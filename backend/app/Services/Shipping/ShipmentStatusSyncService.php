<?php

namespace App\Services\Shipping;

use App\Models\CarrierRawStatus;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\OrderStatusLog;
use App\Models\Shipment;
use App\Models\ShipmentStatusLog;
use App\Support\OrderCodAdjustmentSystemNote;
use App\Support\OrderStatusCatalog;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

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
        $carrierCode = $this->mapper->canonicalizeCarrierCode($shipment->carrier_code) ?? trim((string) $shipment->carrier_code);
        $accountId = $shipment->account_id;

        if ($carrierCode === '') {
            return [
                'success' => false,
                'message' => 'Vận đơn chưa có mã hãng vận chuyển để áp mapping.',
                'shipment' => $shipment,
                'order_synced' => false,
            ];
        }

        if ($carrierCode && $shipment->carrier_code !== $carrierCode) {
            $shipment->carrier_code = $carrierCode;
            if ($carrierCode === 'viettel_post' && !$shipment->carrier_name) {
                $shipment->carrier_name = 'Viettel Post';
            }
        }

        $this->rememberCarrierRawStatus($accountId, $carrierCode, $carrierRawStatus, $rawPayload);

        $mapped = $this->mapper->mapCarrierStatus($carrierCode, $carrierRawStatus, $accountId);

        if (!$mapped['shipment_status']) {
            if (!empty($mapped['blocked_by_disabled_mapping'])) {
                Log::info("Carrier status mapping disabled: {$carrierCode}:{$carrierRawStatus}", [
                    'shipment_id' => $shipment->id,
                    'mapping_id' => $mapped['mapping_id'] ?? null,
                ]);

                return [
                    'success' => false,
                    'message' => "Trang thai tu hang '{$carrierRawStatus}' dang bi tat mapping nen se khong tu dong dong bo.",
                    'shipment' => $shipment,
                    'order_synced' => false,
                    'mapping_disabled' => true,
                ];
            }

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

    public function reapplyStoredCarrierStatus(
        Shipment $shipment,
        string $source = 'carrier_mapping_reapply',
        ?int $changedBy = null
    ): array {
        $carrierRawStatus = trim((string) ($shipment->carrier_status_raw ?? ''));
        $carrierCode = $this->mapper->canonicalizeCarrierCode($shipment->carrier_code) ?? trim((string) $shipment->carrier_code);
        $accountId = $shipment->account_id;

        if ($carrierCode === '' || $carrierRawStatus === '') {
            return [
                'success' => false,
                'message' => 'Van don chua co raw status de doi chieu mapping.',
                'shipment' => $shipment,
                'order_synced' => false,
            ];
        }

        $samplePayload = is_array($shipment->raw_tracking_payload) ? $shipment->raw_tracking_payload : null;
        $this->rememberCarrierRawStatus($accountId, $carrierCode, $carrierRawStatus, $samplePayload);

        $mapped = $this->mapper->mapCarrierStatus($carrierCode, $carrierRawStatus, $accountId);

        if (!$mapped['shipment_status']) {
            return [
                'success' => false,
                'message' => !empty($mapped['blocked_by_disabled_mapping'])
                    ? 'Mapping hien tai dang bi tat nen khong tu dong dong bo lai.'
                    : 'Khong tim thay mapping hop le cho raw status hien tai.',
                'shipment' => $shipment,
                'order_synced' => false,
                'mapping_disabled' => (bool) ($mapped['blocked_by_disabled_mapping'] ?? false),
            ];
        }

        if ($shipment->carrier_code !== $carrierCode) {
            $shipment->carrier_code = $carrierCode;
        }

        $shipment->carrier_status_mapped = $mapped['shipment_status'];
        $shipment->carrier_status_code = $carrierRawStatus;
        $shipment->carrier_status_text = $this->describeCarrierStatus($carrierRawStatus, $mapped['shipment_status']);

        if ($shipment->isDirty(['carrier_code', 'carrier_status_mapped', 'carrier_status_code', 'carrier_status_text'])) {
            $shipment->save();
        }

        if ((string) $shipment->shipment_status !== (string) $mapped['shipment_status']) {
            return $this->updateShipmentStatus(
                $shipment,
                $mapped['shipment_status'],
                $source,
                $changedBy,
                "Re-apply mapping tu carrier: {$carrierCode} raw='{$carrierRawStatus}'"
            );
        }

        $orderSynced = $this->syncOrderFromShipment($shipment, $source, $changedBy);

        return [
            'success' => true,
            'message' => 'Da dong bo lai mapping cho van don hien co.',
            'shipment' => $shipment->fresh(),
            'order_synced' => $orderSynced,
        ];
    }

    public function syncOrderFromShipment(
        Shipment $shipment,
        string $source = 'shipment_sync',
        ?int $changedBy = null,
        bool $syncOrderStatus = true
    ): bool
    {
        $order = $shipment->order;
        if (!$order) {
            return false;
        }

        $shouldUseRawStatus = $this->isCarrierDrivenSource($source);
        $carrierCode = $this->mapper->canonicalizeCarrierCode($shipment->carrier_code) ?? $shipment->carrier_code;
        $orderSync = $this->mapper->resolveOrderStatusSync(
            $carrierCode,
            $shipment->shipment_status,
            $shipment->account_id,
            $shouldUseRawStatus ? $shipment->carrier_status_raw : null
        );

        $oldOrderStatus = $order->status;
        $isCurrentOrderTerminal = in_array($oldOrderStatus, ['returned', 'completed', 'cancelled', OrderStatusCatalog::EXCHANGE_COMPLETED_CODE, OrderStatusCatalog::PARTIAL_DELIVERY_CODE]);
        
        $shouldSyncOrderStatus = $syncOrderStatus && ($orderSync['should_sync_order_status'] ?? false);
        $newOrderStatus = $shouldSyncOrderStatus
            ? $this->resolveOrderStatusForSpecialOrderType(
                $order,
                (string) $shipment->shipment_status,
                (string) ($orderSync['order_status'] ?? $oldOrderStatus)
            )
            : $oldOrderStatus;

        // Protection: If current order status is terminal, do not allow syncing back to non-terminal status
        // unless it's a specific terminal-to-terminal transition (e.g. from returned to exchange_completed).
        if ($isCurrentOrderTerminal && $newOrderStatus) {
            $isNewOrderTerminal = in_array($newOrderStatus, ['returned', 'completed', 'cancelled', OrderStatusCatalog::EXCHANGE_COMPLETED_CODE, OrderStatusCatalog::PARTIAL_DELIVERY_CODE]);
            if (!$isNewOrderTerminal) {
                $shouldSyncOrderStatus = false;
                $newOrderStatus = $oldOrderStatus;
            }
        }
        $oldShippingStatus = $order->shipping_status;
        $newShippingStatus = $shipment->shipment_status;
        $statusChanged = $shouldSyncOrderStatus
            && $newOrderStatus
            && $oldOrderStatus !== $newOrderStatus;
        $shippingChanged = $oldShippingStatus !== $newShippingStatus;

        [$problemCode, $problemMessage] = $this->resolveProblemSummary($shipment);
        $trackingCode = $shipment->carrier_tracking_code ?: $shipment->tracking_number;
        $expectedDispatchedAt = $shipment->shipped_at ?: $order->shipping_dispatched_at;
        $expectedInternalShippingFee = (string) $shipment->shipment_status === 'canceled'
            ? 0.0
            : max(0, round((float) ($shipment->shipping_cost ?? 0), 2));
        $dispatchedMatches = (!$expectedDispatchedAt && !$order->shipping_dispatched_at)
            || (
                $expectedDispatchedAt
                && $order->shipping_dispatched_at
                && $order->shipping_dispatched_at->equalTo($expectedDispatchedAt)
            );
        $financialUpdateData = $this->buildOrderFinancialSyncPayload($order, $shipment);
        $financialChanged = $this->hasModelDifferences($order, $financialUpdateData);

        if (
            !$statusChanged
            && !$shippingChanged
            && $order->shipping_issue_code === $problemCode
            && $order->shipping_issue_message === $problemMessage
            && $order->shipping_tracking_code === $trackingCode
            && $order->shipping_carrier_code === $shipment->carrier_code
            && $order->shipping_carrier_name === $shipment->carrier_name
            && $dispatchedMatches
            && (
                !Schema::hasColumn('orders', 'internal_shipping_fee')
                || abs((float) ($order->internal_shipping_fee ?? 0) - $expectedInternalShippingFee) < 0.01
            )
            && !$financialChanged
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
            'shipping_status_source' => $this->isCarrierDrivenSource($source) ? 'carrier' : 'system',
            'shipping_carrier_code' => $carrierCode,
            'shipping_carrier_name' => $shipment->carrier_name,
            'shipping_tracking_code' => $shipment->carrier_tracking_code ?: $shipment->tracking_number,
            'shipping_dispatched_at' => $shipment->shipped_at ?: $order->shipping_dispatched_at ?: now(),
            'shipping_issue_code' => $problemCode,
            'shipping_issue_message' => $problemMessage,
            'shipping_issue_detected_at' => $problemCode ? ($shipment->problem_detected_at ?: now()) : null,
        ];

        if (Schema::hasColumn('orders', 'internal_shipping_fee')) {
            $updateData['internal_shipping_fee'] = $expectedInternalShippingFee;
        }

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
        $updateData = array_merge($updateData, $financialUpdateData);

        $order->update($updateData);
        $this->syncInvoiceAmountFromOrder($order, $updateData);

        return true;
    }

    public function syncShipmentFinancialsFromOrder(Order $order): bool
    {
        $shipment = $order->relationLoaded('activeShipment')
            ? $order->activeShipment
            : $order->activeShipment()->first();

        if (!$shipment) {
            return $this->syncOrderCodAdjustmentNote($order, null, 0.0, false);
        }

        $updateData = $this->buildShipmentFinancialSyncPayload($order, $shipment);
        $shipmentChanged = $this->hasModelDifferences($shipment, $updateData);

        if ($shipmentChanged) {
            $shipment->update($updateData);
        }

        $currentSystemAdjustment = $this->resolveCurrentSystemAdjustmentAmount($order);
        $baseManualDiscount = $this->resolveManualDiscountBase($order, $currentSystemAdjustment);
        $noteChanged = $this->syncOrderCodAdjustmentNote(
            $order,
            $shipment,
            $currentSystemAdjustment,
            abs($baseManualDiscount) >= 0.01
        );

        return $shipmentChanged || $noteChanged;
    }

    private function resolveOrderStatusForSpecialOrderType(
        Order $order,
        string $shipmentStatus,
        string $mappedOrderStatus
    ): string {
        $currentStatus = trim((string) $order->status);
        $normalizedOrderType = $order->getNormalizedOrderType();

        if ($normalizedOrderType === Order::TYPE_EXCHANGE_RETURN) {
            if (in_array($shipmentStatus, ['returning', 'returned'], true)) {
                return $currentStatus === OrderStatusCatalog::EXCHANGE_COMPLETED_CODE
                    ? $currentStatus
                    : 'pending_return';
            }

            return $mappedOrderStatus;
        }

        if ($normalizedOrderType === Order::TYPE_PARTIAL_DELIVERY) {
            if ($shipmentStatus === 'returned') {
                return OrderStatusCatalog::PARTIAL_DELIVERY_CODE;
            }

            if ($shipmentStatus === 'returning') {
                return $currentStatus === OrderStatusCatalog::PARTIAL_DELIVERY_CODE
                    ? $currentStatus
                    : 'pending_return';
            }
        }

        return $mappedOrderStatus;
    }

    private function buildOrderFinancialSyncPayload(Order $order, Shipment $shipment): array
    {
        if ((string) $shipment->shipment_status === 'canceled') {
            return $this->filterPersistableOrderData([
                'notes' => $this->resolveOrderCodAdjustmentNotes($order, null, 0.0, false),
            ]);
        }

        $itemRevenue = $this->resolveOrderItemRevenue($order);
        $targetTotalPrice = round((float) ($shipment->cod_amount ?? 0), 2);
        $targetDiscount = round($itemRevenue - $targetTotalPrice, 2);
        $currentSystemAdjustment = $this->resolveCurrentSystemAdjustmentAmount($order);
        $baseManualDiscount = $this->resolveManualDiscountBase($order, $currentSystemAdjustment);
        $systemAdjustment = round($targetDiscount - $baseManualDiscount, 2);
        $baseCostTotal = round((float) ($order->cost_total ?? 0), 2);
        $baseProfitTotal = round($targetTotalPrice - $baseCostTotal, 2);
        $normalizedOrderType = $order->getNormalizedOrderType();
        $settlementDelta = $normalizedOrderType === Order::TYPE_STANDARD
            ? 0.0
            : round((float) ($order->settlement_delta ?? 0), 2);
        $supplementTotalPrice = $normalizedOrderType === Order::TYPE_STANDARD
            ? 0.0
            : round((float) ($order->supplement_items_total_price ?? 0), 2);
        $supplementCostTotal = $normalizedOrderType === Order::TYPE_STANDARD
            ? 0.0
            : round((float) ($order->supplement_items_cost_total ?? 0), 2);
        $reportRevenueTotal = $normalizedOrderType === Order::TYPE_STANDARD
            ? $targetTotalPrice
            : round($targetTotalPrice - $supplementTotalPrice + $settlementDelta, 2);
        $reportCostTotal = $normalizedOrderType === Order::TYPE_STANDARD
            ? $baseCostTotal
            : round($baseCostTotal - $supplementCostTotal, 2);
        $reportProfitTotal = round($reportRevenueTotal - $reportCostTotal, 2);

        return $this->filterPersistableOrderData([
            'total_price' => $targetTotalPrice,
            'discount' => $targetDiscount,
            'profit_total' => $baseProfitTotal,
            'report_revenue_total' => $reportRevenueTotal,
            'report_cost_total' => $reportCostTotal,
            'report_profit_total' => $reportProfitTotal,
            'notes' => $this->resolveOrderCodAdjustmentNotes(
                $order,
                $shipment,
                $systemAdjustment,
                abs($baseManualDiscount) >= 0.01
            ),
        ]);
    }

    private function buildShipmentFinancialSyncPayload(Order $order, Shipment $shipment): array
    {
        if ((string) $shipment->shipment_status === 'canceled') {
            return [];
        }

        $targetCodAmount = round((float) ($order->total_price ?? 0), 2);
        $targetActualReceivedAmount = round(
            $targetCodAmount
            - (float) ($shipment->shipping_cost ?? 0)
            - (float) ($shipment->service_fee ?? 0)
            - (float) ($shipment->return_fee ?? 0)
            - (float) ($shipment->other_fee ?? 0),
            2
        );

        return $this->filterPersistableShipmentData([
            'cod_amount' => $targetCodAmount,
            'actual_received_amount' => $targetActualReceivedAmount,
        ]);
    }

    private function resolveOrderItemRevenue(Order $order): float
    {
        if (Schema::hasTable('order_items')) {
            try {
                return round(
                    (float) $order->items()
                        ->selectRaw('COALESCE(SUM(price * quantity), 0) as aggregate')
                        ->value('aggregate'),
                    2
                );
            } catch (\Throwable $exception) {
                Log::warning('Cannot resolve order item revenue for shipment financial sync.', [
                    'order_id' => $order->id,
                    'message' => $exception->getMessage(),
                ]);
            }
        }

        return round(
            (float) ($order->total_price ?? 0)
            + (float) ($order->discount ?? 0),
            2
        );
    }

    private function syncOrderCodAdjustmentNote(
        Order $order,
        ?Shipment $shipment = null,
        ?float $adjustmentAmount = null,
        bool $isAdditional = false
    ): bool {
        $targetNotes = $this->resolveOrderCodAdjustmentNotes($order, $shipment, $adjustmentAmount, $isAdditional);
        $currentNotes = $this->normalizeOrderNotes($order->notes);

        if ($currentNotes === $targetNotes) {
            return false;
        }

        $order->forceFill([
            'notes' => $targetNotes,
        ])->save();

        $order->setAttribute('notes', $targetNotes);

        return true;
    }

    private function resolveOrderCodAdjustmentNotes(
        Order $order,
        ?Shipment $shipment = null,
        ?float $adjustmentAmount = null,
        bool $isAdditional = false
    ): ?string {
        $resolvedShipment = $shipment;

        if ($resolvedShipment === null) {
            $resolvedShipment = $order->relationLoaded('activeShipment')
                ? $order->activeShipment
                : $order->activeShipment()->first();
        }

        $effectiveAdjustmentAmount = $resolvedShipment && (string) $resolvedShipment->shipment_status !== 'canceled'
            ? round((float) ($adjustmentAmount ?? 0), 2)
            : 0.0;

        return OrderCodAdjustmentSystemNote::sync($order->notes, $effectiveAdjustmentAmount, $isAdditional);
    }

    private function resolveCurrentSystemAdjustmentAmount(Order $order): float
    {
        return round(OrderCodAdjustmentSystemNote::extractAdjustmentAmount($order->notes), 2);
    }

    private function resolveManualDiscountBase(Order $order, ?float $currentSystemAdjustment = null): float
    {
        $resolvedSystemAdjustment = round((float) ($currentSystemAdjustment ?? $this->resolveCurrentSystemAdjustmentAmount($order)), 2);

        return round((float) ($order->discount ?? 0) - $resolvedSystemAdjustment, 2);
    }

    private function normalizeOrderNotes(?string $notes): ?string
    {
        $normalized = str_replace(["\r\n", "\r"], "\n", trim((string) ($notes ?? '')));

        return $normalized === '' ? null : $normalized;
    }

    private function filterPersistableOrderData(array $data): array
    {
        return collect($data)
            ->filter(fn ($value, $column) => Schema::hasColumn('orders', (string) $column))
            ->all();
    }

    private function filterPersistableShipmentData(array $data): array
    {
        return collect($data)
            ->filter(fn ($value, $column) => Schema::hasColumn('shipments', (string) $column))
            ->all();
    }

    private function hasModelDifferences(object $model, array $data): bool
    {
        foreach ($data as $column => $value) {
            $currentValue = $model->{$column} ?? null;

            if (is_numeric($value) || is_numeric($currentValue)) {
                if (abs((float) ($currentValue ?? 0) - (float) $value) >= 0.01) {
                    return true;
                }

                continue;
            }

            if ($currentValue !== $value) {
                return true;
            }
        }

        return false;
    }

    private function syncInvoiceAmountFromOrder(Order $order, array $updatedOrderData): void
    {
        if (!array_key_exists('total_price', $updatedOrderData) || !Schema::hasTable('invoices')) {
            return;
        }

        Invoice::query()
            ->where('order_id', $order->id)
            ->update(['amount' => (float) $updatedOrderData['total_price']]);
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

    public function rememberCarrierRawStatus(
        ?int $accountId,
        ?string $carrierCode,
        ?string $carrierRawStatus,
        ?array $samplePayload = null
    ): void
    {
        $normalizedCarrierCode = $this->mapper->canonicalizeCarrierCode($carrierCode) ?? trim((string) $carrierCode);
        $normalizedRawStatus = trim((string) ($carrierRawStatus ?? ''));

        if ($normalizedCarrierCode === '' || $normalizedRawStatus === '') {
            return;
        }

        $mapping = $this->mapper->findExistingMappingForRawStatus($normalizedCarrierCode, $normalizedRawStatus, $accountId);
        $rawStatusRecord = CarrierRawStatus::query()->firstOrNew([
            'account_id' => $accountId,
            'carrier_code' => $normalizedCarrierCode,
            'raw_status' => $normalizedRawStatus,
        ]);

        if (!$rawStatusRecord->exists || $rawStatusRecord->first_seen_at === null) {
            $rawStatusRecord->first_seen_at = now();
        }

        $rawStatusRecord->last_seen_at = now();
        $rawStatusRecord->is_mapped = $mapping !== null;
        $rawStatusRecord->mapping_id = $mapping?->id;

        if ($samplePayload !== null) {
            $rawStatusRecord->sample_payload = $samplePayload;
        }

        $rawStatusRecord->save();
    }

    private function isCarrierDrivenSource(string $source): bool
    {
        return in_array($source, ['carrier_sync', 'carrier_mapping_reapply'], true);
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
        return $rawStatus;
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
