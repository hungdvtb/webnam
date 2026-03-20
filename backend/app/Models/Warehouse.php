<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Warehouse extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'name',
        'code',
        'contact_name',
        'phone',
        'email',
        'address',
        'city',
        'province_name',
        'district_name',
        'ward_name',
        'province_id',
        'district_id',
        'ward_id',
        'is_active',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }

    public function inventoryItems()
    {
        return $this->hasMany(InventoryItem::class);
    }

    public function shippingIntegrations()
    {
        return $this->hasMany(ShippingIntegration::class, 'default_warehouse_id');
    }
}
