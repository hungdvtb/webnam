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
use App\Models\QuoteTemplate;
use App\Models\Shipment;
use App\Models\ShipmentItem;
use App\Models\ShipmentStatusLog;
use App\Models\ShippingIntegration;
use App\Models\SiteSetting;
use App\Services\Inventory\InventoryService;
use App\Services\Shipping\ShipmentDispatchService;
use App\Services\Shipping\ShippingAlertService;
use App\Services\Shipping\ShipmentStatusSyncService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrderController extends Controller
{
    private const BOOTSTRAP_CACHE_TTL_SECONDS = 15;
    private const QUOTE_SETTING_KEYS = [
        'quote_logo_url',
        'quote_store_name',
        'quote_store_address',
        'quote_store_phone',
    ];

    private function generateOrderNumber($accountId = null)
    {
        $query = Order::withTrashed();
        if ($accountId) {
            $query->where('account_id', $accountId);
        }
        
        $lastOrder = $query->where('order_number', 'LIKE', 'OR%A0')
            ->orderBy('id', 'desc')
            ->select('order_number')
            ->first();

        $nextNumber = 10000;
        if ($lastOrder && isset($lastOrder->order_number) && preg_match('/OR(\d+)A0/', $lastOrder->order_number, $matches)) {
            $nextNumber = intval($matches[1]) + 1;
        }
        return "OR{$nextNumber}A0";
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

    private function connectedCarrierCacheKey(int $accountId): string
    {
        return "orders:connected-carriers:{$accountId}";
    }

    private function bootstrapCacheKey(int $accountId, string $mode): string
    {
        return "orders:bootstrap:{$accountId}:{$mode}";
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
        return OrderStatus::query()
            ->where('account_id', $accountId)
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get()
            ->toArray();
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
                'type',
                'shipping_status', 'shipping_carrier_code', 'shipping_carrier_name',
                'shipping_tracking_code', 'shipping_dispatched_at',
                'shipping_issue_code', 'shipping_issue_message', 'shipping_issue_detected_at',
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

            if ($state === 'created') {
                $q->where(function ($builder) {
                    $builder
                        ->where('type', 'inventory_export')
                        ->orWhere(function ($exportQuery) {
                            $exportQuery
                                ->whereNotNull('shipping_tracking_code')
                                ->where('shipping_tracking_code', '!=', '');
                        });
                });
            }

            if ($state === 'missing') {
                $q
                    ->where(function ($builder) {
                        $builder
                            ->whereNull('type')
                            ->orWhere('type', '!=', 'inventory_export');
                    })
                    ->where(function ($builder) {
                        $builder
                            ->whereNull('shipping_tracking_code')
                            ->orWhere('shipping_tracking_code', '');
                    });
            }
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

        return response()->json($query->paginate($perPage));
    }

    public function store(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        $request->validate([
            'lead_id' => 'nullable|integer|exists:leads,id',
        ]);

        $rawItems = [];
        if ($request->has('items')) {
            $rawItems = collect($request->items)
                ->filter(fn ($item) => !empty($item['product_id']) && (int) ($item['quantity'] ?? 0) > 0)
                ->values()
                ->all();
        } else {
            $cart = Cart::with('items.product')->where('user_id', Auth::id())->first();
            if (!$cart || !isset($cart->items) || $cart->items->isEmpty()) {
                return response()->json(['message' => 'Cart is empty'], 400);
            }

            $rawItems = $cart->items->map(function ($item) {
                $product = $item->product;
                return [
                    'product_id' => $item->product_id,
                    'quantity' => $item->quantity,
                    'price' => $product ? ($product->current_price ?? $item->price) : $item->price,
                ];
            })->all();
        }

        return DB::transaction(function () use ($request, $accountId, $rawItems) {
            $lead = null;
            if ($request->filled('lead_id')) {
                $lead = \App\Models\Lead::query()
                    ->where('account_id', $accountId)
                    ->with('statusConfig')
                    ->findOrFail((int) $request->lead_id);
            }

            // Customer creation/lookup optimized with index
            $customer = Customer::firstOrCreate(
                ['account_id' => $accountId, 'phone' => $request->customer_phone],
                ['name' => $request->customer_name, 'email' => $request->customer_email, 'address' => $request->shipping_address]
            );

            // Create Order
            $order = Order::create([
                'user_id' => Auth::id(),
                'account_id' => $accountId,
                'customer_id' => $customer->id,
                'lead_id' => $lead?->id,
                'order_number' => $this->generateOrderNumber($accountId),
                'total_price' => 0,
                'status' => $request->status ?? (\App\Models\OrderStatus::where('account_id', $accountId)->where('is_default', true)->value('code') ?: 'new'),
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
            ]);

            $inventorySummary = app(InventoryService::class)->attachInventoryToOrder($order, $rawItems);
            $finalTotal = round(
                $inventorySummary['total_price']
                + (float) ($request->shipping_fee ?? 0)
                - (float) ($request->discount ?? 0),
                2
            );

            $order->update([
                'total_price' => $finalTotal,
                'cost_total' => $inventorySummary['cost_total'],
                'profit_total' => round($finalTotal - $inventorySummary['cost_total'], 2),
            ]);

            // Sync Order Attributes - optimized lookup
            if ($request->has('custom_attributes') && !empty($request->custom_attributes)) {
                $attrCodes = array_keys($request->custom_attributes);
                $existingAttrs = \App\Models\Attribute::where('account_id', $accountId)->whereIn('code', $attrCodes)->get()->keyBy('code');

                foreach ($request->custom_attributes as $attrCode => $val) {
                    $attribute = $existingAttrs->get($attrCode);
                    if (!$attribute) {
                        $attribute = \App\Models\Attribute::create([
                            'account_id' => $accountId,
                            'code' => $attrCode,
                            'name' => ucwords(str_replace('_', ' ', $attrCode)),
                            'frontend_type' => 'text'
                        ]);
                    }

                    \App\Models\OrderAttributeValue::create([
                        'order_id' => $order->id,
                        'attribute_id' => $attribute->id,
                        'value' => is_array($val) ? json_encode($val) : $val
                    ]);
                }
            }

            // Customer stats update
            $customer->increment('total_orders');
            $customer->increment('total_spent', $finalTotal);

            // One-off invoice creation
            Invoice::create([
                'order_id' => $order->id,
                'invoice_number' => 'INV-' . strtoupper(Str::random(10)),
                'amount' => $finalTotal,
                'status' => 'pending',
                'due_date' => now()->addDays(3),
            ]);

            if (!$request->has('items')) {
                Cart::where('user_id', Auth::id())->first()?->items()->delete();
            }

            if ($lead) {
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

            return response()->json($order->load(['items.product', 'customer', 'attributeValues.attribute']), 201);
        });
    }


    public function show($id)
    {
        $order = Order::with(['items.product', 'customer', 'shipments', 'payment', 'attributeValues.attribute', 'user'])->findOrFail($id);
        return response()->json($order);
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
        ]);

        if ($validator->fails()) {
            \Illuminate\Support\Facades\Log::error('Order Update Validation Failed', [
                'errors' => $validator->errors()->toArray(),
                'request_data' => $request->all()
            ]);
            return response()->json(['errors' => $validator->errors()], 422);
        }

        $order = Order::findOrFail($id);
        $accountId = $order->account_id;

        // Check unique order_number if provided
        if ($request->has('order_number') && $request->order_number !== $order->order_number) {
            $exists = Order::where('account_id', $accountId)
                ->where('order_number', $request->order_number)
                ->where('id', '!=', $id)
                ->exists();
            if ($exists) {
                return response()->json(['message' => 'Mã đơn hàng này đã tồn tại trong hệ thống!'], 422);
            }
        }

        \Illuminate\Support\Facades\Log::info("Order Update Data for ID: $id", $request->all());

        return DB::transaction(function () use ($request, $order) {
            $data = $request->only([
                'order_number', 'customer_name', 'customer_email', 'customer_phone', 
                'shipping_address', 'province', 'district', 'ward', 'notes', 'source', 
                'type', 'shipment_status', 'shipping_fee', 'discount', 'status'
            ]);
            
            $order->update($data);

            // Sync items if provided
            if ($request->has('items')) {
                app(InventoryService::class)->releaseOrderInventory($order);
                $order->items()->delete();
                $inventorySummary = app(InventoryService::class)->attachInventoryToOrder($order, $request->items);
                $itemRevenue = $inventorySummary['total_price'];
                $costTotal = $inventorySummary['cost_total'];
            } else {
                $itemRevenue = (float) $order->items()->sum(DB::raw('price * quantity'));
                $costTotal = (float) $order->items()->sum('cost_total');
            }

            $finalTotal = round($itemRevenue + (float) ($order->shipping_fee ?? 0) - (float) ($order->discount ?? 0), 2);
            $order->update([
                'total_price' => $finalTotal,
                'cost_total' => round($costTotal, 2),
                'profit_total' => round($finalTotal - $costTotal, 2),
            ]);

            // Sync Order EAV custom attributes
            if ($request->has('custom_attributes')) {
                foreach ($request->custom_attributes as $attrCode => $val) {
                    $attribute = \App\Models\Attribute::firstOrCreate(
                        ['account_id' => $order->account_id, 'code' => $attrCode],
                        [
                            'name' => ucwords(str_replace('_', ' ', $attrCode)),
                            'frontend_type' => 'text'
                        ]
                    );

                    \App\Models\OrderAttributeValue::updateOrCreate(
                        ['order_id' => $order->id, 'attribute_id' => $attribute->id],
                        ['value' => is_array($val) ? json_encode($val) : $val]
                    );
                }
            }

            return response()->json($order->load(['items.product', 'customer', 'attributeValues.attribute']));
        });
    }

    public function destroy($id)
    {
        $order = Order::findOrFail($id);
        app(InventoryService::class)->releaseOrderInventory($order);
        $order->delete();
        return response()->json(['message' => 'Order deleted successfully']);
    }

    public function duplicate($id)
    {
        $original = Order::with(['items', 'attributeValues'])->findOrFail($id);
        
        return DB::transaction(function () use ($original) {
            $new = $original->replicate();
            $new->order_number = $this->generateOrderNumber($original->account_id);
            $new->status = \App\Models\OrderStatus::where('account_id', $original->account_id)->where('is_default', true)->value('code') ?: 'new';
            $new->save();

            foreach ($original->items as $item) {
                $newItem = $item->replicate();
                $newItem->order_id = $new->id;
                $newItem->save();
            }

            foreach ($original->attributeValues as $val) {
                $newVal = $val->replicate();
                $newVal->order_id = $new->id;
                $newVal->save();
            }

            return response()->json($new->load(['items.product', 'customer', 'attributeValues.attribute']));
        });
    }

    public function updateStatus(Request $request, $id)
    {
        try {
            $request->validate(['status' => 'required|string']);
            
            return DB::transaction(function () use ($request, $id) {
                $order = Order::findOrFail($id);
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

    public function restore($id)
    {
        $order = Order::withTrashed()->findOrFail($id);
        $order->restore();
        return response()->json(['message' => 'Order restored successfully']);
    }

    public function bulkDelete(Request $request)
    {
        $ids = $request->input('ids', []);
        if (empty($ids)) return response()->json(['message' => 'No IDs provided'], 400);

        if ($request->input('force') == '1') {
            if (Auth::user()->role !== 'admin') {
                return response()->json(['message' => 'Bạn không có quyền xóa vĩnh viễn đơn hàng.'], 403);
            }
            Order::whereIn('id', $ids)->withTrashed()->forceDelete();
        } else {
            Order::whereIn('id', $ids)->delete();
        }

        return response()->json(['message' => 'Thao tác xóa thành công']);
    }

    public function bulkRestore(Request $request)
    {
        $ids = $request->input('ids', []);
        if (empty($ids)) return response()->json(['message' => 'No IDs provided'], 400);

        Order::whereIn('id', $ids)->withTrashed()->restore();
        return response()->json(['message' => 'Orders restored successfully']);
    }

    public function bulkDuplicate(Request $request)
    {
        $ids = $request->input('ids', []);
        if (empty($ids)) return response()->json(['message' => 'No IDs provided'], 400);

        $duplicatedCount = 0;
        DB::transaction(function () use ($ids, &$duplicatedCount) {
            foreach ($ids as $id) {
                $original = Order::with(['items', 'attributeValues'])->find($id);
                if (!$original) continue;

                $new = $original->replicate();
                $new->order_number = $this->generateOrderNumber($original->account_id);
                $new->status = \App\Models\OrderStatus::where('account_id', $original->account_id)->where('is_default', true)->value('code') ?: 'new';
                $new->save();

                foreach ($original->items as $item) {
                    $newItem = $item->replicate();
                    $newItem->order_id = $new->id;
                    $newItem->save();
                }

                foreach ($original->attributeValues as $val) {
                    $newVal = $val->replicate();
                    $newVal->order_id = $new->id;
                    $newVal->save();
                }
                $duplicatedCount++;
            }
        });

        return response()->json(['message' => $duplicatedCount . ' orders duplicated successfully']);
    }

    public function bulkUpdate(Request $request)
    {
        $ids = $request->input('ids', []);
        if (empty($ids)) return response()->json(['message' => 'Chưa chọn đơn hàng nào.'], 400);

        $data = $request->only([
            'status', 'notes', 'source', 'type', 'shipment_status'
        ]);
        
        $customAttributes = $request->input('custom_attributes', []);

        \Illuminate\Support\Facades\DB::transaction(function () use ($ids, $data, $customAttributes) {
            if (!empty($data)) {
                Order::whereIn('id', $ids)->update($data);
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

        return response()->json(['message' => 'Cập nhật hàng loạt thành công']);
    }
    public function dispatchPreview(Request $request, ShipmentDispatchService $dispatchService)
    {
        $validated = $request->validate([
            'order_ids' => 'required|array|min:1',
            'order_ids.*' => 'integer|exists:orders,id',
            'carrier_code' => 'required|string|max:50',
            'warehouse_id' => 'nullable|integer|exists:warehouses,id',
        ]);

        $orders = Order::query()
            ->whereIn('id', $validated['order_ids'])
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

        $orders = Order::query()
            ->whereIn('id', $validated['order_ids'])
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

        $orders = Order::query()
            ->whereIn('id', $shipmentsPayload->pluck('order_id')->unique()->values())
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
