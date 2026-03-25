<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Post extends Model
{
    protected $fillable = [
        'account_id',
        'blog_category_id',
        'title',
        'slug',
        'seo_keyword',
        'content',
        'excerpt',
        'featured_image',
        'is_system',
        'is_published',
        'is_starred',
        'sort_order',
        'published_at'
    ];

    protected $hidden = [
        'search_text',
    ];

    protected $casts = [
        'blog_category_id' => 'integer',
        'is_system' => 'boolean',
        'is_published' => 'boolean',
        'is_starred' => 'boolean',
        'sort_order' => 'integer',
        'published_at' => 'datetime',
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
