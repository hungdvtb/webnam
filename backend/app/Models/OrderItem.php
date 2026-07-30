<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OrderItem extends Model
{
    use Concerns\HasOrderItemProductDisplay;
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'order_id', 'product_id', 'actual_product_id', 'product_name_snapshot', 'product_sku_snapshot',
        'actual_product_name_snapshot', 'actual_product_sku_snapshot', 'product_source_account_id',
        'inventory_source_account_id', 'product_group_id',
        'sort_order', 'quantity', 'price', 'cost_price', 'cost_total', 'profit_total', 'options', 'account_id'
    ];

    protected $casts = [
        'options' => 'array',
        'actual_product_id' => 'integer',
        'product_source_account_id' => 'integer',
        'inventory_source_account_id' => 'integer',
        'sort_order' => 'integer',
        'quantity' => 'decimal:3',
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
        return $this->belongsTo(Product::class)->withTrashed();
    }

    public function actualProduct()
    {
        return $this->belongsTo(Product::class, 'actual_product_id')->withTrashed();
    }

    public function productSourceAccount()
    {
        return $this->belongsTo(Account::class, 'product_source_account_id');
    }

    public function inventorySourceAccount()
    {
        return $this->belongsTo(Account::class, 'inventory_source_account_id');
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
