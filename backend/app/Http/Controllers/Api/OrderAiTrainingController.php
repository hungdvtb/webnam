<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Services\Orders\OrderAiAssistantService;
use App\Services\Orders\OrderAiTrainingService;
use App\Support\Utf8Sanitizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class OrderAiTrainingController extends Controller
{
    public function __construct(
        private readonly OrderAiAssistantService $orderAiAssistantService,
        private readonly OrderAiTrainingService $orderAiTrainingService,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $paginator = $this->orderAiTrainingService->listDatasets($this->resolveAccountId($request), [
            'search' => $request->query('search'),
            'altar_size' => $request->query('altar_size'),
            'input_type' => $request->query('input_type'),
            'per_page' => $request->query('per_page', 20),
        ]);

        return response()->json($paginator);
    }

    public function show(Request $request, int $datasetId): JsonResponse
    {
        return response()->json([
            'data' => $this->orderAiTrainingService->getDatasetPayload($this->resolveAccountId($request), $datasetId),
        ]);
    }

    public function preview(Request $request): JsonResponse
    {
        $payload = $this->normalizePayload($request);

        $validated = validator($payload, [
            'altar_size_label' => 'required|string|max:120',
            'input_type' => ['required', Rule::in(['text', 'image'])],
            'input_text' => 'nullable|string|max:20000',
            'definition_text' => 'nullable|string|max:10000',
            'attachment' => 'nullable|file|max:12288|mimes:jpg,jpeg,png,webp,heic,heif',
        ])->validate();

        return response()->json(
            $this->orderAiAssistantService->buildTrainingPreview(
                $this->resolveAccountId($request),
                (string) $validated['altar_size_label'],
                (string) ($validated['input_text'] ?? ''),
                $request->file('attachment'),
                (string) $validated['input_type'],
                (string) ($validated['definition_text'] ?? '')
            )
        );
    }

    public function definitions(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->orderAiTrainingService->getSharedDefinitionPayload($this->resolveAccountId($request)),
        ]);
    }

    public function updateDefinitions(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'definition_text' => 'nullable|string|max:20000',
        ]);

        return response()->json([
            'message' => 'Đã lưu từ điển AI dùng chung.',
            'data' => $this->orderAiTrainingService->updateSharedDefinitionPayload(
                $this->resolveAccountId($request),
                (string) ($validated['definition_text'] ?? '')
            ),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        return response()->json([
            'message' => 'Đã lưu dữ liệu train AI.',
            'data' => $this->orderAiTrainingService->upsertDataset(
                $this->resolveAccountId($request),
                $this->validateDatasetPayload($request),
                $request->file('attachment')
            ),
        ]);
    }

    public function update(Request $request, int $datasetId): JsonResponse
    {
        return response()->json([
            'message' => 'Đã cập nhật dữ liệu train AI.',
            'data' => $this->orderAiTrainingService->upsertDataset(
                $this->resolveAccountId($request),
                $this->validateDatasetPayload($request),
                $request->file('attachment'),
                $datasetId
            ),
        ]);
    }

    public function destroy(Request $request, int $datasetId): JsonResponse
    {
        $this->orderAiTrainingService->deleteDataset($this->resolveAccountId($request), $datasetId);

        return response()->json([
            'message' => 'Đã xóa dữ liệu train AI.',
        ]);
    }

    private function validateDatasetPayload(Request $request): array
    {
        $payload = $this->normalizePayload($request);

        return validator($payload, [
            'rule_key' => 'required|string|max:160',
            'altar_size_label' => 'required|string|max:120',
            'altar_size_aliases' => 'nullable|array|max:12',
            'altar_size_aliases.*' => 'nullable|string|max:120',
            'context_aliases' => 'nullable|array|max:16',
            'context_aliases.*' => 'nullable|string|max:160',
            'input_type' => ['required', Rule::in(['text', 'image'])],
            'source_name' => 'nullable|string|max:255',
            'training_note' => 'nullable|string|max:5000',
            'definition_text' => 'nullable|string|max:10000',
            'input_text' => 'nullable|string|max:20000',
            'attachment' => 'nullable|file|max:12288|mimes:jpg,jpeg,png,webp,heic,heif',
            'parsed_result' => 'nullable|array',
            'parsed_raw_text' => 'nullable|string|max:20000',
            'parsed_provider' => 'nullable|string|max:120',
            'trained_at' => 'nullable|string|max:80',
            'mapping_items' => 'required|array|max:40',
            'mapping_items.*.aliases' => 'nullable|array|max:12',
            'mapping_items.*.aliases.*' => 'nullable|string|max:160',
            'mapping_items.*.default_quantity' => 'nullable|integer|min:1|max:999',
            'mapping_items.*.target_product_id' => 'required|integer|min:1',
            'mapping_items.*.parent_product_id' => 'nullable|integer|min:1',
            'mapping_items.*.entry_kind' => ['nullable', Rule::in(['product', 'variation'])],
            'mapping_items.*.display_name' => 'nullable|string|max:255',
            'mapping_items.*.display_sku' => 'nullable|string|max:120',
            'mapping_items.*.option_label' => 'nullable|string|max:255',
            'mapping_items.*.main_image' => 'nullable|string|max:1000',
            'mapping_items.*.price' => 'nullable|numeric|min:0',
            'mapping_items.*.cost_price' => 'nullable|numeric|min:0',
        ])->validate();
    }

    private function normalizePayload(Request $request): array
    {
        return Utf8Sanitizer::normalize(array_merge($request->all(), [
            'attachment' => $request->file('attachment'),
            'altar_size_aliases' => $this->decodeJsonValue($request->input('altar_size_aliases', []), []),
            'context_aliases' => $this->decodeJsonValue($request->input('context_aliases', []), []),
            'mapping_items' => $this->decodeJsonValue($request->input('mapping_items', []), []),
            'parsed_result' => $this->decodeJsonValue($request->input('parsed_result', null), null),
        ]));
    }

    private function decodeJsonValue(mixed $value, mixed $default): mixed
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            if (json_last_error() === JSON_ERROR_NONE) {
                return $decoded;
            }
        }

        return $value ?? $default;
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
