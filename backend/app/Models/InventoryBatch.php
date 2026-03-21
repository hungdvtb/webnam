<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventoryBatch extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'account_id',
        'product_id',
        'import_id',
        'import_item_id',
        'source_type',
        'source_id',
        'batch_number',
        'received_at',
        'quantity',
        'remaining_quantity',
        'unit_cost',
        'status',
        'meta',
    ];

    protected $casts = [
        'received_at' => 'datetime',
        'unit_cost' => 'decimal:2',
        'meta' => 'array',
    ];

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function import()
    {
        return $this->belongsTo(InventoryImport::class, 'import_id');
    }

    public function importItem()
    {
        return $this->belongsTo(ImportItem::class, 'import_item_id');
    }

    public function allocations()
    {
        return $this->hasMany(InventoryBatchAllocation::class, 'inventory_batch_id');
    }

    public function documentAllocations()
    {
        return $this->hasMany(InventoryDocumentAllocation::class, 'inventory_batch_id');
    }
}
