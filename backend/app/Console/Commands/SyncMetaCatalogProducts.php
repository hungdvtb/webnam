<?php

namespace App\Console\Commands;

use App\Services\MetaCatalog\MetaCatalogProductSyncService;
use Illuminate\Console\Command;

class SyncMetaCatalogProducts extends Command
{
    protected $signature = 'meta-catalog:sync-products
        {--dry-run : Build the sync plan without sending writes to Meta}
        {--delete-stale : Delete Meta catalog items missing from the website feed}
        {--skip-delete-stale : Force stale item deletes off}
        {--batch-size= : Override request count per Meta batch}
        {--no-status-poll : Submit batches without polling Meta batch status}';

    protected $description = 'Sync website products to Meta Catalog through the Catalog Batch API.';

    public function handle(MetaCatalogProductSyncService $syncService): int
    {
        $deleteStale = !$this->option('skip-delete-stale')
            && ((bool) $this->option('delete-stale') || (bool) config('meta_catalog.delete_stale', true));

        try {
            $result = $syncService->sync([
                'dry_run' => (bool) $this->option('dry-run'),
                'delete_stale' => $deleteStale,
                'batch_size' => $this->option('batch-size') ? (int) $this->option('batch-size') : null,
                'poll_status' => !$this->option('no-status-poll'),
            ]);
        } catch (\Throwable $exception) {
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
}
