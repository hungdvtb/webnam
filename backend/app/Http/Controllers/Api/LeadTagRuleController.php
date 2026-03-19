<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LeadTagRule;
use Illuminate\Http\Request;

class LeadTagRuleController extends Controller
{
    public function index(Request $request)
    {
        return response()->json(
            LeadTagRule::query()
                ->orderByDesc('priority')
                ->orderBy('id')
                ->get()
        );
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'tag' => 'required|string|max:120',
            'match_type' => 'required|string|max:40',
            'pattern' => 'required|string|max:255',
            'priority' => 'nullable|integer',
            'notes' => 'nullable|string',
            'is_active' => 'nullable|boolean',
        ]);

        $rule = LeadTagRule::create([
            'tag' => $validated['tag'],
            'match_type' => $validated['match_type'],
            'pattern' => $validated['pattern'],
            'priority' => $validated['priority'] ?? 0,
            'notes' => $validated['notes'] ?? null,
            'is_active' => (bool) ($validated['is_active'] ?? true),
        ]);

        return response()->json($rule, 201);
    }

    public function update(Request $request, int $id)
    {
        $rule = LeadTagRule::query()->findOrFail($id);
        $validated = $request->validate([
            'tag' => 'required|string|max:120',
            'match_type' => 'required|string|max:40',
            'pattern' => 'required|string|max:255',
            'priority' => 'nullable|integer',
            'notes' => 'nullable|string',
            'is_active' => 'nullable|boolean',
        ]);

        $rule->update([
            'tag' => $validated['tag'],
            'match_type' => $validated['match_type'],
            'pattern' => $validated['pattern'],
            'priority' => $validated['priority'] ?? $rule->priority,
            'notes' => $validated['notes'] ?? null,
            'is_active' => (bool) ($validated['is_active'] ?? $rule->is_active),
        ]);

        return response()->json($rule);
    }

    public function destroy(int $id)
    {
        LeadTagRule::query()->findOrFail($id)->delete();
        return response()->json(['message' => 'Deleted']);
    }
}
