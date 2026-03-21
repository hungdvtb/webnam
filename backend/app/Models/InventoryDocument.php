<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventoryDocument extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'account_id',
        'supplier_id',
        'document_number',
        'type',
        'document_date',
        'status',
        'reference_type',
        'reference_id',
        'total_quantity',
        'total_amount',
        'notes',
        'created_by',
    ];

    protected $casts = [
        'document_date' => 'date',
        'total_amount' => 'decimal:2',
    ];

    public function supplier()
    {
        return $this->belongsTo(Supplier::class)->withTrashed();
    }

    public function items()
    {
        return $this->hasMany(InventoryDocumentItem::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
