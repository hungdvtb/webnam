<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OrderStatusLog extends Model
{
    protected $fillable = [
        'order_id', 'from_status', 'to_status',
        'from_shipping_status', 'to_shipping_status',
        'source', 'changed_by', 'reason',
    ];

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function changedByUser()
    {
        return $this->belongsTo(User::class, 'changed_by');
    }
}
