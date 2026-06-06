<?php

namespace App\Jobs;

use App\Models\Product;
use App\Services\AI\ProductReviewAiGenerationService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class GenerateProductReviewsForProductJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 900;

    public function __construct(public int $productId)
    {
        $connection = trim((string) config('product_review_ai.queue_connection', ''));
        if ($connection !== '') {
            $this->onConnection($connection);
        }

        $this->onQueue((string) config('product_review_ai.queue_name', 'default'));
    }

    public function backoff(): array
    {
        return [180, 600];
    }

    public function handle(ProductReviewAiGenerationService $reviewAiService): void
    {
        if (! (bool) config('product_review_ai.enabled', true)) {
            return;
        }

        $product = Product::query()->find($this->productId);
        if (! $product) {
            return;
        }

        $reviewAiService->generateForProduct($product);
    }

    public function failed(\Throwable $exception): void
    {
        Log::warning('AI product review generation failed.', [
            'product_id' => $this->productId,
            'message' => $exception->getMessage(),
        ]);
    }
}
