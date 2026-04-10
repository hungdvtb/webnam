<?php

namespace Tests\Unit;

use App\Services\AI\ProductSeoBulkQueueWorkerService;
use Tests\TestCase;

class ProductSeoBulkQueueWorkerServiceStatusTest extends TestCase
{
    private ?string $metadataPath = null;

    protected function tearDown(): void
    {
        if ($this->metadataPath && is_file($this->metadataPath)) {
            @unlink($this->metadataPath);
        }

        parent::tearDown();
    }

    public function test_it_marks_error_heartbeat_metadata_as_not_running(): void
    {
        $this->metadataPath = storage_path('framework/testing/product-seo-bulk-worker-status.json');
        $directory = dirname($this->metadataPath);

        if (! is_dir($directory)) {
            mkdir($directory, 0777, true);
        }

        file_put_contents($this->metadataPath, json_encode([
            'status' => 'error',
            'heartbeat_at' => now()->toIso8601String(),
            'last_error' => 'Worker loop failed.',
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        config([
            'product_seo_bulk.queue_connection' => 'database',
            'product_seo_bulk.worker.metadata_path' => $this->metadataPath,
            'product_seo_bulk.worker.idle_heartbeat_ttl' => 60,
        ]);

        $status = app(ProductSeoBulkQueueWorkerService::class)->status();

        $this->assertFalse($status['running']);
        $this->assertTrue($status['heartbeat_fresh']);
        $this->assertSame('error', $status['state']);
        $this->assertSame('Worker loop failed.', $status['last_error']);
    }
}
