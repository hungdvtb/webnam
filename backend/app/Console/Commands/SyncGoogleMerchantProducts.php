<?php

namespace App\Console\Commands;

use App\Models\GoogleMerchantSyncLog;
use App\Models\Product;
use App\Services\GoogleMerchant\GoogleMerchantProductSyncService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class SyncGoogleMerchantProducts extends Command
{
    protected $signature = 'google-merchant:sync-products
        {--id=* : Only sync specific product IDs}
        {--limit=0 : Maximum number of products to sync}
        {--account-id= : Only sync products for one account ID}
        {--include-inactive : Include inactive products}
        {--dry-run : Build payloads without sending them to Google}
        {--scheduled : Run as an automatic scheduled background sync}';

    protected $description = 'Sync products to Google Merchant Center through Merchant API.';

    public function handle(GoogleMerchantProductSyncService $syncService): int
    {
        $startedAt = now();
        $startedAtMs = microtime(true);
        $operation = $this->option('scheduled')
            ? 'scheduled_sync'
            : ($this->option('dry-run') ? 'dry_run' : 'sync_live');
        $accountId = $this->option('account-id') !== null && $this->option('account-id') !== ''
            ? (int) $this->option('account-id')
            : null;

        if ($this->option('scheduled') && !(bool) config('google_merchant.scheduled_sync_enabled', true)) {
            $summary = [
                'message' => 'Google Merchant scheduled sync is disabled.',
                'scheduled' => true,
                'started_at' => $startedAt->toDateTimeString(),
                'finished_at' => now()->toDateTimeString(),
                'total_candidates' => 0,
                'processed' => 0,
                'updated' => 0,
                'skipped' => 0,
                'deleted' => 0,
                'failed' => 0,
            ];

            $this->recordSummaryLog($accountId, $operation, 'skipped', $summary, $startedAtMs);
            $this->line($summary['message']);

            return self::SUCCESS;
        }

        $ids = collect($this->option('id'))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        $query = Product::withTrashed()
            ->with(['images', 'siteDomain', 'parentConfigurable.siteDomain', 'parentConfigurable.images'])
            ->orderBy('id');

        if ($accountId) {
            $query->where('account_id', $accountId);
        }

        if ($ids->isNotEmpty()) {
            $query->whereIn('id', $ids->all());
        }

        if (!$this->option('include-inactive')) {
            $query->where(function ($productQuery) {
                $productQuery
                    ->where(function ($sellableProductQuery) {
                        $sellableProductQuery
                            ->whereNull('products.deleted_at')
                            ->where('status', true)
                            ->whereDoesntHave('parentConfigurable');
                    })
                    ->orWhereNotNull('google_merchant_offer_id')
                    ->orWhereNotNull('google_merchant_product_input_name')
                    ->orWhereIn('google_merchant_sync_status', ['synced', 'error']);
            });
        }

        $limit = (int) $this->option('limit');
        $totalCandidates = (clone $query)->count();
        $totalToScan = $limit > 0 ? min($limit, $totalCandidates) : $totalCandidates;
        $synced = 0;
        $deleted = 0;
        $skipped = 0;
        $failed = 0;
        $processed = 0;
        $bundleOptionDeleted = 0;
        $variantChildDeleted = 0;
        $failureSamples = [];
        $skippedSamples = [];

        $this->line(sprintf(
            '[%s] Google Merchant sync started at %s. Candidates: %d. Limit: %s.',
            $operation,
            $startedAt->toDateTimeString(),
            $totalCandidates,
            $limit > 0 ? (string) $limit : 'none'
        ));

        $query->chunkById(100, function ($products) use (
            $syncService,
            $limit,
            &$synced,
            &$deleted,
            &$skipped,
            &$failed,
            &$processed,
            &$bundleOptionDeleted,
            &$variantChildDeleted,
            &$failureSamples,
            &$skippedSamples
        ) {
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
                            if (count($skippedSamples) < 20) {
                                $skippedSamples[] = [
                                    'product_id' => (int) $product->id,
                                    'offer_id' => $result['offer_id'] ?? null,
                                    'reason' => $reason,
                                ];
                            }
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
                            if ($optionStatus === 'deleted' || str_contains($optionAction, 'delete')) {
                                $deleted++;
                                $bundleOptionDeleted++;
                            }
                            $this->line(sprintf(
                                '  [%s] %s %s%s',
                                $optionStatus !== '' ? $optionStatus : 'bundle',
                                $optionAction,
                                $bundleOptionResult['offer_id'] ?? '',
                                $optionSuffix
                            ));
                        }

                        foreach (($result['variant_child_deletes'] ?? []) as $variantDeleteResult) {
                            $deleted++;
                            $variantChildDeleted++;
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
                    if (count($failureSamples) < 20) {
                        $failureSamples[] = [
                            'product_id' => (int) $product->id,
                            'message' => $exception->getMessage(),
                        ];
                    }
                    $this->warn(sprintf('[failed] #%d %s', $product->id, $exception->getMessage()));
                } finally {
                    $processed++;
                }
            }

            return $limit <= 0 || $processed < $limit;
        });

        $summary = [
            'operation' => $operation,
            'scheduled' => (bool) $this->option('scheduled'),
            'dry_run' => (bool) $this->option('dry-run'),
            'account_id' => $accountId,
            'started_at' => $startedAt->toDateTimeString(),
            'finished_at' => now()->toDateTimeString(),
            'total_candidates' => $totalCandidates,
            'total_to_scan' => $totalToScan,
            'processed' => $processed,
            'updated' => $synced,
            'skipped' => $skipped,
            'deleted' => $deleted,
            'bundle_option_deleted' => $bundleOptionDeleted,
            'variant_child_deleted' => $variantChildDeleted,
            'failed' => $failed,
            'skipped_samples' => $skippedSamples,
            'failure_samples' => $failureSamples,
        ];
        $this->recordSummaryLog($accountId, $operation, $failed > 0 ? 'error' : 'success', $summary, $startedAtMs);

        $this->info("Done. Scanned: {$processed}/{$totalCandidates}. Updated: {$synced}. Deleted: {$deleted}. Skipped: {$skipped}. Failed: {$failed}.");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }

    private function recordSummaryLog(?int $accountId, string $operation, string $status, array $summary, float $startedAtMs): void
    {
        try {
            GoogleMerchantSyncLog::create([
                'account_id' => $accountId,
                'product_id' => null,
                'offer_id' => null,
                'action' => $operation,
                'status' => $status,
                'request_method' => 'COMMAND',
                'request_url' => 'artisan google-merchant:sync-products',
                'request_payload' => [
                    'scheduled' => (bool) $this->option('scheduled'),
                    'dry_run' => (bool) $this->option('dry-run'),
                    'include_inactive' => (bool) $this->option('include-inactive'),
                    'limit' => (int) $this->option('limit'),
                    'account_id' => $accountId,
                    'ids' => $this->option('id'),
                ],
                'response_status' => null,
                'response_body' => $summary,
                'error_message' => $status === 'error' ? 'Google Merchant sync completed with failures.' : ($summary['message'] ?? null),
                'duration_ms' => (int) round((microtime(true) - $startedAtMs) * 1000),
            ]);
        } catch (\Throwable $exception) {
            Log::warning('Unable to write Google Merchant scheduled sync summary.', [
                'operation' => $operation,
                'status' => $status,
                'message' => $exception->getMessage(),
            ]);
        }
    }
}
