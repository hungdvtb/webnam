<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventoryImportStatus extends Model
{
    protected $fillable = [
        'account_id',
        'code',
        'name',
        'color',
        'sort_order',
        'is_default',
        'is_system',
        'is_active',
        'affects_inventory',
    ];

    protected $casts = [
        'is_default' => 'boolean',
        'is_system' => 'boolean',
        'is_active' => 'boolean',
        'affects_inventory' => 'boolean',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }

    public function imports()
    {
        return $this->hasMany(InventoryImport::class, 'inventory_import_status_id');
    }
}
