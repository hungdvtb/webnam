<?php

namespace App\Models;

use App\Services\MediaService;
use Illuminate\Database\Eloquent\Model;

class ProductImage extends Model
{
    protected $fillable = [
        'product_id',
        'media_asset_id',
        'image_url',
        'is_primary',
        'sort_order',
        'file_name',
        'file_size',
    ];

    protected $casts = [
        'media_asset_id' => 'integer',
        'is_primary' => 'boolean',
        'sort_order' => 'integer',
        'file_size' => 'integer',
    ];

    protected $appends = [
        'thumbnail_url',
        'medium_url',
        'large_url',
        'width',
        'height',
        'srcset',
    ];

    protected static function booted(): void
    {
        static::deleted(function (ProductImage $image): void {
            if ($image->media_asset_id) {
                app(MediaService::class)->deleteAsset($image->media_asset_id);
            }
        });
    }

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function mediaAsset()
    {
        return $this->belongsTo(MediaAsset::class, 'media_asset_id');
    }

    public function getImageUrlAttribute($value): ?string
    {
        $asset = $this->resolvedMediaAsset();
        if ($asset) {
            return app(MediaService::class)->buildAssetUrl($asset, 'large');
        }

        return $value;
    }

    public function getThumbnailUrlAttribute(): string
    {
        $asset = $this->resolvedMediaAsset();

        return $asset
            ? app(MediaService::class)->buildAssetUrl($asset, 'thumbnail')
            : (string) $this->image_url;
    }

    public function getMediumUrlAttribute(): string
    {
        $asset = $this->resolvedMediaAsset();

        return $asset
            ? app(MediaService::class)->buildAssetUrl($asset, 'medium')
            : (string) $this->image_url;
    }

    public function getLargeUrlAttribute(): string
    {
        $asset = $this->resolvedMediaAsset();

        return $asset
            ? app(MediaService::class)->buildAssetUrl($asset, 'large')
            : (string) $this->image_url;
    }

    public function getWidthAttribute(): ?int
    {
        return $this->resolvedMediaAsset()?->width;
    }

    public function getHeightAttribute(): ?int
    {
        return $this->resolvedMediaAsset()?->height;
    }

    public function getSrcsetAttribute(): string
    {
        $asset = $this->resolvedMediaAsset();

        return $asset
            ? app(MediaService::class)->buildSrcset($asset)
            : '';
    }

    private function resolvedMediaAsset(): ?MediaAsset
    {
        if ($this->relationLoaded('mediaAsset')) {
            return $this->mediaAsset;
        }

        if ($this->media_asset_id) {
            return $this->mediaAsset()->first();
        }

        $publicId = app(MediaService::class)->extractPublicIdFromUrl($this->getRawOriginal('image_url'));
        if (!$publicId) {
            return null;
        }

        return MediaAsset::query()->where('public_id', $publicId)->first();
    }
}
