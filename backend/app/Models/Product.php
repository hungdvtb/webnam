<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Schema;

class Product extends Model
{
    use \App\Traits\BelongsToAccount, SoftDeletes;

    protected $fillable = [
        'type', 'name', 'slug', 'description', 'specifications', 'price', 'price_type', 'cost_price', 'expected_cost', 'special_price', 'special_price_from', 'special_price_to', 
        'imported_quantity_total', 'imported_value_total', 'category_id', 'stock_quantity', 'damaged_quantity', 'status', 'is_featured', 'is_new', 'sku', 'account_id',
        'meta_title', 'meta_description', 'meta_keywords', 'weight', 'inventory_unit_id', 'inventory_import_starred', 'supplier_id', 'video_url', 'video_urls', 'additional_info', 'bundle_title', 'site_domain_id',
        'sort_order',
        'google_merchant_sync_status', 'google_merchant_last_synced_at', 'google_merchant_last_attempted_at',
        'google_merchant_last_error', 'google_merchant_offer_id', 'google_merchant_product_input_name',
        'google_merchant_last_payload_hash', 'google_merchant_last_action',
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

    protected $casts = [
        'inventory_import_starred' => 'boolean',
        'stock_quantity' => 'decimal:3',
        'damaged_quantity' => 'decimal:3',
        'imported_quantity_total' => 'decimal:3',
        'imported_value_total' => 'decimal:2',
        'video_urls' => 'array',
        'sort_order' => 'integer',
        'google_merchant_last_synced_at' => 'datetime',
        'google_merchant_last_attempted_at' => 'datetime',
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
        $image = $this->resolveDisplayPrimaryImage();

        return $image?->large_url ?: $image?->image_url;
    }

    public function getPrimaryImageAttribute()
    {
        $image = $this->resolveDisplayPrimaryImage();
        if (!$image) {
            return null;
        }

        $sourceProductId = (int) ($image->product_id ?? $this->id);

        return [
            'id' => $image->id,
            'url' => $image->large_url ?: $image->image_url,
            'path' => $image->large_url ?: $image->image_url,
            'image_url' => $image->image_url,
            'thumbnail_url' => $image->thumbnail_url,
            'medium_url' => $image->medium_url,
            'large_url' => $image->large_url,
            'width' => $image->width,
            'height' => $image->height,
            'srcset' => $image->srcset,
            'is_primary' => $image->is_primary,
            'source_product_id' => $sourceProductId,
            'is_inherited' => $sourceProductId !== (int) $this->id,
        ];
    }

    protected function resolveDisplayPrimaryImage(): ?ProductImage
    {
        $image = $this->resolveOwnPrimaryImage();
        if ($image) {
            return $image;
        }

        return $this->resolveParentPrimaryImage();
    }

    protected function resolveOwnPrimaryImage(): ?ProductImage
    {
        $images = $this->relationLoaded('images')
            ? $this->getRelation('images')
            : $this->images()->get();

        return $images->where('is_primary', true)->first() ?: $images->sortBy('sort_order')->first();
    }

    protected function resolveParentPrimaryImage(): ?ProductImage
    {
        $parents = $this->relationLoaded('parentConfigurable')
            ? $this->getRelation('parentConfigurable')
            : $this->parentConfigurable()->with('images')->limit(1)->get();

        $parent = $parents->first();
        if (!$parent instanceof self) {
            return null;
        }

        return $parent->resolveOwnPrimaryImage();
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
        $pivotColumns = ['sort_order', 'item_type', 'bundle_option_key'];

        if (Schema::hasColumn('category_product', 'bundle_option_uid')) {
            $pivotColumns[] = 'bundle_option_uid';
        }

        return $this->belongsToMany(Category::class)
            ->wherePivot('item_type', 'product')
            ->withPivot($pivotColumns)
            ->withTimestamps()
            ->orderBy('category_product.sort_order')
            ->orderBy('categories.id');
    }

    protected function productLinksPivotColumns(array $columns): array
    {
        if (Schema::hasColumn('product_links', 'bundle_option_uid')) {
            $columns[] = 'bundle_option_uid';
        }

        return $columns;
    }

    /**
     * Parent's linked items (Children, variations, grouped items, relations)
     */
    public function linkedProducts()
    {
        return $this->belongsToMany(Product::class, 'product_links', 'product_id', 'linked_product_id')
                    ->withPivot($this->productLinksPivotColumns(['link_type', 'position', 'option_title', 'option_post_id', 'option_image_url', 'option_video_url', 'option_video_source', 'quantity', 'is_required', 'variant_id', 'price', 'cost_price', 'is_default']))
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
        $relation = $this->belongsToMany(Attribute::class, 'product_super_attributes', 'product_id', 'attribute_id')
            ->withPivot(['position']);

        if (Attribute::hasSortOrderColumn()) {
            $relation->orderBy('attributes.sort_order');
        }

        return $relation
            ->orderBy('product_super_attributes.position')
            ->orderBy('attributes.id')
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
        $relation = $this->hasMany(\App\Models\ProductAttributeValue::class);
        $sortOrderSubquery = Attribute::sortOrderSubquery('product_attribute_values.attribute_id');

        if ($sortOrderSubquery !== null) {
            $relation->orderBy($sortOrderSubquery);
        }

        return $relation
            ->orderBy('product_attribute_values.attribute_id')
            ->orderBy('product_attribute_values.id');
    }

    public function images()
    {
        return $this->hasMany(ProductImage::class)
            ->with('mediaAsset')
            ->orderByDesc('is_primary')
            ->orderBy('sort_order')
            ->orderBy('id');
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
                    ->withPivot($this->productLinksPivotColumns(['link_type', 'quantity', 'is_required', 'position', 'option_title', 'option_post_id', 'option_image_url', 'option_video_url', 'option_video_source', 'is_default', 'variant_id', 'price', 'cost_price']))
                    ->orderByPivot('position', 'asc')
                    ->withTimestamps();
    }

    protected function compositeItemsRelationName(): ?string
    {
        if ($this->type === 'bundle') {
            return 'bundleItems';
        }

        if ($this->type === 'grouped') {
            return 'groupedItems';
        }

        return null;
    }

    public function calculateCompositePrice(array $removedIds = [])
    {
        $relationName = $this->compositeItemsRelationName();
        if ($relationName === null || $this->price_type !== 'sum') {
            return $this->price;
        }

        $items = $this->{$relationName};
        $total = 0;

        foreach ($items as $item) {
            if (in_array($item->id, $removedIds, true)) {
                continue;
            }

            $unitPrice = $item->pivot->price ?? $item->price ?? 0;
            $quantity = (int) ($item->pivot->quantity ?? 0);
            $total += ((float) $unitPrice) * $quantity;
        }

        return $total;
    }

    public function calculateCompositeCostPrice()
    {
        $relationName = $this->compositeItemsRelationName();
        if ($relationName === null) {
            return $this->cost_price;
        }

        $items = $this->{$relationName};
        $total = 0;

        foreach ($items as $item) {
            $unitCost = $item->pivot->cost_price ?? $item->cost_price ?? $item->expected_cost ?? 0;
            $quantity = (int) ($item->pivot->quantity ?? 0);
            $total += ((float) $unitCost) * $quantity;
        }

        return $total;
    }

    /**
     * Calculate price for grouped product if type is 'sum'
     */
    public function calculateGroupPrice($removedIds = [])
    {
        if ($this->type !== 'grouped') {
            return $this->price;
        }

        return $this->calculateCompositePrice($removedIds);
    }

    /**
     * Calculate cost price for grouped product (Sum of components)
     */
    public function calculateGroupCostPrice()
    {
        if ($this->type !== 'grouped') {
            return $this->cost_price;
        }

        return $this->calculateCompositeCostPrice();
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
