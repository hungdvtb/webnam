<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class InventoryImport extends Model
{
    use \App\Traits\BelongsToAccount, SoftDeletes;

    protected $table = 'imports';

    protected $fillable = [
        'account_id',
        'supplier_id',
        'inventory_import_status_id',
        'import_number',
        'supplier_name',
        'import_date',
        'status',
        'entry_mode',
        'total_quantity',
        'subtotal_amount',
        'extra_charge_percent',
        'extra_charge_mode',
        'extra_charge_value',
        'extra_charge_amount',
        'total_amount',
        'notes',
        'created_by',
        'inventory_applied_at',
    ];

    protected $casts = [
        'import_date' => 'date',
        'subtotal_amount' => 'decimal:2',
        'extra_charge_percent' => 'decimal:2',
        'extra_charge_value' => 'decimal:2',
        'extra_charge_amount' => 'decimal:2',
        'total_amount' => 'decimal:2',
        'inventory_applied_at' => 'datetime',
    ];

    public function items()
    {
        return $this->hasMany(ImportItem::class, 'import_id');
    }

    public function supplier()
    {
        return $this->belongsTo(Supplier::class)->withTrashed();
    }

    public function statusConfig()
    {
        return $this->belongsTo(InventoryImportStatus::class, 'inventory_import_status_id');
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function attachments()
    {
        return $this->hasMany(InventoryImportAttachment::class, 'import_id');
    }

    public function invoiceAnalysisLogs()
    {
        return $this->hasMany(InventoryInvoiceAnalysisLog::class, 'import_id');
    }
}
