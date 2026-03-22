<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Product extends Model
{
    use \App\Traits\BelongsToAccount, SoftDeletes;

    protected $fillable = [
        'type', 'name', 'slug', 'description', 'specifications', 'price', 'price_type', 'cost_price', 'expected_cost', 'special_price', 'special_price_from', 'special_price_to', 
        'category_id', 'stock_quantity', 'damaged_quantity', 'status', 'is_featured', 'is_new', 'sku', 'account_id',
        'meta_title', 'meta_description', 'meta_keywords', 'weight', 'inventory_unit_id', 'supplier_id', 'video_url', 'additional_info', 'bundle_title', 'site_domain_id'
    ];

    public function siteDomain()
    {
        return $this->belongsTo(SiteDomain::class);
    }

    protected $attributes = [
        'status' => true,
        'is_new' => true,
        'is_featured' => false,
    ];

    protected $appends = ['average_rating', 'current_price', 'main_image', 'primary_image', 'inventory_display_cost', 'inventory_cost_source'];

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
        // Try eager loaded primary image first
        $image = $this->images->where('is_primary', true)->first() ?: $this->images->sortBy('sort_order')->first();
        
        if (!$image) return null;
        
        $url = $image->image_url;
        // If it's a relative path, we might need a full URL, but better to let frontend handle it or provide a consistent field
        return $url;
    }

    public function getPrimaryImageAttribute()
    {
        $image = $this->images->where('is_primary', true)->first() ?: $this->images->sortBy('sort_order')->first();
        if (!$image) return null;
        
        return [
            'id' => $image->id,
            'url' => $image->image_url,
            'path' => $image->image_url, // For compatibility with frontend expecting .path
            'is_primary' => $image->is_primary
        ];
    }

    public function category()
    {
        return $this->belongsTo(Category::class);
    }

    public function supplier()
    {
        return $this->belongsTo(Supplier::class);
    }

    public function unit()
    {
        return $this->belongsTo(InventoryUnit::class, 'inventory_unit_id');
    }

    public function suppliers()
    {
        return $this->belongsToMany(Supplier::class, 'product_suppliers')
            ->withPivot(['account_id'])
            ->withTimestamps();
    }

    public function categories()
    {
        return $this->belongsToMany(Category::class);
    }

    /**
     * Parent's linked items (Children, variations, grouped items, relations)
     */
    public function linkedProducts()
    {
        return $this->belongsToMany(Product::class, 'product_links', 'product_id', 'linked_product_id')
                    ->withPivot(['link_type', 'position', 'option_title'])
                    ->orderByPivot('position', 'asc')
                    ->withTimestamps();
    }

    /**
     * Related products (Suggestions for the user)
     */
    public function relatedProducts()
    {
        return $this->belongsToMany(Product::class, 'product_links', 'product_id', 'linked_product_id')
                    ->wherePivot('link_type', 'related')
                    ->withPivot(['link_type', 'position', 'option_title'])
                    ->orderByPivot('position', 'asc')
                    ->withTimestamps();
    }

    /**
     * Inverse of linkedProducts - find parent products
     */
    public function parentProducts()
    {
        return $this->belongsToMany(Product::class, 'product_links', 'linked_product_id', 'product_id')
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
     * Variations (Children) - linked with super_link
     */
    public function variations()
    {
        return $this->belongsToMany(Product::class, 'product_links', 'product_id', 'linked_product_id')
                    ->wherePivot('link_type', 'super_link')
                    ->withPivot(['link_type', 'position'])
                    ->orderByPivot('position', 'asc')
                    ->withTimestamps();
    }

    /**
     * Parent of this variant
     */
    public function parentConfigurable()
    {
        return $this->belongsToMany(Product::class, 'product_links', 'linked_product_id', 'product_id')
                    ->wherePivot('link_type', 'super_link')
                    ->withPivot(['link_type', 'position'])
                    ->withTimestamps();
    }

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

    public function importItems()
    {
        return $this->hasMany(ImportItem::class);
    }

    public function inventoryBatches()
    {
        return $this->hasMany(InventoryBatch::class);
    }

    public function inventoryAllocations()
    {
        return $this->hasMany(InventoryBatchAllocation::class);
    }

    public function supplierPrices()
    {
        return $this->hasMany(SupplierProductPrice::class);
    }

    public function inventoryDocumentItems()
    {
        return $this->hasMany(InventoryDocumentItem::class);
    }

    public function orderItems()
    {
        return $this->hasMany(OrderItem::class);
    }

    /**
     * Items in this product (if it's a grouped/bundle product)
     */
    public function groupedItems()
    {
        return $this->belongsToMany(Product::class, 'product_links', 'product_id', 'linked_product_id')
                    ->wherePivot('link_type', 'grouped')
                    ->withPivot(['link_type', 'quantity', 'is_required', 'position', 'variant_id', 'price', 'cost_price'])
                    ->orderByPivot('position', 'asc')
                    ->withTimestamps();
    }

    /**
     * Items in this bundle product
     */
    public function bundleItems()
    {
        return $this->belongsToMany(Product::class, 'product_links', 'product_id', 'linked_product_id')
                    ->wherePivot('link_type', 'bundle')
                    ->withPivot(['link_type', 'quantity', 'is_required', 'position', 'option_title', 'is_default', 'variant_id', 'price', 'cost_price'])
                    ->orderByPivot('position', 'asc')
                    ->withTimestamps();
    }

    /**
     * Calculate price for grouped product if type is 'sum'
     */
    public function calculateGroupPrice($removedIds = [])
    {
        if ($this->type !== 'grouped' || $this->price_type !== 'sum') {
            return $this->price;
        }

        $items = $this->groupedItems;
        $total = 0;
        foreach ($items as $item) {
            if (!in_array($item->id, $removedIds)) {
                $total += $item->price * $item->pivot->quantity;
            }
        }
        return $total;
    }

    /**
     * Calculate cost price for grouped product (Sum of components)
     */
    public function calculateGroupCostPrice()
    {
        if ($this->type !== 'grouped') {
            return $this->cost_price;
        }

        $items = $this->groupedItems;
        $total = 0;
        foreach ($items as $item) {
            $total += ($item->cost_price ?? 0) * $item->pivot->quantity;
        }
        return $total;
    }

    public function getInventoryDisplayCostAttribute()
    {
        return $this->cost_price ?? $this->expected_cost;
    }

    public function getInventoryCostSourceAttribute()
    {
        return $this->cost_price !== null ? 'current_cost' : 'expected_cost';
    }
}
