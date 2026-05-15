<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MetaCatalogConfig extends Model
{
    protected $fillable = [
        'account_id',
        'enabled',
        'app_id',
        'catalog_id',
        'access_token',
        'graph_api_version',
        'brand',
        'currency',
        'fallback_image_url',
        'delete_stale',
        'sync_frequency',
    ];

    protected $casts = [
        'enabled' => 'boolean',
        'delete_stale' => 'boolean',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }
}
