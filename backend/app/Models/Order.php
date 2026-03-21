<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Order extends Model
{
    use \App\Traits\BelongsToAccount, SoftDeletes;

    protected $fillable = [
        'user_id', 'order_number', 'total_price', 'status', 
        'customer_name', 'customer_email', 'customer_phone', 
        'shipping_address', 'province', 'district', 'ward', 'notes', 'account_id',
        'source', 'type', 'shipment_status', 'shipping_fee', 'discount', 'cost_total', 'profit_total', 'customer_id',
        'shipping_status', 'shipping_synced_at', 'shipping_status_source',
        'shipping_carrier_code', 'shipping_carrier_name', 'shipping_tracking_code',
        'shipping_dispatched_at', 'shipping_issue_code', 'shipping_issue_message', 'shipping_issue_detected_at',
    ];

    protected $casts = [
        'shipping_synced_at' => 'datetime',
        'shipping_dispatched_at' => 'datetime',
        'shipping_issue_detected_at' => 'datetime',
        'cost_total' => 'decimal:2',
        'profit_total' => 'decimal:2',
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

    public function statusLogs()
    {
        return $this->hasMany(OrderStatusLog::class)->orderBy('created_at', 'desc');
    }

    /**
     * Get the active (non-canceled) shipment for this order
     * For now: 1 order = 1 active shipment. Future: support multiple.
     */
    public function activeShipment()
    {
        return $this->hasOne(Shipment::class)
            ->whereNotIn('shipment_status', ['canceled'])
            ->latest();
    }

    /**
     * Check if this order has an active shipment controlling its shipping status
     */
    public function hasActiveShipment(): bool
    {
        return $this->shipments()
            ->whereNotIn('shipment_status', ['canceled'])
            ->exists();
    }

    /**
     * Determine if shipping status is being controlled by carrier sync
     */
    public function isShippingAutoSynced(): bool
    {
        return $this->shipping_status_source !== 'manual' && $this->hasActiveShipment();
    }
}
