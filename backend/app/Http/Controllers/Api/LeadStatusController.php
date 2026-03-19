<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LeadStatus;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class LeadStatusController extends Controller
{
    public function index(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $statuses = LeadStatus::ensureDefaultsForAccount($accountId);

        return response()->json($statuses->map(fn ($status) => [
            'id' => $status->id,
            'code' => $status->code,
            'name' => $status->name,
            'color' => $status->color,
            'sort_order' => $status->sort_order,
            'is_default' => (bool) $status->is_default,
            'blocks_order_create' => (bool) $status->blocks_order_create,
            'is_active' => (bool) $status->is_active,
        ])->values());
    }

    public function store(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');
        LeadStatus::ensureDefaultsForAccount($accountId);

        $validated = $request->validate([
            'name' => 'required|string|max:120',
            'code' => 'nullable|string|max:80',
            'color' => 'nullable|string|max:20',
            'sort_order' => 'nullable|integer',
            'is_default' => 'nullable|boolean',
            'blocks_order_create' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
        ]);

        $code = Str::slug($validated['code'] ?: $validated['name']);

        $status = LeadStatus::create([
            'account_id' => $accountId,
            'name' => $validated['name'],
            'code' => $code,
            'color' => $validated['color'] ?? '#475569',
            'sort_order' => $validated['sort_order'] ?? (LeadStatus::query()->max('sort_order') + 1),
            'is_default' => (bool) ($validated['is_default'] ?? false),
            'blocks_order_create' => (bool) ($validated['blocks_order_create'] ?? false),
            'is_active' => (bool) ($validated['is_active'] ?? true),
        ]);

        if ($status->is_default) {
            LeadStatus::query()->where('id', '!=', $status->id)->update(['is_default' => false]);
        }

        return response()->json($status, 201);
    }

    public function update(Request $request, int $id)
    {
        $status = LeadStatus::query()->findOrFail($id);
        $validated = $request->validate([
            'name' => 'required|string|max:120',
            'code' => 'nullable|string|max:80',
            'color' => 'nullable|string|max:20',
            'sort_order' => 'nullable|integer',
            'is_default' => 'nullable|boolean',
            'blocks_order_create' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
        ]);

        $status->update([
            'name' => $validated['name'],
            'code' => Str::slug($validated['code'] ?: $validated['name']),
            'color' => $validated['color'] ?? $status->color,
            'sort_order' => $validated['sort_order'] ?? $status->sort_order,
            'is_default' => (bool) ($validated['is_default'] ?? $status->is_default),
            'blocks_order_create' => (bool) ($validated['blocks_order_create'] ?? $status->blocks_order_create),
            'is_active' => (bool) ($validated['is_active'] ?? $status->is_active),
        ]);

        if ($status->is_default) {
            LeadStatus::query()->where('id', '!=', $status->id)->update(['is_default' => false]);
        }

        return response()->json($status);
    }

    public function reorder(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer|exists:lead_statuses,id',
        ]);

        foreach ($validated['ids'] as $index => $id) {
            LeadStatus::query()->where('id', $id)->update(['sort_order' => $index + 1]);
        }

        return response()->json(['message' => 'Reordered']);
    }

    public function destroy(Request $request, int $id)
    {
        $status = LeadStatus::query()->withCount('leads')->findOrFail($id);
        if ($status->leads_count > 0) {
            return response()->json(['message' => 'Không th? xóa tr?ng thái dang du?c lead s? d?ng.'], 422);
        }

        $status->delete();

        if (!LeadStatus::query()->where('is_default', true)->exists()) {
            $first = LeadStatus::query()->orderBy('sort_order')->first();
            if ($first) {
                $first->update(['is_default' => true]);
            }
        }

        return response()->json(['message' => 'Deleted']);
    }
}
