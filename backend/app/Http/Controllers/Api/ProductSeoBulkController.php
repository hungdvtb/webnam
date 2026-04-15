<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\ProductSeoBulkRun;
use App\Models\ProductSeoBulkRunItem;
use App\Services\AI\ProductSeoBulkRunService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProductSeoBulkController extends Controller
{
    public function __construct(
        private readonly ProductSeoBulkRunService $bulkRunService,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $accountId = $this->resolveAccountId($request);
        if (! $accountId) {
            return response()->json(['error' => 'Thieu Account ID.'], 400);
        }

        $limit = max(min((int) $request->query('limit', 10), 30), 1);
        $requestKey = trim((string) $request->query('request_key', ''));

        $runsQuery = ProductSeoBulkRun::query()
            ->where('account_id', $accountId);

        if ($requestKey !== '') {
            $runsQuery->where('metadata->request_key', $requestKey);
        }

        $runs = $runsQuery
            ->latest('id')
            ->limit($limit)
            ->get();

        $activeRun = $runs->first(fn (ProductSeoBulkRun $run) => in_array($run->status, [
            ProductSeoBulkRun::STATUS_QUEUED,
            ProductSeoBulkRun::STATUS_RUNNING,
        ], true));
        $workerStatus = $activeRun
            ? $this->bulkRunService->ensureWorkerRunningIfNeeded($activeRun)
            : $this->bulkRunService->getWorkerStatus();

        return response()->json([
            'data' => $runs->map(function (ProductSeoBulkRun $run) use ($request, $workerStatus) {
                return $this->mapRun($run, false, $request, $workerStatus);
            })->values()->all(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $accountId = $this->resolveAccountId($request);
        if (! $accountId) {
            return response()->json(['error' => 'Thieu Account ID.'], 400);
        }

        $validated = $request->validate([
            'product_ids' => 'required|array|min:1|max:5000',
            'product_ids.*' => 'integer',
            'model' => 'nullable|string|max:120',
            'custom_instruction' => 'nullable|string|max:4000',
            'team_image_url' => 'nullable|string|max:1000',
            'request_key' => 'nullable|string|max:120',
        ]);

        $run = $this->bulkRunService->createRun(
            $accountId,
            $validated['product_ids'],
            auth()->id(),
            $validated['model'] ?? null,
            $validated['custom_instruction'] ?? null,
            $validated['request_key'] ?? null
        );

        if (!empty($validated['team_image_url'])) {
            \App\Models\SiteSetting::setValue(
                 'product_seo_team_image_url', 
                 trim($validated['team_image_url']), 
                 $accountId
            );
            \App\Support\OrderBootstrapCache::forget($accountId, \App\Support\OrderBootstrapCache::MODE_FORM);
        }

        $workerStatus = $this->bulkRunService->getWorkerStatus();

        return response()->json([
            'data' => $this->mapRun($run, true, $request, $workerStatus),
        ], 201);
    }

    public function show(Request $request, int $runId): JsonResponse
    {
        $run = $this->resolveRun($request, $runId);
        $workerStatus = $this->bulkRunService->ensureWorkerRunningIfNeeded($run);

        $run = $this->bulkRunService->syncRunProgress($run);

        return response()->json([
            'data' => $this->mapRun($run, true, $request, $workerStatus),
        ]);
    }

    private function resolveRun(Request $request, int $runId): ProductSeoBulkRun
    {
        $accountId = $this->resolveAccountId($request);
        if (! $accountId) {
            abort(400, 'Thieu Account ID.');
        }

        return ProductSeoBulkRun::query()
            ->where('account_id', $accountId)
            ->whereKey($runId)
            ->firstOrFail();
    }

    public function cancel(Request $request, int $runId): JsonResponse
    {
        $run = $this->resolveRun($request, $runId);
        $run = $this->bulkRunService->cancelRun($run);
        $workerStatus = $this->bulkRunService->getWorkerStatus();

        return response()->json([
            'data' => $this->mapRun($run, true, $request, $workerStatus),
        ]);
    }

    private function mapRun(ProductSeoBulkRun $run, bool $withItems, Request $request, ?array $workerStatus = null): array
    {
        $run->refresh();

        $summary = $run->summary ?? [];
        $payload = [
            'id' => $run->id,
            'status' => $run->status,
            'total_items' => (int) $run->total_items,
            'queued_items' => (int) $run->queued_items,
            'processing_items' => (int) $run->processing_items,
            'completed_items' => (int) $run->completed_items,
            'retrying_items' => (int) $run->retrying_items,
            'failed_items' => (int) $run->failed_items,
            'max_attempts' => (int) $run->max_attempts,
            'ai_model' => $run->ai_model,
            'custom_instruction' => $run->custom_instruction,
            'request_key' => $run->metadata['request_key'] ?? null,
            'summary' => $summary,
            'progress_percent' => isset($summary['progress_percent']) ? (float) $summary['progress_percent'] : 0,
            'processed_items' => isset($summary['processed_items']) ? (int) $summary['processed_items'] : ((int) $run->completed_items + (int) $run->failed_items),
            'errors' => $run->errors ?? [],
            'metadata' => $run->metadata ?? [],
            'worker' => $workerStatus ?? $this->bulkRunService->getWorkerStatus(),
            'started_at' => $run->started_at?->toIso8601String(),
            'finished_at' => $run->finished_at?->toIso8601String(),
            'created_at' => $run->created_at?->toIso8601String(),
            'updated_at' => $run->updated_at?->toIso8601String(),
        ];

        if (! $withItems) {
            return $payload;
        }

        $perPage = max(min((int) $request->query('per_page', 25), 100), 1);
        $page = max((int) $request->query('page', 1), 1);
        $statusFilter = trim((string) $request->query('status', ''));
        $search = trim((string) $request->query('search', ''));

        $itemsQuery = $run->items()->getQuery();

        if (in_array($statusFilter, [
            ProductSeoBulkRunItem::STATUS_QUEUED,
            ProductSeoBulkRunItem::STATUS_PROCESSING,
            ProductSeoBulkRunItem::STATUS_RETRYING,
            ProductSeoBulkRunItem::STATUS_COMPLETED,
            ProductSeoBulkRunItem::STATUS_FAILED,
        ], true)) {
            $itemsQuery->where('status', $statusFilter);
        }

        if ($search !== '') {
            $itemsQuery->where(function ($query) use ($search) {
                $query->where('product_name', 'like', '%'.$search.'%')
                    ->orWhere('product_sku', 'like', '%'.$search.'%');
            });
        }

        $items = $itemsQuery
            ->orderBy('position')
            ->orderBy('id')
            ->paginate($perPage, ['*'], 'page', $page);

        $payload['items'] = $items->getCollection()
            ->map(fn (ProductSeoBulkRunItem $item) => $this->mapItem($item))
            ->values()
            ->all();

        $payload['items_meta'] = [
            'current_page' => $items->currentPage(),
            'last_page' => $items->lastPage(),
            'per_page' => $items->perPage(),
            'total' => $items->total(),
            'from' => $items->firstItem(),
            'to' => $items->lastItem(),
            'status' => $statusFilter !== '' ? $statusFilter : null,
            'search' => $search !== '' ? $search : null,
        ];

        return $payload;
    }

    private function mapItem(ProductSeoBulkRunItem $item): array
    {
        return [
            'id' => $item->id,
            'product_id' => (int) $item->product_id,
            'product_name' => $item->product_name,
            'product_sku' => $item->product_sku,
            'position' => (int) $item->position,
            'status' => $item->status,
            'attempt_count' => (int) $item->attempt_count,
            'max_attempts' => (int) $item->max_attempts,
            'error_code' => $item->error_code,
            'last_error' => $item->last_error,
            'retryable' => (bool) $item->retryable,
            'next_retry_at' => $item->next_retry_at?->toIso8601String(),
            'last_model' => $item->last_model,
            'started_at' => $item->started_at?->toIso8601String(),
            'finished_at' => $item->finished_at?->toIso8601String(),
            'updated_at' => $item->updated_at?->toIso8601String(),
        ];
    }

    private function resolveAccountId(Request $request): ?int
    {
        $siteCode = $request->query('site_code') ?: $request->header('X-Site-Code');

        if ($siteCode) {
            $account = Account::query()->where('site_code', $siteCode)->first();
            if ($account) {
                return (int) $account->id;
            }
        }

        $headerAccountId = $request->header('X-Account-Id');
        if ($headerAccountId && $headerAccountId !== 'all') {
            return (int) $headerAccountId;
        }

        return null;
    }
}
