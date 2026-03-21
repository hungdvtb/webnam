<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventoryImport extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $table = 'imports';

    protected $fillable = [
        'account_id',
        'supplier_id',
        'import_number',
        'supplier_name',
        'import_date',
        'status',
        'total_quantity',
        'total_amount',
        'notes',
        'created_by',
    ];

    protected $casts = [
        'import_date' => 'date',
        'total_amount' => 'decimal:2',
    ];

    public function items()
    {
        return $this->hasMany(ImportItem::class, 'import_id');
    }

    public function supplier()
    {
        return $this->belongsTo(Supplier::class)->withTrashed();
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
