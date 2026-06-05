<?php

return [
    'queue_connection' => env('BLOG_AI_URL_QUEUE_CONNECTION', env('QUEUE_CONNECTION', 'database')),
    'queue_name' => env('BLOG_AI_URL_QUEUE_NAME', 'blog-ai-url'),
    'batch_size' => (int) env('BLOG_AI_URL_BATCH_SIZE', 3),
    'item_timeout_seconds' => (int) env('BLOG_AI_URL_ITEM_TIMEOUT_SECONDS', 900),
    'crawl' => [
        'timeout' => (int) env('BLOG_AI_URL_CRAWL_TIMEOUT', 45),
        'connect_timeout' => (int) env('BLOG_AI_URL_CRAWL_CONNECT_TIMEOUT', 12),
        'retry_attempts' => (int) env('BLOG_AI_URL_CRAWL_RETRY_ATTEMPTS', 2),
        'retry_delay_ms' => (int) env('BLOG_AI_URL_CRAWL_RETRY_DELAY_MS', 1500),
    ],
    'ai' => [
        'timeout' => (int) env('BLOG_AI_URL_GEMINI_TIMEOUT', 120),
        'connect_timeout' => (int) env('BLOG_AI_URL_GEMINI_CONNECT_TIMEOUT', 15),
        'max_api_keys' => (int) env('BLOG_AI_URL_GEMINI_MAX_API_KEYS', 1),
        'max_model_candidates' => (int) env('BLOG_AI_URL_GEMINI_MAX_MODEL_CANDIDATES', 1),
        'transient_retry_delays_ms' => array_values(array_filter(
            array_map('intval', preg_split('/[\s,;]+/', (string) env('BLOG_AI_URL_GEMINI_RETRY_DELAYS_MS', '2500')) ?: []),
            fn (int $delayMs) => $delayMs >= 0
        )),
    ],
    'worker' => [
        'auto_start' => env('BLOG_AI_URL_AUTO_START_WORKER', true),
        'php_binary' => env('BLOG_AI_URL_WORKER_PHP_BINARY'),
        'sleep' => (int) env('BLOG_AI_URL_WORKER_SLEEP', 1),
        'lock_ttl' => (int) env('BLOG_AI_URL_WORKER_LOCK_TTL', 900),
        'heartbeat_ttl' => (int) env('BLOG_AI_URL_WORKER_HEARTBEAT_TTL', 420),
        'idle_heartbeat_ttl' => (int) env('BLOG_AI_URL_WORKER_IDLE_HEARTBEAT_TTL', 15),
        'boot_wait_ms' => (int) env('BLOG_AI_URL_WORKER_BOOT_WAIT_MS', 1200),
        'metadata_path' => env('BLOG_AI_URL_WORKER_METADATA_PATH', storage_path('app/blog-ai-url-worker.json')),
    ],
];
