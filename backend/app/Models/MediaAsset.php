<?php

namespace App\Models;

use App\Services\MediaService;
use Illuminate\Database\Eloquent\Model;

class MediaAsset extends Model
{
    protected $fillable = [
        'public_id',
        'disk',
        'collection',
        'original_name',
        'original_extension',
        'mime_type',
        'width',
        'height',
        'size_bytes',
        'variants',
        'metadata',
    ];

    protected $casts = [
        'width' => 'integer',
        'height' => 'integer',
        'size_bytes' => 'integer',
        'variants' => 'array',
        'metadata' => 'array',
    ];

    protected $appends = [
        'url',
        'image_url',
        'thumbnail_url',
        'medium_url',
        'large_url',
        'original_url',
        'srcset',
    ];

    public function getUrlAttribute(): string
    {
        return app(MediaService::class)->buildAssetUrl($this, 'large');
    }

    public function getImageUrlAttribute(): string
    {
        return $this->getUrlAttribute();
    }

    public function getThumbnailUrlAttribute(): string
    {
        return app(MediaService::class)->buildAssetUrl($this, 'thumbnail');
    }

    public function getMediumUrlAttribute(): string
    {
        return app(MediaService::class)->buildAssetUrl($this, 'medium');
    }

    public function getLargeUrlAttribute(): string
    {
        return app(MediaService::class)->buildAssetUrl($this, 'large');
    }

    public function getOriginalUrlAttribute(): string
    {
        return app(MediaService::class)->buildAssetUrl($this, 'original');
    }

    public function getSrcsetAttribute(): string
    {
        return app(MediaService::class)->buildSrcset($this);
    }
}
