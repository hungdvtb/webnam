<?php

namespace App\Services\AI;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use RuntimeException;
use Symfony\Component\Process\PhpExecutableFinder;

class ProductSeoBulkQueueWorkerService
{
    private const START_LOCK_KEY = 'product_seo_bulk_worker_bootstrap_lock';

    public function status(): array
    {
        $metadata = $this->readMetadata();
        $lastHeartbeatAt = $metadata['heartbeat_at'] ?? null;
        $workerState = strtolower((string) ($metadata['status'] ?? ''));
        $heartbeatFresh = $this->requiresExternalWorker() ? $this->heartbeatIsFresh($lastHeartbeatAt) : true;
        $running = $this->requiresExternalWorker()
            ? ($heartbeatFresh && $workerState !== 'error')
            : true;

        return [
            'required' => $this->requiresExternalWorker(),
            'auto_start' => $this->autoStartEnabled(),
            'running' => $running,
            'heartbeat_fresh' => $heartbeatFresh,
            'state' => $workerState !== '' ? $workerState : ($running ? 'running' : 'stopped'),
            'pid' => $metadata['pid'] ?? null,
            'queue_connection' => $this->queueConnection(),
            'queue_name' => $this->queueName(),
            'command' => $metadata['command'] ?? implode(' ', $this->buildBootstrapCommand()),
            'last_started_at' => $metadata['started_at'] ?? $metadata['start_requested_at'] ?? null,
            'heartbeat_at' => $lastHeartbeatAt,
            'last_error' => $metadata['last_error'] ?? null,
            'checked_at' => now()->toIso8601String(),
        ];
    }

    public function ensureRunning(): array
    {
        $status = $this->status();

        if (! $status['required'] || ! $status['auto_start'] || $status['running']) {
            return array_merge($status, ['started_now' => false]);
        }

        $lock = Cache::lock(self::START_LOCK_KEY, 15);
        $lockAcquired = false;

        try {
            $lockAcquired = $lock->get();

            if (! $lockAcquired) {
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

            usleep((int) config('product_seo_bulk.worker.boot_wait_ms', 1500) * 1000);

            $status = $this->status();

            if (! $status['running'] && ! $status['last_error']) {
                $this->writeMetadata(array_merge($this->readMetadata(), [
                    'last_error' => 'Worker nền chưa ghi heartbeat sau khi khởi động.',
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
            'pid' => null,
            'command' => implode(' ', $this->buildBootstrapCommand()),
            'started_at' => $this->readMetadata()['started_at'] ?? now()->toIso8601String(),
            'heartbeat_at' => now()->toIso8601String(),
            'queue_connection' => $this->queueConnection(),
            'queue_name' => $this->queueName(),
        ], $attributes);

        if (! isset($metadata['started_at']) || ! $metadata['started_at']) {
            $metadata['started_at'] = now()->toIso8601String();
        }

        if (! isset($metadata['heartbeat_at']) || ! $metadata['heartbeat_at']) {
            $metadata['heartbeat_at'] = now()->toIso8601String();
        }

        $this->writeMetadata($metadata);
    }

    public function requiresExternalWorker(): bool
    {
        return ! in_array($this->queueConnection(), ['sync', 'deferred', 'background', 'null'], true);
    }

    public function queueConnection(): string
    {
        return (string) config('product_seo_bulk.queue_connection', config('queue.default', 'database'));
    }

    public function queueName(): string
    {
        return (string) config('product_seo_bulk.queue_name', 'ai-seo-bulk');
    }

    public function workerCommandSignature(): string
    {
        return 'product-seo-bulk:work';
    }

    public function phpBinary(): string
    {
        return $this->resolvePhpBinary();
    }

    private function autoStartEnabled(): bool
    {
        return (bool) config('product_seo_bulk.worker.auto_start', true);
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
            $result = Process::path(base_path())->run('"C:\\Windows\\System32\\cmd.exe" /c '.$this->buildWindowsDetachedStartCommand());

            if (! $result->successful()) {
                throw new RuntimeException(trim($result->errorOutput() ?: $result->output()) ?: 'Không thể tự khởi động worker nền.');
            }

            return;
        }

        Process::path(base_path())
            ->forever()
            ->start($this->buildBootstrapCommand());
    }

    private function buildWindowsDetachedStartCommand(): string
    {
        $escape = static fn (string $value): string => '"'.str_replace('"', '""', $value).'"';

        return 'start "" /B '.implode(' ', array_map($escape, $this->buildBootstrapCommand()));
    }

    private function resolvePhpBinary(): string
    {
        $configuredBinary = trim((string) config('product_seo_bulk.worker.php_binary', ''));
        if ($configuredBinary !== '') {
            return $configuredBinary;
        }

        $phpBinary = PHP_BINARY;
        if ($phpBinary !== '') {
            $phpBinaryFilename = basename($phpBinary);
            if (str_contains(strtolower($phpBinaryFilename), 'php-cgi')) {
                $candidate = dirname($phpBinary).DIRECTORY_SEPARATOR.'php.exe';
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
        return (string) config('product_seo_bulk.worker.metadata_path', storage_path('app/product-seo-bulk-worker.json'));
    }

    private function heartbeatTtlSeconds(): int
    {
        return max((int) config('product_seo_bulk.worker.heartbeat_ttl', 420), 30);
    }

    private function heartbeatIsFresh(?string $heartbeatAt): bool
    {
        if (! $heartbeatAt) {
            return false;
        }

        $timestamp = strtotime($heartbeatAt);
        if ($timestamp === false) {
            return false;
        }

        $metadata = $this->readMetadata();
        $status = strtolower((string) ($metadata['status'] ?? ''));
        $idleTtlSeconds = max((int) config('product_seo_bulk.worker.idle_heartbeat_ttl', 10), 5);
        $ttlSeconds = $status === 'working' ? $this->heartbeatTtlSeconds() : $idleTtlSeconds;

        return (time() - $timestamp) <= $ttlSeconds;
    }

    private function readMetadata(): array
    {
        $path = $this->metadataPath();
        if (! is_file($path)) {
            return [];
        }

        $decoded = json_decode((string) File::get($path), true);

        return is_array($decoded) ? $decoded : [];
    }

    private function writeMetadata(array $metadata): void
    {
        $path = $this->metadataPath();
        $directory = dirname($path);

        if (! is_dir($directory)) {
            File::ensureDirectoryExists($directory);
        }

        File::put($path, json_encode($metadata, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }
}
