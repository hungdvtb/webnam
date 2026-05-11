<?php

namespace App\Jobs;

use App\Models\Product;
use App\Services\GoogleMerchant\GoogleMerchantProductSyncService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class SyncGoogleMerchantProductJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 120;

    public function __construct(public int $productId, public ?string $action = null)
    {
        $this->onConnection((string) config('google_merchant.queue_connection', 'sync'));
        $this->onQueue((string) config('google_merchant.queue_name', 'google-merchant'));
    }

    public function handle(GoogleMerchantProductSyncService $syncService): void
    {
        $product = Product::withTrashed()->find($this->productId);
        if (!$product) {
            return;
        }

        try {
            $syncService->syncProduct($product, $this->action);
        } catch (\Throwable $exception) {
            $syncService->logFailure($product, $exception);
            throw $exception;
        }
    }
}
