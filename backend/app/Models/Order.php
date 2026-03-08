<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'user_id', 'order_number', 'total_price', 'status', 
        'customer_name', 'customer_email', 'customer_phone', 
        'shipping_address', 'notes', 'account_id'
    ];

    public function items()
    {
        return $this->hasMany(OrderItem::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function payment()
    {
        return $this->hasOne(Payment::class);
    }

    public function customer()
    {
        return $this->belongsTo(Customer::class);
    }

    public function shipments()
    {
        return $this->hasMany(Shipment::class);
    }

    public function attributeValues()
    {
        return $this->hasMany(OrderAttributeValue::class);
    }
}
