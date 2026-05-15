<?php

namespace App\Console\Commands;

use App\Models\MetaCatalogSyncLog;
use App\Services\MetaCatalog\MetaCatalogProductSyncService;
use App\Services\MetaCatalog\MetaCatalogSettingsService;
use Illuminate\Console\Command;

class SyncMetaCatalogProducts extends Command
{
    protected $signature = 'meta-catalog:sync-products
        {--dry-run : Build the sync plan without sending writes to Meta}
        {--delete-stale : Delete Meta catalog items missing from the website feed}
        {--skip-delete-stale : Force stale item deletes off}
        {--scheduled : Only run when automatic sync is enabled and due}
        {--account-id= : Account ID to use for Meta Catalog settings}
        {--batch-size= : Override request count per Meta batch}
        {--no-status-poll : Submit batches without polling Meta batch status}';

    protected $description = 'Sync website products to Meta Catalog through the Catalog Batch API.';

    public function handle(MetaCatalogProductSyncService $syncService, MetaCatalogSettingsService $settingsService): int
    {
        $accountId = $this->option('account-id') ? (int) $this->option('account-id') : null;
        $settings = $settingsService->settingsFor($accountId);

        if ($this->option('scheduled') && !$settingsService->shouldRunScheduled($accountId, $settings)) {
            $this->line('Meta Catalog scheduled sync is not due.');

            return self::SUCCESS;
        }

        $settingsService->applyToConfig($settings);
        $deleteStale = !$this->option('skip-delete-stale')
            && ((bool) $this->option('delete-stale') || (bool) ($settings['delete_stale'] ?? true));
        $startedAt = now();
        $startTime = microtime(true);

        try {
            $result = $syncService->sync([
                'dry_run' => (bool) $this->option('dry-run'),
                'delete_stale' => $deleteStale,
                'batch_size' => $this->option('batch-size') ? (int) $this->option('batch-size') : null,
                'poll_status' => !$this->option('no-status-poll'),
            ]);
        } catch (\Throwable $exception) {
            $this->recordFailure($accountId, $this->operationName(), $exception, $startedAt, $startTime);
            $this->error($exception->getMessage());

            return self::FAILURE;
        }

        $mode = $result['dry_run'] ? 'Dry run' : 'Submitted';
        $this->info(sprintf(
            '%s Meta catalog sync. Feed: %d. Valid: %d. Invalid: %d. Create: %d. Update: %d. Delete: %d. Batches: %d.',
            $mode,
            $result['feed_count'],
            $result['valid_count'],
            $result['invalid_count'],
            $result['create_count'],
            $result['update_count'],
            $result['delete_count'],
            $result['batch_count']
        ));

        $fallbackEntries = (array) ($result['fallback_entries'] ?? []);
        if (!empty($fallbackEntries)) {
            $this->warn('Products using fallback image: ' . count($fallbackEntries));
        }

        foreach (array_slice($result['invalid_entries'], 0, 10) as $entry) {
            $this->warn(sprintf(
                '[invalid] %s %s',
                $entry['id'] ?? '',
                implode('; ', (array) ($entry['errors'] ?? []))
            ));
        }

        $batchErrors = $this->countBatchErrors($result['batches']);
        if ($batchErrors > 0) {
            $this->warn("Meta reported {$batchErrors} batch error sample(s). Check the command output or Laravel logs for details.");
        }

        $status = $result['invalid_count'] > 0 || $batchErrors > 0 ? 'error' : 'success';
        $this->recordResult($accountId, $this->operationName(), $status, $result, $startedAt, $startTime);

        return $result['invalid_count'] > 0 || $batchErrors > 0
            ? self::FAILURE
            : self::SUCCESS;
    }

    private function countBatchErrors(array $batches): int
    {
        $count = 0;
        foreach ($batches as $batch) {
            foreach ((array) ($batch['statuses'] ?? []) as $status) {
                $errors = data_get($status, 'response.data.0.errors', data_get($status, 'response.errors', []));
                if (is_array($errors)) {
                    $count += count($errors);
                }
            }
        }

        return $count;
    }

    private function operationName(): string
    {
        if ($this->option('scheduled')) {
            return 'scheduled_sync';
        }

        return $this->option('dry-run') ? 'dry_run' : 'sync_live';
    }

    private function recordResult(?int $accountId, string $operation, string $status, array $result, $startedAt, float $startTime): void
    {
        MetaCatalogSyncLog::query()->create([
            'account_id' => $accountId,
            'operation' => $operation,
            'status' => $status,
            'total_products' => (int) ($result['feed_count'] ?? 0),
            'valid_products' => (int) ($result['valid_count'] ?? 0),
            'invalid_products' => (int) ($result['invalid_count'] ?? 0),
            'success_count' => (int) ($result['request_count'] ?? $result['valid_count'] ?? 0),
            'error_count' => (int) ($result['invalid_count'] ?? 0),
            'create_count' => (int) ($result['create_count'] ?? 0),
            'update_count' => (int) ($result['update_count'] ?? 0),
            'delete_count' => (int) ($result['delete_count'] ?? 0),
            'fallback_count' => (int) ($result['fallback_count'] ?? count((array) ($result['fallback_entries'] ?? []))),
            'duration_ms' => (int) round((microtime(true) - $startTime) * 1000),
            'summary' => sprintf(
                '%s %s: total %d, valid %d, invalid %d, create %d, update %d, delete %d.',
                $operation,
                $status,
                (int) ($result['feed_count'] ?? 0),
                (int) ($result['valid_count'] ?? 0),
                (int) ($result['invalid_count'] ?? 0),
                (int) ($result['create_count'] ?? 0),
                (int) ($result['update_count'] ?? 0),
                (int) ($result['delete_count'] ?? 0)
            ),
            'details' => [
                'invalid_entries' => $result['invalid_entries'] ?? [],
                'fallback_entries' => $result['fallback_entries'] ?? [],
                'batches' => $result['batches'] ?? [],
            ],
            'started_at' => $startedAt,
            'finished_at' => now(),
        ]);
    }

    private function recordFailure(?int $accountId, string $operation, \Throwable $exception, $startedAt, float $startTime): void
    {
        MetaCatalogSyncLog::query()->create([
            'account_id' => $accountId,
            'operation' => $operation,
            'status' => 'error',
            'error_count' => 1,
            'duration_ms' => (int) round((microtime(true) - $startTime) * 1000),
            'summary' => $exception->getMessage(),
            'error_message' => $exception->getMessage(),
            'details' => ['error' => $exception->getMessage()],
            'started_at' => $startedAt,
            'finished_at' => now(),
        ]);
    }
}
