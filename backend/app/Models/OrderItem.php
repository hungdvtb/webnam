<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OrderItem extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'order_id', 'product_id', 'product_name_snapshot', 'product_sku_snapshot', 'product_group_id', 
        'quantity', 'price', 'cost_price', 'cost_total', 'profit_total', 'options', 'account_id'
    ];

    protected $casts = [
        'options' => 'array',
        'cost_price' => 'decimal:2',
        'cost_total' => 'decimal:2',
        'profit_total' => 'decimal:2',
    ];

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function productGroup()
    {
        return $this->belongsTo(ProductGroup::class);
    }

    public function batchAllocations()
    {
        return $this->hasMany(InventoryBatchAllocation::class);
    }
}
