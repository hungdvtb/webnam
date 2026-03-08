<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Shipment extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'order_id',
        'warehouse_id',
        'shipment_number',
        'tracking_number',
        'carrier_name',
        'status',
        'shipping_cost',
        'shipped_at',
        'delivered_at',
        'notes',
        'account_id',
    ];

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function warehouse()
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function items()
    {
        return $this->hasMany(ShipmentItem::class);
    }
}
