<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Carrier;
use App\Models\CarrierRawStatus;
use App\Models\CarrierStatusMapping;
use App\Services\Shipping\CarrierStatusMapper;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class CarrierStatusMappingController extends Controller
{
    public function __construct(private CarrierStatusMapper $carrierStatusMapper)
    {
    }

    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        $requestedCarrierCode = $this->carrierStatusMapper->canonicalizeCarrierCode((string) $request->input('carrier_code'));
        $query = CarrierStatusMapping::query()
            ->where(function ($scoped) use ($accountId) {
                $scoped->where('account_id', $accountId)
                    ->orWhereNull('account_id');
            })
            ->orderBy('carrier_code')
            ->orderByRaw('CASE WHEN account_id IS NULL THEN 1 ELSE 0 END')
            ->orderBy('sort_order');

        if ($requestedCarrierCode) {
            $query->whereIn('carrier_code', $this->carrierStatusMapper->equivalentCarrierCodes($requestedCarrierCode));
        }

        $mappings = $query->get()->map(function (CarrierStatusMapping $mapping) {
            $mapping->carrier_code = $this->carrierStatusMapper->canonicalizeCarrierCode($mapping->carrier_code) ?? $mapping->carrier_code;

            return $mapping;
        });

        $orderStatuses = \App\Models\OrderStatus::query()
            ->when($accountId, fn ($q) => $q->where('account_id', $accountId))
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->get(['id', 'code', 'name', 'color', 'sort_order', 'is_system']);

        $discoveredStatuses = \App\Models\CarrierRawStatus::query()
            ->where(function ($scoped) use ($accountId) {
                $scoped->where('account_id', $accountId)
                    ->orWhereNull('account_id');
            })
            ->where('is_mapped', false)
            ->orderBy('last_seen_at', 'desc')
            ->get()
            ->map(function (\App\Models\CarrierRawStatus $status) {
                $status->carrier_code = $this->carrierStatusMapper->canonicalizeCarrierCode($status->carrier_code) ?? $status->carrier_code;

                return $status;
            });

        $mappingCounts = $mappings->groupBy('carrier_code')->map->count();
        $unmappedCounts = $discoveredStatuses->groupBy('carrier_code')->map->count();
        $carriers = Carrier::orderBy('sort_order')->orderBy('name')->get()->map(function ($carrier) use ($mappingCounts, $unmappedCounts) {
            $carrier->mappings_count = (int) ($mappingCounts[$carrier->code] ?? 0);
            $carrier->unmapped_count = (int) ($unmappedCounts[$carrier->code] ?? 0);
            return $carrier;
        });

        return response()->json([
            'mappings' => $mappings,
            'carriers' => $carriers,
            'order_statuses' => $orderStatuses,
            'discovered_statuses' => $discoveredStatuses,
        ]);
    }

    public function updateCarrier(Request $request, $code)
    {
        $carrier = Carrier::where('code', $code)->firstOrFail();

        $request->validate([
            'name' => 'sometimes|string|max:255',
            'color' => 'sometimes|string|max:20',
            'is_active' => 'sometimes|boolean',
            'is_visible' => 'sometimes|boolean',
            'sort_order' => 'sometimes|integer',
        ]);

        $carrier->update($request->only(['name', 'color', 'is_active', 'is_visible', 'sort_order']));

        return response()->json($carrier);
    }

    public function store(Request $request)
    {
        $request->validate([
            'carrier_code' => 'required|string|max:50',
            'carrier_raw_status' => 'required|string',
            'internal_shipment_status' => 'nullable|string|max:50',
            'mapped_order_status' => 'nullable|string|max:50',
            'is_terminal' => 'boolean',
            'sort_order' => 'integer',
            'description' => 'nullable|string',
        ]);

        $accountId = $request->header('X-Account-Id');
        $carrierCode = $this->carrierStatusMapper->canonicalizeCarrierCode((string) $request->input('carrier_code'));
        $internalShipmentStatus = $this->carrierStatusMapper->inferInternalShipmentStatus(
            $carrierCode,
            $request->input('carrier_raw_status'),
            $request->input('internal_shipment_status'),
            $accountId ? (int) $accountId : null
        );
        $mappedOrderStatus = $this->carrierStatusMapper->resolveOrderStatusIdentifier(
            $request->input('mapped_order_status'),
            $accountId ? (int) $accountId : null
        );

        $exists = CarrierStatusMapping::whereIn('carrier_code', $this->carrierStatusMapper->equivalentCarrierCodes($carrierCode))
            ->where('carrier_raw_status', $request->carrier_raw_status)
            ->where(function ($scoped) use ($request) {
                $scoped->where('account_id', $request->header('X-Account-Id'))
                    ->orWhereNull('account_id');
            })
            ->exists();

        if ($exists) {
            return response()->json(['message' => 'Mapping nay da ton tai cho hang VC nay.'], 422);
        }

        $mapping = CarrierStatusMapping::create(array_merge($request->only([
            'carrier_raw_status',
            'internal_shipment_status',
            'is_terminal',
            'sort_order',
            'is_active',
            'description',
        ]), [
            'account_id' => $accountId,
            'carrier_code' => $carrierCode,
            'internal_shipment_status' => $internalShipmentStatus,
            'mapped_order_status' => $mappedOrderStatus,
        ]));

        \App\Models\CarrierRawStatus::whereIn('carrier_code', $this->carrierStatusMapper->equivalentCarrierCodes($carrierCode))
            ->where('raw_status', $request->carrier_raw_status)
            ->where(function ($scoped) use ($request) {
                $scoped->where('account_id', $request->header('X-Account-Id'))
                    ->orWhereNull('account_id');
            })
            ->update(['is_mapped' => true, 'mapping_id' => $mapping->id]);

        $this->carrierStatusMapper->clearCache($mapping->carrier_code);

        return response()->json($mapping, 201);
    }

    public function update(Request $request, $id)
    {
        $mapping = CarrierStatusMapping::findOrFail($id);
        $accountId = $request->header('X-Account-Id');

        $request->validate([
            'carrier_raw_status' => 'sometimes|string',
            'internal_shipment_status' => 'nullable|string|max:50',
            'mapped_order_status' => 'nullable|string|max:50',
            'is_terminal' => 'boolean',
            'sort_order' => 'integer',
            'is_active' => 'boolean',
            'description' => 'nullable|string',
        ]);

        $updateData = $request->only([
            'carrier_raw_status',
            'is_terminal',
            'sort_order',
            'is_active',
            'description',
        ]);

        if ($request->exists('internal_shipment_status') || $request->exists('carrier_raw_status')) {
            $updateData['internal_shipment_status'] = $this->carrierStatusMapper->inferInternalShipmentStatus(
                $mapping->carrier_code,
                $request->input('carrier_raw_status', $mapping->carrier_raw_status),
                $request->input('internal_shipment_status', $mapping->internal_shipment_status),
                $accountId ? (int) $accountId : null
            );
        }

        if ($request->exists('mapped_order_status')) {
            $updateData['mapped_order_status'] = $this->carrierStatusMapper->resolveOrderStatusIdentifier(
                $request->input('mapped_order_status'),
                $accountId ? (int) $accountId : null
            );
        }

        $mapping->update($updateData);

        $this->carrierStatusMapper->clearCache($mapping->carrier_code);

        return response()->json($mapping);
    }

    public function destroy(Request $request, $id)
    {
        $mapping = $this->scopedMappingQuery($request->header('X-Account-Id'))->findOrFail($id);
        $this->deleteMappings(collect([$mapping]));

        return response()->json(['message' => 'Da xoa mapping']);
    }

    public function bulkDestroy(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
            'carrier_code' => 'nullable|string|max:50',
        ]);

        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values();

        $carrierCode = $this->carrierStatusMapper->canonicalizeCarrierCode((string) ($validated['carrier_code'] ?? ''));
        $query = $this->scopedMappingQuery($request->header('X-Account-Id'))
            ->whereIn('id', $ids->all());

        if ($carrierCode !== null) {
            $query->whereIn('carrier_code', $this->carrierStatusMapper->equivalentCarrierCodes($carrierCode));
        }

        $mappings = $query->get();
        $invalidIds = array_values(array_diff(
            $ids->all(),
            $mappings->pluck('id')->map(fn ($id) => (int) $id)->all()
        ));

        if (!empty($invalidIds)) {
            return response()->json([
                'message' => 'Mot so mapping khong hop le hoac khong thuoc hang dang chon.',
                'invalid_ids' => $invalidIds,
            ], 422);
        }

        $deletedCount = $this->deleteMappings($mappings);

        return response()->json([
            'message' => 'Da xoa cac mapping da chon',
            'deleted_count' => $deletedCount,
        ]);
    }

    public function updateCarriersSort(Request $request)
    {
        $request->validate([
            'order' => 'required|array',
            'order.*' => 'string',
        ]);

        foreach ($request->order as $index => $code) {
            Carrier::where('code', $code)->update(['sort_order' => $index]);
        }

        return response()->json(['message' => 'Da cap nhat thu tu']);
    }

    public function toggleCarrierVisibility(Request $request, $code)
    {
        $carrier = Carrier::where('code', $code)->firstOrFail();
        $carrier->update(['is_visible' => !$carrier->is_visible]);
        return response()->json($carrier);
    }

    private function scopedMappingQuery(?string $accountId)
    {
        return CarrierStatusMapping::query()
            ->where(function ($scoped) use ($accountId) {
                if (filled($accountId)) {
                    $scoped->where('account_id', $accountId)
                        ->orWhereNull('account_id');

                    return;
                }

                $scoped->whereNull('account_id');
            });
    }

    private function deleteMappings(Collection $mappings): int
    {
        if ($mappings->isEmpty()) {
            return 0;
        }

        $deletedCount = 0;
        $mappingIds = $mappings->pluck('id')->map(fn ($id) => (int) $id)->all();

        DB::transaction(function () use ($mappings, $mappingIds, &$deletedCount) {
            $mappings
                ->groupBy(function (CarrierStatusMapping $mapping) {
                    $carrierCode = $this->carrierStatusMapper->canonicalizeCarrierCode($mapping->carrier_code) ?? $mapping->carrier_code;

                    return sprintf('%s|%s', $mapping->account_id ?? 'global', $carrierCode);
                })
                ->each(function (Collection $group) {
                    $mapping = $group->first();

                    if (!$mapping instanceof CarrierStatusMapping) {
                        return;
                    }

                    $rawStatuses = $group->pluck('carrier_raw_status')
                        ->filter(fn ($status) => filled($status))
                        ->unique()
                        ->values()
                        ->all();

                    $this->releaseRawStatuses(
                        $mapping->account_id !== null ? (int) $mapping->account_id : null,
                        $mapping->carrier_code,
                        $rawStatuses
                    );
                });

            $deletedCount = CarrierStatusMapping::query()
                ->whereIn('id', $mappingIds)
                ->delete();
        });

        $mappings->pluck('carrier_code')
            ->map(fn ($carrierCode) => $this->carrierStatusMapper->canonicalizeCarrierCode($carrierCode) ?? $carrierCode)
            ->filter()
            ->unique()
            ->each(fn ($carrierCode) => $this->carrierStatusMapper->clearCache((string) $carrierCode));

        return $deletedCount;
    }

    private function releaseRawStatuses(?int $accountId, ?string $carrierCode, array $rawStatuses): void
    {
        $equivalentCarrierCodes = $this->carrierStatusMapper->equivalentCarrierCodes($carrierCode);

        if (empty($equivalentCarrierCodes) || empty($rawStatuses)) {
            return;
        }

        CarrierRawStatus::query()
            ->whereIn('carrier_code', $equivalentCarrierCodes)
            ->whereIn('raw_status', $rawStatuses)
            ->where(function ($scoped) use ($accountId) {
                if ($accountId !== null) {
                    $scoped->where('account_id', $accountId)
                        ->orWhereNull('account_id');

                    return;
                }

                $scoped->whereNull('account_id');
            })
            ->update([
                'is_mapped' => false,
                'mapping_id' => null,
            ]);
    }
}
