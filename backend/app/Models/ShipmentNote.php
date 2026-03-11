<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ShipmentNote extends Model
{
    protected $fillable = ['shipment_id', 'note_type', 'content', 'created_by'];

    public function shipment()
    {
        return $this->belongsTo(Shipment::class);
    }

    public function createdByUser()
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
