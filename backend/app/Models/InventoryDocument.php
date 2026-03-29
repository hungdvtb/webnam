<?php

namespace App\Models;

use App\Models\Concerns\OptionalSoftDeletes;
use Illuminate\Database\Eloquent\Model;

class InventoryDocument extends Model
{
    use \App\Traits\BelongsToAccount, OptionalSoftDeletes;

    public const ADJUSTMENT_KIND_STOCK = 'stock_adjustment';
    public const ADJUSTMENT_KIND_EXPORT = 'export_adjustment';

    public const ADJUSTMENT_SOURCE_MANUAL = 'manual_inventory';
    public const ADJUSTMENT_SOURCE_RETURN_RECONCILIATION = 'return_reconciliation';

    protected $fillable = [
        'account_id',
        'supplier_id',
        'document_number',
        'type',
        'adjustment_kind',
        'adjustment_source',
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
        return $this->belongsTo(self::class, 'parent_document_id')->withTrashed();
    }

    public function childDocuments()
    {
        return $this->hasMany(self::class, 'parent_document_id')->withTrashed();
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
