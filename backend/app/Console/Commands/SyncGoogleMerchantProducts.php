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
            $query->where(function ($productQuery) {
                $productQuery
                    ->where(function ($sellableProductQuery) {
                        $sellableProductQuery
                            ->where('status', true)
                            ->whereDoesntHave('parentConfigurable');
                    })
                    ->orWhereNotNull('google_merchant_offer_id')
                    ->orWhereNotNull('google_merchant_product_input_name')
                    ->orWhere('google_merchant_sync_status', 'synced');
            });
        }

        $limit = (int) $this->option('limit');
        $synced = 0;
        $deleted = 0;
        $skipped = 0;
        $failed = 0;
        $processed = 0;

        $query->chunkById(100, function ($products) use ($syncService, $limit, &$synced, &$deleted, &$skipped, &$failed, &$processed) {
            foreach ($products as $product) {
                if ($limit > 0 && $processed >= $limit) {
                    return false;
                }

                try {
                    if ($this->option('dry-run')) {
                        $payloads = $syncService->buildProductInputPayloads($product);
                        foreach ($payloads as $payload) {
                            $this->line(sprintf('[dry-run] #%d %s', $product->id, $payload['offerId'] ?? ''));
                        }
                        $synced++;
                    } else {
                        $result = $syncService->syncProduct($product);
                        $status = (string) ($result['status'] ?? 'synced');
                        $reason = trim((string) ($result['reason'] ?? ''));
                        $suffix = $reason !== '' ? " - {$reason}" : '';

                        if ($status === 'deleted') {
                            $deleted++;
                            $this->line(sprintf('[deleted] #%d %s%s', $product->id, $result['offer_id'] ?? '', $suffix));
                        } elseif ($status === 'skipped') {
                            $skipped++;
                            $this->line(sprintf('[skipped] #%d %s%s', $product->id, $result['offer_id'] ?? '', $suffix));
                        } else {
                            $synced++;
                            $this->line(sprintf('[synced] #%d %s%s', $product->id, $result['offer_id'] ?? '', $suffix));
                        }

                        foreach (($result['bundle_options'] ?? []) as $bundleOptionResult) {
                            $optionStatus = (string) ($bundleOptionResult['status'] ?? '');
                            $optionAction = (string) ($bundleOptionResult['action'] ?? '');
                            $optionReason = trim((string) ($bundleOptionResult['reason'] ?? ''));
                            $optionSuffix = $optionReason !== '' ? " - {$optionReason}" : '';
                            $this->line(sprintf(
                                '  [%s] %s %s%s',
                                $optionStatus !== '' ? $optionStatus : 'bundle',
                                $optionAction,
                                $bundleOptionResult['offer_id'] ?? '',
                                $optionSuffix
                            ));
                        }

                        foreach (($result['variant_child_deletes'] ?? []) as $variantDeleteResult) {
                            $variantReason = trim((string) ($variantDeleteResult['reason'] ?? ''));
                            $variantSuffix = $variantReason !== '' ? " - {$variantReason}" : '';
                            $this->line(sprintf(
                                '  [deleted] variant_child_delete #%s %s%s',
                                $variantDeleteResult['product_id'] ?? '',
                                $variantDeleteResult['offer_id'] ?? '',
                                $variantSuffix
                            ));
                        }
                    }
                } catch (\Throwable $exception) {
                    $failed++;
                    $this->warn(sprintf('[failed] #%d %s', $product->id, $exception->getMessage()));
                } finally {
                    $processed++;
                }
            }

            return $limit <= 0 || $processed < $limit;
        });

        $this->info("Done. Synced: {$synced}. Deleted: {$deleted}. Skipped: {$skipped}. Failed: {$failed}.");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
