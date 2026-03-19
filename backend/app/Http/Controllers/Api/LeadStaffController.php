<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LeadStaff;
use Illuminate\Http\Request;

class LeadStaffController extends Controller
{
    public function index(Request $request)
    {
        return response()->json(
            LeadStaff::query()
                ->orderBy('sort_order')
                ->orderBy('id')
                ->get()
        );
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:120',
            'user_id' => 'nullable|integer|exists:users,id',
            'sort_order' => 'nullable|integer',
            'is_active' => 'nullable|boolean',
        ]);

        $staff = LeadStaff::create([
            'name' => $validated['name'],
            'user_id' => $validated['user_id'] ?? null,
            'sort_order' => $validated['sort_order'] ?? (LeadStaff::query()->max('sort_order') + 1),
            'is_active' => (bool) ($validated['is_active'] ?? true),
        ]);

        return response()->json($staff, 201);
    }

    public function update(Request $request, int $id)
    {
        $staff = LeadStaff::query()->findOrFail($id);
        $validated = $request->validate([
            'name' => 'required|string|max:120',
            'user_id' => 'nullable|integer|exists:users,id',
            'sort_order' => 'nullable|integer',
            'is_active' => 'nullable|boolean',
        ]);

        $staff->update([
            'name' => $validated['name'],
            'user_id' => $validated['user_id'] ?? null,
            'sort_order' => $validated['sort_order'] ?? $staff->sort_order,
            'is_active' => (bool) ($validated['is_active'] ?? $staff->is_active),
        ]);

        return response()->json($staff);
    }

    public function reorder(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer|exists:lead_staffs,id',
        ]);

        foreach ($validated['ids'] as $index => $id) {
            LeadStaff::query()->where('id', $id)->update(['sort_order' => $index + 1]);
        }

        return response()->json(['message' => 'Reordered']);
    }

    public function destroy(int $id)
    {
        LeadStaff::query()->findOrFail($id)->delete();
        return response()->json(['message' => 'Deleted']);
    }
}
