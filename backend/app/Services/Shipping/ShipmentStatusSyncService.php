<?php

namespace App\Services\Shipping;

use App\Models\Order;
use App\Models\OrderStatusLog;
use App\Models\Shipment;
use App\Models\ShipmentStatusLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ShipmentStatusSyncService
 *
 * Core service that orchestrates:
 * 1. Shipment status updates (with transition guard)
 * 2. Automatic order status sync from shipment changes
 * 3. Carrier raw status processing
 * 4. Audit logging for both shipment and order status changes
 */
class ShipmentStatusSyncService
{
    private ShipmentTransitionGuard $guard;
    private CarrierStatusMapper $mapper;

    public function __construct(ShipmentTransitionGuard $guard, CarrierStatusMapper $mapper)
    {
        $this->guard = $guard;
        $this->mapper = $mapper;
    }

    /**
     * Update shipment status (manual or system) and sync order
     *
     * @return array ['success' => bool, 'message' => string, 'shipment' => Shipment|null, 'order_synced' => bool]
     */
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

        // 1. Check transition validity
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

        // 2. Execute in transaction
        return DB::transaction(function () use ($shipment, $oldStatus, $newStatus, $source, $changedBy, $reason, $failedReason) {

            // Log shipment status change
            ShipmentStatusLog::create([
                'shipment_id'   => $shipment->id,
                'from_status'   => $oldStatus,
                'to_status'     => $newStatus,
                'changed_by'    => $changedBy,
                'change_source' => $source,
                'reason'        => $reason,
            ]);

            // Update shipment
            $shipment->shipment_status = $newStatus;
            $shipment->status = $newStatus;

            // Set timestamps
            $this->setShipmentTimestamp($shipment, $newStatus);

            // Handle delivery_failed specifics
            if ($newStatus === 'delivery_failed') {
                $shipment->attempt_delivery_count = ($shipment->attempt_delivery_count ?? 0) + 1;
                if ($failedReason) {
                    $shipment->failed_reason = $failedReason;
                }
            }

            // Handle delivered specifics
            if ($newStatus === 'delivered') {
                $shipment->cod_status = 'collected';
            }

            $shipment->save();

            // 3. Sync order status
            $orderSynced = $this->syncOrderFromShipment($shipment, $source, $changedBy);

            return [
                'success' => true,
                'message' => 'Trạng thái vận đơn đã cập nhật thành công.',
                'shipment' => $shipment->fresh(),
                'order_synced' => $orderSynced,
            ];
        });
    }

    /**
     * Process carrier webhook/API raw status
     *
     * @return array Result of the status update
     */
    public function processCarrierStatus(
        Shipment $shipment,
        string $carrierRawStatus,
        ?array $rawPayload = null
    ): array {
        $carrierCode = $shipment->carrier_code;

        // Map carrier raw status to internal statuses
        $mapped = $this->mapper->mapCarrierStatus($carrierCode, $carrierRawStatus);

        if (!$mapped['shipment_status']) {
            Log::warning("Unknown carrier status: {$carrierCode}::{$carrierRawStatus}", [
                'shipment_id' => $shipment->id,
            ]);
            return [
                'success' => false,
                'message' => "Trạng thái từ hãng '{$carrierRawStatus}' không nhận diện được.",
                'shipment' => $shipment,
                'order_synced' => false,
            ];
        }

        // Store raw data
        $shipment->carrier_status_raw = $carrierRawStatus;
        $shipment->carrier_status_mapped = $mapped['shipment_status'];
        $shipment->last_synced_at = now();
        if ($rawPayload) {
            $shipment->raw_tracking_payload = $rawPayload;
        }
        $shipment->save();

        // Update shipment status via guard
        return $this->updateShipmentStatus(
            $shipment,
            $mapped['shipment_status'],
            'carrier_sync',
            null,
            "Auto-sync từ hãng VC: {$carrierCode} raw='{$carrierRawStatus}'"
        );
    }

    /**
     * Sync order status from its active shipment
     */
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

        // Check if order status actually needs to change
        $statusChanged = ($oldOrderStatus !== $newOrderStatus);
        $shippingChanged = ($oldShippingStatus !== $newShippingStatus);

        if (!$statusChanged && !$shippingChanged) {
            return false; // no change needed
        }

        // Log order status change
        OrderStatusLog::create([
            'order_id'             => $order->id,
            'from_status'          => $oldOrderStatus,
            'to_status'            => $statusChanged ? $newOrderStatus : $oldOrderStatus,
            'from_shipping_status' => $oldShippingStatus,
            'to_shipping_status'   => $newShippingStatus,
            'source'               => $source,
            'changed_by'           => $changedBy,
            'reason'               => "Đồng bộ từ vận đơn {$shipment->shipment_number}: {$shipment->shipment_status}",
        ]);

        // Update order
        $updateData = [
            'shipping_status'        => $newShippingStatus,
            'shipping_synced_at'     => now(),
            'shipping_status_source' => ($source === 'carrier_sync') ? 'carrier' : 'system',
        ];

        if ($statusChanged) {
            $updateData['status'] = $newOrderStatus;
        }

        // Also update legacy shipment_status field for backward compat
        $legacyShipmentStatusMap = [
            'created' => 'ready', 'waiting_pickup' => 'ready', 'picked_up' => 'shipped',
            'shipped' => 'shipped', 'in_transit' => 'shipped', 'out_for_delivery' => 'shipped',
            'delivered' => 'delivered', 'delivery_failed' => 'shipped',
            'returning' => 'returned', 'returned' => 'returned', 'canceled' => 'ready',
        ];
        $updateData['shipment_status'] = $legacyShipmentStatusMap[$newShippingStatus] ?? $order->shipment_status;

        $order->update($updateData);

        return true;
    }

    /**
     * Check if an order's shipping-related status can be manually edited
     */
    public function canManuallyEditOrderShipping(Order $order): array
    {
        $hasShipment = $order->shipments()->exists();

        if (!$hasShipment) {
            return ['allowed' => true, 'reason' => null];
        }

        // Has shipment: check if any active (non-canceled) shipment exists
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

        // All shipments are canceled
        return ['allowed' => true, 'reason' => 'Tất cả vận đơn đã hủy, có thể sửa tay.'];
    }

    /**
     * Set appropriate timestamp on shipment based on status
     */
    private function setShipmentTimestamp(Shipment $shipment, string $status): void
    {
        $map = [
            'picked_up'          => 'picked_at',
            'shipped'            => 'shipped_at',
            'in_transit'         => 'in_transit_at',
            'out_for_delivery'   => 'out_for_delivery_at',
            'delivered'          => 'delivered_at',
            'delivery_failed'    => 'delivery_failed_at',
            'returning'          => 'returning_at',
            'returned'           => 'returned_at',
            'canceled'           => 'canceled_at',
        ];

        if (isset($map[$status])) {
            $shipment->{$map[$status]} = $shipment->{$map[$status]} ?? now();
        }

        if (in_array($status, ['picked_up', 'shipped', 'in_transit'])) {
            $shipment->shipped_at = $shipment->shipped_at ?? now();
        }
    }
}
