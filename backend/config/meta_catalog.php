<?php

$enabled = env('META_CATALOG_SYNC_ENABLED', false);
if (is_string($enabled)) {
    $enabled = filter_var($enabled, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
}

$deleteStale = env('META_CATALOG_DELETE_STALE', true);
if (is_string($deleteStale)) {
    $deleteStale = filter_var($deleteStale, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? true;
}

$pollStatus = env('META_CATALOG_POLL_STATUS', true);
if (is_string($pollStatus)) {
    $pollStatus = filter_var($pollStatus, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? true;
}

$verifySsl = env('META_CATALOG_VERIFY_SSL', true);
if (is_string($verifySsl)) {
    $verifySsl = filter_var($verifySsl, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? true;
}

return [
    'enabled' => (bool) $enabled,

    'app_id' => env('META_APP_ID'),
    'catalog_id' => env('META_CATALOG_ID'),
    'access_token' => env('META_CATALOG_ACCESS_TOKEN'),
    'graph_api_version' => env('META_GRAPH_API_VERSION', 'v25.0'),

    'brand' => env('META_CATALOG_BRAND', 'Gốm Đại Thành'),
    'currency' => env('META_CATALOG_CURRENCY', 'VND'),
    'fallback_image_url' => env('META_CATALOG_FALLBACK_IMAGE_URL'),
    'delete_stale' => (bool) $deleteStale,

    'batch_size' => (int) env('META_CATALOG_BATCH_SIZE', 500),
    'catalog_page_limit' => (int) env('META_CATALOG_PAGE_LIMIT', 1000),
    'max_catalog_pages' => (int) env('META_CATALOG_MAX_PAGES', 1000),

    'poll_status' => (bool) $pollStatus,
    'status_poll_attempts' => (int) env('META_CATALOG_STATUS_POLL_ATTEMPTS', 8),
    'status_poll_delay_ms' => (int) env('META_CATALOG_STATUS_POLL_DELAY_MS', 1000),

    'timeout' => (int) env('META_CATALOG_TIMEOUT', 60),
    'connect_timeout' => (int) env('META_CATALOG_CONNECT_TIMEOUT', 15),
    'retry_times' => (int) env('META_CATALOG_RETRY_TIMES', 3),
    'retry_sleep_ms' => (int) env('META_CATALOG_RETRY_SLEEP_MS', 2000),
    'verify_ssl' => (bool) $verifySsl,
];
