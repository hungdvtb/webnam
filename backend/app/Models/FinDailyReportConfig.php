<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FinDailyReportConfig extends Model
{
    protected $fillable = [
        'return_rate',
        'packaging_fee',
        'shipping_estimate_rate',
        'shipping_fee_type',
        'tax_rate',
        'fb_access_token',
        'fb_ad_account_ids',
        'fb_tax_rate',
        'fb_tokens_configs'
    ];

    protected $casts = [
        'fb_tokens_configs' => 'array'
    ];
}
