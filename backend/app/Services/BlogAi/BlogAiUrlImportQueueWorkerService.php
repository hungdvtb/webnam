<?php

namespace App\Services\BlogAi;

use App\Models\BlogAiBulkJob;
use App\Models\BlogAiUrlImportItem;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use RuntimeException;
use Symfony\Component\Process\PhpExecutableFinder;

class BlogAiUrlImportQueueWorkerService
{
    private const START_LOCK_KEY = 'blog_ai_url_worker_bootstrap_lock';

    public function status(): array
    {
        $metadata = $this->readMetadata();
        $lastHeartbeatAt = $metadata['heartbeat_at'] ?? null;
        $workerState = strtolower((string) ($metadata['status'] ?? ''));
        $heartbeatFresh = $this->requiresExternalWorker() ? $this->heartbeatIsFresh($lastHeartbeatAt) : true;
        $running = $this->requiresExternalWorker()
            ? ($heartbeatFresh && $workerState !== 'error')
            : true;
        $state = $workerState !== '' ? $workerState : ($running ? 'running' : 'stopped');
        if (!$running && $lastHeartbeatAt && $state !== 'error') {
            $state = 'lost';
        }
        $activeJob = $this->activeJobSnapshot($metadata);

        return [
            'required' => $this->requiresExternalWorker(),
            'auto_start' => $this->autoStartEnabled(),
            'running' => $running,
            'heartbeat_fresh' => $heartbeatFresh,
            'heartbeat_age_seconds' => $this->heartbeatAgeSeconds($lastHeartbeatAt),
            'state' => $state,
            'pid' => $metadata['pid'] ?? null,
            'queue_connection' => $this->queueConnection(),
            'queue_name' => $this->queueName(),
            'command' => $metadata['command'] ?? implode(' ', $this->buildBootstrapCommand()),
            'last_started_at' => $metadata['started_at'] ?? $metadata['start_requested_at'] ?? null,
            'heartbeat_at' => $lastHeartbeatAt,
            'last_error' => $metadata['last_error'] ?? null,
            'current_step' => $metadata['current_step'] ?? null,
            'current_job_id' => $activeJob['id'] ?? ($metadata['current_job_id'] ?? null),
            'current_item' => $activeJob['current_item'] ?? null,
            'active_job' => $activeJob,
            'checked_at' => now()->toIso8601String(),
        ];
    }

    public function ensureRunning(): array
    {
        $status = $this->status();

        if (!$status['required'] || !$status['auto_start'] || $status['running']) {
            return array_merge($status, ['started_now' => false]);
        }

        $lock = Cache::lock(self::START_LOCK_KEY, 15);
        $lockAcquired = false;

        try {
            $lockAcquired = $lock->get();

            if (!$lockAcquired) {
                return array_merge($this->status(), ['started_now' => false]);
            }

            $status = $this->status();
            if ($status['running']) {
                return array_merge($status, ['started_now' => false]);
            }

            $this->writeMetadata(array_merge($this->readMetadata(), [
                'pid' => null,
                'command' => implode(' ', $this->buildBootstrapCommand()),
                'start_requested_at' => now()->toIso8601String(),
                'last_error' => null,
            ]));

            $this->startWorkerProcess();

            usleep((int) config('blog_ai_url_import.worker.boot_wait_ms', 1200) * 1000);

            $status = $this->status();

            if (!$status['running'] && !$status['last_error']) {
                $this->writeMetadata(array_merge($this->readMetadata(), [
                    'last_error' => 'Worker nen chua ghi heartbeat sau khi khoi dong.',
                ]));
                $status = $this->status();
            }

            return array_merge($status, ['started_now' => $status['running']]);
        } catch (\Throwable $exception) {
            $this->writeMetadata(array_merge($this->readMetadata(), [
                'last_error' => $exception->getMessage(),
            ]));

            return array_merge($this->status(), [
                'started_now' => false,
                'last_error' => $exception->getMessage(),
            ]);
        } finally {
            if ($lockAcquired) {
                $lock->release();
            }
        }
    }

