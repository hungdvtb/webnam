<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventoryDocumentItemOrderLink extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'account_id',
        'inventory_document_item_id',
        'order_id',
        'product_id',
        'exported_quantity',
        'actual_quantity',
        'export_adjustment_quantity',
        'meta',
    ];

    protected $casts = [
        'meta' => 'array',
    ];

    public function item()
    {
        return $this->belongsTo(InventoryDocumentItem::class, 'inventory_document_item_id');
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function product()
    {
        return $this->belongsTo(Product::class);
    }
}
