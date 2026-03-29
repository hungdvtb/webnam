<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'gemini' => [
        'base_url' => env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/'),
        'default_model' => env('GEMINI_MODEL', 'gemini-2.5-flash'),
        'ca_bundle_path' => env('GEMINI_CA_BUNDLE_PATH'),
        'verify_ssl' => env('GEMINI_VERIFY_SSL', true),
        'timeout' => env('GEMINI_TIMEOUT', 60),
        'connect_timeout' => env('GEMINI_CONNECT_TIMEOUT', 15),
    ],

    'blog_bundle' => [
        'ca_bundle_path' => env('BLOG_EXPORT_CA_BUNDLE_PATH'),
        'verify_ssl' => env('BLOG_EXPORT_VERIFY_SSL', true),
    ],

];
