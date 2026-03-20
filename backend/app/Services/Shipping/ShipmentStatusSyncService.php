<?php

namespace App\Services\Shipping;

use App\Models\CarrierRawStatus;
use App\Models\Order;
use App\Models\OrderStatusLog;
use App\Models\Shipment;
use App\Models\ShipmentStatusLog;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ShipmentStatusSyncService
{
    private ShipmentTransitionGuard $guard;
    private CarrierStatusMapper $mapper;

    public function __construct(ShipmentTransitionGuard $guard, CarrierStatusMapper $mapper)
    {
        $this->guard = $guard;
        $this->mapper = $mapper;
    }

    public function updateShipmentStatus(
        Shipment $shipment,
        string $newStatus,
        string $source = 'manual',
        ?int $changedBy = null,
        ?string $reason = null,
        ?string $failedReason = null,
        bool $isAdminOverride = false
    ): array {
        $oldStatus = $shipment->shipment_status;

        $check = $this->guard->canTransition($oldStatus, $newStatus, $isAdminOverride);
        if (!$check['allowed']) {
            return [
                'success' => false,
                'message' => $check['reason'],
                'shipment' => $shipment,
                'order_synced' => false,
                'requires_override' => $check['requires_override'] ?? false,
            ];
        }

        return DB::transaction(function () use ($shipment, $oldStatus, $newStatus, $source, $changedBy, $reason, $failedReason) {
            ShipmentStatusLog::create([
                'shipment_id' => $shipment->id,
                'from_status' => $oldStatus,
                'to_status' => $newStatus,
                'changed_by' => $changedBy,
                'change_source' => $source,
                'reason' => $reason,
            ]);

            $shipment->shipment_status = $newStatus;
            $shipment->status = $newStatus;
            $this->setShipmentTimestamp($shipment, $newStatus);

            if ($newStatus === 'delivery_failed') {
                $shipment->attempt_delivery_count = ($shipment->attempt_delivery_count ?? 0) + 1;
                if ($failedReason) {
                    $shipment->failed_reason = $failedReason;
                }
            }

            if ($newStatus === 'delivered') {
                $shipment->cod_status = 'collected';
            }

            $shipment->save();

            $orderSynced = $this->syncOrderFromShipment($shipment, $source, $changedBy);

            return [
                'success' => true,
                'message' => 'Trạng thái vận đơn đã được cập nhật thành công.',
                'shipment' => $shipment->fresh(),
                'order_synced' => $orderSynced,
            ];
        });
    }

    public function processCarrierStatus(Shipment $shipment, string $carrierRawStatus, ?array $rawPayload = null): array
    {
        $carrierCode = $shipment->carrier_code;
        $accountId = $shipment->account_id;
        $mapped = $this->mapper->mapCarrierStatus($carrierCode, $carrierRawStatus, $accountId);

        if (!$mapped['shipment_status']) {
            CarrierRawStatus::updateOrCreate(
                [
                    'account_id' => $accountId,
                    'carrier_code' => $carrierCode,
                    'raw_status' => $carrierRawStatus,
                ],
                [
                    'first_seen_at' => now(),
                    'last_seen_at' => now(),
                    'is_mapped' => false,
                    'sample_payload' => $rawPayload,
                ]
            );

            Log::warning("Unknown carrier status: {$carrierCode}:{$carrierRawStatus}", [
                'shipment_id' => $shipment->id,
            ]);

            return [
                'success' => false,
                'message' => "Trạng thái từ hãng '{$carrierRawStatus}' chưa được mapping.",
                'shipment' => $shipment,
                'order_synced' => false,
            ];
        }

        $shipment->carrier_status_raw = $carrierRawStatus;
        $shipment->carrier_status_mapped = $mapped['shipment_status'];
        $shipment->carrier_status_code = $carrierRawStatus;
        $shipment->carrier_status_text = $this->describeCarrierStatus($carrierRawStatus, $mapped['shipment_status']);
        $shipment->last_synced_at = now();

        if ($rawPayload) {
            $shipment->raw_tracking_payload = $rawPayload;
            $shipment->last_webhook_received_at = now();
        }

        $shipment->save();

        $result = $this->updateShipmentStatus(
            $shipment,
            $mapped['shipment_status'],
            'carrier_sync',
            null,
            "Auto-sync từ hãng VC: {$carrierCode} raw='{$carrierRawStatus}'"
        );

        if ($rawPayload) {
            $this->recordTrackingHistory($shipment->fresh(), $carrierRawStatus, $rawPayload);
        }

        return $result;
    }

    public function syncOrderFromShipment(Shipment $shipment, string $source = 'shipment_sync', ?int $changedBy = null): bool
    {
        $order = $shipment->order;
        if (!$order) {
            return false;
        }

        $newOrderStatus = $this->mapper->shipmentToOrderStatus($shipment->shipment_status);
        if (!$newOrderStatus) {
            return false;
        }

        $oldOrderStatus = $order->status;
        $oldShippingStatus = $order->shipping_status;
        $newShippingStatus = $shipment->shipment_status;
        $statusChanged = $oldOrderStatus !== $newOrderStatus;
        $shippingChanged = $oldShippingStatus !== $newShippingStatus;

        [$problemCode, $problemMessage] = $this->resolveProblemSummary($shipment);

        if (
            !$statusChanged
            && !$shippingChanged
            && $order->shipping_issue_code === $problemCode
            && $order->shipping_tracking_code === ($shipment->carrier_tracking_code ?: $shipment->tracking_number)
        ) {
            return false;
        }

        OrderStatusLog::create([
            'order_id' => $order->id,
            'from_status' => $oldOrderStatus,
            'to_status' => $statusChanged ? $newOrderStatus : $oldOrderStatus,
            'from_shipping_status' => $oldShippingStatus,
            'to_shipping_status' => $newShippingStatus,
            'source' => $source,
            'changed_by' => $changedBy,
            'reason' => "Đồng bộ từ vận đơn {$shipment->shipment_number}: {$shipment->shipment_status}",
        ]);

        $updateData = [
            'shipping_status' => $newShippingStatus,
            'shipping_synced_at' => now(),
            'shipping_status_source' => $source === 'carrier_sync' ? 'carrier' : 'system',
            'shipping_carrier_code' => $shipment->carrier_code,
            'shipping_carrier_name' => $shipment->carrier_name,
            'shipping_tracking_code' => $shipment->carrier_tracking_code ?: $shipment->tracking_number,
            'shipping_dispatched_at' => $shipment->shipped_at ?: $order->shipping_dispatched_at ?: now(),
            'shipping_issue_code' => $problemCode,
            'shipping_issue_message' => $problemMessage,
            'shipping_issue_detected_at' => $problemCode ? ($shipment->problem_detected_at ?: now()) : null,
        ];

        if ($statusChanged) {
            $updateData['status'] = $newOrderStatus;
        }

        $legacyShipmentStatusMap = [
            'created' => 'ready',
            'waiting_pickup' => 'ready',
            'picked_up' => 'shipped',
            'shipped' => 'shipped',
            'in_transit' => 'shipped',
            'out_for_delivery' => 'shipped',
            'delivered' => 'delivered',
            'delivery_failed' => 'shipped',
            'returning' => 'returned',
            'returned' => 'returned',
            'canceled' => 'ready',
        ];
        $updateData['shipment_status'] = $legacyShipmentStatusMap[$newShippingStatus] ?? $order->shipment_status;

        $order->update($updateData);

        return true;
    }

    public function canManuallyEditOrderShipping(Order $order): array
    {
        if (!$order->shipments()->exists()) {
            return ['allowed' => true, 'reason' => null];
        }

        $activeShipment = $order->shipments()
            ->whereNotIn('shipment_status', ['canceled'])
            ->first();

        if ($activeShipment) {
            return [
                'allowed' => false,
                'reason' => "Đơn hàng đã có vận đơn {$activeShipment->shipment_number}. Trạng thái giao hàng được đồng bộ tự động từ vận đơn.",
                'shipment_id' => $activeShipment->id,
                'shipment_number' => $activeShipment->shipment_number,
            ];
        }

        return ['allowed' => true, 'reason' => 'Tất cả vận đơn đã hủy, có thể sửa tay.'];
    }

    private function setShipmentTimestamp(Shipment $shipment, string $status): void
    {
        $map = [
            'picked_up' => 'picked_at',
            'shipped' => 'shipped_at',
            'in_transit' => 'in_transit_at',
            'out_for_delivery' => 'out_for_delivery_at',
            'delivered' => 'delivered_at',
            'delivery_failed' => 'delivery_failed_at',
            'returning' => 'returning_at',
            'returned' => 'returned_at',
            'canceled' => 'canceled_at',
        ];

        if (isset($map[$status])) {
            $shipment->{$map[$status]} = $shipment->{$map[$status]} ?? now();
        }

        if (in_array($status, ['picked_up', 'shipped', 'in_transit'], true)) {
            $shipment->shipped_at = $shipment->shipped_at ?? now();
        }

        [$problemCode, $problemMessage] = $this->resolveProblemSummary($shipment, $status);
        $shipment->problem_code = $problemCode;
        $shipment->problem_message = $problemMessage;
        $shipment->problem_detected_at = $problemCode ? ($shipment->problem_detected_at ?: now()) : null;
    }

    private function resolveProblemSummary(Shipment $shipment, ?string $status = null): array
    {
        $status = $status ?: $shipment->shipment_status;

        if (in_array($status, ['delivery_failed', 'returning', 'returned', 'canceled'], true)) {
            return [
                $status,
                $shipment->failed_reason ?: $shipment->problem_message ?: 'Vận đơn đang có vấn đề cần xử lý',
            ];
        }

        if (($shipment->attempt_delivery_count ?? 0) >= 2) {
            return ['multiple_delivery_failures', 'Vận đơn giao thất bại nhiều lần'];
        }

        if ($shipment->reconciliation_status === 'mismatch') {
            return ['reconciliation_mismatch', 'Đối soát vận đơn bị lệch'];
        }

        return [null, null];
    }

    private function describeCarrierStatus(string $rawStatus, string $mappedStatus): string
    {
        return sprintf('Raw %s -> %s', $rawStatus, $mappedStatus);
    }

    private function recordTrackingHistory(Shipment $shipment, string $carrierRawStatus, array $rawPayload): void
    {
        $eventTime = $this->parseCarrierEventTime((string) data_get($rawPayload, 'ORDER_STATUSDATE'));

        $exists = $shipment->trackingHistories()
            ->where('status', $shipment->shipment_status)
            ->where('event_time', $eventTime)
            ->exists();

        if ($exists) {
            return;
        }

        $shipment->trackingHistories()->create([
            'tracking_code' => $shipment->carrier_tracking_code ?: $shipment->tracking_number,
            'status' => $shipment->shipment_status,
            'sub_status' => $carrierRawStatus,
            'description' => 'Carrier cập nhật trạng thái ' . (data_get($rawPayload, 'ORDER_STATUS') ?: $carrierRawStatus),
            'location' => data_get($rawPayload, 'CURRENT_WAREHOUSE_NAME') ?: data_get($rawPayload, 'LOCATION'),
            'event_time' => $eventTime,
            'raw_payload' => $rawPayload,
        ]);
    }

    private function parseCarrierEventTime(?string $value): Carbon
    {
        if (!$value) {
            return now();
        }

        foreach (['d/m/Y H:i:s', 'd/m/Y G:i:s'] as $format) {
            try {
                return Carbon::createFromFormat($format, $value);
            } catch (\Throwable $e) {
            }
        }

        return now();
    }
}
