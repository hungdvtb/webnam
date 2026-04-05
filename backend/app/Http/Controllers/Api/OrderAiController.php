<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Services\Orders\OrderAiAssistantService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OrderAiController extends Controller
{
    public function __construct(
        private readonly OrderAiAssistantService $orderAiAssistantService,
    ) {
    }

    public function preview(Request $request): JsonResponse
    {
        $request->validate([
            'message' => 'nullable|string',
            'attachment' => 'nullable|file|max:12288|mimes:jpg,jpeg,png,webp,pdf,heic,heif',
            'preferred_rule_key' => 'nullable|string|max:160',
        ]);

        return response()->json(
            $this->orderAiAssistantService->preview(
                $this->resolveAccountId($request),
                (string) $request->input('message', ''),
                $request->file('attachment'),
                (string) $request->input('preferred_rule_key', '')
            )
        );
    }

    public function trainPreview(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'altar_size_label' => 'required|string|max:120',
            'message' => 'nullable|string|max:5000',
            'attachment' => 'required|file|max:12288|mimes:jpg,jpeg,png,webp,pdf,heic,heif',
        ]);

        return response()->json(
            $this->orderAiAssistantService->trainRulePreview(
                $this->resolveAccountId($request),
                (string) ($validated['altar_size_label'] ?? ''),
                (string) ($validated['message'] ?? ''),
                $request->file('attachment')
            )
        );
    }

    public function rules(Request $request): JsonResponse
    {
        return response()->json([
            'rules' => $this->orderAiAssistantService->getRules($this->resolveAccountId($request)),
        ]);
    }

    public function updateRules(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'rules' => 'required|array|max:24',
            'rules.*.id' => 'nullable|string|max:120',
            'rules.*.altar_size_label' => 'required|string|max:120',
            'rules.*.altar_size_aliases' => 'nullable|array|max:12',
            'rules.*.altar_size_aliases.*' => 'nullable|string|max:120',
            'rules.*.context_aliases' => 'nullable|array|max:16',
            'rules.*.context_aliases.*' => 'nullable|string|max:160',
            'rules.*.training_source_type' => 'nullable|string|in:manual,image',
            'rules.*.training_source_name' => 'nullable|string|max:255',
            'rules.*.training_note' => 'nullable|string|max:5000',
            'rules.*.training_raw_text' => 'nullable|string|max:10000',
            'rules.*.trained_at' => 'nullable|string|max:80',
            'rules.*.items' => 'nullable|array|max:40',
            'rules.*.items.*.id' => 'nullable|string|max:120',
            'rules.*.items.*.aliases' => 'nullable|array|max:12',
            'rules.*.items.*.aliases.*' => 'nullable|string|max:160',
            'rules.*.items.*.default_quantity' => 'nullable|integer|min:1|max:999',
            'rules.*.items.*.target_product_id' => 'required|integer|min:1',
            'rules.*.items.*.parent_product_id' => 'nullable|integer|min:1',
            'rules.*.items.*.entry_kind' => 'nullable|string|in:product,variation',
            'rules.*.items.*.display_name' => 'nullable|string|max:255',
            'rules.*.items.*.display_sku' => 'nullable|string|max:120',
            'rules.*.items.*.option_label' => 'nullable|string|max:255',
            'rules.*.items.*.main_image' => 'nullable|string|max:1000',
            'rules.*.items.*.price' => 'nullable|numeric|min:0',
            'rules.*.items.*.cost_price' => 'nullable|numeric|min:0',
        ]);

        return response()->json([
            'message' => 'Đã lưu rule AI theo kích thước ban thờ.',
            'rules' => $this->orderAiAssistantService->saveRules(
                $this->resolveAccountId($request),
                $validated['rules'] ?? []
            ),
        ]);
    }

    private function resolveAccountId(Request $request): int
    {
        $headerAccountId = (int) $request->header('X-Account-Id');
        if ($headerAccountId > 0) {
            return $headerAccountId;
        }

        $siteCode = trim((string) $request->header('X-Site-Code', ''));
        if ($siteCode !== '') {
            return (int) (Account::query()->where('site_code', $siteCode)->value('id') ?? 0);
        }

        return 0;
    }
}
