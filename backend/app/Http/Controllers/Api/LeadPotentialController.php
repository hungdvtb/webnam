<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Lead;
use App\Models\LeadNote;
use App\Models\LeadPotential;
use Illuminate\Http\Request;

class LeadPotentialController extends Controller
{
    public function index(Request $request)
    {
        $accountId = $this->accountId($request);
        $potentials = LeadPotential::ensureDefaultsForAccount($accountId);

        return response()->json($potentials->map(fn (LeadPotential $potential) => $this->transformPotential($potential))->values());
    }

    public function store(Request $request)
    {
        $accountId = $this->accountId($request);
        LeadPotential::ensureDefaultsForAccount($accountId);

        $validated = $request->validate([
            'name' => 'required|string|max:120',
            'code' => 'nullable|string|max:80',
            'color' => 'nullable|string|max:20',
            'sort_order' => 'nullable|integer',
            'is_default' => 'nullable|boolean',
            'counts_as_potential' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
        ]);

        $codeSource = trim((string) ($validated['code'] ?? '')) ?: $validated['name'];

        $potential = LeadPotential::withoutGlobalScopes()->create([
            'account_id' => $accountId,
            'name' => $validated['name'],
            'code' => LeadPotential::uniqueCodeForAccount($accountId, $codeSource),
            'color' => $validated['color'] ?? '#16a34a',
            'sort_order' => $validated['sort_order'] ?? ((int) LeadPotential::withoutGlobalScopes()->where('account_id', $accountId)->max('sort_order') + 1),
            'is_default' => (bool) ($validated['is_default'] ?? false),
            'counts_as_potential' => (bool) ($validated['counts_as_potential'] ?? true),
            'is_active' => (bool) ($validated['is_active'] ?? true),
        ]);

        if ($potential->is_default) {
            $this->clearOtherDefaults($accountId, $potential->id);
        }

        return response()->json($this->transformPotential($potential), 201);
    }

    public function update(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $potential = LeadPotential::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->findOrFail($id);

        $validated = $request->validate([
            'name' => 'required|string|max:120',
            'color' => 'nullable|string|max:20',
            'sort_order' => 'nullable|integer',
            'is_default' => 'nullable|boolean',
            'counts_as_potential' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
        ]);

        $potential->update([
            'name' => $validated['name'],
            'color' => $validated['color'] ?? $potential->color,
            'sort_order' => $validated['sort_order'] ?? $potential->sort_order,
            'is_default' => (bool) ($validated['is_default'] ?? $potential->is_default),
            'counts_as_potential' => (bool) ($validated['counts_as_potential'] ?? $potential->counts_as_potential),
            'is_active' => (bool) ($validated['is_active'] ?? $potential->is_active),
        ]);

        if ($potential->is_default) {
            $this->clearOtherDefaults($accountId, $potential->id);
        }

        return response()->json($this->transformPotential($potential));
    }

    public function destroy(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $potential = LeadPotential::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->findOrFail($id);

        $leadCount = Lead::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->where('potential_level', $potential->code)
            ->count();
        $noteCount = LeadNote::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->where('potential_level', $potential->code)
            ->count();

        if ($leadCount > 0 || $noteCount > 0) {
            return response()->json(['message' => 'Không thể xóa mức tiềm năng đang được khách hoặc lịch sử ghi chú sử dụng.'], 422);
        }

        $wasDefault = $potential->is_default;
        $potential->delete();

        if ($wasDefault && !LeadPotential::withoutGlobalScopes()->where('account_id', $accountId)->where('is_default', true)->exists()) {
            $first = LeadPotential::withoutGlobalScopes()
                ->where('account_id', $accountId)
                ->where('is_active', true)
                ->orderBy('sort_order')
                ->first();
            if ($first) {
                $first->update(['is_default' => true]);
            }
        }

        return response()->json(['message' => 'Deleted']);
    }

    private function clearOtherDefaults(int $accountId, int $currentPotentialId): void
    {
        LeadPotential::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->where('id', '!=', $currentPotentialId)
            ->update(['is_default' => false]);
    }

    private function accountId(Request $request): int
    {
        return (int) $request->header('X-Account-Id');
    }

    private function transformPotential(LeadPotential $potential): array
    {
        return [
            'id' => $potential->id,
            'code' => $potential->code,
            'value' => $potential->code,
            'name' => $potential->name,
            'label' => $potential->name,
            'color' => $potential->color,
            'sort_order' => $potential->sort_order,
            'is_default' => (bool) $potential->is_default,
            'counts_as_potential' => (bool) $potential->counts_as_potential,
            'is_active' => (bool) $potential->is_active,
        ];
    }
}
