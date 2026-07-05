<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FinDailyReportConfig extends Model
{
    protected $fillable = [
        'account_id',
        'return_rate',
        'packaging_fee',
        'shipping_estimate_rate',
        'shipping_fee_type',
        'tax_rate',
        'fb_access_token',
        'fb_ad_account_ids',
        'fb_tax_rate',
        'fb_tokens_configs',
        'google_developer_token',
        'google_client_id',
        'google_client_secret',
        'google_refresh_token',
        'google_login_customer_id',
        'google_customer_ids',
        'google_tax_rate',
    ];

    protected $casts = [
        'account_id' => 'integer',
        'fb_tokens_configs' => 'array'
    ];
}
