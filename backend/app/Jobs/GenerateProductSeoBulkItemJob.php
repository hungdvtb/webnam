<?php

namespace App\Jobs;

use App\Models\Product;
use App\Models\ProductSeoBulkRunItem;
use App\Services\AI\ProductSeoAiService;
use App\Services\AI\ProductSeoBulkRunService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use RuntimeException;

class GenerateProductSeoBulkItemJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 300;
    public int $tries = 6;

    public function __construct(
        public int $itemId,
    ) {
        $this->onQueue((string) config('product_seo_bulk.queue_name', 'ai-seo-bulk'));
    }

    public function handle(
        ProductSeoBulkRunService $bulkRunService,
        ProductSeoAiService $productSeoAiService,
    ): void {
        $item = ProductSeoBulkRunItem::query()->with('run')->find($this->itemId);
        if (!$item || !$item->run) {
            return;
        }

        if (in_array($item->status, [
            ProductSeoBulkRunItem::STATUS_COMPLETED,
            ProductSeoBulkRunItem::STATUS_FAILED,
            ProductSeoBulkRunItem::STATUS_PROCESSING, // Prevent double processing
        ], true)) {
            $bulkRunService->syncRunProgress($item->product_seo_bulk_run_id);
            return;
        }

        $attempt = max($this->attempts(), 1);
        $run = $item->run;

        // Fetch up to 4 more items to batch (max 5)
        $otherItems = ProductSeoBulkRunItem::query()
            ->where('product_seo_bulk_run_id', $run->id)
            ->where('status', ProductSeoBulkRunItem::STATUS_QUEUED)
            ->where('id', '!=', $item->id)
            ->orderBy('position')
            ->limit(4)
            ->get();

        $batchItems = collect([$item])->concat($otherItems)->values();

        foreach ($batchItems as $batchItem) {
            $bulkRunService->markItemProcessing($batchItem, $attempt);
        }
        $bulkRunService->syncRunProgress($run);

        try {
            $payloads = $batchItems->map(fn($batchItem) => [
                'item_id' => $batchItem->id, // keep reference
                'product_id' => (int) $batchItem->product_id,
                'custom_instruction' => $run->custom_instruction,
            ])->all();

            $generatedResults = $productSeoAiService->generateBatch(
                $payloads,
                (int) $run->account_id,
                $run->ai_model
            );

            // Ensure we got an array back, fallback to empty array if missing keys
            $generatedResults = is_array($generatedResults) ? $generatedResults : [];

            foreach ($batchItems as $index => $batchItem) {
                $generated = $generatedResults[$index] ?? null;
                
                if (empty($generated)) {
                    $bulkRunService->markItemFailed($batchItem, ['message' => 'Lỗi: AI trả về thiếu kết quả cho sản phẩm này trong batch.'], $attempt);
                    continue;
                }

                $product = Product::query()->find($batchItem->product_id);
                if (!$product) {
                    $bulkRunService->markItemFailed($batchItem, ['message' => 'San pham khong con ton tai de luu ket qua SEO.'], $attempt);
                    continue;
                }

                $productSeoAiService->persist($product, $generated);
                $bulkRunService->markItemCompleted($batchItem, $generated['model'] ?? $run->ai_model);
            }

            $bulkRunService->syncRunProgress($run);
            
            // Tạm dừng 3 giây sau mỗi lần gọi batch thành công. (Vì mỗi batch 5 item tốn nhiều token, có thể tăng sleep thành 5-7s)
            sleep(5);
        } catch (\Throwable $exception) {
            $error = $bulkRunService->classifyException($exception);
            $maxAttempts = max((int) ($item->max_attempts ?: $run->max_attempts ?: 1), 1);

            $delaySeconds = $bulkRunService->resolveRetryDelaySeconds($attempt);
            $shouldRetry = ($error['retryable'] ?? false) && $attempt < $maxAttempts;

            foreach ($batchItems as $batchItem) {
                if ($shouldRetry) {
                    $bulkRunService->markItemRetrying($batchItem, $error, $attempt, $delaySeconds);
                } else {
                    $bulkRunService->markItemFailed($batchItem, $error, $attempt);
                }
            }

            $bulkRunService->syncRunProgress($run);
            
            if ($shouldRetry) {
                $this->release($delaySeconds);
                return;
            }
        }
    }

    public function failed(\Throwable $exception): void
    {
        $item = ProductSeoBulkRunItem::query()->with('run')->find($this->itemId);
        if (!$item || !$item->run) {
            return;
        }

        if ($item->status === ProductSeoBulkRunItem::STATUS_COMPLETED) {
            return;
        }

        $bulkRunService = app(ProductSeoBulkRunService::class);
        $error = $bulkRunService->classifyException($exception);
        $bulkRunService->markItemFailed($item, $error, max($this->attempts(), 1));
        $bulkRunService->syncRunProgress($item->run);
    }
}
