<?php

namespace App\Models;

use App\Services\MediaService;
use Illuminate\Database\Eloquent\Model;

class Banner extends Model
{
    protected $fillable = [
        'account_id',
        'title',
        'subtitle',
        'image_url',
        'media_asset_id',
        'link_url',
        'button_text',
        'sort_order',
        'is_active',
    ];

    protected $casts = [
        'media_asset_id' => 'integer',
        'is_active' => 'boolean',
        'sort_order' => 'integer',
    ];

    protected $appends = [
        'image',
    ];

    protected static function booted(): void
    {
        static::deleted(function (Banner $banner): void {
            if ($banner->media_asset_id) {
                app(MediaService::class)->deleteAsset($banner->media_asset_id);
            }
        });
    }

    public function mediaAsset()
    {
        return $this->belongsTo(MediaAsset::class, 'media_asset_id');
    }

    public function getImageUrlAttribute($value): ?string
    {
        if ($this->relationLoaded('mediaAsset') && $this->mediaAsset) {
            return app(MediaService::class)->buildAssetUrl($this->mediaAsset, 'large');
        }

        return app(MediaService::class)->normalizeLegacyUrl($value);
    }

    public function getImageAttribute(): ?array
    {
        return app(MediaService::class)->buildAssetPayload($this->mediaAsset, $this->getRawOriginal('image_url'));
    }
}
