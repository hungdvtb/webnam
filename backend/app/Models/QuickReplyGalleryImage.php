<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class QuickReplyGalleryImage extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'account_id',
        'folder_id',
        'media_asset_id',
        'name',
        'search_text',
        'sort_order',
        'use_count',
        'is_favorite',
        'last_used_at',
        'metadata',
    ];

    protected $casts = [
        'account_id' => 'integer',
        'folder_id' => 'integer',
        'media_asset_id' => 'integer',
        'sort_order' => 'integer',
        'use_count' => 'integer',
        'is_favorite' => 'boolean',
        'last_used_at' => 'datetime',
        'metadata' => 'array',
        'deleted_at' => 'datetime',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }

    public function folder()
    {
        return $this->belongsTo(QuickReplyImageFolder::class, 'folder_id');
    }

    public function mediaAsset()
    {
        return $this->belongsTo(MediaAsset::class);
    }
}