    public function recordHeartbeat(array $attributes = []): void
    {
        $metadata = array_merge($this->readMetadata(), [
            'pid' => getmypid() ?: null,
            'command' => implode(' ', $this->buildBootstrapCommand()),
            'started_at' => $this->readMetadata()['started_at'] ?? now()->toIso8601String(),
            'heartbeat_at' => now()->toIso8601String(),
            'queue_connection' => $this->queueConnection(),
            'queue_name' => $this->queueName(),
        ], $attributes);

        if (!isset($metadata['started_at']) || !$metadata['started_at']) {
            $metadata['started_at'] = now()->toIso8601String();
        }

        if (!isset($metadata['heartbeat_at']) || !$metadata['heartbeat_at']) {
            $metadata['heartbeat_at'] = now()->toIso8601String();
        }

        $this->writeMetadata($metadata);
    }

    public function requiresExternalWorker(): bool
    {
        return !in_array($this->queueConnection(), ['sync', 'deferred', 'background', 'null'], true);
    }

    public function queueConnection(): string
    {
        return (string) config('blog_ai_url_import.queue_connection', config('queue.default', 'database'));
    }

    public function queueName(): string
    {
        return (string) config('blog_ai_url_import.queue_name', 'blog-ai-url');
    }

    public function workerCommandSignature(): string
    {
        return 'blog-ai-url:work';
    }

    private function autoStartEnabled(): bool
    {
        return (bool) config('blog_ai_url_import.worker.auto_start', true);
    }

    private function buildBootstrapCommand(): array
    {
        return [
            $this->resolvePhpBinary(),
            base_path('artisan'),
            $this->workerCommandSignature(),
        ];
    }

    private function startWorkerProcess(): void
    {
        if (DIRECTORY_SEPARATOR === '\\') {
            $result = Process::path(base_path())->run('"C:\\Windows\\System32\\cmd.exe" /c ' . $this->buildWindowsDetachedStartCommand());

            if (!$result->successful()) {
                throw new RuntimeException(trim($result->errorOutput() ?: $result->output()) ?: 'Khong the tu khoi dong worker nen.');
            }

            return;
        }

        Process::path(base_path())
            ->forever()
            ->start($this->buildBootstrapCommand());
    }

    private function buildWindowsDetachedStartCommand(): string
    {
        $escape = static fn (string $value): string => '"' . str_replace('"', '""', $value) . '"';

        return 'start "" /B ' . implode(' ', array_map($escape, $this->buildBootstrapCommand()));
    }

    private function resolvePhpBinary(): string
    {
        $configuredBinary = trim((string) config('blog_ai_url_import.worker.php_binary', ''));
        if ($configuredBinary !== '') {
            return $configuredBinary;
        }

        $phpBinary = PHP_BINARY;
        if ($phpBinary !== '') {
            $phpBinaryFilename = basename($phpBinary);
            if (str_contains(strtolower($phpBinaryFilename), 'php-cgi')) {
                $candidate = dirname($phpBinary) . DIRECTORY_SEPARATOR . 'php.exe';
                if (DIRECTORY_SEPARATOR === '\\' && is_file($candidate)) {
                    return $candidate;
                }
            }

            if (is_file($phpBinary)) {
                return $phpBinary;
            }
        }

        $finderBinary = (new PhpExecutableFinder())->find(false);
        if (is_string($finderBinary) && $finderBinary !== '') {
            return $finderBinary;
        }

        return 'php';
    }

    private function metadataPath(): string
    {
        return (string) config('blog_ai_url_import.worker.metadata_path', storage_path('app/blog-ai-url-worker.json'));
    }

    private function heartbeatTtlSeconds(): int
    {
        return max((int) config('blog_ai_url_import.worker.heartbeat_ttl', 420), 30);
    }

    private function heartbeatIsFresh(?string $heartbeatAt): bool
    {
        if (!$heartbeatAt) {
            return false;
        }

        $timestamp = strtotime($heartbeatAt);
        if ($timestamp === false) {
            return false;
        }

        $metadata = $this->readMetadata();
        $status = strtolower((string) ($metadata['status'] ?? ''));
        $idleTtlSeconds = max((int) config('blog_ai_url_import.worker.idle_heartbeat_ttl', 2), 2);
        $ttlSeconds = $status === 'working' ? $this->heartbeatTtlSeconds() : $idleTtlSeconds;

        return (time() - $timestamp) <= $ttlSeconds;
    }

