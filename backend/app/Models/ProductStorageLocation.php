<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductStorageLocation extends Model
{
    use \App\Traits\BelongsToAccount;

    protected static string $accountScopeType = 'inventory';

    protected $fillable = [
        'account_id',
        'product_id',
        'warehouse_shelf_id',
        'floor_number',
        'position_note',
        'assigned_by',
        'assigned_at',
    ];

    protected $casts = [
        'floor_number' => 'integer',
        'assigned_at' => 'datetime',
    ];

    public function product()
    {
        return $this->belongsTo(Product::class)
            ->withoutGlobalScope('account_id')
            ->withTrashed();
    }

    public function shelf()
    {
        return $this->belongsTo(WarehouseShelf::class, 'warehouse_shelf_id')
            ->withoutGlobalScope('account_id');
    }

    public function assignedBy()
    {
        return $this->belongsTo(User::class, 'assigned_by');
    }
}
