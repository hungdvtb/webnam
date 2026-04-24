<?php

namespace App\Support;

use App\Models\Order;

class OrderShippingFeeCalculator
{
    public static function resolveRecordedShippingFee(Order $order): float
    {
        $storedShippingFee = max(0, round((float) ($order->internal_shipping_fee ?? 0), 2));
        $outsideDeliveryFee = max(0, round((float) data_get($order->external_delivery_meta, 'shipping_cost', 0), 2));
        $activeShipmentFee = $order->relationLoaded('activeShipment') && $order->activeShipment
            ? max(0, round((float) ($order->activeShipment->shipping_cost ?? 0), 2))
            : 0.0;

        return max($storedShippingFee, $outsideDeliveryFee, $activeShipmentFee);
    }

    public static function resolveShippingSummary(Order $order): array
    {
        $recordedShippingFee = self::resolveRecordedShippingFee($order);
        $estimatedShippingFee = $recordedShippingFee > 0
            ? 0.0
            : round(max(0, (float) ($order->total_price ?? 0)) * 0.05, 2);

        return [
            'shipping_fee_recorded' => round($recordedShippingFee, 2),
            'shipping_fee_estimated' => round($estimatedShippingFee, 2),
            'shipping_fee_total' => round($recordedShippingFee + $estimatedShippingFee, 2),
        ];
    }

    public static function resolveTotalShippingFee(Order $order): float
    {
        return self::resolveShippingSummary($order)['shipping_fee_total'];
    }
}
