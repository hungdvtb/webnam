<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventoryDocumentItem extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'account_id',
        'inventory_document_id',
        'product_id',
        'actual_product_id',
        'product_name_snapshot',
        'product_sku_snapshot',
        'actual_product_name_snapshot',
        'actual_product_sku_snapshot',
        'quantity',
        'actual_quantity',
        'stock_bucket',
        'direction',
        'unit_cost',
        'total_cost',
        'actual_unit_cost',
        'actual_total_cost',
        'unit_price',
        'total_price',
        'actual_unit_price',
        'actual_total_price',
        'notes',
        'actual_reason',
        'variance_type',
        'planned_order_product_id',
        'planned_order_product_name_snapshot',
        'planned_order_product_sku_snapshot',
        'planned_order_quantity',
    ];

    protected $casts = [
        'unit_cost' => 'decimal:2',
        'total_cost' => 'decimal:2',
        'actual_unit_cost' => 'decimal:2',
        'actual_total_cost' => 'decimal:2',
        'unit_price' => 'decimal:2',
        'total_price' => 'decimal:2',
        'actual_unit_price' => 'decimal:2',
        'actual_total_price' => 'decimal:2',
    ];

    public function document()
    {
        return $this->belongsTo(InventoryDocument::class, 'inventory_document_id');
    }

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function actualProduct()
    {
        return $this->belongsTo(Product::class, 'actual_product_id');
    }

    public function allocations()
    {
        return $this->hasMany(InventoryDocumentAllocation::class);
    }

    public function orderReleases()
    {
        return $this->hasMany(InventoryDocumentItemOrderRelease::class, 'inventory_document_item_id');
    }
}
