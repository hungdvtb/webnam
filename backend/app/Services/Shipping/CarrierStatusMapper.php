<?php

namespace App\Services\Shipping;

use App\Models\CarrierStatusMapping;
use Illuminate\Support\Facades\Cache;

/**
 * CarrierStatusMapper
 *
 * Maps raw carrier statuses to internal shipment statuses
 * and corresponding order statuses.
 */
class CarrierStatusMapper
{
    /**
     * Default mapping when carrier has no specific mapping defined
     * shipment_status => order_status
     */
    const DEFAULT_SHIPMENT_TO_ORDER_MAP = [
        'created'            => 'confirmed',
        'waiting_pickup'     => 'confirmed',
        'picked_up'          => 'shipping',
        'shipped'            => 'shipping',
        'in_transit'         => 'shipping',
        'out_for_delivery'   => 'shipping',
        'delivered'          => 'completed',
        'delivery_failed'    => 'processing',
        'returning'          => 'pending_return',
        'returned'           => 'returned',
        'canceled'           => 'cancelled',
    ];

    /**
     * Map a carrier raw status to internal statuses
     *
     * @return array ['shipment_status' => string, 'order_status' => string, 'is_terminal' => bool]
     */
    public function mapCarrierStatus(string $carrierCode, string $rawStatus): array
    {
        $mapping = $this->getMapping($carrierCode, $rawStatus);

        if ($mapping) {
            return [
                'shipment_status' => $mapping->internal_shipment_status,
                'order_status'    => $mapping->mapped_order_status,
                'is_terminal'     => (bool) $mapping->is_terminal,
            ];
        }

        // Fallback: try to match raw status to internal status directly
        $normalizedRaw = strtolower(str_replace([' ', '-'], '_', $rawStatus));
        if (array_key_exists($normalizedRaw, self::DEFAULT_SHIPMENT_TO_ORDER_MAP)) {
            return [
                'shipment_status' => $normalizedRaw,
                'order_status'    => self::DEFAULT_SHIPMENT_TO_ORDER_MAP[$normalizedRaw],
                'is_terminal'     => in_array($normalizedRaw, ['delivered', 'returned', 'canceled']),
            ];
        }

        // Unknown status - keep current, log warning
        return [
            'shipment_status' => null,
            'order_status'    => null,
            'is_terminal'     => false,
        ];
    }

    /**
     * Map internal shipment_status to order_status
     */
    public function shipmentToOrderStatus(string $shipmentStatus): ?string
    {
        return self::DEFAULT_SHIPMENT_TO_ORDER_MAP[$shipmentStatus] ?? null;
    }

    /**
     * Get mapping from database (cached)
     */
    private function getMapping(string $carrierCode, string $rawStatus): ?CarrierStatusMapping
    {
        $cacheKey = "carrier_mapping:{$carrierCode}:{$rawStatus}";

        return Cache::remember($cacheKey, 3600, function () use ($carrierCode, $rawStatus) {
            return CarrierStatusMapping::where('carrier_code', $carrierCode)
                ->where('carrier_raw_status', $rawStatus)
                ->where('is_active', true)
                ->first();
        });
    }

    /**
     * Get all mappings for a carrier
     */
    public function getCarrierMappings(string $carrierCode): \Illuminate\Database\Eloquent\Collection
    {
        return CarrierStatusMapping::where('carrier_code', $carrierCode)
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->get();
    }

    /**
     * Flush cache for a carrier
     */
    public function clearCache(?string $carrierCode = null): void
    {
        if ($carrierCode) {
            $mappings = CarrierStatusMapping::where('carrier_code', $carrierCode)->get();
            foreach ($mappings as $m) {
                Cache::forget("carrier_mapping:{$carrierCode}:{$m->carrier_raw_status}");
            }
        }
    }
}
