<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Account extends Model
{
    protected $fillable = [
        'name',
        'domain',
        'subdomain',
        'site_code',
        'status',
        'ai_api_key',
        'catalog_account_id',
        'inventory_account_id',
    ];

    protected $casts = [
        'status' => 'boolean',
        'catalog_account_id' => 'integer',
        'inventory_account_id' => 'integer',
    ];

    public function users()
    {
        return $this->belongsToMany(User::class)
            ->using(AccountUser::class)
            ->withPivot('role', 'status', 'permissions', 'data_permissions')
            ->withTimestamps();
    }

    public function catalogAccount()
    {
        return $this->belongsTo(self::class, 'catalog_account_id');
    }

    public function inventoryAccount()
    {
        return $this->belongsTo(self::class, 'inventory_account_id');
    }
}
