<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WarehouseShelf extends Model
{
    use \App\Traits\BelongsToAccount;

    protected static string $accountScopeType = 'inventory';

    protected $fillable = [
        'account_id',
        'warehouse_id',
        'name',
        'code',
        'floor_count',
        'is_active',
        'notes',
    ];

    protected $casts = [
        'floor_count' => 'integer',
        'is_active' => 'boolean',
    ];

    public function warehouse()
    {
        return $this->belongsTo(Warehouse::class)
            ->withoutGlobalScope('account_id');
    }

    public function locations()
    {
        return $this->hasMany(ProductStorageLocation::class);
    }
}
