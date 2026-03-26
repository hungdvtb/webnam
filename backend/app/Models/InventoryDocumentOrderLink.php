<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventoryDocumentOrderLink extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'account_id',
        'inventory_document_id',
        'order_id',
    ];

    public function document()
    {
        return $this->belongsTo(InventoryDocument::class, 'inventory_document_id');
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }
}