    private function heartbeatAgeSeconds(?string $heartbeatAt): ?int
    {
        if (!$heartbeatAt) {
            return null;
        }

        $timestamp = strtotime($heartbeatAt);
        if ($timestamp === false) {
            return null;
        }

        return max(time() - $timestamp, 0);
    }

    private function activeJobSnapshot(array $metadata): ?array
    {
        $job = BlogAiBulkJob::query()
            ->where('status', BlogAiBulkJob::STATUS_RUNNING)
            ->where('metadata->source_type', BlogAiUrlImportService::SOURCE_TYPE)
            ->where('metadata->processing_active', true)
            ->orderBy('id')
            ->first();

        if (!$job) {
            return null;
        }

        $summary = $job->summary ?? [];
        $counts = BlogAiUrlImportItem::query()
            ->where('blog_ai_bulk_job_id', $job->id)
            ->selectRaw('status, COUNT(*) as aggregate')
            ->groupBy('status')
            ->pluck('aggregate', 'status');
        $processingItem = null;

        $metadataJobId = (int) ($metadata['current_job_id'] ?? 0);
        $metadataItemId = (int) ($metadata['current_item_id'] ?? 0);
        if ($metadataJobId === (int) $job->id && $metadataItemId > 0) {
            $processingItem = BlogAiUrlImportItem::query()
                ->where('blog_ai_bulk_job_id', $job->id)
                ->whereKey($metadataItemId)
                ->first();
        }

        if (!$processingItem) {
            $processingItem = BlogAiUrlImportItem::query()
                ->where('blog_ai_bulk_job_id', $job->id)
                ->where('status', BlogAiUrlImportItem::STATUS_PROCESSING)
                ->orderBy('position')
                ->orderBy('id')
                ->first();
        }

        $pending = (int) ($counts[BlogAiUrlImportItem::STATUS_PENDING] ?? 0);
        $processing = (int) ($counts[BlogAiUrlImportItem::STATUS_PROCESSING] ?? 0);
        $completed = (int) ($counts[BlogAiUrlImportItem::STATUS_COMPLETED] ?? 0);
        $failed = (int) ($counts[BlogAiUrlImportItem::STATUS_FAILED] ?? 0);
        $total = $pending + $processing + $completed + $failed;

        return [
            'id' => (int) $job->id,
            'source_url' => $job->metadata['source_url'] ?? $job->source_path,
            'status' => $job->status,
            'current_step' => $metadata['current_step'] ?? null,
            'current_item' => $processingItem ? [
                'id' => (int) $processingItem->id,
                'position' => (int) $processingItem->position,
                'source_title' => $processingItem->source_title,
                'source_url' => $processingItem->source_url,
                'status' => $processingItem->status,
            ] : null,
            'total_items' => $total,
            'pending_items' => $pending,
            'processing_items' => $processing,
            'completed_items' => $completed,
            'failed_items' => $failed,
            'remaining_items' => $pending + $processing,
            'ai_requests_used' => (int) ($summary['ai_requests_used'] ?? 0),
            'max_ai_requests' => (int) ($summary['max_ai_requests'] ?? $job->metadata['max_ai_requests'] ?? 0),
            'ai_total_tokens_used' => (int) ($summary['ai_total_tokens_used'] ?? 0),
            'updated_at' => $job->updated_at?->toIso8601String(),
        ];
    }

    private function readMetadata(): array
    {
        $path = $this->metadataPath();
        if (!is_file($path)) {
            return [];
        }

        $decoded = json_decode((string) File::get($path), true);

        return is_array($decoded) ? $decoded : [];
    }

    private function writeMetadata(array $metadata): void
    {
        $path = $this->metadataPath();
        $directory = dirname($path);

        if (!is_dir($directory)) {
            File::ensureDirectoryExists($directory);
        }

        File::put($path, json_encode($metadata, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), true);
    }
}
