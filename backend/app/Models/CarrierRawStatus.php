<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CarrierRawStatus extends Model
{
    protected $fillable = [
        'carrier_code',
        'raw_status',
        'first_seen_at',
        'last_seen_at',
        'is_mapped',
        'mapping_id',
        'sample_payload'
    ];

    protected $casts = [
        'first_seen_at' => 'datetime',
        'last_seen_at' => 'datetime',
        'is_mapped' => 'boolean',
        'sample_payload' => 'json'
    ];

    public function carrier()
    {
        return $this->belongsTo(Carrier::class, 'carrier_code', 'code');
    }

    public function mapping()
    {
        return $this->belongsTo(CarrierStatusMapping::class, 'mapping_id');
    }
}
