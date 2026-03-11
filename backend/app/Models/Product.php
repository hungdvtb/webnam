<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Product extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'type', 'name', 'slug', 'description', 'price', 'cost_price', 'special_price', 'special_price_from', 'special_price_to', 
        'category_id', 'stock_quantity', 'status', 'is_featured', 'is_new', 'sku', 'account_id',
        'meta_title', 'meta_description', 'meta_keywords', 'weight'
    ];

    protected $appends = ['average_rating', 'current_price', 'main_image'];

    public function reviews()
    {
        return $this->hasMany(ProductReview::class);
    }

    public function approvedReviews()
    {
        return $this->hasMany(ProductReview::class)->where('is_approved', true);
    }

    public function getAverageRatingAttribute()
    {
        return $this->approvedReviews()->avg('rating') ?: 0;
    }

    public function getCurrentPriceAttribute()
    {
        $now = now();
        if ($this->special_price && 
            (!$this->special_price_from || $this->special_price_from <= $now) && 
            (!$this->special_price_to || $this->special_price_to >= $now)) {
            return $this->special_price;
        }
        return $this->price;
    }

    public function getMainImageAttribute()
    {
        $primary = $this->images()->where('is_primary', true)->first();
        if ($primary) return $primary->image_url;
        
        $first = $this->images()->first();
        return $first ? $first->image_url : null;
    }

    public function category()
    {
        return $this->belongsTo(Category::class);
    }

    /**
     * Parent's linked items (Children, variations, grouped items, relations)
     */
    public function linkedProducts()
    {
        return $this->belongsToMany(Product::class, 'product_links', 'product_id', 'linked_product_id')
                    ->withPivot(['link_type', 'position'])
                    ->withTimestamps();
    }

    /**
     * Configurable product's super attributes (e.g. Size, Color)
     */
    public function superAttributes()
    {
        return $this->belongsToMany(Attribute::class, 'product_super_attributes', 'product_id', 'attribute_id')
                    ->withPivot(['position'])
                    ->withTimestamps();
    }

    /**
     * EAV Attribute Values (Custom attributes like Artist, Story...)
     */
    public function attributeValues()
    {
        return $this->hasMany(\App\Models\ProductAttributeValue::class);
    }

    public function images()
    {
        return $this->hasMany(ProductImage::class);
    }

    public function groups()
    {
        return $this->belongsToMany(ProductGroup::class, 'product_group_items')
                    ->withPivot(['quantity', 'is_required']);
    }
}
