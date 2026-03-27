<?php

namespace App\Services\Shipping;

use App\Models\CarrierStatusMapping;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

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
    public function mapCarrierStatus(string $carrierCode, string $rawStatus, ?int $accountId = null): array
    {
        $mapping = $this->getMapping($carrierCode, $rawStatus, $accountId);

        if ($mapping) {
            if (!(bool) $mapping->is_active) {
                return [
                    'shipment_status' => null,
                    'order_status' => null,
                    'is_terminal' => false,
                    'blocked_by_disabled_mapping' => true,
                    'mapping_id' => (int) $mapping->id,
                ];
            }

            return [
                'shipment_status' => $mapping->internal_shipment_status,
                'order_status'    => $this->normalizeOptionalStatus($mapping->mapped_order_status),
                'is_terminal'     => (bool) $mapping->is_terminal,
                'blocked_by_disabled_mapping' => false,
                'mapping_id' => (int) $mapping->id,
            ];
        }

        // Fallback: try to match raw status to internal status directly
        $normalizedRaw = $this->normalizeStatusKey($rawStatus);
        if (array_key_exists($normalizedRaw, self::DEFAULT_SHIPMENT_TO_ORDER_MAP)) {
            return [
                'shipment_status' => $normalizedRaw,
                'order_status'    => self::DEFAULT_SHIPMENT_TO_ORDER_MAP[$normalizedRaw],
                'is_terminal'     => in_array($normalizedRaw, ['delivered', 'returned', 'canceled']),
                'blocked_by_disabled_mapping' => false,
                'mapping_id' => null,
            ];
        }

        // Unknown status - keep current, log warning
        return [
            'shipment_status' => null,
            'order_status'    => null,
            'is_terminal'     => false,
            'blocked_by_disabled_mapping' => false,
            'mapping_id' => null,
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
     * Resolve whether the current shipment status should update order status.
     *
     * If a carrier mapping exists, it becomes the source of truth:
     * - active mapping + mapped_order_status => sync order status
     * - active mapping + empty mapped_order_status => do not sync order status
     * - inactive mapping => do not sync order status
     * - no mapping configured => fall back to the legacy default table
     *
     * @return array{should_sync_order_status: bool, order_status: ?string, source: string, mapping_id: ?int}
     */
    public function resolveOrderStatusSync(
        ?string $carrierCode,
        string $shipmentStatus,
        ?int $accountId = null,
        ?string $rawStatus = null
    ): array {
        $defaultOrderStatus = $this->shipmentToOrderStatus($shipmentStatus);

        if (!$carrierCode) {
            return [
                'should_sync_order_status' => $defaultOrderStatus !== null,
                'order_status' => $defaultOrderStatus,
                'source' => $defaultOrderStatus !== null ? 'default' : 'none',
                'mapping_id' => null,
            ];
        }

        $mapping = null;
        if ($rawStatus !== null && $rawStatus !== '') {
            $exactMapping = $this->getMapping($carrierCode, $rawStatus, $accountId);
            if (
                $exactMapping
                && $this->normalizeStatusKey((string) $exactMapping->internal_shipment_status) === $this->normalizeStatusKey($shipmentStatus)
            ) {
                $mapping = $exactMapping;
            }
        }

        $mapping = $mapping ?: $this->getMappingForShipmentStatus($carrierCode, $shipmentStatus, $accountId);

        if ($mapping) {
            $mappedOrderStatus = $this->normalizeOptionalStatus($mapping->mapped_order_status);

            return [
                'should_sync_order_status' => (bool) $mapping->is_active && $mappedOrderStatus !== null,
                'order_status' => (bool) $mapping->is_active ? $mappedOrderStatus : null,
                'source' => !(bool) $mapping->is_active
                    ? 'mapping_disabled'
                    : ($mappedOrderStatus !== null ? 'mapping' : 'mapping_no_order_status'),
                'mapping_id' => (int) $mapping->id,
            ];
        }

        return [
            'should_sync_order_status' => $defaultOrderStatus !== null,
            'order_status' => $defaultOrderStatus,
            'source' => $defaultOrderStatus !== null ? 'default' : 'none',
            'mapping_id' => null,
        ];
    }

    /**
     * Get mapping from database (cached)
     */
    private function getMapping(string $carrierCode, string $rawStatus, ?int $accountId = null): ?CarrierStatusMapping
    {
        return $this->preferScopedMatches(
            $this->getCarrierMappingSet($carrierCode, $accountId)
                ->filter(fn (CarrierStatusMapping $mapping) => $this->normalizeLookupKey((string) $mapping->carrier_raw_status) === $this->normalizeLookupKey($rawStatus))
                ->values()
        )->first();
    }

    private function getMappingForShipmentStatus(string $carrierCode, string $shipmentStatus, ?int $accountId = null): ?CarrierStatusMapping
    {
        $matches = $this->preferScopedMatches(
            $this->getCarrierMappingSet($carrierCode, $accountId)
                ->filter(fn (CarrierStatusMapping $mapping) => $this->normalizeStatusKey((string) $mapping->internal_shipment_status) === $this->normalizeStatusKey($shipmentStatus))
                ->values()
        );

        if ($matches->isEmpty()) {
            return null;
        }

        return $matches->first(fn (CarrierStatusMapping $mapping) => (bool) $mapping->is_active)
            ?: $matches->first();
    }

    /**
     * Get all mappings for a carrier
     */
    public function getCarrierMappings(string $carrierCode, ?int $accountId = null): EloquentCollection
    {
        $mappings = $this->getCarrierMappingSet($carrierCode, $accountId)
            ->filter(fn (CarrierStatusMapping $mapping) => (bool) $mapping->is_active)
            ->values()
            ->all();

        return new EloquentCollection($mappings);
    }

    /**
     * Flush cache for a carrier
     */
    public function clearCache(?string $carrierCode = null): void
    {
        $carrierCodes = collect();

        if ($carrierCode) {
            $carrierCodes->push($carrierCode);
        } else {
            $carrierCodes = CarrierStatusMapping::query()
                ->distinct()
                ->pluck('carrier_code');
        }

        $carrierCodes
            ->filter()
            ->unique()
            ->each(function (string $code): void {
                Cache::forget($this->carrierCacheKey($code, null));

                CarrierStatusMapping::query()
                    ->where('carrier_code', $code)
                    ->whereNotNull('account_id')
                    ->distinct()
                    ->pluck('account_id')
                    ->each(fn ($accountId) => Cache::forget($this->carrierCacheKey($code, (int) $accountId)));
            });
    }

    /**
     * @return EloquentCollection<int, CarrierStatusMapping>
     */
    private function getCarrierMappingSet(string $carrierCode, ?int $accountId = null): EloquentCollection
    {
        return Cache::remember(
            $this->carrierCacheKey($carrierCode, $accountId),
            3600,
            function () use ($carrierCode, $accountId) {
                return CarrierStatusMapping::query()
                    ->where('carrier_code', $carrierCode)
                    ->when(
                        $accountId !== null,
                        function ($query) use ($accountId) {
                            $query->where(function ($scoped) use ($accountId) {
                                $scoped->where('account_id', $accountId)
                                    ->orWhereNull('account_id');
                            });
                        },
                        fn ($query) => $query->whereNull('account_id')
                    )
                    ->orderByRaw('CASE WHEN account_id IS NULL THEN 1 ELSE 0 END')
                    ->orderBy('sort_order')
                    ->orderBy('id')
                    ->get();
            }
        );
    }

    /**
     * @param Collection<int, CarrierStatusMapping> $matches
     * @return Collection<int, CarrierStatusMapping>
     */
    private function preferScopedMatches(Collection $matches): Collection
    {
        if ($matches->isEmpty()) {
            return $matches;
        }

        $scopedMatches = $matches->filter(fn (CarrierStatusMapping $mapping) => $mapping->account_id !== null)->values();

        return $scopedMatches->isNotEmpty()
            ? $scopedMatches
            : $matches->values();
    }

    private function carrierCacheKey(string $carrierCode, ?int $accountId = null): string
    {
        $scope = $accountId === null ? 'global' : (string) $accountId;

        return "carrier_mappings:{$scope}:{$carrierCode}";
    }

    private function normalizeStatusKey(string $value): string
    {
        return str_replace([' ', '-'], '_', $this->normalizeLookupKey($value));
    }

    private function normalizeLookupKey(string $value): string
    {
        return (string) Str::of($value)->trim()->lower();
    }

    private function normalizeOptionalStatus(mixed $value): ?string
    {
        $normalized = trim((string) ($value ?? ''));

        return $normalized === '' ? null : $normalized;
    }
}
