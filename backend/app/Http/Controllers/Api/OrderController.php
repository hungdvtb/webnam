<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attribute;
use App\Models\Carrier;
use App\Models\Cart;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Customer;
use App\Models\Invoice;
use App\Models\OrderStatus;
use App\Models\Product;
use App\Models\QuoteTemplate;
use App\Models\Shipment;
use App\Models\ShipmentItem;
use App\Models\ShipmentStatusLog;
use App\Models\ShippingIntegration;
use App\Models\SiteSetting;
use App\Support\OrderStatusCatalog;
use App\Services\Inventory\InventoryService;
use App\Services\OrderInventorySlipService;
use App\Services\RepeatCustomerPhoneService;
use App\Services\Shipping\ShipmentDispatchService;
use App\Services\Shipping\ShippingAlertService;
use App\Services\Shipping\ShipmentStatusSyncService;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class OrderController extends Controller
{
    private const BOOTSTRAP_CACHE_TTL_SECONDS = 15;
    private const ORDER_NUMBER_SEQUENCE_START = 10000;
    private const ORDER_NUMBER_LOCK_WAIT_SECONDS = 10;
    private const ORDER_NUMBER_RETRY_ATTEMPTS = 5;
    private const SHIPPING_STATUS_SOURCE_MANUAL = 'manual';
    private const ORDER_KIND_OFFICIAL = Order::KIND_OFFICIAL;
    private const ORDER_KIND_TEMPLATE = Order::KIND_TEMPLATE;
    private const ORDER_KIND_DRAFT = Order::KIND_DRAFT;
    private const ORDER_KIND_LABELS = [
        self::ORDER_KIND_OFFICIAL => 'Đơn hàng chính',
        self::ORDER_KIND_TEMPLATE => 'Đơn hàng mẫu',
        self::ORDER_KIND_DRAFT => 'Đơn nháp',
    ];
    private const QUOTE_SETTING_KEYS = [
        'quote_logo_url',
        'quote_store_name',
        'quote_store_address',
        'quote_store_phone',
    ];

    public function __construct(
        protected RepeatCustomerPhoneService $repeatCustomerPhoneService,
        protected OrderInventorySlipService $orderInventorySlipService,
    ) {
    }

    private function freshShippingState(): array
    {
        return [
            'shipping_status' => null,
            'shipping_synced_at' => null,
            'shipping_status_source' => self::SHIPPING_STATUS_SOURCE_MANUAL,
            'shipping_carrier_code' => null,
            'shipping_carrier_name' => null,
            'shipping_tracking_code' => null,
            'shipping_dispatched_at' => null,
            'shipping_issue_code' => null,
            'shipping_issue_message' => null,
            'shipping_issue_detected_at' => null,
        ];
    }

    private function orderDetailRelations(): array
    {
        return [
            'items' => fn ($query) => $query
                ->select([
                    'id',
                    'order_id',
                    'account_id',
                    'product_id',
                    'product_name_snapshot',
                    'product_sku_snapshot',
                    'quantity',
                    'price',
                    'cost_price',
                    'cost_total',
                    'profit_total',
                    'options',
                ])
                ->with([
                    'product:id,name,sku,cost_price,expected_cost',
                ]),
            'attributeValues' => fn ($query) => $query
                ->select(['id', 'order_id', 'attribute_id', 'value'])
                ->with([
                    'attribute:id,code,name',
                ]),
        ];
    }

    private function orderPrintRelations(): array
    {
        return [
            'items' => fn ($query) => $query
                ->select([
                    'id',
                    'order_id',
                    'account_id',
                    'product_id',
                    'product_name_snapshot',
                    'product_sku_snapshot',
                    'quantity',
                    'price',
                ])
                ->with([
                    'product:id,name,sku',
                ]),
        ];
    }

    private function mutationResponsePayload(Order $order): array
    {
        $order->refresh();

        return [
            'id' => (int) $order->id,
            'order_number' => $order->order_number,
            'order_kind' => $this->normalizeOrderKind((string) $order->order_kind),
            'status' => $order->status,
            'customer_name' => $order->customer_name,
            'customer_phone' => $order->customer_phone,
            'total_price' => (float) $order->total_price,
            'shipping_status_source' => $order->shipping_status_source ?: self::SHIPPING_STATUS_SOURCE_MANUAL,
            'converted_from_order_id' => $order->converted_from_order_id,
            'converted_from_kind' => $order->converted_from_kind,
            'updated_at' => $order->updated_at?->toISOString(),
        ];
    }

    private function normalizeOrderKind(?string $orderKind): string
    {
        $normalized = Str::lower(trim((string) $orderKind));

        return in_array($normalized, Order::KINDS, true)
            ? $normalized
            : self::ORDER_KIND_OFFICIAL;
    }

    private function shouldManageInventory(string $orderKind): bool
    {
        return $this->normalizeOrderKind($orderKind) === self::ORDER_KIND_OFFICIAL;
    }

    private function requiresOfficialValidation(string $orderKind): bool
    {
        return $this->normalizeOrderKind($orderKind) === self::ORDER_KIND_OFFICIAL;
    }

    private function orderNumberPrefix(string $orderKind): string
    {
        return match ($this->normalizeOrderKind($orderKind)) {
            self::ORDER_KIND_TEMPLATE => 'TM',
            self::ORDER_KIND_DRAFT => 'DR',
            default => 'OR',
        };
    }

    private function withOrderNumberLock(string $orderKind, callable $callback)
    {
        $connection = DB::connection();
        $lockName = 'orders:order-number:' . $this->orderNumberPrefix($orderKind);
        $driver = $connection->getDriverName();

        if ($driver === 'mysql') {
            $row = $connection->selectOne('SELECT GET_LOCK(?, ?) AS acquired', [
                $lockName,
                self::ORDER_NUMBER_LOCK_WAIT_SECONDS,
            ]);

            if ((int) ($row->acquired ?? 0) !== 1) {
                throw new \RuntimeException('Không thể khóa bộ sinh mã đơn hàng.');
            }

            try {
                return $callback();
            } finally {
                $connection->select('SELECT RELEASE_LOCK(?)', [$lockName]);
            }
        }

        if ($driver === 'pgsql') {
            $lockKey = abs((int) crc32($lockName));
            $connection->statement('SELECT pg_advisory_lock(?)', [$lockKey]);

            try {
                return $callback();
            } finally {
                $connection->statement('SELECT pg_advisory_unlock(?)', [$lockKey]);
            }
        }

        return $callback();
    }

    private function isOrderNumberUniqueViolation(QueryException $exception): bool
    {
        $sqlState = (string) ($exception->errorInfo[0] ?? $exception->getCode());
        $message = Str::lower($exception->getMessage());

        if (!Str::contains($message, ['order_number', 'orders.order_number', 'orders_order_number_unique'])) {
            return false;
        }

        return in_array($sqlState, ['23000', '23505', '19'], true)
            || Str::contains($message, ['duplicate', 'unique', 'constraint']);
    }

    private function runOrderNumberMutation(string $orderKind, callable $callback)
    {
        $normalizedKind = $this->normalizeOrderKind($orderKind);

        for ($attempt = 1; $attempt <= self::ORDER_NUMBER_RETRY_ATTEMPTS; $attempt++) {
            try {
                return $this->withOrderNumberLock($normalizedKind, $callback);
            } catch (QueryException $exception) {
                if ($attempt === self::ORDER_NUMBER_RETRY_ATTEMPTS || !$this->isOrderNumberUniqueViolation($exception)) {
                    throw $exception;
                }

                usleep($attempt * 50000);
            }
        }

        throw new \RuntimeException('Không thể sinh mã đơn hàng duy nhất.');
    }

    private function generateOrderNumber(?string $orderKind = null, ?int $ignoreOrderId = null): string
    {
        $orderKind = $this->normalizeOrderKind($orderKind);
        $prefix = $this->orderNumberPrefix($orderKind);

        $latestOrderNumber = Order::withTrashed()
            ->where('order_number', 'LIKE', $prefix . '%A0')
            ->orderByRaw('LENGTH(order_number) DESC')
            ->orderBy('order_number', 'desc')
            ->value('order_number');

        $nextNumber = self::ORDER_NUMBER_SEQUENCE_START;
        if (is_string($latestOrderNumber) && preg_match('/^' . preg_quote($prefix, '/') . '(\d+)A0$/', $latestOrderNumber, $matches)) {
            $nextNumber = max(self::ORDER_NUMBER_SEQUENCE_START, ((int) $matches[1]) + 1);
        }

        while (true) {
            $candidate = "{$prefix}{$nextNumber}A0";
            $existsQuery = Order::withTrashed()->where('order_number', $candidate);

            if ($ignoreOrderId) {
                $existsQuery->where('id', '!=', $ignoreOrderId);
            }

            if (!$existsQuery->exists()) {
                return $candidate;
            }

            $nextNumber++;
        }
    }

    private function defaultStatusForKind(int $accountId, string $orderKind, ?string $currentStatus = null): string
    {
        if ($this->normalizeOrderKind($orderKind) !== self::ORDER_KIND_OFFICIAL) {
            return $currentStatus ?: 'new';
        }

        return OrderStatus::query()
            ->where('account_id', $accountId)
            ->where('is_default', true)
            ->value('code') ?: ($currentStatus ?: 'new');
    }

    private function validateOfficialOrderPayload(array $payload, string $regionType = 'new'): void
    {
        $province = trim((string) ($payload['province'] ?? ''));
        $district = trim((string) ($payload['district'] ?? ''));
        $ward = trim((string) ($payload['ward'] ?? ''));
        $shippingAddress = trim((string) ($payload['shipping_address'] ?? ''));

        if ($province === '' || $ward === '' || ($regionType === 'old' && $district === '')) {
            throw ValidationException::withMessages([
                'shipping_address' => 'Đơn chính thức phải có đầy đủ khu vực giao hàng.',
            ]);
        }

        if ($shippingAddress === '') {
            throw ValidationException::withMessages([
                'shipping_address' => 'Đơn chính thức phải có địa chỉ giao hàng.',
            ]);
        }
    }

    private function collectRequestItems(Request $request): array
    {
        if ($request->has('items')) {
            return collect($request->input('items', []))
                ->map(fn ($item) => is_array($item) ? $item : [])
                ->filter(fn ($item) => !empty($item['product_id']) && (int) ($item['quantity'] ?? 0) > 0)
                ->values()
                ->all();
        }

        $cart = Cart::with('items.product')->where('user_id', Auth::id())->first();
        if (!$cart || !isset($cart->items) || $cart->items->isEmpty()) {
            throw ValidationException::withMessages([
                'items' => 'Đơn hàng chưa có sản phẩm.',
            ]);
        }

        return $cart->items->map(function ($item) {
            $product = $item->product;

            return [
                'product_id' => $item->product_id,
                'quantity' => $item->quantity,
                'price' => $product ? ($product->current_price ?? $item->price) : $item->price,
                'cost_price' => $product?->cost_price ?? $product?->expected_cost ?? 0,
                'options' => $item->options ?? null,
            ];
        })->all();
    }

    private function syncManualOrderItems(Order $order, array $rawItems): array
    {
        $normalizedItems = collect($rawItems)
            ->map(fn ($item) => is_array($item) ? $item : [])
            ->filter(fn ($item) => (int) ($item['quantity'] ?? 0) > 0 && !empty($item['product_id']))
            ->values();

        if ($normalizedItems->isEmpty()) {
            throw ValidationException::withMessages([
                'items' => 'Đơn hàng phải có ít nhất 1 sản phẩm.',
            ]);
        }

        $productIds = $normalizedItems->pluck('product_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        $products = Product::query()
            ->whereIn('id', $productIds)
            ->get()
            ->keyBy('id');

        if (count($productIds) !== $products->count()) {
            throw ValidationException::withMessages([
                'items' => 'Có sản phẩm không tồn tại hoặc không thuộc cửa hàng hiện tại.',
            ]);
        }

        $createdItems = [];

        foreach ($normalizedItems as $item) {
            /** @var Product $product */
            $product = $products->get((int) $item['product_id']);
            $quantity = (int) $item['quantity'];
            $price = round((float) ($item['price'] ?? $product->price ?? 0), 2);
            $costPrice = round((float) ($item['cost_price'] ?? $product->cost_price ?? $product->expected_cost ?? 0), 2);
            $costTotal = round($costPrice * $quantity, 2);
            $profitTotal = round(($price * $quantity) - $costTotal, 2);

            $createdItems[] = $order->items()->create([
                'account_id' => $order->account_id,
                'product_id' => $product->id,
                'product_name_snapshot' => $item['name'] ?? $product->name,
                'product_sku_snapshot' => $item['sku'] ?? $product->sku,
                'quantity' => $quantity,
                'price' => $price,
                'cost_price' => $costPrice,
                'cost_total' => $costTotal,
                'profit_total' => $profitTotal,
                'options' => $item['options'] ?? null,
            ]);
        }

        return [
            'items' => $createdItems,
            'total_price' => round(collect($createdItems)->sum(fn ($row) => (float) $row->price * (int) $row->quantity), 2),
            'cost_total' => round(collect($createdItems)->sum(fn ($row) => (float) $row->cost_total), 2),
            'profit_total' => round(collect($createdItems)->sum(fn ($row) => (float) $row->profit_total), 2),
        ];
    }

    private function syncOrderItems(Order $order, array $rawItems, string $orderKind): array
    {
        if ($this->shouldManageInventory($orderKind)) {
            return app(InventoryService::class)->attachInventoryToOrder($order, $rawItems);
        }

        return $this->syncManualOrderItems($order, $rawItems);
    }

    private function releaseInventoryIfNeeded(Order $order): void
    {
        if (!$this->shouldManageInventory((string) $order->order_kind)) {
            return;
        }

        app(InventoryService::class)->releaseOrderInventory($order);
    }

    private function reserveInventoryIfNeeded(Order $order): array
    {
        if (!$this->shouldManageInventory((string) $order->order_kind)) {
            return [
                'items' => $order->items,
                'total_price' => round((float) $order->items()->sum(DB::raw('price * quantity')), 2),
                'cost_total' => round((float) $order->items()->sum('cost_total'), 2),
                'profit_total' => round((float) $order->items()->sum('profit_total'), 2),
            ];
        }

        return app(InventoryService::class)->reserveOrderInventory($order->fresh(['items']));
    }

    private function syncOrderAttributes(Order $order, array $customAttributes = []): void
    {
        if (empty($customAttributes)) {
            return;
        }

        $attrCodes = array_keys($customAttributes);
        $existingAttrs = \App\Models\Attribute::query()
            ->where('account_id', $order->account_id)
            ->whereIn('code', $attrCodes)
            ->get()
            ->keyBy('code');

        foreach ($customAttributes as $attrCode => $value) {
            $attribute = $existingAttrs->get($attrCode);

            if (!$attribute) {
                $attribute = \App\Models\Attribute::create([
                    'account_id' => $order->account_id,
                    'code' => $attrCode,
                    'name' => ucwords(str_replace('_', ' ', $attrCode)),
                    'frontend_type' => 'text',
                ]);
                $existingAttrs->put($attrCode, $attribute);
            }

            \App\Models\OrderAttributeValue::updateOrCreate(
                [
                    'order_id' => $order->id,
                    'attribute_id' => $attribute->id,
                ],
                [
                    'value' => is_array($value) ? json_encode($value) : $value,
                ]
            );
        }
    }

    private function recalculateOrderTotals(Order $order, float $itemRevenue, float $costTotal): void
    {
        $finalTotal = round(
            $itemRevenue + (float) ($order->shipping_fee ?? 0) - (float) ($order->discount ?? 0),
            2
        );

        $order->forceFill([
            'total_price' => $finalTotal,
            'cost_total' => round($costTotal, 2),
            'profit_total' => round($finalTotal - $costTotal, 2),
        ])->save();
    }

    private function syncOfficialCustomerAndInvoice(Order $order, bool $syncCustomerStats = true): void
    {
        if (!$this->shouldManageInventory((string) $order->order_kind)) {
            return;
        }

        $phone = trim((string) $order->customer_phone);
        $customer = null;

        if ($phone !== '') {
            $customer = Customer::firstOrCreate(
                ['account_id' => $order->account_id, 'phone' => $phone],
                [
                    'name' => $order->customer_name,
                    'email' => $order->customer_email,
                    'address' => $order->shipping_address,
                ]
            );

            $customer->forceFill([
                'name' => $order->customer_name ?: $customer->name,
                'email' => $order->customer_email ?: $customer->email,
                'address' => $order->shipping_address ?: $customer->address,
            ])->save();
        }

        if ($customer && (int) $order->customer_id !== (int) $customer->id) {
            $order->forceFill(['customer_id' => $customer->id])->save();
        }

        if ($customer && $syncCustomerStats) {
            $customer->increment('total_orders');
            $customer->increment('total_spent', (float) $order->total_price);
        }

        Invoice::updateOrCreate(
            ['order_id' => $order->id],
            [
                'invoice_number' => Invoice::query()->where('order_id', $order->id)->value('invoice_number') ?: 'INV-' . strtoupper(Str::random(10)),
                'amount' => $order->total_price,
                'status' => 'pending',
                'due_date' => now()->addDays(3),
            ]
        );
    }

    private function removeOfficialSideEffects(Order $order): void
    {
        Invoice::query()->where('order_id', $order->id)->delete();
        $order->forceFill(['customer_id' => null])->save();
    }

    private function guardConvertOrderKind(Order $order, string $targetKind): void
    {
        $currentKind = $this->normalizeOrderKind((string) $order->order_kind);
        $targetKind = $this->normalizeOrderKind($targetKind);

        if ($currentKind === $targetKind) {
            throw ValidationException::withMessages([
                'order_kind' => 'Đơn hàng đã ở đúng nhóm được chọn.',
            ]);
        }

        if ($targetKind !== self::ORDER_KIND_OFFICIAL && $order->shipments()->exists()) {
            throw ValidationException::withMessages([
                'order_kind' => 'Không thể chuyển đơn đã có vận đơn sang nhóm khác.',
            ]);
        }

        if ($targetKind !== self::ORDER_KIND_OFFICIAL && $order->inventoryDocuments()->exists()) {
            throw ValidationException::withMessages([
                'order_kind' => 'Không thể chuyển đơn đã có phiếu kho sang nhóm khác.',
            ]);
        }
    }

    private function duplicateOrderToKind(Order $original, string $targetKind): Order
    {
        $targetKind = $this->normalizeOrderKind($targetKind);

        return $this->runOrderNumberMutation($targetKind, function () use ($original, $targetKind) {
            return DB::transaction(function () use ($original, $targetKind) {
                $newOrder = $original->replicate([
                    'order_number',
                    'customer_id',
                    'shipping_status',
                    'shipping_synced_at',
                    'shipping_status_source',
                    'shipping_carrier_code',
                    'shipping_carrier_name',
                    'shipping_tracking_code',
                    'shipping_dispatched_at',
                    'shipping_issue_code',
                    'shipping_issue_message',
                    'shipping_issue_detected_at',
                    'deleted_at',
                ]);

                $newOrder->order_number = $this->generateOrderNumber($targetKind);
                $newOrder->order_kind = $targetKind;
                $newOrder->converted_from_order_id = $original->id;
                $newOrder->converted_from_kind = $this->normalizeOrderKind((string) $original->order_kind);
                $newOrder->customer_id = null;
                $newOrder->status = $this->defaultStatusForKind($original->account_id, $targetKind, $original->status);
                $newOrder->forceFill($this->freshShippingState());
                $newOrder->save();

                $rawItems = $original->items->map(function (OrderItem $item) {
                    return [
                        'product_id' => $item->product_id,
                        'name' => $item->product_name_snapshot,
                        'sku' => $item->product_sku_snapshot,
                        'quantity' => $item->quantity,
                        'price' => $item->price,
                        'cost_price' => $item->cost_price,
                        'options' => $item->options,
                    ];
                })->all();

                $summary = $this->syncOrderItems($newOrder, $rawItems, $targetKind);
                $this->recalculateOrderTotals($newOrder, (float) ($summary['total_price'] ?? 0), (float) ($summary['cost_total'] ?? 0));

                foreach ($original->attributeValues as $attributeValue) {
                    $newValue = $attributeValue->replicate();
                    $newValue->order_id = $newOrder->id;
                    $newValue->save();
                }

                if ($this->shouldManageInventory($targetKind)) {
                    $this->syncOfficialCustomerAndInvoice($newOrder, true);
                }

                return $newOrder;
            });
        });
    }

    private function convertOrderToKind(Order $order, string $targetKind, array $payload = []): Order
    {
        $targetKind = $this->normalizeOrderKind($targetKind);
        $currentKind = $this->normalizeOrderKind((string) $order->order_kind);

        $this->guardConvertOrderKind($order, $targetKind);

        if ($this->requiresOfficialValidation($targetKind)) {
            $this->validateOfficialOrderPayload([
                'province' => $payload['province'] ?? $order->province,
                'district' => $payload['district'] ?? $order->district,
                'ward' => $payload['ward'] ?? $order->ward,
                'shipping_address' => $payload['shipping_address'] ?? $order->shipping_address,
            ], (string) ($payload['region_type'] ?? 'new'));
        }

        return $this->runOrderNumberMutation($targetKind, function () use ($order, $targetKind, $currentKind) {
            return DB::transaction(function () use ($order, $targetKind, $currentKind) {
                if ($this->shouldManageInventory($currentKind)) {
                    $this->releaseInventoryIfNeeded($order);
                    $this->removeOfficialSideEffects($order);
                }

                $order->forceFill(array_merge([
                    'order_kind' => $targetKind,
                    'converted_from_order_id' => $order->converted_from_order_id ?: $order->id,
                    'converted_from_kind' => $currentKind,
                    'order_number' => $this->generateOrderNumber($targetKind, $order->id),
                    'status' => $this->defaultStatusForKind($order->account_id, $targetKind, $order->status),
                ], $this->freshShippingState()))->save();

                if ($this->shouldManageInventory($targetKind)) {
                    $summary = $this->reserveInventoryIfNeeded($order);
                    $this->recalculateOrderTotals($order, (float) ($summary['total_price'] ?? 0), (float) ($summary['cost_total'] ?? 0));
                    $this->syncOfficialCustomerAndInvoice($order, false);
                }

                return $order;
            });
        });
    }

    private function generateShipmentNumber(?int $accountId = null): string
    {
        $baseCount = Shipment::withoutGlobalScopes()
            ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
            ->whereDate('created_at', today())
            ->count();

        do {
            $baseCount++;
            $shipmentNumber = 'VD-' . now()->format('Ymd') . '-' . str_pad((string) $baseCount, 4, '0', STR_PAD_LEFT);
        } while (
            Shipment::withoutGlobalScopes()
                ->where('shipment_number', $shipmentNumber)
                ->exists()
        );

        return $shipmentNumber;
    }

    private function resolveManualCarrierMeta(string $carrierName): array
    {
        $normalizedName = trim($carrierName);

        if ($normalizedName === '') {
            return ['code' => null, 'name' => null];
        }

        $carrier = Carrier::query()
            ->where(function ($query) use ($normalizedName) {
                $query
                    ->where('code', $normalizedName)
                    ->orWhereRaw('LOWER(name) = ?', [Str::lower($normalizedName)]);
            })
            ->first();

        return [
            'code' => $carrier?->code,
            'name' => $carrier?->name ?: $normalizedName,
        ];
    }

    private function createQuickShipmentForOrder(
        Order $order,
        array $shipmentInput,
        ShipmentStatusSyncService $syncService
    ): Shipment {
        return DB::transaction(function () use ($order, $shipmentInput, $syncService) {
            $activeShipment = $order->shipments()
                ->whereNotIn('shipment_status', ['canceled'])
                ->latest('id')
                ->first();

            if ($activeShipment) {
                throw new \RuntimeException("Đơn đã có vận đơn {$activeShipment->shipment_number}.");
            }

            $carrierMeta = $this->resolveManualCarrierMeta((string) $shipmentInput['carrier_name']);
            $trackingNumber = trim((string) $shipmentInput['tracking_number']);
            $shippingCost = (float) $shipmentInput['shipping_cost'];
            $codAmount = max(0, (float) ($order->total_price ?? 0));

            $shipment = Shipment::create([
                'account_id' => $order->account_id,
                'order_id' => $order->id,
                'order_code' => $order->order_number,
                'shipment_number' => $this->generateShipmentNumber($order->account_id),
                'tracking_number' => $trackingNumber,
                'carrier_tracking_code' => $trackingNumber,
                'carrier_code' => $carrierMeta['code'],
                'carrier_name' => $carrierMeta['name'],
                'channel' => 'manual',
                'customer_id' => $order->customer_id,
                'customer_name' => $order->customer_name,
                'customer_phone' => $order->customer_phone,
                'customer_address' => $order->shipping_address,
                'customer_ward' => $order->ward,
                'customer_district' => $order->district,
                'customer_province' => $order->province,
                'status' => 'out_for_delivery',
                'shipment_status' => 'out_for_delivery',
                'order_status_snapshot' => $order->status,
                'cod_amount' => $codAmount,
                'shipping_cost' => $shippingCost,
                'service_fee' => 0,
                'actual_received_amount' => max(0, $codAmount - $shippingCost),
                'created_by' => auth()->id(),
                'shipped_at' => now(),
                'out_for_delivery_at' => now(),
                'extra_data' => [
                    'manual_quick_dispatch' => true,
                    'manual_input' => [
                        'tracking_number' => $trackingNumber,
                        'carrier_name' => $carrierMeta['name'],
                        'shipping_cost' => $shippingCost,
                    ],
                ],
            ]);

            OrderItem::query()
                ->where('order_id', $order->id)
                ->get()
                ->each(function (OrderItem $item) use ($shipment) {
                    ShipmentItem::create([
                        'shipment_id' => $shipment->id,
                        'order_item_id' => $item->id,
                        'qty' => $item->quantity,
                    ]);
                });

            ShipmentStatusLog::create([
                'shipment_id' => $shipment->id,
                'from_status' => null,
                'to_status' => 'out_for_delivery',
                'changed_by' => auth()->id(),
                'change_source' => 'manual',
                'reason' => 'Gửi vận chuyển nhanh từ quản lý đơn hàng',
            ]);

            $syncService->syncOrderFromShipment($shipment, 'manual_quick_dispatch', auth()->id());

            return $shipment->fresh(['order', 'items.orderItem.product']);
        });
    }

    private function resolveAccountId(Request $request): int
    {
        return (int) $request->header('X-Account-Id');
    }

    private function scopedOrderQuery(Request $request, bool $withTrashed = false)
    {
        $query = $withTrashed ? Order::withTrashed() : Order::query();
        $accountId = $this->resolveAccountId($request);

        if ($accountId > 0) {
            $query->where('account_id', $accountId);
        }

        return $query;
    }

    private function findScopedOrder(Request $request, int $id, bool $withTrashed = false): Order
    {
        return $this->scopedOrderQuery($request, $withTrashed)->findOrFail($id);
    }

    private function repeatPhoneMetaForOrder(array $repeatMetaMap, int $orderId): array
    {
        return $repeatMetaMap["order:{$orderId}"] ?? [
            'is_repeat_customer_phone' => false,
            'repeat_phone_previous_count' => 0,
            'normalized_phone' => null,
        ];
    }

    private function transformOrderListItems(Collection $orders, int $accountId): Collection
    {
        $repeatMetaMap = $this->repeatCustomerPhoneService->buildOrderMeta($orders, $accountId);
        $inventorySlipSummaryMap = $this->orderInventorySlipService->buildListSummaryMap($orders);

        return $orders->map(function (Order $order) use ($repeatMetaMap, $inventorySlipSummaryMap) {
            return array_merge(
                $order->toArray(),
                $this->repeatPhoneMetaForOrder($repeatMetaMap, (int) $order->id),
                [
                    'inventory_slip_summary' => $inventorySlipSummaryMap[(int) $order->id] ?? null,
                ]
            );
        })->values();
    }

    private function connectedCarrierCacheKey(int $accountId): string
    {
        return "orders:connected-carriers:{$accountId}";
    }

    private function bootstrapCacheKey(int $accountId, string $mode): string
    {
        return "orders:bootstrap:{$accountId}:{$mode}";
    }

    private function loadOrderKindCounts(int $accountId): array
    {
        $baseCounts = Order::query()
            ->where('account_id', $accountId)
            ->selectRaw('COALESCE(order_kind, ?) as order_kind, COUNT(*) as aggregate', [self::ORDER_KIND_OFFICIAL])
            ->groupBy('order_kind')
            ->pluck('aggregate', 'order_kind');

        return [
            self::ORDER_KIND_OFFICIAL => (int) ($baseCounts[self::ORDER_KIND_OFFICIAL] ?? 0),
            self::ORDER_KIND_TEMPLATE => (int) ($baseCounts[self::ORDER_KIND_TEMPLATE] ?? 0),
            self::ORDER_KIND_DRAFT => (int) ($baseCounts[self::ORDER_KIND_DRAFT] ?? 0),
            'trash' => (int) Order::onlyTrashed()->where('account_id', $accountId)->count(),
        ];
    }

    private function loadConnectedCarriers(int $accountId): array
    {
        return Cache::remember(
            $this->connectedCarrierCacheKey($accountId),
            now()->addSeconds(self::BOOTSTRAP_CACHE_TTL_SECONDS),
            function () use ($accountId) {
                return ShippingIntegration::query()
                    ->where('account_id', $accountId)
                    ->where('is_enabled', true)
                    ->where(function ($query) {
                        $query
                            ->where('connection_status', 'connected')
                            ->orWhere('connection_status', 'configured')
                            ->orWhereNotNull('access_token');
                    })
                    ->orderBy('carrier_name')
                    ->with('defaultWarehouse:id,name')
                    ->get([
                        'carrier_code',
                        'carrier_name',
                        'connection_status',
                        'is_enabled',
                        'access_token',
                        'webhook_url',
                        'default_warehouse_id',
                    ])
                    ->map(function (ShippingIntegration $integration) {
                        $effectiveStatus = $integration->connection_status ?: 'configured';
                        if ($integration->is_enabled && filled($integration->access_token) && $effectiveStatus === 'disconnected') {
                            $effectiveStatus = 'configured';
                        }

                        return [
                            'carrier_code' => $integration->carrier_code,
                            'carrier_name' => $integration->carrier_name,
                            'connection_status' => $effectiveStatus,
                            'is_enabled' => $integration->is_enabled,
                            'webhook_url' => $integration->webhook_url,
                            'default_warehouse_id' => $integration->default_warehouse_id,
                            'default_warehouse_name' => $integration->defaultWarehouse?->name,
                        ];
                    })
                    ->values()
                    ->all();
            }
        );
    }

    private function loadOrderAttributes(string $entityType): array
    {
        return Attribute::query()
            ->with('options')
            ->byEntityType($entityType)
            ->where('status', true)
            ->orderBy('name')
            ->get()
            ->toArray();
    }

    private function loadOrderStatuses(int $accountId): array
    {
        OrderStatusCatalog::ensurePrintedStatus($accountId);

        return OrderStatus::query()
            ->where('account_id', $accountId)
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get()
            ->toArray();
    }

    private function buildPrintableAddress(Order $order): string
    {
        $parts = [];

        foreach ([$order->shipping_address, $order->ward, $order->district, $order->province] as $rawPart) {
            $part = trim((string) $rawPart);
            if ($part === '') {
                continue;
            }

            $exists = collect($parts)->contains(function (string $existing) use ($part) {
                $existingLower = Str::lower($existing);
                $partLower = Str::lower($part);

                return $existingLower === $partLower
                    || Str::contains($existingLower, $partLower)
                    || Str::contains($partLower, $existingLower);
            });

            if (!$exists) {
                $parts[] = $part;
            }
        }

        return implode(', ', $parts);
    }

    private function transformPrintableOrders(Collection $orders): array
    {
        return $orders
            ->map(function (Order $order) {
                return [
                    'id' => (int) $order->id,
                    'order_number' => $order->order_number,
                    'customer_name' => $order->customer_name,
                    'customer_phone' => $order->customer_phone,
                    'shipping_address' => $this->buildPrintableAddress($order),
                    'notes' => trim((string) $order->notes),
                    'total_payment' => (float) $order->total_price,
                    'created_at' => $order->created_at?->toISOString(),
                    'items' => $order->items
                        ->map(function (OrderItem $item) {
                            $productName = trim((string) ($item->product_name_snapshot ?: $item->product?->name ?: ('Sản phẩm #' . $item->product_id)));
                            $productSku = trim((string) ($item->product_sku_snapshot ?: $item->product?->sku ?: ''));
                            $quantity = (int) $item->quantity;
                            $unitPrice = (float) $item->price;

                            return [
                                'id' => (int) $item->id,
                                'name' => $productName,
                                'sku' => $productSku !== '' ? $productSku : null,
                                'quantity' => $quantity,
                                'unit_price' => $unitPrice,
                                'line_total' => round($quantity * $unitPrice, 2),
                            ];
                        })
                        ->values()
                        ->all(),
                ];
            })
            ->values()
            ->all();
    }

    private function loadQuoteSettings(int $accountId): array
    {
        $settings = array_fill_keys(self::QUOTE_SETTING_KEYS, '');

        return array_merge(
            $settings,
            SiteSetting::query()
                ->where('account_id', $accountId)
                ->whereIn('key', self::QUOTE_SETTING_KEYS)
                ->pluck('value', 'key')
                ->toArray()
        );
    }

    public function bootstrap(Request $request)
    {
        $accountId = $this->resolveAccountId($request);
        if (!$accountId) {
            return response()->json([]);
        }

        $mode = strtolower((string) $request->input('mode', 'list'));
        if (!in_array($mode, ['list', 'form'], true)) {
            $mode = 'list';
        }

        $payload = Cache::remember(
            $this->bootstrapCacheKey($accountId, $mode),
            now()->addSeconds(self::BOOTSTRAP_CACHE_TTL_SECONDS),
            function () use ($accountId, $mode) {
                if ($mode === 'form') {
                    return [
                        'order_statuses' => $this->loadOrderStatuses($accountId),
                        'order_attributes' => $this->loadOrderAttributes('order'),
                        'product_attributes' => $this->loadOrderAttributes('product'),
                        'quote_settings' => $this->loadQuoteSettings($accountId),
                        'quote_templates' => QuoteTemplate::query()
                            ->where('account_id', $accountId)
                            ->orderBy('sort_order')
                            ->orderBy('name')
                            ->get()
                            ->toArray(),
                    ];
                }

                return [
                    'order_statuses' => $this->loadOrderStatuses($accountId),
                    'order_attributes' => $this->loadOrderAttributes('order'),
                    'connected_carriers' => $this->loadConnectedCarriers($accountId),
                    'order_kind_counts' => $this->loadOrderKindCounts($accountId),
                ];
            }
        );

        return response()->json($payload);
    }

    public function index(Request $request)
    {
        $accountId = $this->resolveAccountId($request);
        
        // Base select for listing - avoid * to reduce payload
        $query = Order::query()
            ->where('account_id', $accountId)
            ->select([
                'id', 'order_number', 'total_price', 'status', 'customer_name', 
                'customer_phone', 'shipping_address', 'province', 'district', 'ward', 'created_at', 'notes',
                'type', 'order_kind', 'converted_from_order_id', 'converted_from_kind',
                'shipping_status', 'shipping_carrier_code', 'shipping_carrier_name',
                'shipping_tracking_code', 'shipping_dispatched_at',
                'shipping_issue_code', 'shipping_issue_message', 'shipping_issue_detected_at',
                'deleted_at',
            ]);

        // Eager load only what is needed for the table
        $query->with([
            'items:id,order_id,account_id,product_id,product_name_snapshot,product_sku_snapshot,quantity,price',
            'attributeValues:id,order_id,attribute_id,value',
            'activeShipment:id,order_id,shipment_number,carrier_name,carrier_tracking_code,shipment_status,problem_code,problem_message,problem_detected_at'
        ]);

        if ($request->input('trashed') == '1') {
            $query->onlyTrashed();
        }

        $requestedKind = $this->normalizeOrderKind($request->input('order_kind'));
        if ($request->input('trashed') != '1') {
            $query->where(function ($kindQuery) use ($requestedKind) {
                $kindQuery
                    ->where('order_kind', $requestedKind)
                    ->orWhere(function ($fallbackQuery) use ($requestedKind) {
                        if ($requestedKind !== self::ORDER_KIND_OFFICIAL) {
                            $fallbackQuery->whereRaw('1 = 0');
                            return;
                        }

                        $fallbackQuery
                            ->whereNull('order_kind')
                            ->orWhere('order_kind', '');
                    });
            });
        }
        
        $query->when($request->filled('search'), function($q) use ($request) {
            $search = $request->input('search');
            $q->where(function($sub) use ($search) {
                // Order-level fields
                $sub->where('order_number', 'like', "{$search}%")
                    ->orWhere('customer_name', 'like', "%{$search}%")
                    ->orWhere('customer_phone', 'like', "{$search}%")
                    ->orWhere('shipping_address', 'like', "%{$search}%")
                    ->orWhere('notes', 'like', "%{$search}%")
                    ->orWhere('shipping_tracking_code', 'like', "%{$search}%")
                    // Product-level: search by snapshot SKU/name stored in order_items
                    ->orWhereHas('items', function($iq) use ($search) {
                        $iq->where('product_sku_snapshot', 'like', "%{$search}%")
                           ->orWhere('product_name_snapshot', 'like', "%{$search}%");
                    })
                    // Also search live product data via JOIN (catches new/updated products)
                    ->orWhereHas('items.product', function($pq) use ($search) {
                        $pq->where('sku', 'like', "%{$search}%")
                           ->orWhere('name', 'like', "%{$search}%");
                    });
            });
        })
        ->when($request->filled('customer_name'), function($q) use ($request) {
            $q->where('customer_name', 'like', "%{$request->customer_name}%");
        })
        ->when($request->filled('order_number'), function($q) use ($request) {
            $q->where('order_number', 'like', "{$request->order_number}%");
        })
        ->when($request->filled('customer_phone'), function($q) use ($request) {
            $q->where('customer_phone', 'like', "{$request->customer_phone}%");
        })
        ->when($request->filled('shipping_address'), function($q) use ($request) {
            $q->where('shipping_address', 'like', "%{$request->shipping_address}%");
        })
        ->when($request->filled('status'), function($q) use ($request) {
            $statuses = is_array($request->status) ? $request->status : explode(',', $request->status);
            $q->whereIn('status', $statuses);
        })
        ->when($request->filled('created_at_from'), function($q) use ($request) {
            $q->whereDate('created_at', '>=', $request->created_at_from);
        })
        ->when($request->filled('created_at_to'), function($q) use ($request) {
            $q->whereDate('created_at', '<=', $request->created_at_to);
        })
        ->when($request->filled('shipping_carrier_code'), function($q) use ($request) {
            $q->where('shipping_carrier_code', $request->shipping_carrier_code);
        })
        ->when($request->filled('shipping_dispatched_from'), function($q) use ($request) {
            $q->whereDate('shipping_dispatched_at', '>=', $request->shipping_dispatched_from);
        })
        ->when($request->filled('shipping_dispatched_to'), function($q) use ($request) {
            $q->whereDate('shipping_dispatched_at', '<=', $request->shipping_dispatched_to);
        })
        ->when($request->filled('export_slip_state'), function ($q) use ($request) {
            $state = trim((string) $request->input('export_slip_state'));
            $this->orderInventorySlipService->applyExportSlipStateFilter($q, $state);
        });

        // Optimize Dynamic Attribute Filters (EAV) using JOIN for large data
        foreach ($request->all() as $key => $value) {
            if (strpos($key, 'attr_order_') === 0 && !empty($value)) {
                $attrId = str_replace('attr_order_', '', $key);
                $query->whereExists(function ($q) use ($attrId, $value) {
                    $q->select(DB::raw(1))
                        ->from('order_attribute_values')
                        ->whereRaw('order_attribute_values.order_id = orders.id')
                        ->where('attribute_id', $attrId)
                        ->where('value', 'like', "%{$value}%");
                });
            }
        }

        $sortBy = $request->input('sort_by', 'created_at');
        $sortOrder = $request->input('sort_order', 'desc');
        
        if ($sortBy === 'status') {
            $query->leftJoin('order_statuses', function($join) use ($accountId) {
                    $join->on('orders.status', '=', 'order_statuses.code')
                         ->where('order_statuses.account_id', '=', $accountId);
                })
                ->orderBy('order_statuses.sort_order', $sortOrder);
        } else {
            $validSortFields = ['id', 'order_number', 'customer_name', 'created_at', 'total_price', 'status', 'shipping_dispatched_at'];
            $field = in_array($sortBy, $validSortFields) ? $sortBy : 'created_at';
            $query->orderBy($field, $sortOrder);
        }

        $perPage = (int) $request->input('per_page', 20);
        // Ensure per_page is capped to prevent DOS
        $perPage = min(max($perPage, 1), 100);

        $paginator = $query->paginate($perPage);
        $paginator->setCollection(
            $this->transformOrderListItems(collect($paginator->items()), $accountId)
        );

        $response = $paginator->toArray();
        $response['order_kind_counts'] = $this->loadOrderKindCounts($accountId);

        return response()->json($response);
    }

    public function inventorySlips(Request $request, int $id)
    {
        $order = $this->findScopedOrder($request, $id);

        return response()->json(
            $this->orderInventorySlipService->getOrderDetail($order)
        );
    }

    public function storeInventorySlip(Request $request, int $id)
    {
        $order = $this->findScopedOrder($request, $id);

        $validated = $request->validate([
            'type' => 'required|string|in:export,return,damaged',
            'document_date' => 'nullable|date',
            'notes' => 'nullable|string|max:5000',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|integer',
            'items.*.quantity' => 'nullable|integer|min:0',
            'items.*.notes' => 'nullable|string|max:1000',
        ]);

        $document = $this->orderInventorySlipService->createSlip($order, $validated, Auth::id());

        return response()->json($document, 201);
    }

    public function destroyInventorySlip(Request $request, int $id, int $documentId)
    {
        $order = $this->findScopedOrder($request, $id);

        if (!$this->shouldManageInventory((string) $order->order_kind)) {
            return response()->json([
                'message' => 'Chỉ đơn hàng chính thức mới có phiếu kho.',
            ], 422);
        }

        $this->orderInventorySlipService->deleteSlip($order, $documentId);

        return response()->json([
            'message' => 'Đã xóa phiếu kho của đơn hàng.',
        ]);
    }

    public function store(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $validated = $request->validate([
            'lead_id' => 'nullable|integer|exists:leads,id',
            'order_kind' => 'nullable|string|in:official,template,draft',
            'region_type' => 'nullable|string|in:new,old',
        ]);

        $orderKind = $this->normalizeOrderKind($validated['order_kind'] ?? null);
        $regionType = (string) ($validated['region_type'] ?? 'new');

        if ($this->requiresOfficialValidation($orderKind)) {
            $this->validateOfficialOrderPayload($request->all(), $regionType);
        }

        $rawItems = $this->collectRequestItems($request);

        return $this->runOrderNumberMutation($orderKind, function () use ($request, $accountId, $rawItems) {
            return DB::transaction(function () use ($request, $accountId, $rawItems) {
            $orderKind = $this->normalizeOrderKind($request->input('order_kind'));
            $lead = null;
            if ($request->filled('lead_id')) {
                $lead = \App\Models\Lead::query()
                    ->where('account_id', $accountId)
                    ->with('statusConfig')
                    ->findOrFail((int) $request->lead_id);
            }

            $order = Order::create(array_merge([
                'user_id' => Auth::id(),
                'account_id' => $accountId,
                'lead_id' => $lead?->id,
                'order_number' => $this->generateOrderNumber($orderKind),
                'order_kind' => $orderKind,
                'total_price' => 0,
                'status' => $request->status ?? $this->defaultStatusForKind($accountId, $orderKind),
                'customer_name' => $request->customer_name,
                'customer_email' => $request->customer_email,
                'customer_phone' => $request->customer_phone,
                'shipping_address' => $request->shipping_address,
                'province' => $request->province,
                'district' => $request->district,
                'ward' => $request->ward,
                'notes' => $request->notes,
                'source' => $request->source,
                'type' => $request->type,
                'shipment_status' => $request->shipment_status,
                'shipping_fee' => $request->shipping_fee ?? 0,
                'discount' => $request->discount ?? 0,
                'cost_total' => 0,
                'profit_total' => 0,
            ], $this->freshShippingState()));

            $summary = $this->syncOrderItems($order, $rawItems, $orderKind);
            $this->recalculateOrderTotals($order, (float) ($summary['total_price'] ?? 0), (float) ($summary['cost_total'] ?? 0));
            $this->syncOrderAttributes($order, (array) $request->input('custom_attributes', []));

            if ($this->shouldManageInventory($orderKind)) {
                $this->syncOfficialCustomerAndInvoice($order, true);
            }

            if (!$request->has('items')) {
                Cart::where('user_id', Auth::id())->first()?->items()->delete();
            }

            if ($lead && $this->shouldManageInventory($orderKind)) {
                $createdStatus = \App\Models\LeadStatus::query()
                    ->where('account_id', $accountId)
                    ->where('code', 'da-tao-don')
                    ->first();

                $lead->update([
                    'order_id' => $order->id,
                    'lead_status_id' => $createdStatus?->id ?? $lead->lead_status_id,
                    'status' => $createdStatus?->code ?? 'da-tao-don',
                    'status_changed_at' => now(),
                ]);

                \App\Models\LeadNote::create([
                    'account_id' => $accountId,
                    'lead_id' => $lead->id,
                    'user_id' => Auth::id(),
                    'staff_name' => Auth::user()?->name ?? 'Nhân viên',
                    'content' => 'Đã tạo đơn hàng ' . $order->order_number,
                ]);

                $lead->forceFill([
                    'latest_note_excerpt' => 'Đã tạo đơn hàng ' . $order->order_number,
                    'last_noted_at' => now(),
                ])->save();
            }

                return response()->json($this->mutationResponsePayload($order), 201);
            });
        });
    }


    public function show(Request $request, $id)
    {
        $order = $this->scopedOrderQuery($request)
            ->select([
                'id',
                'user_id',
                'account_id',
                'lead_id',
                'order_number',
                'order_kind',
                'converted_from_order_id',
                'converted_from_kind',
                'total_price',
                'status',
                'customer_name',
                'customer_email',
                'customer_phone',
                'shipping_address',
                'province',
                'district',
                'ward',
                'notes',
                'source',
                'type',
                'shipment_status',
                'shipping_fee',
                'discount',
                'cost_total',
                'profit_total',
                'created_at',
                'updated_at',
            ])
            ->with($this->orderDetailRelations())
            ->findOrFail((int) $id);

        return response()->json($order);
    }

    public function printData(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
        ]);

        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return response()->json(['message' => 'Chưa chọn đơn hàng nào để in.'], 400);
        }

        $positions = $ids->flip();

        $orders = $this->scopedOrderQuery($request)
            ->whereIn('id', $ids->all())
            ->select([
                'id',
                'order_number',
                'customer_name',
                'customer_phone',
                'shipping_address',
                'province',
                'district',
                'ward',
                'notes',
                'total_price',
                'created_at',
            ])
            ->with($this->orderPrintRelations())
            ->get()
            ->sortBy(fn (Order $order) => $positions->get((int) $order->id, PHP_INT_MAX))
            ->values();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'Không tìm thấy đơn hàng để in.'], 404);
        }

        return response()->json([
            'data' => $this->transformPrintableOrders($orders),
        ]);
    }

    public function update(Request $request, $id)
    {
        $validator = \Illuminate\Support\Facades\Validator::make($request->all(), [
            'order_number' => 'sometimes|string|max:255',
            'customer_name' => 'sometimes|string|max:255',
            'customer_email' => 'nullable|max:255',
            'customer_phone' => 'nullable|string|max:20',
            'shipping_address' => 'nullable|string',
            'province' => 'nullable|string',
            'district' => 'nullable|string',
            'ward' => 'nullable|string',
            'notes' => 'nullable|string',
            'custom_attributes' => 'nullable|array',
            'order_kind' => 'nullable|string|in:official,template,draft',
            'region_type' => 'nullable|string|in:new,old',
        ]);

        if ($validator->fails()) {
            \Illuminate\Support\Facades\Log::error('Order Update Validation Failed', [
                'errors' => $validator->errors()->toArray(),
                'request_data' => $request->all()
            ]);
            return response()->json(['errors' => $validator->errors()], 422);
        }

        $order = $this->findScopedOrder($request, (int) $id);
        $accountId = $order->account_id;

        // Check unique order_number if provided
        if ($request->has('order_number') && $request->order_number !== $order->order_number) {
            $exists = Order::withTrashed()
                ->where('order_number', $request->order_number)
                ->where('id', '!=', $id)
                ->exists();
            if ($exists) {
                return response()->json(['message' => 'Mã đơn hàng này đã tồn tại trong hệ thống!'], 422);
            }
        }

        return DB::transaction(function () use ($request, $order) {
            $requestedKind = $this->normalizeOrderKind($request->input('order_kind', $order->order_kind));
            $currentKind = $this->normalizeOrderKind((string) $order->order_kind);

            if ($this->requiresOfficialValidation($requestedKind)) {
                $this->validateOfficialOrderPayload([
                    'province' => $request->input('province', $order->province),
                    'district' => $request->input('district', $order->district),
                    'ward' => $request->input('ward', $order->ward),
                    'shipping_address' => $request->input('shipping_address', $order->shipping_address),
                ], (string) $request->input('region_type', 'new'));
            }

            $data = $request->only([
                'order_number', 'customer_name', 'customer_email', 'customer_phone', 
                'shipping_address', 'province', 'district', 'ward', 'notes', 'source', 
                'type', 'shipment_status', 'shipping_fee', 'discount', 'status'
            ]);

            if (!$this->shouldManageInventory($requestedKind)) {
                $data = array_merge($data, $this->freshShippingState());
            } elseif (!$order->hasActiveShipment() && blank($order->shipping_status_source)) {
                $data['shipping_status_source'] = self::SHIPPING_STATUS_SOURCE_MANUAL;
            }
            
            $order->update($data);

            // Sync items if provided
            if ($request->has('items')) {
                if ($this->shouldManageInventory($currentKind)) {
                    $this->releaseInventoryIfNeeded($order->forceFill(['order_kind' => $currentKind]));
                }
                $order->items()->delete();
                $itemSyncKind = $this->shouldManageInventory($requestedKind) && !$this->shouldManageInventory($currentKind)
                    ? $currentKind
                    : $requestedKind;
                $inventorySummary = $this->syncOrderItems($order, (array) $request->input('items', []), $itemSyncKind);
                $itemRevenue = $inventorySummary['total_price'];
                $costTotal = $inventorySummary['cost_total'];
            } else {
                $itemRevenue = (float) $order->items()->sum(DB::raw('price * quantity'));
                $costTotal = (float) $order->items()->sum('cost_total');
            }

            $this->recalculateOrderTotals($order, (float) $itemRevenue, (float) $costTotal);

            // Sync Order EAV custom attributes
            if ($request->has('custom_attributes')) {
                $this->syncOrderAttributes($order, (array) $request->input('custom_attributes', []));
            }

            if ($currentKind !== $requestedKind) {
                $order = $this->convertOrderToKind($order->fresh(['items', 'attributeValues']), $requestedKind, [
                    'province' => $request->input('province', $order->province),
                    'district' => $request->input('district', $order->district),
                    'ward' => $request->input('ward', $order->ward),
                    'shipping_address' => $request->input('shipping_address', $order->shipping_address),
                    'region_type' => $request->input('region_type', 'new'),
                ]);
            } elseif ($this->shouldManageInventory($requestedKind)) {
                $this->syncOfficialCustomerAndInvoice($order, false);
            }

            return response()->json($this->mutationResponsePayload($order));
        });
    }

    public function markPrinted(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
        ]);

        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return response()->json(['message' => 'Chưa chọn đơn hàng nào để cập nhật in đơn.'], 400);
        }

        $accountId = $this->resolveAccountId($request);
        OrderStatusCatalog::ensurePrintedStatus($accountId);

        $orders = $this->scopedOrderQuery($request)
            ->whereIn('id', $ids->all())
            ->select([
                'id',
                'status',
                'order_kind',
                'shipping_dispatched_at',
            ])
            ->with([
                'activeShipment:id,order_id',
            ])
            ->get();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'Không tìm thấy đơn hàng để cập nhật trạng thái in.'], 404);
        }

        $updatedIds = [];
        $keptIds = [];
        $ignoredIds = [];

        DB::transaction(function () use ($orders, &$updatedIds, &$keptIds, &$ignoredIds) {
            foreach ($orders as $order) {
                if (!$this->shouldManageInventory((string) $order->order_kind)) {
                    $ignoredIds[] = (int) $order->id;
                    continue;
                }

                if (
                    $order->status === OrderStatusCatalog::PRINTED_CODE
                    || OrderStatusCatalog::shouldKeepStatusWhenPrinting($order->status)
                    || $order->shipping_dispatched_at
                    || $order->activeShipment
                ) {
                    $keptIds[] = (int) $order->id;
                    continue;
                }

                \App\Models\OrderStatusLog::create([
                    'order_id' => $order->id,
                    'from_status' => $order->status,
                    'to_status' => OrderStatusCatalog::PRINTED_CODE,
                    'source' => 'system',
                    'changed_by' => auth()->id(),
                    'reason' => 'Tự động cập nhật sau khi in đơn hàng',
                ]);

                $order->update([
                    'status' => OrderStatusCatalog::PRINTED_CODE,
                ]);

                $updatedIds[] = (int) $order->id;
            }
        });

        return response()->json([
            'message' => 'Đã ghi nhận thao tác in đơn.',
            'updated_count' => count($updatedIds),
            'preserved_count' => count($keptIds),
            'ignored_count' => count($ignoredIds),
            'updated_ids' => $updatedIds,
            'preserved_ids' => $keptIds,
            'ignored_ids' => $ignoredIds,
        ]);
    }

    public function destroy(Request $request, $id)
    {
        $order = $this->findScopedOrder($request, (int) $id, true);

        if ($order->trashed()) {
            return response()->json(['message' => 'Order is already in trash.'], 422);
        }

        DB::transaction(function () use ($order) {
            $this->releaseInventoryIfNeeded($order);
            $order->delete();
        });

        return response()->json(['message' => 'Order moved to trash successfully']);
    }

    public function forceDelete(Request $request, $id)
    {
        $order = $this->findScopedOrder($request, (int) $id, true);

        DB::transaction(function () use ($order) {
            if (!$order->trashed()) {
                $this->releaseInventoryIfNeeded($order);
            }

            $order->forceDelete();
        });

        return response()->json(['message' => 'Order permanently deleted successfully']);
    }

    public function duplicate(Request $request, $id)
    {
        $original = $this->scopedOrderQuery($request)
            ->with(['items', 'attributeValues'])
            ->findOrFail($id);
        $targetKind = $this->normalizeOrderKind($request->input('target_kind', $original->order_kind));

        return response()->json(
            $this->mutationResponsePayload(
                $this->duplicateOrderToKind($original, $targetKind)
            )
        );
    }

    public function convert(Request $request, $id)
    {
        $request->validate([
            'target_kind' => 'required|string|in:official,template,draft',
            'region_type' => 'nullable|string|in:new,old',
            'province' => 'nullable|string',
            'district' => 'nullable|string',
            'ward' => 'nullable|string',
            'shipping_address' => 'nullable|string',
        ]);

        $order = $this->scopedOrderQuery($request)
            ->with(['items', 'attributeValues', 'shipments', 'inventoryDocuments'])
            ->findOrFail($id);

        return response()->json(
            $this->mutationResponsePayload(
                $this->convertOrderToKind($order, (string) $request->input('target_kind'), $request->all())
            )
        );
    }

    public function updateStatus(Request $request, $id)
    {
        try {
            $request->validate(['status' => 'required|string']);
            
            return DB::transaction(function () use ($request, $id) {
                $order = $this->findScopedOrder($request, (int) $id);

                if (!$this->shouldManageInventory((string) $order->order_kind)) {
                    return response()->json([
                        'message' => 'Đơn mẫu và đơn nháp không dùng cập nhật trạng thái giao hàng.',
                    ], 422);
                }

                $newStatus = $request->status;
                $oldStatus = $order->status;

                if ($newStatus === $oldStatus) {
                    return response()->json($order->load(['items', 'customer', 'attributeValues.attribute', 'shipments']));
                }

                // Validate that the status exists in order_statuses for this account
                $exists = \App\Models\OrderStatus::where('account_id', $order->account_id)
                    ->where('code', $newStatus)
                    ->exists();
                
                if (!$exists) {
                    return response()->json(['message' => "Trạng thái '{$newStatus}' không hợp lệ cho hệ thống của bạn."], 422);
                }

                // Check if shipping-related statuses are locked by active shipment
                $shippingLockedStatuses = ['shipping', 'completed', 'pending_return', 'returned'];
                if (in_array($newStatus, $shippingLockedStatuses) && $order->hasActiveShipment()) {
                    $syncService = app(\App\Services\Shipping\ShipmentStatusSyncService::class);
                    $canEdit = $syncService->canManuallyEditOrderShipping($order);
                    
                    if (!$canEdit['allowed']) {
                        return response()->json([
                            'message' => $canEdit['reason'],
                            'shipping_locked' => true,
                            'shipment_number' => $canEdit['shipment_number'] ?? null,
                        ], 422);
                    }
                }

                // Log order status change
                \App\Models\OrderStatusLog::create([
                    'order_id'    => $order->id,
                    'from_status' => $oldStatus,
                    'to_status'   => $newStatus,
                    'source'      => 'manual',
                    'changed_by'  => auth()->id(),
                    'reason'      => $request->reason ?? 'Cập nhật nhanh từ danh sách',
                ]);

                $order->update(['status' => $newStatus]);
                
                return response()->json($order->load(['items', 'customer', 'attributeValues.attribute', 'shipments']));
            });
        } catch (\Illuminate\Validation\ValidationException $e) {
            return response()->json(['errors' => $e->errors(), 'message' => 'Dữ liệu không hợp lệ'], 422);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("Order Status Update Error for ID {$id}: " . $e->getMessage());
            return response()->json(['message' => 'Có lỗi xảy ra: ' . $e->getMessage()], 500);
        }
    }

    public function restore(Request $request, $id)
    {
        $order = $this->findScopedOrder($request, (int) $id, true);

        if (!$order->trashed()) {
            return response()->json(['message' => 'Order is already active.'], 422);
        }

        DB::transaction(function () use ($order) {
            $order->restore();
            $inventorySummary = $this->reserveInventoryIfNeeded($order->fresh(['items']));

            $this->recalculateOrderTotals(
                $order,
                (float) ($inventorySummary['total_price'] ?? 0),
                (float) ($inventorySummary['cost_total'] ?? 0)
            );
        });

        return response()->json(['message' => 'Order restored successfully']);
    }

    public function bulkDelete(Request $request)
    {
        $ids = collect($request->input('ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return response()->json(['message' => 'No IDs provided'], 400);
        }

        $orders = $this->scopedOrderQuery($request, true)
            ->whereIn('id', $ids->all())
            ->with(['items'])
            ->get();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'No orders found for the selected IDs.'], 404);
        }

        $forceDelete = $request->boolean('force');

        DB::transaction(function () use ($orders, $forceDelete) {
            foreach ($orders as $order) {
                if ($forceDelete) {
                    if (!$order->trashed()) {
                        $this->releaseInventoryIfNeeded($order);
                    }

                    $order->forceDelete();
                    continue;
                }

                if ($order->trashed()) {
                    continue;
                }

                $this->releaseInventoryIfNeeded($order);
                $order->delete();
            }
        });

        return response()->json([
            'message' => $forceDelete
                ? 'Orders permanently deleted successfully'
                : 'Orders moved to trash successfully',
        ]);
    }

    public function bulkRestore(Request $request)
    {
        $ids = collect($request->input('ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return response()->json(['message' => 'No IDs provided'], 400);
        }

        $orders = $this->scopedOrderQuery($request, true)
            ->whereIn('id', $ids->all())
            ->with(['items'])
            ->get();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'No orders found for the selected IDs.'], 404);
        }

        DB::transaction(function () use ($orders) {
            foreach ($orders as $order) {
                if (!$order->trashed()) {
                    continue;
                }

                $order->restore();
                $inventorySummary = $this->reserveInventoryIfNeeded($order->fresh(['items']));
                $this->recalculateOrderTotals(
                    $order,
                    (float) ($inventorySummary['total_price'] ?? 0),
                    (float) ($inventorySummary['cost_total'] ?? 0)
                );
            }
        });

        return response()->json(['message' => 'Orders restored successfully']);
    }

    public function bulkDuplicate(Request $request)
    {
        $ids = collect($request->input('ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return response()->json(['message' => 'No IDs provided'], 400);
        }

        $duplicatedCount = 0;
        DB::transaction(function () use ($request, $ids, &$duplicatedCount) {
            foreach ($ids as $id) {
                $original = $this->scopedOrderQuery($request)
                    ->with(['items', 'attributeValues'])
                    ->find($id);

                if (!$original) {
                    continue;
                }

                $targetKind = $this->normalizeOrderKind($request->input('target_kind', $original->order_kind));
                $this->duplicateOrderToKind($original, $targetKind);

                $duplicatedCount++;
            }
        });

        return response()->json(['message' => $duplicatedCount . ' orders duplicated successfully']);
    }

    public function bulkConvert(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
            'target_kind' => 'required|string|in:official,template,draft',
            'region_type' => 'nullable|string|in:new,old',
            'province' => 'nullable|string',
            'district' => 'nullable|string',
            'ward' => 'nullable|string',
            'shipping_address' => 'nullable|string',
        ]);

        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        $orders = $this->scopedOrderQuery($request)
            ->whereIn('id', $ids->all())
            ->with(['items', 'attributeValues', 'shipments', 'inventoryDocuments'])
            ->get();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'No orders found for the selected IDs.'], 404);
        }

        $convertedCount = 0;
        DB::transaction(function () use ($orders, $validated, &$convertedCount) {
            foreach ($orders as $order) {
                $this->convertOrderToKind($order, $validated['target_kind'], $validated);
                $convertedCount++;
            }
        });

        return response()->json([
            'message' => $convertedCount . ' orders converted successfully',
        ]);
    }

    public function bulkUpdate(Request $request)
    {
        $ids = collect($request->input('ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($ids)) {
            return response()->json(['message' => 'Chua chon don hang nao.'], 400);
        }

        $data = $request->only([
            'status', 'notes', 'source', 'type', 'shipment_status'
        ]);

        $customAttributes = $request->input('custom_attributes', []);

        DB::transaction(function () use ($request, $ids, $data, $customAttributes) {
            if (!empty($data)) {
                $this->scopedOrderQuery($request)->whereIn('id', $ids)->update($data);
            }

            if (!empty($customAttributes)) {
                foreach ($ids as $orderId) {
                    foreach ($customAttributes as $attrId => $val) {
                        \App\Models\OrderAttributeValue::updateOrCreate(
                            ['order_id' => $orderId, 'attribute_id' => $attrId],
                            ['value' => is_array($val) ? json_encode($val) : $val]
                        );
                    }
                }
            }
        });

        return response()->json(['message' => 'Cap nhat hang loat thanh cong']);
    }

    public function dispatchPreview(Request $request, ShipmentDispatchService $dispatchService)
    {
        $validated = $request->validate([
            'order_ids' => 'required|array|min:1',
            'order_ids.*' => 'integer|exists:orders,id',
            'carrier_code' => 'required|string|max:50',
            'warehouse_id' => 'nullable|integer|exists:warehouses,id',
        ]);

        $orders = $this->scopedOrderQuery($request)
            ->whereIn('id', $validated['order_ids'])
            ->where(function ($query) {
                $query
                    ->where('order_kind', self::ORDER_KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            })
            ->with(['items.product'])
            ->get();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'Khong tim thay don hang can gui.'], 404);
        }

        return response()->json(
            $dispatchService->preview($orders, $validated['carrier_code'], $validated['warehouse_id'] ?? null)
        );
    }

    public function dispatch(Request $request, ShipmentDispatchService $dispatchService)
    {
        $validated = $request->validate([
            'order_ids' => 'required|array|min:1',
            'order_ids.*' => 'integer|exists:orders,id',
            'carrier_code' => 'required|string|max:50',
            'warehouse_id' => 'nullable|integer|exists:warehouses,id',
        ]);

        $orders = $this->scopedOrderQuery($request)
            ->whereIn('id', $validated['order_ids'])
            ->where(function ($query) {
                $query
                    ->where('order_kind', self::ORDER_KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            })
            ->with(['items.product'])
            ->get();

        if ($orders->isEmpty()) {
            return response()->json(['message' => 'Khong tim thay don hang can gui.'], 404);
        }

        return response()->json(
            $dispatchService->dispatch(
                $orders,
                $validated['carrier_code'],
                Auth::id(),
                $validated['warehouse_id'] ?? null
            )
        );
    }

    public function quickDispatch(Request $request, ShipmentStatusSyncService $syncService)
    {
        $validated = $request->validate([
            'shipments' => 'required|array|min:1',
            'shipments.*.order_id' => 'required|integer',
            'shipments.*.tracking_number' => 'required|string|max:100',
            'shipments.*.carrier_name' => 'required|string|max:255',
            'shipments.*.shipping_cost' => 'required|numeric|min:0',
        ]);

        $shipmentsPayload = collect($validated['shipments'])
            ->map(function (array $item) {
                return [
                    'order_id' => (int) $item['order_id'],
                    'tracking_number' => trim((string) $item['tracking_number']),
                    'carrier_name' => trim((string) $item['carrier_name']),
                    'shipping_cost' => (float) $item['shipping_cost'],
                ];
            })
            ->values();

        if ($shipmentsPayload->contains(fn (array $item) => $item['tracking_number'] === '' || $item['carrier_name'] === '')) {
            return response()->json([
                'message' => 'Mã vận đơn và đơn vị vận chuyển không được để trống.',
            ], 422);
        }

        $orders = $this->scopedOrderQuery($request)
            ->whereIn('id', $shipmentsPayload->pluck('order_id')->unique()->values())
            ->where(function ($query) {
                $query
                    ->where('order_kind', self::ORDER_KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            })
            ->with(['items.product', 'activeShipment'])
            ->get()
            ->keyBy('id');

        $results = [];
        $successCount = 0;
        $failedCount = 0;

        foreach ($shipmentsPayload as $shipmentInput) {
            $orderId = $shipmentInput['order_id'];
            $order = $orders->get($orderId);

            if (!$order) {
                $failedCount++;
                $results[] = [
                    'order_id' => $orderId,
                    'order_number' => null,
                    'success' => false,
                    'message' => 'Không tìm thấy đơn hàng để gửi vận chuyển.',
                ];
                continue;
            }

            try {
                $shipment = $this->createQuickShipmentForOrder($order, $shipmentInput, $syncService);

                $successCount++;
                $results[] = [
                    'order_id' => $order->id,
                    'order_number' => $order->order_number,
                    'success' => true,
                    'shipment_id' => $shipment->id,
                    'shipment_number' => $shipment->shipment_number,
                    'tracking_number' => $shipment->carrier_tracking_code ?: $shipment->tracking_number,
                ];
            } catch (\Throwable $e) {
                $failedCount++;
                $results[] = [
                    'order_id' => $order->id,
                    'order_number' => $order->order_number,
                    'success' => false,
                    'message' => $e->getMessage(),
                ];
            }
        }

        return response()->json([
            'success_count' => $successCount,
            'failed_count' => $failedCount,
            'results' => $results,
        ], $successCount > 0 && $failedCount === 0 ? 201 : 200);
    }

    public function shippingAlerts(Request $request, ShippingAlertService $shippingAlertService)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $perPage = min(max((int) $request->input('per_page', 20), 1), 50);
        $alerts = $shippingAlertService->activeAlerts($accountId, $perPage);

        return response()->json([
            'data' => $alerts->items(),
            'total' => $alerts->total(),
            'current_page' => $alerts->currentPage(),
            'last_page' => $alerts->lastPage(),
        ]);
    }

    public function connectedCarriers(Request $request)
    {
        $accountId = $this->resolveAccountId($request);

        return response()->json($this->loadConnectedCarriers($accountId));
    }
}
