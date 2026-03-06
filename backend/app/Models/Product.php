<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Product extends Model
{
    protected $fillable = [
        'name', 'slug', 'description', 'price', 'category_id', 'stock_quantity', 'status', 'is_featured'
    ];

    public function category()
    {
        return $this->belongsTo(Category::class);
    }

    public function images()
    {
        return $this->hasMany(ProductImage::class);
    }

    public function groups()
    {
        return $this->belongsToMany(ProductGroup::class, 'product_group_items')
                    ->withPivot(['quantity', 'is_required']);
    }}
