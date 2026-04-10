<?php

return [
    'queue_connection' => env('PRODUCT_SEO_BULK_QUEUE_CONNECTION', env('QUEUE_CONNECTION', 'database')),
    'queue_name' => env('PRODUCT_SEO_BULK_QUEUE_NAME', 'ai-seo-bulk'),
    'worker' => [
        'auto_start' => env('PRODUCT_SEO_BULK_AUTO_START_WORKER', true),
        'php_binary' => env('PRODUCT_SEO_BULK_PHP_BINARY'),
        'sleep' => (int) env('PRODUCT_SEO_BULK_WORKER_SLEEP', 1),
        'timeout' => (int) env('PRODUCT_SEO_BULK_WORKER_TIMEOUT', 300),
        'tries' => (int) env('PRODUCT_SEO_BULK_WORKER_TRIES', 1),
        'heartbeat_ttl' => (int) env('PRODUCT_SEO_BULK_WORKER_HEARTBEAT_TTL', 420),
        'idle_heartbeat_ttl' => (int) env('PRODUCT_SEO_BULK_WORKER_IDLE_HEARTBEAT_TTL', 2),
        'boot_wait_ms' => (int) env('PRODUCT_SEO_BULK_WORKER_BOOT_WAIT_MS', 1500),
        'metadata_path' => env('PRODUCT_SEO_BULK_WORKER_METADATA_PATH', storage_path('app/product-seo-bulk-worker-v2.json')),
    ],
];
