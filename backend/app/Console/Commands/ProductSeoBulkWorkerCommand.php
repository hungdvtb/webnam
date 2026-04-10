<?php

namespace App\Console\Commands;

use App\Services\AI\ProductSeoBulkQueueWorkerService;
use App\Services\AI\ProductSeoBulkRunService;
use Illuminate\Console\Command;

class ProductSeoBulkWorkerCommand extends Command
{
    protected $signature = 'product-seo-bulk:work';

    protected $description = 'Run the product SEO bulk queue worker loop';

    public function handle(
        ProductSeoBulkQueueWorkerService $workerService,
        ProductSeoBulkRunService $bulkRunService,
    ): int
    {
        $sleepSeconds = max((int) config('product_seo_bulk.worker.sleep', 1), 1);

        $workerService->recordHeartbeat([
            'started_at' => now()->toIso8601String(),
            'status' => 'starting',
            'last_error' => null,
        ]);

        while (true) {
            try {
                $workerService->recordHeartbeat([
                    'status' => 'working',
                    'last_error' => null,
                ]);

                $processed = $bulkRunService->processNextAvailableItem();

                if ($processed) {
                    $this->info('[' . now()->format('Y-m-d H:i:s') . '] Da xu ly xong 1 tien trinh. Dang quet tiep...');
                }

                $workerService->recordHeartbeat([
                    'status' => $processed ? 'working' : 'idle',
                    'last_exit_code' => 0,
                    'last_error' => null,
                ]);
            } catch (\Throwable $exception) {
                try {
                    \Illuminate\Support\Facades\DB::reconnect();
                } catch (\Throwable $reconnectException) {
                    // Ignore, let the next loop handle it
                }

                $workerService->recordHeartbeat([
                    'status' => 'error',
                    'last_error' => $exception->getMessage(),
                ]);
            }

            try {
                \Illuminate\Support\Facades\DB::disconnect();
            } catch (\Throwable $disconnectException) {
                // Ignore disconnect errors
            }
            
            sleep($sleepSeconds);
        }
    }
}
