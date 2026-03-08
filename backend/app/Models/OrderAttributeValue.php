<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OrderAttributeValue extends Model
{
    protected $fillable = ['order_id', 'attribute_id', 'value'];

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function attribute()
    {
        return $this->belongsTo(Attribute::class);
    }
}
