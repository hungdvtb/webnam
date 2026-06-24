<?php

$mediaHttpVerify = env('MEDIA_HTTP_VERIFY_SSL', true);

if (is_string($mediaHttpVerify)) {
    $mediaHttpVerify = filter_var($mediaHttpVerify, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? true;
}

$mediaHttpCaBundle = trim((string) env('MEDIA_HTTP_CA_BUNDLE', ''));

return [
    'disk' => env('MEDIA_DISK', 'r2'),

    'public_base_url' => env('MEDIA_PUBLIC_BASE_URL'),

    'route_prefix' => trim((string) env('MEDIA_ROUTE_PREFIX', 'media/assets'), '/'),

    'quality' => [
        'webp' => (int) env('MEDIA_WEBP_QUALITY', 78),
        'jpeg' => (int) env('MEDIA_JPEG_QUALITY', 80),
        'png' => (int) env('MEDIA_PNG_COMPRESSION', 6),
    ],

    'sizes' => [
        'thumbnail' => (int) env('MEDIA_THUMBNAIL_WIDTH', 300),
        'medium' => (int) env('MEDIA_MEDIUM_WIDTH', 800),
        'large' => (int) env('MEDIA_LARGE_WIDTH', 1600),
    ],

    'http' => [
        'verify' => $mediaHttpVerify
            ? ($mediaHttpCaBundle !== '' ? $mediaHttpCaBundle : true)
            : false,
        'connect_timeout' => (float) env('MEDIA_HTTP_CONNECT_TIMEOUT', 5),
        'timeout' => (float) env('MEDIA_HTTP_TIMEOUT', 15),
    ],
];
