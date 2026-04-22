<?php

namespace App\Services\Shipping;

use App\Models\Account;
use App\Models\CarrierStatusMapping;
use App\Models\OrderStatus;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * CarrierStatusMapper
 *
 * Maps raw carrier statuses to internal shipment statuses
 * and corresponding order statuses.
 */
class CarrierStatusMapper
{
    private const CARRIER_CODE_ALIASES = [
        'viettel_post' => ['viettel_post', 'viettelpost'],
        'viettelpost' => ['viettel_post', 'viettelpost'],
    ];

    private const RAW_STATUS_FALLBACK_MAP = [
        'viettel_post' => [
            'giao thành công' => 'delivered',
            'đang vận chuyển' => 'in_transit',
            'đang giao hàng' => 'out_for_delivery',
            'chờ phát lại' => 'out_for_delivery',
            'đã lấy hàng' => 'picked_up',
            'chờ xử lý' => 'waiting_pickup',
            'chuyển hoàn' => 'returning',
            'đã hoàn thành' => 'returned',
            'đã hoàn' => 'returned',
            'hoàn thành công' => 'returned',
            'đã trả' => 'returned',
        ],
    ];

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
            $resolvedShipmentStatus = $this->resolveMappedShipmentStatus($carrierCode, $rawStatus, $mapping, $accountId);

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
                'shipment_status' => $resolvedShipmentStatus,
                'order_status'    => $this->normalizeOptionalStatus($mapping->mapped_order_status, $accountId),
                'is_terminal'     => (bool) $mapping->is_terminal,
                'blocked_by_disabled_mapping' => false,
                'mapping_id' => (int) $mapping->id,
            ];
        }

        // Fallback: try to match raw status to internal status directly
        $fallbackShipmentStatus = $this->resolveFallbackShipmentStatus($carrierCode, $rawStatus);
        if ($fallbackShipmentStatus !== null) {
            return [
                'shipment_status' => $fallbackShipmentStatus,
                'order_status' => $this->shipmentToOrderStatus($fallbackShipmentStatus),
                'is_terminal' => in_array($fallbackShipmentStatus, ['delivered', 'returned', 'canceled'], true),
                'blocked_by_disabled_mapping' => false,
                'mapping_id' => null,
            ];
        }

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

    public function canonicalizeCarrierCode(?string $carrierCode): ?string
    {
        $normalized = $this->trimOptionalValue($carrierCode);

        if ($normalized === null) {
            return null;
        }

        $lookupKey = $this->normalizeLookupKey($normalized);

        return self::CARRIER_CODE_ALIASES[$lookupKey][0] ?? $lookupKey;
    }

    /**
     * @return array<int, string>
     */
    public function equivalentCarrierCodes(?string $carrierCode): array
    {
        $canonical = $this->canonicalizeCarrierCode($carrierCode);

        if ($canonical === null) {
            return [];
        }

        return self::CARRIER_CODE_ALIASES[$canonical] ?? [$canonical];
    }

    public function resolveOrderStatusIdentifier(mixed $value, ?int $accountId = null): ?string
    {
        $normalized = $this->trimOptionalValue($value);

        if ($normalized === null || !Schema::hasTable('order_statuses')) {
            return $normalized;
        }

        $lookupKey = $this->normalizeLookupKey($normalized);
        $match = OrderStatus::query()
            ->when($accountId !== null, fn ($query) => $query->where('account_id', $accountId))
            ->get(['code', 'name'])
            ->first(function (OrderStatus $status) use ($lookupKey) {
                return $this->normalizeLookupKey((string) $status->code) === $lookupKey
                    || $this->normalizeLookupKey((string) $status->name) === $lookupKey;
            });

        return $match?->code ?? $normalized;
    }

    /**
     * Map internal shipment_status to order_status
     */
    public function shipmentToOrderStatus(string $shipmentStatus): ?string
    {
        return self::DEFAULT_SHIPMENT_TO_ORDER_MAP[$shipmentStatus] ?? null;
    }

    public function inferInternalShipmentStatus(
        ?string $carrierCode,
        ?string $rawStatus,
        ?string $explicitShipmentStatus = null,
        ?int $accountId = null
    ): ?string {
        $explicit = $this->trimOptionalValue($explicitShipmentStatus);
        if ($explicit !== null) {
            return $explicit;
        }

        $normalizedCarrierCode = $this->canonicalizeCarrierCode($carrierCode);
        $normalizedRawStatus = $this->trimOptionalValue($rawStatus);
        if ($normalizedCarrierCode === null || $normalizedRawStatus === null) {
            return null;
        }

        $matchedMapping = $this->getCarrierMappingSet($normalizedCarrierCode, $accountId)
            ->first(function (CarrierStatusMapping $mapping) use ($normalizedRawStatus) {
                return $this->normalizeLookupKey((string) $mapping->carrier_raw_status) === $this->normalizeLookupKey($normalizedRawStatus)
                    && $this->trimOptionalValue($mapping->internal_shipment_status) !== null;
            });

        if ($matchedMapping) {
            return $this->trimOptionalValue($matchedMapping->internal_shipment_status);
        }

        $fallbackShipmentStatus = $this->resolveFallbackShipmentStatus($normalizedCarrierCode, $normalizedRawStatus);
        if ($fallbackShipmentStatus !== null) {
            return $fallbackShipmentStatus;
        }

        $normalizedStatusKey = $this->normalizeStatusKey($normalizedRawStatus);

        return array_key_exists($normalizedStatusKey, self::DEFAULT_SHIPMENT_TO_ORDER_MAP)
            ? $normalizedStatusKey
            : null;
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
            $mappedOrderStatus = $this->normalizeOptionalStatus($mapping->mapped_order_status, $accountId);

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

    private function resolveMappedShipmentStatus(
        string $carrierCode,
        string $rawStatus,
        CarrierStatusMapping $mapping,
        ?int $accountId = null
    ): ?string {
        return $this->inferInternalShipmentStatus(
            $carrierCode,
            $rawStatus,
            $mapping->internal_shipment_status,
            $accountId
        );
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
            $carrierCodes = collect($this->equivalentCarrierCodes($carrierCode));
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

                $accountIds = CarrierStatusMapping::query()
                    ->whereIn('carrier_code', $this->equivalentCarrierCodes($code))
                    ->whereNotNull('account_id')
                    ->distinct()
                    ->pluck('account_id');

                if (Schema::hasTable('accounts')) {
                    $accountIds = $accountIds->merge(Account::query()->pluck('id'));
                }

                $accountIds
                    ->filter()
                    ->unique()
                    ->each(fn ($accountId) => Cache::forget($this->carrierCacheKey($code, (int) $accountId)));
            });
    }

    /**
     * @return EloquentCollection<int, CarrierStatusMapping>
     */
    private function getCarrierMappingSet(string $carrierCode, ?int $accountId = null): EloquentCollection
    {
        $carrierCodes = $this->equivalentCarrierCodes($carrierCode);

        return Cache::remember(
            $this->carrierCacheKey($carrierCode, $accountId),
            3600,
            function () use ($carrierCodes, $accountId) {
                return CarrierStatusMapping::query()
                    ->whereIn('carrier_code', $carrierCodes)
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
        $carrierCode = $this->canonicalizeCarrierCode($carrierCode) ?? $carrierCode;

        return "carrier_mappings:{$scope}:{$carrierCode}";
    }

    private function normalizeStatusKey(string $value): string
    {
        return str_replace([' ', '-'], '_', $this->normalizeLookupKey($value));
    }

    private function normalizeLookupKey(string $value): string
    {
        $normalized = preg_replace('/\s+/u', ' ', str_replace("\u{00A0}", ' ', trim($value))) ?? '';

        return Str::lower(Str::ascii($normalized));
    }

    private function normalizeOptionalStatus(mixed $value, ?int $accountId = null): ?string
    {
        $normalized = $this->trimOptionalValue($value);

        return $normalized === null
            ? null
            : $this->resolveOrderStatusIdentifier($normalized, $accountId);
    }

    private function trimOptionalValue(mixed $value): ?string
    {
        $normalized = trim((string) ($value ?? ''));

        return $normalized === '' ? null : $normalized;
    }

    private function resolveFallbackShipmentStatus(string $carrierCode, string $rawStatus): ?string
    {
        $canonicalCarrierCode = $this->canonicalizeCarrierCode($carrierCode);
        $fallbacks = self::RAW_STATUS_FALLBACK_MAP[$canonicalCarrierCode] ?? null;

        if (!$fallbacks) {
            return null;
        }

        $normalizedRawStatus = $this->normalizeLookupKey($rawStatus);

        foreach ($fallbacks as $rawPattern => $shipmentStatus) {
            if (str_contains($normalizedRawStatus, $this->normalizeLookupKey($rawPattern))) {
                return $shipmentStatus;
            }
        }

        return null;
    }
}
