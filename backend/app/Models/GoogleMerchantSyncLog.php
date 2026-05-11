<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class GoogleMerchantSyncLog extends Model
{
    protected $fillable = [
        'account_id',
        'product_id',
        'offer_id',
        'action',
        'status',
        'request_method',
        'request_url',
        'request_payload',
        'response_status',
        'response_body',
        'error_message',
        'duration_ms',
    ];

    protected $casts = [
        'request_payload' => 'array',
        'response_body' => 'array',
        'response_status' => 'integer',
        'duration_ms' => 'integer',
    ];
}
