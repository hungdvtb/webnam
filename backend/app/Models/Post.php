<?php

namespace App\Models;

use App\Services\MediaService;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

class Post extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'account_id',
        'blog_category_id',
        'title',
        'slug',
        'seo_keyword',
        'content',
        'excerpt',
        'featured_image',
        'featured_media_asset_id',
        'is_system',
        'is_published',
        'is_starred',
        'sort_order',
        'published_at'
    ];

    protected $hidden = [
        'search_text',
    ];

    protected $appends = [
        'featured_image_media',
    ];

    protected $casts = [
        'blog_category_id' => 'integer',
        'featured_media_asset_id' => 'integer',
        'is_system' => 'boolean',
        'is_published' => 'boolean',
        'is_starred' => 'boolean',
        'sort_order' => 'integer',
        'published_at' => 'datetime',
        'deleted_at' => 'datetime',
    ];

    protected $attributes = [
        'is_system' => false,
        'is_published' => true,
        'is_starred' => false,
        'sort_order' => 0,
    ];

    protected static function booted(): void
    {
        static::saving(function (Post $post) {
            $post->search_text = self::buildSearchText(
                $post->title,
                $post->slug,
                $post->excerpt,
                $post->content
            );
        });

        static::forceDeleted(function (Post $post): void {
            if ($post->featured_media_asset_id) {
                app(MediaService::class)->deleteAsset($post->featured_media_asset_id);
            }
        });
    }

    public function scopePublished($query)
    {
        return $query->where('is_published', true)
                     ->where(function ($q) {
                         $q->whereNull('published_at')
                           ->orWhere('published_at', '<=', now());
                     });
    }

    public function account()
    {
        return $this->belongsTo(Account::class);
    }

    public function category()
    {
        return $this->belongsTo(BlogCategory::class, 'blog_category_id');
    }

    public function featuredMediaAsset()
    {
        return $this->belongsTo(MediaAsset::class, 'featured_media_asset_id');
    }

    public function getFeaturedImageAttribute($value): ?string
    {
        if ($this->relationLoaded('featuredMediaAsset') && $this->featuredMediaAsset) {
            return app(MediaService::class)->buildAssetUrl($this->featuredMediaAsset, 'large');
        }

        return app(MediaService::class)->normalizeLegacyUrl($value);
    }

    public function getFeaturedImageMediaAttribute(): ?array
    {
        return app(MediaService::class)->buildAssetPayload($this->featuredMediaAsset, $this->getRawOriginal('featured_image'));
    }

    public static function buildSearchText(
        ?string $title,
        ?string $slug,
        ?string $excerpt,
        ?string $content
    ): string {
        $plainContent = html_entity_decode(strip_tags((string) $content), ENT_QUOTES | ENT_HTML5, 'UTF-8');

        $searchText = collect([
            $title,
            $slug,
            $excerpt,
            $plainContent,
        ])
            ->map(fn ($segment) => trim((string) $segment))
            ->filter()
            ->implode(' ');

        return Str::of($searchText)
            ->replaceMatches('/\s+/u', ' ')
            ->trim()
            ->value();
    }
}
