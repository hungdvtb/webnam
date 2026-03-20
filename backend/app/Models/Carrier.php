<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Carrier extends Model
{
    protected $fillable = ['code', 'name', 'color', 'is_active', 'is_visible', 'sort_order', 'api_enabled', 'webhook_enabled', 'logo', 'config_json', 'account_id'];

    protected $casts = [
        'is_active' => 'boolean',
        'is_visible' => 'boolean',
        'sort_order' => 'integer',
        'api_enabled' => 'boolean',
        'webhook_enabled' => 'boolean',
        'config_json' => 'json',
    ];

    public function rawStatuses()
    {
        return $this->hasMany(CarrierRawStatus::class, 'carrier_code', 'code');
    }

    public function mappings()
    {
        return $this->hasMany(CarrierStatusMapping::class, 'carrier_code', 'code');
    }

    public function integrations()
    {
        return $this->hasMany(ShippingIntegration::class, 'carrier_code', 'code');
    }

    public function shipments()
    {
        return $this->hasMany(Shipment::class, 'carrier_code', 'code');
    }
}
