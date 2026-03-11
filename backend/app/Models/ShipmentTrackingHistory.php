<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ShipmentTrackingHistory extends Model
{
    protected $fillable = ['shipment_id', 'tracking_code', 'status', 'sub_status', 'description', 'location', 'event_time', 'raw_payload'];

    protected $casts = [
        'event_time' => 'datetime',
        'raw_payload' => 'json',
    ];

    public function shipment()
    {
        return $this->belongsTo(Shipment::class);
    }
}
