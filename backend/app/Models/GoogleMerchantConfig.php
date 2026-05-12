<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class GoogleMerchantConfig extends Model
{
    protected $fillable = [
        'account_id',
        'enabled',
        'merchant_id',
        'data_source_id',
        'data_source_name',
        'developer_email',
        'credential_type',
        'service_account_json',
        'service_account_manifest_name',
        'oauth_client_id',
        'oauth_client_secret',
        'oauth_refresh_token',
        'access_token',
        'content_language',
        'feed_label',
        'currency',
        'offer_id_field',
        'product_url_base',
        'default_brand',
        'default_google_product_category',
        'inactive_action',
    ];

    protected $casts = [
        'enabled' => 'boolean',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }
}
