<?php

$splitCsv = static function (?string $value): array {
    return array_values(array_filter(
        array_map(
            static fn ($item) => trim((string) $item),
            explode(',', (string) $value)
        ),
        static fn ($item) => $item !== ''
    ));
};

$allowedOrigins = array_values(array_unique(array_merge(
    [
        'http://localhost:3000',
        'http://localhost:3003',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3003',
        'http://127.0.0.1:5173',
        'https://gomdaithanh.com',
        'https://www.gomdaithanh.com',
        'https://admin.gomdaithanh.com',
    ],
    array_filter([
        env('APP_URL'),
        env('FRONTEND_URL'),
        env('FRONTEND_WEBSITE_URL'),
    ]),
    $splitCsv(env('ALLOWED_ORIGINS', ''))
)));

$allowedOriginPatterns = array_values(array_unique(array_merge(
    [
        '#^https?://localhost(?::\d+)?$#i',
        '#^https?://127(?:\.\d{1,3}){3}(?::\d+)?$#',
        '#^https?://\[::1\](?::\d+)?$#i',
        '#^https?://(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?$#',
        '#^https://(?:[a-z0-9-]+\.)*gomdaithanh\.com$#i',
    ],
    $splitCsv(env('ALLOWED_ORIGIN_PATTERNS', ''))
)));

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    | To learn more: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
    |
    */

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => $allowedOrigins,

    'allowed_origins_patterns' => $allowedOriginPatterns,

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 3600,

    'supports_credentials' => true,

];
