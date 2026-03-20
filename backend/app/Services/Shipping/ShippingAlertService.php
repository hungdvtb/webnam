<?php

namespace App\Services\Shipping;

use App\Models\Order;
use App\Models\Shipment;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

class ShippingAlertService
{
    public function refreshOrderIssueSummary(?Order $order = null, ?Shipment $shipment = null): void
    {
        $order = $order ?: $shipment?->order;
        $shipment = $shipment ?: $order?->activeShipment;

        if (!$order) {
            return;
        }

        if (!$shipment || !$shipment->problem_code) {
            $order->forceFill([
                'shipping_issue_code' => null,
                'shipping_issue_message' => null,
                'shipping_issue_detected_at' => null,
            ])->save();

            return;
        }

        $order->forceFill([
            'shipping_issue_code' => $shipment->problem_code,
            'shipping_issue_message' => $shipment->problem_message,
            'shipping_issue_detected_at' => $shipment->problem_detected_at ?: now(),
        ])->save();
    }

    public function activeAlerts(int $accountId, int $perPage = 20): LengthAwarePaginator
    {
        return Order::query()
            ->where('account_id', $accountId)
            ->whereNotNull('shipping_issue_code')
            ->with(['activeShipment:id,order_id,shipment_number,carrier_name,carrier_tracking_code,shipment_status,problem_code,problem_message,problem_detected_at'])
            ->orderByDesc('shipping_issue_detected_at')
            ->paginate($perPage);
    }
}
