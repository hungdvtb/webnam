<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PublicCategoryNode extends Model
{
    protected $fillable = [
        'site_domain_id',
        'parent_id',
        'title',
        'slug',
        'status',
        'sort_order',
        'metadata',
    ];

    protected $casts = [
        'site_domain_id' => 'integer',
        'parent_id' => 'integer',
        'status' => 'boolean',
        'sort_order' => 'integer',
        'metadata' => 'array',
    ];

    public function siteDomain()
    {
        return $this->belongsTo(SiteDomain::class);
    }

    public function parent()
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children()
    {
        return $this->hasMany(self::class, 'parent_id')
            ->orderBy('sort_order')
            ->orderBy('id');
    }

    public function categories()
    {
        return $this->belongsToMany(Category::class, 'public_category_node_categories')
            ->withPivot('sort_order')
            ->withTimestamps()
            ->orderBy('public_category_node_categories.sort_order')
            ->orderBy('categories.id');
    }
}
