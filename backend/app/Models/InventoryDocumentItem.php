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
        'product_name_snapshot',
        'product_sku_snapshot',
        'quantity',
        'stock_bucket',
        'direction',
        'unit_cost',
        'total_cost',
        'unit_price',
        'total_price',
        'notes',
        'meta',
    ];

    protected $casts = [
        'unit_cost' => 'decimal:2',
        'total_cost' => 'decimal:2',
        'unit_price' => 'decimal:2',
        'total_price' => 'decimal:2',
        'meta' => 'array',
    ];

    public function document()
    {
        return $this->belongsTo(InventoryDocument::class, 'inventory_document_id');
    }

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function allocations()
    {
        return $this->hasMany(InventoryDocumentAllocation::class);
    }

    public function orderLinks()
    {
        return $this->hasMany(InventoryDocumentItemOrderLink::class, 'inventory_document_item_id');
    }
}
