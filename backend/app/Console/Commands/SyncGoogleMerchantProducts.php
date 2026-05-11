<?php

namespace App\Console\Commands;

use App\Models\Product;
use App\Services\GoogleMerchant\GoogleMerchantProductSyncService;
use Illuminate\Console\Command;

class SyncGoogleMerchantProducts extends Command
{
    protected $signature = 'google-merchant:sync-products
        {--id=* : Only sync specific product IDs}
        {--limit=0 : Maximum number of products to sync}
        {--include-inactive : Include inactive products}
        {--dry-run : Build payloads without sending them to Google}';

    protected $description = 'Sync products to Google Merchant Center through Merchant API.';

    public function handle(GoogleMerchantProductSyncService $syncService): int
    {
        if (!$this->option('dry-run') && !$syncService->enabled()) {
            $this->error('Google Merchant sync is disabled. Set GOOGLE_MERCHANT_SYNC_ENABLED=true.');
            return self::FAILURE;
        }

        $ids = collect($this->option('id'))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        $query = Product::query()
            ->with(['images', 'siteDomain', 'parentConfigurable.siteDomain', 'parentConfigurable.images'])
            ->orderBy('id');

        if ($ids->isNotEmpty()) {
            $query->whereIn('id', $ids->all());
        }

        if (!$this->option('include-inactive')) {
            $query->where('status', true);
        }

        $limit = (int) $this->option('limit');
        $count = 0;
        $failed = 0;
        $processed = 0;

        $query->chunkById(100, function ($products) use ($syncService, $limit, &$count, &$failed, &$processed) {
            foreach ($products as $product) {
                if ($limit > 0 && $processed >= $limit) {
                    return false;
                }

                try {
                    if ($this->option('dry-run')) {
                        $payload = $syncService->buildProductInputPayload($product);
                        $this->line(sprintf('[dry-run] #%d %s', $product->id, $payload['offerId'] ?? ''));
                    } else {
                        $result = $syncService->syncProduct($product);
                        $this->line(sprintf('[synced] #%d %s', $product->id, $result['offer_id'] ?? ''));
                    }

                    $count++;
                } catch (\Throwable $exception) {
                    $failed++;
                    $this->warn(sprintf('[failed] #%d %s', $product->id, $exception->getMessage()));
                } finally {
                    $processed++;
                }
            }

            return $limit <= 0 || $processed < $limit;
        });

        $this->info("Done. Synced: {$count}. Failed: {$failed}.");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
