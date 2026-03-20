<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Carrier;
use App\Models\CarrierStatusMapping;
use Illuminate\Http\Request;

class CarrierStatusMappingController extends Controller
{
    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        $query = CarrierStatusMapping::query()
            ->where(function ($scoped) use ($accountId) {
                $scoped->where('account_id', $accountId)
                    ->orWhereNull('account_id');
            })
            ->orderBy('carrier_code')
            ->orderByRaw('CASE WHEN account_id IS NULL THEN 1 ELSE 0 END')
            ->orderBy('sort_order');

        if ($request->carrier_code) {
            $query->where('carrier_code', $request->carrier_code);
        }

        $mappings = $query->get();

        // Dynamic order statuses from database
        $orderStatuses = \App\Models\OrderStatus::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->get(['id', 'code', 'name', 'color', 'sort_order', 'is_system']);

        // Preparation for unknown statuses discovery (for specific carrier if requested or all)
        $discoveredStatuses = \App\Models\CarrierRawStatus::query()
            ->where(function ($scoped) use ($accountId) {
                $scoped->where('account_id', $accountId)
                    ->orWhereNull('account_id');
            })
            ->where('is_mapped', false)
            ->orderBy('last_seen_at', 'desc')
            ->get();

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
            'carrier_code'             => 'required|string|max:50',
            'carrier_raw_status'       => 'required|string',
            'internal_shipment_status' => 'required|string|max:50',
            'mapped_order_status'      => 'nullable|string|max:50',
            'is_terminal'              => 'boolean',
            'sort_order'               => 'integer',
            'description'              => 'nullable|string',
        ]);

        $exists = CarrierStatusMapping::where('carrier_code', $request->carrier_code)
            ->where('carrier_raw_status', $request->carrier_raw_status)
            ->where(function ($scoped) use ($request) {
                $scoped->where('account_id', $request->header('X-Account-Id'))
                    ->orWhereNull('account_id');
            })
            ->exists();

        if ($exists) {
            return response()->json(['message' => 'Mapping này đã tồn tại cho hãng VC này.'], 422);
        }

        $mapping = CarrierStatusMapping::create(array_merge($request->only([
            'carrier_code', 'carrier_raw_status', 'internal_shipment_status',
            'mapped_order_status', 'is_terminal', 'sort_order', 'is_active', 'description',
        ]), [
            'account_id' => $request->header('X-Account-Id'),
        ]));

        // If this was a discovered status, mark it as mapped
        \App\Models\CarrierRawStatus::where('carrier_code', $request->carrier_code)
            ->where('raw_status', $request->carrier_raw_status)
            ->where(function ($scoped) use ($request) {
                $scoped->where('account_id', $request->header('X-Account-Id'))
                    ->orWhereNull('account_id');
            })
            ->update(['is_mapped' => true, 'mapping_id' => $mapping->id]);

        return response()->json($mapping, 201);
    }

    public function update(Request $request, $id)
    {
        $mapping = CarrierStatusMapping::findOrFail($id);

        $request->validate([
            'carrier_raw_status'       => 'sometimes|string',
            'internal_shipment_status' => 'sometimes|string|max:50',
            'mapped_order_status'      => 'nullable|string|max:50',
            'is_terminal'              => 'boolean',
            'sort_order'               => 'integer',
            'is_active'                => 'boolean',
            'description'              => 'nullable|string',
        ]);

        $mapping->update($request->only([
            'carrier_raw_status', 'internal_shipment_status',
            'mapped_order_status', 'is_terminal', 'sort_order', 'is_active', 'description',
        ]));

        return response()->json($mapping);
    }

    public function destroy($id)
    {
        CarrierStatusMapping::findOrFail($id)->delete();
        return response()->json(['message' => 'Đã xóa mapping']);
    }

    public function updateCarriersSort(Request $request)
    {
        $request->validate([
            'order' => 'required|array',
            'order.*' => 'string', // carrier codes
        ]);

        foreach ($request->order as $index => $code) {
            Carrier::where('code', $code)->update(['sort_order' => $index]);
        }

        return response()->json(['message' => 'Đã cập nhật thứ tự']);
    }

    public function toggleCarrierVisibility(Request $request, $code)
    {
        $carrier = Carrier::where('code', $code)->firstOrFail();
        $carrier->update(['is_visible' => !$carrier->is_visible]);
        return response()->json($carrier);
    }
}
