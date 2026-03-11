<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CarrierStatusMapping extends Model
{
    protected $fillable = [
        'carrier_code', 'carrier_raw_status', 'internal_shipment_status',
        'mapped_order_status', 'is_terminal', 'sort_order', 'is_active', 'description',
    ];

    protected $casts = [
        'is_terminal' => 'boolean',
        'is_active'   => 'boolean',
    ];

    public function carrier()
    {
        return $this->belongsTo(Carrier::class, 'carrier_code', 'code');
    }
}
