<?php

namespace App\Services\AI;

use App\Jobs\GenerateProductSeoBulkItemJob;
use App\Models\Product;
use App\Models\ProductSeoBulkRun;
use App\Models\ProductSeoBulkRunItem;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class ProductSeoBulkRunService
{
    private const DEFAULT_MAX_ATTEMPTS = 5;
    private const ITEM_QUEUE = 'ai-seo-bulk';
    private const RETRY_DELAYS_SECONDS = [60, 180, 600, 1800];

    public function __construct(
        private readonly AiExceptionClassifier $aiExceptionClassifier,
        private readonly ProductSeoBulkQueueWorkerService $queueWorkerService,
    ) {
    }

    public function createRun(
        int $accountId,
        array $productIds,
        ?int $createdBy = null,
        ?string $model = null,
        ?string $customInstruction = null,
        ?string $requestKey = null,
    ): ProductSeoBulkRun {
        $resolvedRequestKey = trim((string) $requestKey) !== '' ? trim((string) $requestKey) : null;

        if ($resolvedRequestKey) {
            $existingRun = $this->findRunByRequestKey($accountId, $resolvedRequestKey);
            if ($existingRun) {
                return $this->syncRunProgress($existingRun);
            }
        }

        $this->purgeAllQueuedJobs();
        $this->supersedePendingRuns($accountId);

        $normalizedIds = collect($productIds)
            ->map(fn ($value) => (int) $value)
            ->filter(fn (int $value) => $value > 0)
            ->unique()
            ->values()
            ->all();

        if ($normalizedIds === []) {
            throw ValidationException::withMessages([
                'product_ids' => ['Cần chọn ít nhất 1 sản phẩm hợp lệ để tạo SEO hàng loạt.'],
            ]);
        }

        $productsById = Product::query()
            ->where('account_id', $accountId)
            ->whereIn('id', $normalizedIds)
            ->get(['id', 'name', 'sku'])
            ->keyBy('id');

        $orderedProducts = collect($normalizedIds)
            ->map(fn (int $id) => $productsById->get($id))
            ->filter()
            ->values();

        if ($orderedProducts->isEmpty()) {
            throw ValidationException::withMessages([
                'product_ids' => ['Không tìm thấy sản phẩm hợp lệ trong tài khoản hiện tại.'],
            ]);
        }

        $ignoredProductIds = array_values(array_diff($normalizedIds, $orderedProducts->pluck('id')->all()));
        $resolvedModel = trim((string) $model) !== '' ? trim((string) $model) : null;
        $resolvedInstruction = trim((string) $customInstruction) !== '' ? trim((string) $customInstruction) : null;
        $maxAttempts = self::DEFAULT_MAX_ATTEMPTS;

        $itemIds = [];

        $run = DB::transaction(function () use (
            $accountId,
            $createdBy,
            $resolvedModel,
            $resolvedInstruction,
            $resolvedRequestKey,
            $orderedProducts,
            $ignoredProductIds,
            $maxAttempts,
            &$itemIds,
        ) {
            $run = ProductSeoBulkRun::query()->create([
                'account_id' => $accountId,
                'created_by' => $createdBy,
                'status' => ProductSeoBulkRun::STATUS_QUEUED,
                'total_items' => $orderedProducts->count(),
                'queued_items' => $orderedProducts->count(),
                'processing_items' => 0,
                'completed_items' => 0,
                'retrying_items' => 0,
                'failed_items' => 0,
                'max_attempts' => $maxAttempts,
                'ai_model' => $resolvedModel,
                'custom_instruction' => $resolvedInstruction,
                'summary' => [
                    'progress_percent' => 0,
                    'processed_items' => 0,
                ],
                'metadata' => [
                    'requested_product_ids' => $orderedProducts->pluck('id')->all(),
                    'ignored_product_ids' => $ignoredProductIds,
                    'request_key' => $resolvedRequestKey,
                ],
            ]);

            $rows = [];
            foreach ($orderedProducts as $index => $product) {
                $rows[] = [
                    'product_seo_bulk_run_id' => $run->id,
                    'product_id' => (int) $product->id,
                    'position' => $index + 1,
                    'product_name' => (string) $product->name,
                    'product_sku' => $product->sku !== null ? (string) $product->sku : null,
                    'status' => ProductSeoBulkRunItem::STATUS_QUEUED,
                    'attempt_count' => 0,
                    'max_attempts' => $maxAttempts,
                    'retryable' => false,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }

            ProductSeoBulkRunItem::query()->insert($rows);

            $itemIds = ProductSeoBulkRunItem::query()
                ->where('product_seo_bulk_run_id', $run->id)
                ->orderBy('position')
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->all();

            if (! $this->queueWorkerService->requiresExternalWorker()) {
                DB::afterCommit(function () use ($itemIds) {
                    foreach ($itemIds as $itemId) {
                        GenerateProductSeoBulkItemJob::dispatch($itemId)
                            ->onConnection($this->queueConnection())
                            ->onQueue($this->queueName());
                    }
                });
            }

            return $run;
        });

        $this->ensureWorkerRunningIfNeeded($run);

        return $this->syncRunProgress($run);
    }

    public function findRunByRequestKey(int $accountId, string $requestKey): ?ProductSeoBulkRun
    {
        $normalizedRequestKey = trim($requestKey);
        if ($normalizedRequestKey === '') {
            return null;
        }

        return ProductSeoBulkRun::query()
            ->where('account_id', $accountId)
            ->where('metadata->request_key', $normalizedRequestKey)
            ->latest('id')
            ->first();
    }

    public function processNextAvailableItem(): bool
    {
        $nextItem = ProductSeoBulkRunItem::query()
            ->select('product_seo_bulk_run_items.*')
            ->join('product_seo_bulk_runs', 'product_seo_bulk_runs.id', '=', 'product_seo_bulk_run_items.product_seo_bulk_run_id')
            ->whereIn('product_seo_bulk_runs.status', [
                ProductSeoBulkRun::STATUS_QUEUED,
                ProductSeoBulkRun::STATUS_RUNNING,
            ])
            ->where(function ($query) {
                $query->where('product_seo_bulk_run_items.status', ProductSeoBulkRunItem::STATUS_QUEUED)
                    ->orWhere(function ($retryQuery) {
                        $retryQuery->where('product_seo_bulk_run_items.status', ProductSeoBulkRunItem::STATUS_RETRYING)
                            ->where(function ($dateQuery) {
                                $dateQuery->whereNull('product_seo_bulk_run_items.next_retry_at')
                                    ->orWhere('product_seo_bulk_run_items.next_retry_at', '<=', now());
                            });
                    });
            })
            ->orderBy('product_seo_bulk_runs.id')
            ->orderByRaw("CASE WHEN product_seo_bulk_run_items.status = 'retrying' THEN 0 ELSE 1 END")
            ->orderBy('product_seo_bulk_run_items.position')
            ->orderBy('product_seo_bulk_run_items.id')
            ->first();

        if (! $nextItem) {
            return false;
        }

        GenerateProductSeoBulkItemJob::dispatchSync($nextItem->id);

        return true;
    }

    public function cancelRun(ProductSeoBulkRun|int $run): ProductSeoBulkRun
    {
        $resolvedRun = $run instanceof ProductSeoBulkRun
            ? $run
            : ProductSeoBulkRun::query()->findOrFail((int) $run);

        if (in_array($resolvedRun->status, [
            ProductSeoBulkRun::STATUS_QUEUED,
            ProductSeoBulkRun::STATUS_RUNNING,
        ], true)) {
            ProductSeoBulkRunItem::query()
                ->where('product_seo_bulk_run_id', $resolvedRun->id)
                ->whereIn('status', [
                    ProductSeoBulkRunItem::STATUS_QUEUED,
                    ProductSeoBulkRunItem::STATUS_RETRYING,
                ])
                ->update([
                    'status' => ProductSeoBulkRunItem::STATUS_FAILED,
                    'retryable' => false,
                    'error_code' => 'CANCELLED_BY_USER',
                    'last_error' => 'Người dùng đã dừng tiến trình.',
                    'next_retry_at' => null,
                    'finished_at' => now(),
                    'updated_at' => now(),
                ]);

            $this->syncRunProgress($resolvedRun);
        }

        return $resolvedRun->fresh();
    }

    public function classifyException(\Throwable $exception): array
    {
        return $this->aiExceptionClassifier->classify($exception);
    }

    public function ensureWorkerRunningIfNeeded(?ProductSeoBulkRun $run = null): array
    {
        $status = $run ? strtolower((string) $run->status) : null;

        if ($run && ! in_array($status, [
            ProductSeoBulkRun::STATUS_QUEUED,
            ProductSeoBulkRun::STATUS_RUNNING,
        ], true)) {
            return $this->queueWorkerService->status();
        }

        return $this->queueWorkerService->ensureRunning();
    }

    public function getWorkerStatus(): array
    {
        return $this->queueWorkerService->status();
    }

    public function processNextItemInline(ProductSeoBulkRun|int $run): bool
    {
        $resolvedRun = $run instanceof ProductSeoBulkRun
            ? $run->fresh()
            : ProductSeoBulkRun::query()->findOrFail((int) $run);

        if (! in_array($resolvedRun->status, [
            ProductSeoBulkRun::STATUS_QUEUED,
            ProductSeoBulkRun::STATUS_RUNNING,
        ], true)) {
            return false;
        }

        $nextItem = ProductSeoBulkRunItem::query()
            ->where('product_seo_bulk_run_id', $resolvedRun->id)
            ->where(function ($query) {
                $query->where('status', ProductSeoBulkRunItem::STATUS_QUEUED)
                    ->orWhere(function ($retryQuery) {
                        $retryQuery->where('status', ProductSeoBulkRunItem::STATUS_RETRYING)
                            ->where(function ($dateQuery) {
                                $dateQuery->whereNull('next_retry_at')
                                    ->orWhere('next_retry_at', '<=', now());
                            });
                    });
            })
            ->orderByRaw("CASE WHEN status = 'retrying' THEN 0 ELSE 1 END")
            ->orderBy('position')
            ->orderBy('id')
            ->first();

        if (! $nextItem) {
            return false;
        }

        GenerateProductSeoBulkItemJob::dispatchSync($nextItem->id);

        return true;
    }

    public function resolveRetryDelaySeconds(int $attempt): int
    {
        $index = max($attempt - 1, 0);
        $fallbackDelay = self::RETRY_DELAYS_SECONDS[count(self::RETRY_DELAYS_SECONDS) - 1];

        return self::RETRY_DELAYS_SECONDS[$index] ?? $fallbackDelay;
    }

    public function markItemProcessing(ProductSeoBulkRunItem $item, int $attempt): ProductSeoBulkRunItem
    {
        $item->forceFill([
            'status' => ProductSeoBulkRunItem::STATUS_PROCESSING,
            'attempt_count' => max($attempt, (int) $item->attempt_count),
            'retryable' => false,
            'error_code' => null,
            'last_error' => null,
            'next_retry_at' => null,
            'started_at' => $item->started_at ?? now(),
            'finished_at' => null,
        ])->save();

        return $item->refresh();
    }

    public function markItemCompleted(ProductSeoBulkRunItem $item, ?string $model = null): ProductSeoBulkRunItem
    {
        $item->forceFill([
            'status' => ProductSeoBulkRunItem::STATUS_COMPLETED,
            'retryable' => false,
            'error_code' => null,
            'last_error' => null,
            'next_retry_at' => null,
            'last_model' => $model ?: $item->last_model,
            'finished_at' => now(),
        ])->save();

        return $item->refresh();
    }

    public function markItemRetrying(
        ProductSeoBulkRunItem $item,
        array $error,
        int $attempt,
        int $delaySeconds,
    ): ProductSeoBulkRunItem {
        $item->forceFill([
            'status' => ProductSeoBulkRunItem::STATUS_RETRYING,
            'attempt_count' => max($attempt, (int) $item->attempt_count),
            'retryable' => true,
            'error_code' => $error['error_code'] ?? null,
            'last_error' => $error['detail'] ?? $error['message'] ?? null,
            'next_retry_at' => now()->addSeconds($delaySeconds),
            'finished_at' => null,
        ])->save();

        return $item->refresh();
    }

    public function markItemFailed(
        ProductSeoBulkRunItem $item,
        array $error,
        int $attempt,
    ): ProductSeoBulkRunItem {
        $item->forceFill([
            'status' => ProductSeoBulkRunItem::STATUS_FAILED,
            'attempt_count' => max($attempt, (int) $item->attempt_count),
            'retryable' => false,
            'error_code' => $error['error_code'] ?? null,
            'last_error' => $error['detail'] ?? $error['message'] ?? null,
            'next_retry_at' => null,
            'finished_at' => now(),
        ])->save();

        return $item->refresh();
    }

    public function syncRunProgress(ProductSeoBulkRun|int $run): ProductSeoBulkRun
    {
        $resolvedRun = $run instanceof ProductSeoBulkRun
            ? $run->fresh()
            : ProductSeoBulkRun::query()->findOrFail((int) $run);

        $statusCounts = ProductSeoBulkRunItem::query()
            ->where('product_seo_bulk_run_id', $resolvedRun->id)
            ->selectRaw('status, COUNT(*) as aggregate')
            ->groupBy('status')
            ->pluck('aggregate', 'status');

        $queuedItems = (int) ($statusCounts[ProductSeoBulkRunItem::STATUS_QUEUED] ?? 0);
        $processingItems = (int) ($statusCounts[ProductSeoBulkRunItem::STATUS_PROCESSING] ?? 0);
        $retryingItems = (int) ($statusCounts[ProductSeoBulkRunItem::STATUS_RETRYING] ?? 0);
        $completedItems = (int) ($statusCounts[ProductSeoBulkRunItem::STATUS_COMPLETED] ?? 0);
        $failedItems = (int) ($statusCounts[ProductSeoBulkRunItem::STATUS_FAILED] ?? 0);
        $totalItems = $resolvedRun->total_items > 0
            ? (int) $resolvedRun->total_items
            : ($queuedItems + $processingItems + $retryingItems + $completedItems + $failedItems);
        $processedItems = $completedItems + $failedItems;

        $status = match (true) {
            $totalItems > 0 && $completedItems === $totalItems => ProductSeoBulkRun::STATUS_COMPLETED,
            $totalItems > 0 && $failedItems === $totalItems => ProductSeoBulkRun::STATUS_FAILED,
            $totalItems > 0 && $processedItems === $totalItems => ProductSeoBulkRun::STATUS_COMPLETED_WITH_ERRORS,
            ($processingItems + $retryingItems + $completedItems + $failedItems) > 0 => ProductSeoBulkRun::STATUS_RUNNING,
            default => ProductSeoBulkRun::STATUS_QUEUED,
        };

        $summary = array_merge($resolvedRun->summary ?? [], [
            'progress_percent' => $totalItems > 0
                ? round(($processedItems / $totalItems) * 100, 2)
                : 0,
            'processed_items' => $processedItems,
        ]);

        $errors = $failedItems > 0
            ? ProductSeoBulkRunItem::query()
                ->where('product_seo_bulk_run_id', $resolvedRun->id)
                ->where('status', ProductSeoBulkRunItem::STATUS_FAILED)
                ->orderBy('position')
                ->limit(20)
                ->get(['product_id', 'product_name', 'product_sku', 'error_code', 'last_error'])
                ->map(fn (ProductSeoBulkRunItem $item) => [
                    'product_id' => (int) $item->product_id,
                    'product_name' => $item->product_name,
                    'product_sku' => $item->product_sku,
                    'error_code' => $item->error_code,
                    'message' => $item->last_error,
                ])
                ->all()
            : [];

        $resolvedRun->forceFill([
            'status' => $status,
            'queued_items' => $queuedItems,
            'processing_items' => $processingItems,
            'completed_items' => $completedItems,
            'retrying_items' => $retryingItems,
            'failed_items' => $failedItems,
            'started_at' => $resolvedRun->started_at ?? (($processingItems + $retryingItems + $completedItems + $failedItems) > 0 ? now() : null),
            'finished_at' => in_array($status, [
                ProductSeoBulkRun::STATUS_COMPLETED,
                ProductSeoBulkRun::STATUS_COMPLETED_WITH_ERRORS,
                ProductSeoBulkRun::STATUS_FAILED,
            ], true) ? ($resolvedRun->finished_at ?? now()) : null,
            'summary' => $summary,
            'errors' => $errors,
        ])->save();

        return $resolvedRun->fresh();
    }

    private function queueConnection(): string
    {
        return (string) config('product_seo_bulk.queue_connection', config('queue.default', 'database'));
    }

    private function queueName(): string
    {
        return (string) config('product_seo_bulk.queue_name', self::ITEM_QUEUE);
    }

    private function supersedePendingRuns(int $accountId): void
    {
        $activeRunIds = ProductSeoBulkRun::query()
            ->where('account_id', $accountId)
            ->whereIn('status', [
                ProductSeoBulkRun::STATUS_QUEUED,
                ProductSeoBulkRun::STATUS_RUNNING,
            ])
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        if ($activeRunIds === []) {
            return;
        }

        $affectedItemIds = ProductSeoBulkRunItem::query()
            ->whereIn('product_seo_bulk_run_id', $activeRunIds)
            ->whereIn('status', [
                ProductSeoBulkRunItem::STATUS_QUEUED,
                ProductSeoBulkRunItem::STATUS_PROCESSING,
                ProductSeoBulkRunItem::STATUS_RETRYING,
            ])
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        ProductSeoBulkRunItem::query()
            ->whereIn('id', $affectedItemIds)
            ->update([
                'status' => ProductSeoBulkRunItem::STATUS_FAILED,
                'retryable' => false,
                'error_code' => 'SUPERSEDED_BY_NEW_RUN',
                'last_error' => 'Đã dừng vì đã tạo tiến trình SEO AI mới.',
                'next_retry_at' => null,
                'finished_at' => now(),
                'updated_at' => now(),
            ]);

        foreach ($activeRunIds as $runId) {
            $this->syncRunProgress($runId);
        }
    }

    private function purgeAllQueuedJobs(): void
    {
        if ($this->queueConnection() !== 'database') {
            return;
        }

        $jobTable = (string) config('queue.connections.database.table', 'jobs');

        DB::table($jobTable)->where('queue', $this->queueName())->delete();
    }
}
