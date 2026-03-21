<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

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
}
