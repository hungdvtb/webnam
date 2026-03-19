<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\QuoteTemplate;
use Illuminate\Http\Request;

class QuoteTemplateController extends Controller
{
    public function index(Request $request)
    {
        $accountId = $this->getAccountId($request);
        if (!$accountId) {
            return response()->json([]);
        }

        return response()->json(
            QuoteTemplate::where('account_id', $accountId)
                ->orderBy('sort_order')
                ->orderBy('name')
                ->get()
        );
    }

    public function store(Request $request)
    {
        $accountId = $this->getAccountId($request);
        if (!$accountId) {
            return response()->json(['message' => 'Account Id is required'], 400);
        }

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'image_url' => 'nullable|string|max:2048',
            'sort_order' => 'nullable|integer|min:0',
            'is_active' => 'nullable|boolean',
        ]);

        $template = QuoteTemplate::create([
            'account_id' => $accountId,
            'name' => $validated['name'],
            'image_url' => $validated['image_url'] ?? null,
            'sort_order' => $validated['sort_order'] ?? 0,
            'is_active' => $validated['is_active'] ?? true,
        ]);

        return response()->json($template, 201);
    }

    public function update(Request $request, $id)
    {
        $accountId = $this->getAccountId($request);
        $template = QuoteTemplate::where('account_id', $accountId)->findOrFail($id);

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'image_url' => 'nullable|string|max:2048',
            'sort_order' => 'nullable|integer|min:0',
            'is_active' => 'nullable|boolean',
        ]);

        $template->update([
            'name' => $validated['name'],
            'image_url' => $validated['image_url'] ?? null,
            'sort_order' => $validated['sort_order'] ?? $template->sort_order,
            'is_active' => $validated['is_active'] ?? $template->is_active,
        ]);

        return response()->json($template);
    }

    public function destroy(Request $request, $id)
    {
        $accountId = $this->getAccountId($request);
        $template = QuoteTemplate::where('account_id', $accountId)->findOrFail($id);
        $template->delete();

        return response()->json(['message' => 'Quote template deleted successfully']);
    }

    private function getAccountId(Request $request)
    {
        return $request->header('X-Account-Id') && $request->header('X-Account-Id') !== 'all'
            ? $request->header('X-Account-Id')
            : null;
    }
}
