<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventoryBatchAllocation extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'account_id',
        'inventory_batch_id',
        'product_id',
        'order_id',
        'order_item_id',
        'quantity',
        'unit_cost',
        'total_cost',
        'allocated_at',
    ];

    protected $casts = [
        'allocated_at' => 'datetime',
        'unit_cost' => 'decimal:2',
        'total_cost' => 'decimal:2',
    ];

    public function batch()
    {
        return $this->belongsTo(InventoryBatch::class, 'inventory_batch_id');
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function orderItem()
    {
        return $this->belongsTo(OrderItem::class);
    }

    public function product()
    {
        return $this->belongsTo(Product::class);
    }
}
