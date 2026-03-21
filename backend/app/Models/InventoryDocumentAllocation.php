<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventoryDocumentAllocation extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'account_id',
        'inventory_document_item_id',
        'inventory_batch_id',
        'product_id',
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

    public function item()
    {
        return $this->belongsTo(InventoryDocumentItem::class, 'inventory_document_item_id');
    }

    public function batch()
    {
        return $this->belongsTo(InventoryBatch::class, 'inventory_batch_id');
    }

    public function product()
    {
        return $this->belongsTo(Product::class);
    }
}
