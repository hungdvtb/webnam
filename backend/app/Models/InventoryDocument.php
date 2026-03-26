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
        'parent_document_id',
        'batch_group_key',
        'total_quantity',
        'total_amount',
        'notes',
        'meta',
        'created_by',
    ];

    protected $casts = [
        'document_date' => 'date',
        'total_amount' => 'decimal:2',
        'meta' => 'array',
    ];

    public function supplier()
    {
        return $this->belongsTo(Supplier::class)->withTrashed();
    }

    public function items()
    {
        return $this->hasMany(InventoryDocumentItem::class);
    }

    public function parentDocument()
    {
        return $this->belongsTo(self::class, 'parent_document_id');
    }

    public function childDocuments()
    {
        return $this->hasMany(self::class, 'parent_document_id');
    }

    public function orderLinks()
    {
        return $this->hasMany(InventoryDocumentOrderLink::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
