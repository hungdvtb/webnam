<?php

$enabled = env('GOOGLE_MERCHANT_SYNC_ENABLED', false);
if (is_string($enabled)) {
    $enabled = filter_var($enabled, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
}

$verifySsl = env('GOOGLE_MERCHANT_VERIFY_SSL', true);
if (is_string($verifySsl)) {
    $verifySsl = filter_var($verifySsl, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? true;
}

return [
    'enabled' => (bool) $enabled,

    'account_id' => env('GOOGLE_MERCHANT_ACCOUNT_ID', '5784047046'),
    'data_source_id' => env('GOOGLE_MERCHANT_DATA_SOURCE_ID'),
    'data_source_name' => env('GOOGLE_MERCHANT_DATA_SOURCE_NAME'),
    'developer_email' => env('GOOGLE_MERCHANT_DEVELOPER_EMAIL'),

    'credential_type' => env('GOOGLE_MERCHANT_CREDENTIAL_TYPE', 'service_account'),
    'service_account_json_path' => env('GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON_PATH'),
    'service_account_json' => env('GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON'),
    'oauth_client_id' => env('GOOGLE_MERCHANT_OAUTH_CLIENT_ID'),
    'oauth_client_secret' => env('GOOGLE_MERCHANT_OAUTH_CLIENT_SECRET'),
    'oauth_refresh_token' => env('GOOGLE_MERCHANT_OAUTH_REFRESH_TOKEN'),
    'access_token' => env('GOOGLE_MERCHANT_ACCESS_TOKEN'),

    'content_language' => env('GOOGLE_MERCHANT_CONTENT_LANGUAGE', 'vi'),
    'feed_label' => env('GOOGLE_MERCHANT_FEED_LABEL', 'VN'),
    'currency' => env('GOOGLE_MERCHANT_CURRENCY', 'VND'),
    'offer_id_field' => env('GOOGLE_MERCHANT_OFFER_ID_FIELD', 'sku'),

    'product_url_base' => env('GOOGLE_MERCHANT_PRODUCT_URL_BASE', env('FRONTEND_WEBSITE_URL')),
    'default_brand' => env('GOOGLE_MERCHANT_DEFAULT_BRAND', 'Gom Dai Thanh'),
    'default_google_product_category' => env('GOOGLE_MERCHANT_DEFAULT_GOOGLE_PRODUCT_CATEGORY'),
    'inactive_action' => env('GOOGLE_MERCHANT_INACTIVE_ACTION', 'out_of_stock'),

    'queue_connection' => env('GOOGLE_MERCHANT_QUEUE_CONNECTION', 'sync'),
    'queue_name' => env('GOOGLE_MERCHANT_QUEUE_NAME', 'google-merchant'),

    'timeout' => (int) env('GOOGLE_MERCHANT_TIMEOUT', 30),
    'connect_timeout' => (int) env('GOOGLE_MERCHANT_CONNECT_TIMEOUT', 10),
    'verify_ssl' => $verifySsl,
];
