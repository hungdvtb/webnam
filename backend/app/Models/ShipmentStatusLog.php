<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ShipmentStatusLog extends Model
{
    protected $fillable = ['shipment_id', 'from_status', 'to_status', 'changed_by', 'change_source', 'reason'];

    public function shipment()
    {
        return $this->belongsTo(Shipment::class);
    }

    public function changedByUser()
    {
        return $this->belongsTo(User::class, 'changed_by');
    }
}
