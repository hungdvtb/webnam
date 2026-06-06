<?php

return [
    'enabled' => filter_var(env('PRODUCT_REVIEW_AI_ENABLED', true), FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? true,
    'min_reviews' => (int) env('PRODUCT_REVIEW_AI_MIN_REVIEWS', 90),
    'max_reviews' => (int) env('PRODUCT_REVIEW_AI_MAX_REVIEWS', 100),
    'batch_size' => (int) env('PRODUCT_REVIEW_AI_BATCH_SIZE', 20),
    'delay_minutes' => (int) env('PRODUCT_REVIEW_AI_DELAY_MINUTES', 3),
    'queue_connection' => env('PRODUCT_REVIEW_AI_QUEUE_CONNECTION', env('QUEUE_CONNECTION', 'database')),
    'queue_name' => env('PRODUCT_REVIEW_AI_QUEUE_NAME', 'default'),
    'model' => env('PRODUCT_REVIEW_AI_MODEL'),
];
