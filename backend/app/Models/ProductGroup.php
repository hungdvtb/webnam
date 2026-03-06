<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductGroup extends Model
{
    protected $fillable = ['name', 'slug', 'description', 'price', 'price_type', 'status'];

    public function products()
    {
        return $this->belongsToMany(Product::class, 'product_group_items')
                    ->withPivot(['quantity', 'is_required']);
    }

    public function calculateCurrentPrice($removedIds = [])
    {
        if ($this->price_type === 'fixed') {
            return $this->price;
        }

        // Logic for 'sum' type
        $items = $this->products;
        $total = 0;
        foreach ($items as $item) {
            if (!in_array($item->id, $removedIds)) {
                $total += $item->price * $item->pivot->quantity;
            }
        }
        return $total;
    }}
