<?php

namespace App\Services\Shipping;

use App\Models\Carrier;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Shipment;
use App\Models\ShipmentItem;
use App\Models\ShipmentStatusLog;
use App\Models\ShippingIntegration;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class ShipmentDispatchService
{
    public function __construct(
        private ViettelPostClient $viettelPostClient,
        private ViettelPostAddressService $addressService,
        private ShipmentStatusSyncService $shipmentStatusSyncService,
    ) {
    }

    public function preview(Collection $orders, string $carrierCode): array
    {
        $integration = $this->resolveIntegration($carrierCode, (int) $orders->first()?->account_id);
        $results = [];

        foreach ($orders as $order) {
            try {
                $this->validateOrderForDispatch($order, $integration);
                $results[] = ['order_id' => $order->id, 'order_number' => $order->order_number, 'valid' => true];
            } catch (\Throwable $e) {
                $results[] = [
                    'order_id' => $order->id,
                    'order_number' => $order->order_number,
                    'valid' => false,
                    'message' => $e->getMessage(),
                ];
            }
        }

        return [
            'carrier_code' => $carrierCode,
            'valid_count' => collect($results)->where('valid', true)->count(),
            'invalid_count' => collect($results)->where('valid', false)->count(),
            'results' => $results,
            'integration' => [
                'carrier_code' => $integration->carrier_code,
                'carrier_name' => $integration->carrier_name,
            ],
        ];
    }

    public function dispatch(Collection $orders, string $carrierCode, ?int $userId = null): array
    {
        $integration = $this->resolveIntegration($carrierCode, (int) $orders->first()?->account_id);
        $carrier = Carrier::where('code', $carrierCode)->first();

        $successCount = 0;
        $failedCount = 0;
        $results = [];

        foreach ($orders as $order) {
            try {
                $shipment = DB::transaction(function () use ($order, $integration, $carrier, $userId) {
                    $this->validateOrderForDispatch($order, $integration);
                    $payload = $this->buildDispatchPayload($order, $integration);
                    $response = $this->dispatchToCarrier($integration, $payload);

                    return $this->persistDispatchResult(
                        $order,
                        $integration,
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
            'success_count' => $successCount,
            'failed_count' => $failedCount,
            'results' => $results,
        ];
    }

    public function createAutomaticReconciliation(Shipment $shipment, ?int $userId = null): Shipment
    {
        $carrierReceived = $this->extractCarrierReceivedAmount($shipment);
        if ($carrierReceived === null) {
            throw new RuntimeException('Vận đơn chưa có dữ liệu carrier để đối soát.');
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
            'note' => 'Đối soát tự động từ dữ liệu carrier mới nhất',
            'reconciled_by' => $userId,
            'reconciled_at' => now(),
        ]);

        return $shipment->fresh();
    }

    private function persistDispatchResult(
        Order $order,
        ShippingIntegration $integration,
        ?Carrier $carrier,
        array $payload,
        array $response,
        ?int $userId = null
    ): Shipment {
        $trackingNumber = $this->extractTrackingNumber($response);
        $externalOrderNumber = $this->extractExternalOrderNumber($response) ?: $trackingNumber;
        $carrierFee = $this->extractCarrierFee($response);

        if (!$trackingNumber) {
            throw new RuntimeException('ViettelPost không trả về mã vận đơn.');
        }

        $shipment = Shipment::create([
            'account_id' => $order->account_id,
            'integration_id' => $integration->id,
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
            'sender_name' => $integration->sender_name,
            'sender_phone' => $integration->sender_phone,
            'sender_address' => $integration->sender_address,
            'status' => 'waiting_pickup',
            'shipment_status' => 'waiting_pickup',
            'order_status_snapshot' => $order->status,
            'carrier_status_raw' => '101',
            'carrier_status_mapped' => 'waiting_pickup',
            'carrier_status_code' => '101',
            'carrier_status_text' => 'Chờ lấy hàng',
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
            'reason' => 'Gửi đơn sang đơn vị vận chuyển',
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

        return $shipment->fresh(['order', 'carrier', 'integration']);
    }

    private function dispatchToCarrier(ShippingIntegration $integration, array $payload): array
    {
        if ($integration->carrier_code === 'viettel_post') {
            return $this->viettelPostClient->createOrder($integration, $payload);
        }

        throw new RuntimeException("Hãng '{$integration->carrier_code}' chưa hỗ trợ gửi API trong phiên bản này.");
    }

    private function buildDispatchPayload(Order $order, ShippingIntegration $integration): array
    {
        $sender = $this->addressService->resolveSenderIds($integration, [
            'province' => data_get($integration->config_json, 'sender_province_name'),
            'district' => data_get($integration->config_json, 'sender_district_name'),
            'ward' => data_get($integration->config_json, 'sender_ward_name'),
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

        return [
            'ORDER_NUMBER' => $order->order_number,
            'ORDER_REFERENCE' => $order->order_number,
            'ORDER_PAYMENT' => 3,
            'ORDER_SERVICE' => $integration->default_service_code,
            'ORDER_SERVICE_ADD' => $integration->default_service_add ?: '',
            'ORDER_NOTE' => $order->notes ?: 'Đơn từ hệ thống quản lý bán hàng',
            'SENDER_FULLNAME' => $integration->sender_name,
            'SENDER_PHONE' => $integration->sender_phone,
            'SENDER_ADDRESS' => $integration->sender_address,
            'SENDER_PROVINCE' => $sender['province_id'],
            'SENDER_DISTRICT' => $sender['district_id'],
            'RECEIVER_FULLNAME' => $order->customer_name,
            'RECEIVER_PHONE' => $order->customer_phone,
            'RECEIVER_ADDRESS' => $order->shipping_address,
            'RECEIVER_PROVINCE' => $receiver['province_id'],
            'RECEIVER_DISTRICT' => $receiver['district_id'],
            'PRODUCT_NAME' => $productName ?: ($firstItem?->product_name_snapshot ?: 'Đơn hàng website'),
            'PRODUCT_DESCRIPTION' => $productName ?: ($firstItem?->product_name_snapshot ?: 'Đơn hàng website'),
            'PRODUCT_QUANTITY' => max(1, (int) $items->sum('quantity')),
            'PRODUCT_PRICE' => (int) round((float) $order->total_price),
            'PRODUCT_WEIGHT' => $totalWeight,
            'PRODUCT_LENGTH' => 0,
            'PRODUCT_WIDTH' => 0,
            'PRODUCT_HEIGHT' => 0,
            'PRODUCT_TYPE' => 'HH',
            'MONEY_COLLECTION' => (int) round((float) $order->total_price),
        ];
    }

    private function validateOrderForDispatch(Order $order, ShippingIntegration $integration): void
    {
        if (!$integration->is_enabled) {
            throw new RuntimeException('Kết nối vận chuyển chưa được bật.');
        }

        if ($order->hasActiveShipment()) {
            throw new RuntimeException('Đơn đã có vận đơn đang hoạt động.');
        }

        if (!$order->customer_name || !$order->customer_phone || !$order->shipping_address) {
            throw new RuntimeException('Thiếu họ tên, số điện thoại hoặc địa chỉ giao hàng.');
        }

        if (!$order->province || !$order->district || !$order->ward) {
            throw new RuntimeException('Thiếu tỉnh/huyện/xã của đơn hàng.');
        }

        if (!$order->items()->exists()) {
            throw new RuntimeException('Đơn hàng không có sản phẩm để gửi.');
        }

        if (!$integration->sender_name || !$integration->sender_phone || !$integration->sender_address) {
            throw new RuntimeException('Thiếu thông tin người gửi mặc định trong cấu hình vận chuyển.');
        }

        if (!$integration->default_service_code) {
            throw new RuntimeException('Chưa cấu hình mã dịch vụ mặc định cho đơn vị vận chuyển.');
        }

        if (
            !data_get($integration->config_json, 'sender_province_name')
            || !data_get($integration->config_json, 'sender_district_name')
            || !data_get($integration->config_json, 'sender_ward_name')
        ) {
            throw new RuntimeException('Thiếu tỉnh/huyện/xã kho gửi trong cấu hình vận chuyển.');
        }
    }

    private function resolveIntegration(string $carrierCode, ?int $accountId): ShippingIntegration
    {
        $integration = ShippingIntegration::query()
            ->where('carrier_code', $carrierCode)
            ->where('account_id', $accountId)
            ->first();

        if (!$integration) {
            throw new RuntimeException('Đơn vị vận chuyển chưa được cấu hình cho tài khoản này.');
        }

        return $integration;
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
