<?php

namespace App\Services\Shipping;

use App\Models\Carrier;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Shipment;
use App\Models\ShipmentItem;
use App\Models\ShipmentStatusLog;
use App\Models\ShippingIntegration;
use App\Models\Warehouse;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class ShipmentDispatchService
{
    public function __construct(
        private ViettelPostClient $viettelPostClient,
        private ViettelPostAddressService $addressService,
        private ShipmentStatusSyncService $shipmentStatusSyncService,
    ) {
    }

    public function preview(Collection $orders, string $carrierCode, ?int $warehouseId = null): array
    {
        $integration = $this->resolveIntegration($carrierCode, (int) $orders->first()?->account_id);
        $warehouse = $this->resolveWarehouse((int) $orders->first()?->account_id, $integration, $warehouseId);
        $results = [];
        $validOrders = [];
        $invalidOrders = [];

        foreach ($orders as $order) {
            try {
                $this->validateOrderForDispatch($order, $integration, $warehouse);
                $preparedDispatch = $this->prepareDispatchData($order, $integration, $warehouse);
                $results[] = [
                    'order_id' => $order->id,
                    'order_number' => $order->order_number,
                    'valid' => true,
                    'service_code' => $preparedDispatch['service_code'] ?? null,
                    'estimated_fee' => $preparedDispatch['estimated_fee'] ?? null,
                ];
                $validOrders[] = [
                    'id' => $order->id,
                    'order_number' => $order->order_number,
                    'customer_name' => $order->customer_name,
                    'service_code' => $preparedDispatch['service_code'] ?? null,
                    'estimated_fee' => $preparedDispatch['estimated_fee'] ?? null,
                ];
            } catch (\Throwable $e) {
                $results[] = [
                    'order_id' => $order->id,
                    'order_number' => $order->order_number,
                    'valid' => false,
                    'message' => $e->getMessage(),
                ];
                $invalidOrders[] = [
                    'id' => $order->id,
                    'order_number' => $order->order_number,
                    'customer_name' => $order->customer_name,
                    'reason' => $e->getMessage(),
                ];
            }
        }

        return [
            'carrier_code' => $carrierCode,
            'valid_count' => count($validOrders),
            'invalid_count' => count($invalidOrders),
            'valid_orders' => $validOrders,
            'invalid_orders' => $invalidOrders,
            'estimated_shipping_fee' => collect($validOrders)->sum(fn ($order) => (float) ($order['estimated_fee'] ?? 0)),
            'results' => $results,
            'integration' => [
                'carrier_code' => $integration->carrier_code,
                'carrier_name' => $integration->carrier_name,
            ],
            'warehouse' => $warehouse ? [
                'id' => $warehouse->id,
                'name' => $warehouse->name,
                'contact_name' => $warehouse->contact_name,
                'phone' => $warehouse->phone,
                'address' => $warehouse->address,
                'province_name' => $warehouse->province_name,
                'district_name' => $warehouse->district_name,
                'ward_name' => $warehouse->ward_name,
            ] : null,
        ];
    }

    public function dispatch(
        Collection $orders,
        string $carrierCode,
        ?int $userId = null,
        ?int $warehouseId = null
    ): array {
        $integration = $this->resolveIntegration($carrierCode, (int) $orders->first()?->account_id);
        $carrier = Carrier::where('code', $carrierCode)->first();
        $warehouse = $this->resolveWarehouse((int) $orders->first()?->account_id, $integration, $warehouseId);

        $successCount = 0;
        $failedCount = 0;
        $results = [];

        foreach ($orders as $order) {
            try {
                $shipment = DB::transaction(function () use ($order, $integration, $warehouse, $carrier, $userId) {
                    $this->validateOrderForDispatch($order, $integration, $warehouse);
                    $preparedDispatch = $this->prepareDispatchData($order, $integration, $warehouse);
                    $payload = $preparedDispatch['payload'];
                    $response = $this->dispatchToCarrier($integration, $payload);

                    return $this->persistDispatchResult(
                        $order,
                        $integration,
                        $warehouse,
                        $carrier,
                        $payload,
                        $response,
                        $userId
                    );
                });

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
                Log::error('Dispatch order to carrier failed', [
                    'order_id' => $order->id,
                    'order_number' => $order->order_number,
                    'carrier_code' => $carrierCode,
                    'warehouse_id' => $warehouse?->id,
                    'message' => $e->getMessage(),
                ]);
                $results[] = [
                    'order_id' => $order->id,
                    'order_number' => $order->order_number,
                    'success' => false,
                    'message' => $e->getMessage(),
                ];
            }
        }

        return [
            'carrier_code' => $carrierCode,
            'carrier_name' => $integration->carrier_name,
            'warehouse_id' => $warehouse?->id,
            'warehouse_name' => $warehouse?->name,
            'success_count' => $successCount,
            'failed_count' => $failedCount,
            'results' => $results,
        ];
    }

    public function createAutomaticReconciliation(Shipment $shipment, ?int $userId = null): Shipment
    {
        $carrierReceived = $this->extractCarrierReceivedAmount($shipment);
        if ($carrierReceived === null) {
            throw new RuntimeException('Van don chua co du lieu carrier de doi soat.');
        }

        $expected = (float) $shipment->actual_received_amount;
        $diff = $carrierReceived - $expected;

        $shipment->update([
            'reconciled_amount' => $carrierReceived,
            'reconciliation_diff_amount' => $diff,
            'reconciliation_status' => abs($diff) < 1 ? 'reconciled' : 'mismatch',
            'reconciled_at' => now(),
            'last_reconciled_at' => now(),
        ]);

        $shipment->reconciliations()->create([
            'carrier_code' => $shipment->carrier_code,
            'cod_amount' => $shipment->cod_amount,
            'shipping_fee' => $shipment->shipping_cost,
            'service_fee' => $shipment->service_fee,
            'return_fee' => $shipment->return_fee,
            'actual_received_amount' => $carrierReceived,
            'system_expected_amount' => $expected,
            'diff_amount' => $diff,
            'status' => abs($diff) < 1 ? 'reconciled' : 'mismatch',
            'note' => 'Doi soat tu dong tu du lieu carrier moi nhat',
            'reconciled_by' => $userId,
            'reconciled_at' => now(),
        ]);

        return $shipment->fresh();
    }

    private function persistDispatchResult(
        Order $order,
        ShippingIntegration $integration,
        ?Warehouse $warehouse,
        ?Carrier $carrier,
        array $payload,
        array $response,
        ?int $userId = null
    ): Shipment {
        $sender = $this->resolveSenderProfile($integration, $warehouse);
        $trackingNumber = $this->extractTrackingNumber($response);
        $externalOrderNumber = $this->extractExternalOrderNumber($response) ?: $trackingNumber;
        $carrierFee = $this->extractCarrierFee($response);

        if (!$trackingNumber) {
            Log::error('ViettelPost createOrder response missing tracking number', [
                'order_id' => $order->id,
                'order_number' => $order->order_number,
                'carrier_code' => $integration->carrier_code,
                'response' => $response,
            ]);
            throw new RuntimeException('ViettelPost khong tra ve ma van don.');
        }

        $shipment = Shipment::create([
            'account_id' => $order->account_id,
            'integration_id' => $integration->id,
            'warehouse_id' => $warehouse?->id,
            'order_id' => $order->id,
            'order_code' => $order->order_number,
            'shipment_number' => $this->generateShipmentNumber($order->account_id),
            'tracking_number' => $trackingNumber,
            'carrier_tracking_code' => $trackingNumber,
            'external_order_number' => $externalOrderNumber,
            'carrier_code' => $integration->carrier_code,
            'carrier_name' => $integration->carrier_name ?: $carrier?->name ?: $integration->carrier_code,
            'channel' => 'api',
            'customer_id' => $order->customer_id,
            'customer_name' => $order->customer_name,
            'customer_phone' => $order->customer_phone,
            'customer_address' => $order->shipping_address,
            'customer_ward' => $order->ward,
            'customer_district' => $order->district,
            'customer_province' => $order->province,
            'sender_name' => $sender['name'],
            'sender_phone' => $sender['phone'],
            'sender_address' => $sender['address'],
            'status' => 'waiting_pickup',
            'shipment_status' => 'waiting_pickup',
            'order_status_snapshot' => $order->status,
            'carrier_status_raw' => '101',
            'carrier_status_mapped' => 'waiting_pickup',
            'carrier_status_code' => '101',
            'carrier_status_text' => 'Cho lay hang',
            'cod_amount' => max(0, (float) $order->total_price),
            'shipping_cost' => $carrierFee ?? (float) ($order->shipping_fee ?? 0),
            'service_fee' => 0,
            'actual_received_amount' => max(0, (float) $order->total_price) - ($carrierFee ?? (float) ($order->shipping_fee ?? 0)),
            'created_by' => $userId,
            'shipped_at' => now(),
            'dispatch_payload' => $payload,
            'dispatch_response' => $response,
            'raw_tracking_payload' => $response,
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
            'to_status' => 'waiting_pickup',
            'changed_by' => $userId,
            'change_source' => 'api',
            'reason' => 'Gui don sang don vi van chuyen',
        ]);

        $order->update([
            'status' => 'shipping',
            'shipment_status' => 'shipped',
            'shipping_status' => 'waiting_pickup',
            'shipping_synced_at' => now(),
            'shipping_status_source' => 'carrier',
            'shipping_carrier_code' => $integration->carrier_code,
            'shipping_carrier_name' => $integration->carrier_name ?: $carrier?->name,
            'shipping_tracking_code' => $trackingNumber,
            'shipping_dispatched_at' => now(),
            'shipping_issue_code' => null,
            'shipping_issue_message' => null,
            'shipping_issue_detected_at' => null,
        ]);

        $this->shipmentStatusSyncService->syncOrderFromShipment($shipment, 'carrier_sync', $userId);

        return $shipment->fresh(['order', 'carrier', 'integration', 'warehouse']);
    }

    private function dispatchToCarrier(ShippingIntegration $integration, array $payload): array
    {
        if ($integration->carrier_code === 'viettel_post') {
            return $this->viettelPostClient->createOrder($integration, $payload);
        }

        throw new RuntimeException("Hang '{$integration->carrier_code}' chua ho tro gui API trong phien ban nay.");
    }

    private function prepareDispatchData(Order $order, ShippingIntegration $integration, ?Warehouse $warehouse = null): array
    {
        $senderProfile = $this->resolveSenderProfile($integration, $warehouse);
        $sender = $this->addressService->resolveSenderIds($integration, [
            'province' => $senderProfile['province_name'],
            'district' => $senderProfile['district_name'],
            'ward' => $senderProfile['ward_name'],
        ]);

        $receiver = $this->addressService->resolveReceiverIds($integration, [
            'province' => $order->province,
            'district' => $order->district,
            'ward' => $order->ward,
        ]);

        $items = $order->items()->get();
        $firstItem = $items->first();
        $productName = $items->pluck('product_name_snapshot')->filter()->implode(', ');
        $totalWeight = max(1, (int) round($items->sum(function (OrderItem $item) {
            $productWeight = (float) ($item->product?->weight ?? 0);
            return max(1, $productWeight) * max(1, $item->quantity);
        })));
        $listItems = $items->map(function (OrderItem $item) {
            $unitPrice = (float) ($item->price ?? $item->unit_price ?? 0);
            $productWeight = (float) ($item->product?->weight ?? 0);

            return [
                'PRODUCT_NAME' => $item->product_name_snapshot ?: 'Don hang website',
                'PRODUCT_QUANTITY' => max(1, (int) $item->quantity),
                'PRODUCT_PRICE' => (int) round(max(0, $unitPrice)),
                'PRODUCT_WEIGHT' => max(1, (int) round(max(1, $productWeight))),
            ];
        })->values()->all();

        $payload = [
            'ORDER_NUMBER' => $order->order_number,
            'ORDER_REFERENCE' => $order->order_number,
            'ORDER_PAYMENT' => 3,
            'ORDER_NOTE' => $order->notes ?: 'Don tu he thong quan ly ban hang',
            'SENDER_FULLNAME' => $senderProfile['name'],
            'SENDER_PHONE' => $senderProfile['phone'],
            'SENDER_ADDRESS' => $senderProfile['address'],
            'SENDER_PROVINCE' => $sender['province_id'],
            'SENDER_DISTRICT' => $sender['district_id'],
            'SENDER_WARD' => $sender['ward_id'],
            'RECEIVER_FULLNAME' => $order->customer_name,
            'RECEIVER_PHONE' => $order->customer_phone,
            'RECEIVER_ADDRESS' => $order->shipping_address,
            'RECEIVER_PROVINCE' => $receiver['province_id'],
            'RECEIVER_DISTRICT' => $receiver['district_id'],
            'RECEIVER_WARD' => $receiver['ward_id'],
            'PRODUCT_NAME' => $productName ?: ($firstItem?->product_name_snapshot ?: 'Don hang website'),
            'PRODUCT_DESCRIPTION' => $productName ?: ($firstItem?->product_name_snapshot ?: 'Don hang website'),
            'PRODUCT_QUANTITY' => max(1, (int) $items->sum('quantity')),
            'PRODUCT_PRICE' => (int) round((float) $order->total_price),
            'PRODUCT_WEIGHT' => $totalWeight,
            'PRODUCT_LENGTH' => 0,
            'PRODUCT_WIDTH' => 0,
            'PRODUCT_HEIGHT' => 0,
            'PRODUCT_TYPE' => 'HH',
            'MONEY_COLLECTION' => (int) round((float) $order->total_price),
            'EXTRA_MONEY' => 0,
            'CHECK_UNIQUE' => true,
            'LIST_ITEM' => $listItems,
        ];

        $serviceSelection = $this->resolveServiceSelection($integration, $payload);
        if (!empty($serviceSelection['service_code'])) {
            $payload['ORDER_SERVICE'] = $serviceSelection['service_code'];
        }
        if (array_key_exists('service_add', $serviceSelection)) {
            $payload['ORDER_SERVICE_ADD'] = $serviceSelection['service_add'] ?: null;
        } else {
            $payload['ORDER_SERVICE_ADD'] = $integration->default_service_add ?: null;
        }

        return [
            'payload' => $payload,
            'service_code' => $serviceSelection['service_code'] ?? null,
            'service_add' => $serviceSelection['service_add'] ?? null,
            'estimated_fee' => $serviceSelection['estimated_fee'] ?? null,
        ];
    }

    private function validateOrderForDispatch(Order $order, ShippingIntegration $integration, ?Warehouse $warehouse = null): void
    {
        $senderProfile = $this->resolveSenderProfile($integration, $warehouse);

        if (!$integration->is_enabled) {
            throw new RuntimeException('Ket noi van chuyen chua duoc bat.');
        }

        if ($order->hasActiveShipment()) {
            throw new RuntimeException('Don da co van don dang hoat dong.');
        }

        if (!$order->customer_name || !$order->customer_phone || !$order->shipping_address) {
            throw new RuntimeException('Thieu ho ten, so dien thoai hoac dia chi giao hang.');
        }

        if (!$order->province || !$order->ward) {
            throw new RuntimeException('Thieu tinh/thanh hoac phuong/xa cua don hang.');
        }

        if (!$order->items()->exists()) {
            throw new RuntimeException('Don hang khong co san pham de gui.');
        }

        if (!$senderProfile['name'] || !$senderProfile['phone'] || !$senderProfile['address']) {
            throw new RuntimeException('Thieu thong tin nguoi gui mac dinh trong cau hinh van chuyen.');
        }

        if (!$senderProfile['province_name'] || !$senderProfile['ward_name']) {
            throw new RuntimeException('Thieu tinh/thanh hoac phuong/xa kho gui trong cau hinh van chuyen.');
        }
    }

    private function resolveIntegration(string $carrierCode, ?int $accountId): ShippingIntegration
    {
        $integration = ShippingIntegration::query()
            ->where('carrier_code', $carrierCode)
            ->where('account_id', $accountId)
            ->first();

        if (!$integration) {
            throw new RuntimeException('Don vi van chuyen chua duoc cau hinh cho tai khoan nay.');
        }

        return $integration;
    }

    private function resolveWarehouse(?int $accountId, ShippingIntegration $integration, ?int $warehouseId = null): ?Warehouse
    {
        $targetWarehouseId = $warehouseId ?: $integration->default_warehouse_id;
        if (!$targetWarehouseId) {
            return null;
        }

        $warehouse = Warehouse::query()
            ->where('account_id', $accountId)
            ->find($targetWarehouseId);

        if (!$warehouse) {
            throw new RuntimeException('Khong tim thay kho gui duoc chon cho tai khoan hien tai.');
        }

        if (!$warehouse->is_active) {
            throw new RuntimeException('Kho gui duoc chon hien dang tam ngung hoat dong.');
        }

        return $warehouse;
    }

    private function resolveSenderProfile(ShippingIntegration $integration, ?Warehouse $warehouse = null): array
    {
        return [
            'name' => $warehouse?->contact_name ?: $warehouse?->name ?: $integration->sender_name,
            'phone' => $warehouse?->phone ?: $integration->sender_phone,
            'address' => $warehouse?->address ?: $integration->sender_address,
            'province_name' => $warehouse?->province_name ?: data_get($integration->config_json, 'sender_province_name'),
            'district_name' => $warehouse?->district_name ?: data_get($integration->config_json, 'sender_district_name'),
            'ward_name' => $warehouse?->ward_name ?: data_get($integration->config_json, 'sender_ward_name'),
        ];
    }

    private function resolveServiceSelection(ShippingIntegration $integration, array $payload): array
    {
        if ($integration->default_service_code) {
            return [
                'service_code' => $integration->default_service_code,
                'service_add' => $integration->default_service_add ?: '',
                'estimated_fee' => null,
            ];
        }

        if ($integration->carrier_code !== 'viettel_post') {
            throw new RuntimeException('Chua cau hinh ma dich vu mac dinh cho don vi van chuyen.');
        }

        $pricePayload = $payload;
        $pricePayload['TYPE'] = 1;

        $priceResponse = $this->viettelPostClient->getPriceAll($integration, $pricePayload);
        $candidates = $this->extractServiceCandidates($priceResponse);
        $selected = collect($candidates)
            ->sortBy(fn ($candidate) => (float) ($candidate['fee'] ?? PHP_FLOAT_MAX))
            ->first(fn ($candidate) => !empty($candidate['service_code']));

        if (!$selected) {
            Log::warning('ViettelPost getPriceAll did not yield a usable service code', [
                'integration_id' => $integration->id,
                'account_id' => $integration->account_id,
                'carrier_code' => $integration->carrier_code,
                'request_payload' => $pricePayload,
                'response' => $priceResponse,
                'candidates' => $candidates,
            ]);
            throw new RuntimeException('Khong tu dong lay duoc ma dich vu ViettelPost. Vui long cau hinh ma dich vu mac dinh.');
        }

        return [
            'service_code' => $selected['service_code'],
            'service_add' => $selected['service_add'] ?? ($integration->default_service_add ?: ''),
            'estimated_fee' => $selected['fee'] ?? null,
        ];
    }

    private function extractServiceCandidates(array $response): array
    {
        $candidates = [];
        $this->walkServiceNodes($response, $candidates);

        return array_values(array_filter($candidates, fn ($candidate) => !empty($candidate['service_code'])));
    }

    private function walkServiceNodes(array $node, array &$candidates): void
    {
        if ($this->looksLikeServiceNode($node)) {
            $candidates[] = [
                'service_code' => $this->firstNonEmpty($node, [
                    'SERVICE_CODE',
                    'MA_DV_CHINH',
                    'ORDER_SERVICE',
                    'serviceCode',
                    'service_code',
                    'service',
                    'MA_DV',
                ]),
                'service_add' => $this->firstNonEmpty($node, [
                    'SERVICE_ADD',
                    'ORDER_SERVICE_ADD',
                    'serviceAdd',
                    'service_add',
                    'MA_DV_CONG_THEM',
                ]),
                'fee' => $this->firstNumeric($node, [
                    'MONEY_TOTAL',
                    'MONEY_TOTALFEE',
                    'GIA_CUOC',
                    'PRICE',
                    'price',
                    'totalFee',
                ]),
            ];
        }

        foreach ($node as $value) {
            if (is_array($value)) {
                $this->walkServiceNodes($value, $candidates);
            }
        }
    }

    private function looksLikeServiceNode(array $node): bool
    {
        return $this->firstNonEmpty($node, [
            'SERVICE_CODE',
            'MA_DV_CHINH',
            'ORDER_SERVICE',
            'serviceCode',
            'service_code',
            'service',
            'MA_DV',
        ]) !== null;
    }

    private function firstNonEmpty(array $node, array $keys): ?string
    {
        foreach ($keys as $key) {
            $value = Arr::get($node, $key);
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }

            if (is_numeric($value)) {
                return (string) $value;
            }
        }

        return null;
    }

    private function firstNumeric(array $node, array $keys): ?float
    {
        foreach ($keys as $key) {
            $value = Arr::get($node, $key);
            if (is_numeric($value)) {
                return (float) $value;
            }
        }

        return null;
    }

    private function generateShipmentNumber(?int $accountId): string
    {
        $count = Shipment::withoutGlobalScopes()
            ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
            ->whereDate('created_at', today())
            ->count() + 1;

        return 'VD-' . now()->format('Ymd') . '-' . str_pad((string) $count, 4, '0', STR_PAD_LEFT);
    }

    private function extractTrackingNumber(array $response): ?string
    {
        $candidates = [
            Arr::get($response, 'data.ORDER_NUMBER'),
            Arr::get($response, 'data.order_number'),
            Arr::get($response, 'data.tracking_number'),
            Arr::get($response, 'data.orderNumber'),
            Arr::get($response, 'ORDER_NUMBER'),
            Arr::get($response, 'order_number'),
        ];

        foreach ($candidates as $candidate) {
            if (is_string($candidate) && trim($candidate) !== '') {
                return trim($candidate);
            }

            if (is_numeric($candidate)) {
                return (string) $candidate;
            }
        }

        return null;
    }

    private function extractExternalOrderNumber(array $response): ?string
    {
        $candidates = [
            Arr::get($response, 'data.ORDER_REFERENCE'),
            Arr::get($response, 'data.order_reference'),
            Arr::get($response, 'data.reference'),
            Arr::get($response, 'ORDER_REFERENCE'),
        ];

        foreach ($candidates as $candidate) {
            if (is_string($candidate) && trim($candidate) !== '') {
                return trim($candidate);
            }

            if (is_numeric($candidate)) {
                return (string) $candidate;
            }
        }

        return null;
    }

    private function extractCarrierFee(array $response): ?float
    {
        $candidates = [
            Arr::get($response, 'data.MONEY_TOTAL'),
            Arr::get($response, 'data.MONEY_TOTALFEE'),
            Arr::get($response, 'data.money_total'),
            Arr::get($response, 'data.money_total_fee'),
            Arr::get($response, 'MONEY_TOTAL'),
            Arr::get($response, 'MONEY_TOTALFEE'),
        ];

        foreach ($candidates as $candidate) {
            if (is_numeric($candidate)) {
                return (float) $candidate;
            }
        }

        return null;
    }

    private function extractCarrierReceivedAmount(Shipment $shipment): ?float
    {
        $raw = $shipment->raw_tracking_payload ?: [];

        $moneyCollectionOrigin = Arr::get($raw, 'MONEY_COLLECTION_ORIGIN')
            ?? Arr::get($raw, 'data.MONEY_COLLECTION_ORIGIN');
        $moneyTotal = Arr::get($raw, 'MONEY_TOTAL')
            ?? Arr::get($raw, 'data.MONEY_TOTAL');
        $feeCod = Arr::get($raw, 'MONEY_FEECOD')
            ?? Arr::get($raw, 'data.MONEY_FEECOD');

        if (is_numeric($moneyCollectionOrigin)) {
            $received = (float) $moneyCollectionOrigin - (float) ($moneyTotal ?: 0) - (float) ($feeCod ?: 0);
            return round($received, 2);
        }

        if (is_numeric($shipment->reconciled_amount) && (float) $shipment->reconciled_amount > 0) {
            return (float) $shipment->reconciled_amount;
        }

        return null;
    }
}
