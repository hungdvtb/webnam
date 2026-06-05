<?php

namespace App\Console\Commands;

use App\Services\BlogAi\BlogAiUrlImportQueueWorkerService;
use App\Services\BlogAi\BlogAiUrlImportService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class BlogAiUrlImportWorkerCommand extends Command
{
    protected $signature = 'blog-ai-url:work {--stop-when-empty : Dung worker khi hang doi trong}';

    protected $description = 'Run the AI blog URL import worker loop';

    public function handle(
        BlogAiUrlImportQueueWorkerService $workerService,
        BlogAiUrlImportService $urlImportService,
    ): int {
        $sleepSeconds = max((int) config('blog_ai_url_import.worker.sleep', 1), 1);

        $workerService->recordHeartbeat([
            'started_at' => now()->toIso8601String(),
            'status' => 'starting',
            'last_error' => null,
        ]);

        while (true) {
            try {
                DB::reconnect();

                $workerService->recordHeartbeat([
                    'status' => 'working',
                    'last_error' => null,
                ]);

                $processed = $urlImportService->processNextAvailableJob(function (array $progress) use ($workerService): void {
                    $workerService->recordHeartbeat(array_merge([
                        'status' => 'working',
                        'last_error' => null,
                    ], $progress));
                });

                if ($processed) {
                    $this->info('[' . now()->format('Y-m-d H:i:s') . '] Da xu ly 1 batch URL AI. Dang quet tiep...');
                } elseif ($this->option('stop-when-empty')) {
                    $this->info('[' . now()->format('Y-m-d H:i:s') . '] Hang doi URL AI trong. Dung worker.');
                    $workerService->recordHeartbeat([
                        'status' => 'idle',
                        'current_step' => 'queue_empty',
                        'current_job_id' => null,
                        'current_item_id' => null,
                        'current_item_position' => null,
                        'current_item_title' => null,
                        'current_item_url' => null,
                    ]);

                    return 0;
                }

                $workerService->recordHeartbeat([
                    'status' => $processed ? 'working' : 'idle',
                    'current_step' => $processed ? 'batch_done' : 'queue_empty',
                    'current_job_id' => null,
                    'current_item_id' => null,
                    'current_item_position' => null,
                    'current_item_title' => null,
                    'current_item_url' => null,
                    'last_exit_code' => 0,
                    'last_error' => null,
                ]);
            } catch (\Throwable $exception) {
                try {
                    DB::purge();
                    DB::reconnect();
                } catch (\Throwable) {
                    // Let the next loop try again.
                }

                $workerService->recordHeartbeat([
                    'status' => 'error',
                    'last_error' => $exception->getMessage(),
                ]);
            }

            sleep($sleepSeconds);
        }
    }
}
