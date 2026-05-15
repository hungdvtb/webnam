<?php

$enabled = env('META_CONVERSIONS_ENABLED', true);
if (is_string($enabled)) {
    $enabled = filter_var($enabled, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? true;
}

$verifySsl = env('META_CONVERSIONS_VERIFY_SSL', true);
if (is_string($verifySsl)) {
    $verifySsl = filter_var($verifySsl, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? true;
}

return [
    'enabled' => (bool) $enabled,
    'pixel_id' => env('META_PIXEL_ID', env('META_CONVERSIONS_PIXEL_ID', '2786270608428787')),
    'access_token' => env('META_ACCESS_TOKEN', env('META_CONVERSIONS_ACCESS_TOKEN', env('META_CAPI_ACCESS_TOKEN'))),
    'graph_api_version' => env('META_CONVERSIONS_GRAPH_API_VERSION', env('META_GRAPH_API_VERSION', 'v25.0')),
    'test_event_code' => env('META_TEST_EVENT_CODE', env('META_CONVERSIONS_TEST_EVENT_CODE')),
    'currency' => env('META_CONVERSIONS_CURRENCY', 'VND'),
    'timeout' => (int) env('META_CONVERSIONS_TIMEOUT', 10),
    'connect_timeout' => (int) env('META_CONVERSIONS_CONNECT_TIMEOUT', 5),
    'verify_ssl' => (bool) $verifySsl,
];
