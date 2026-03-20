<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Shipment extends Model
{
    use \App\Traits\BelongsToAccount, SoftDeletes;

    protected $fillable = [
        'order_id', 'integration_id', 'warehouse_id', 'shipment_number', 'tracking_number',
        'carrier_code', 'carrier_name', 'carrier_tracking_code', 'order_code', 'channel',
        'customer_id', 'customer_name', 'customer_phone', 'customer_address',
        'customer_ward', 'customer_district', 'customer_province',
        'sender_name', 'sender_phone', 'sender_address',
        'status', 'shipment_status', 'shipment_sub_status', 'order_status_snapshot',
        'carrier_status_raw', 'carrier_status_mapped', 'carrier_status_code', 'carrier_status_text',
        'cod_amount', 'shipping_cost', 'service_fee', 'return_fee', 'insurance_fee', 'other_fee',
        'reconciled_amount', 'actual_received_amount', 'reconciliation_diff_amount',
        'reconciliation_status', 'cod_status',
        'attempt_delivery_count', 'failed_reason', 'failed_reason_code',
        'internal_note', 'notes', 'risk_flag', 'priority_level', 'problem_code', 'problem_message',
        'created_by', 'assigned_to',
        'shipped_at', 'picked_at', 'in_transit_at', 'out_for_delivery_at',
        'delivered_at', 'delivery_failed_at', 'returning_at', 'returned_at',
        'reconciled_at', 'last_reconciled_at', 'canceled_at', 'last_synced_at', 'problem_detected_at',
        'last_webhook_received_at', 'external_order_number',
        'raw_tracking_payload', 'dispatch_payload', 'dispatch_response', 'extra_data', 'account_id',
    ];

    protected $casts = [
        'cod_amount' => 'decimal:2',
        'shipping_cost' => 'decimal:2',
        'service_fee' => 'decimal:2',
        'return_fee' => 'decimal:2',
        'insurance_fee' => 'decimal:2',
        'other_fee' => 'decimal:2',
        'reconciled_amount' => 'decimal:2',
        'actual_received_amount' => 'decimal:2',
        'reconciliation_diff_amount' => 'decimal:2',
        'shipped_at' => 'datetime',
        'picked_at' => 'datetime',
        'in_transit_at' => 'datetime',
        'out_for_delivery_at' => 'datetime',
        'delivered_at' => 'datetime',
        'delivery_failed_at' => 'datetime',
        'returning_at' => 'datetime',
        'returned_at' => 'datetime',
        'reconciled_at' => 'datetime',
        'last_reconciled_at' => 'datetime',
        'canceled_at' => 'datetime',
        'last_synced_at' => 'datetime',
        'problem_detected_at' => 'datetime',
        'last_webhook_received_at' => 'datetime',
        'raw_tracking_payload' => 'json',
        'dispatch_payload' => 'json',
        'dispatch_response' => 'json',
        'extra_data' => 'json',
        'attempt_delivery_count' => 'integer',
    ];

    // Relationships
    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function warehouse()
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function integration()
    {
        return $this->belongsTo(ShippingIntegration::class, 'integration_id');
    }

    public function items()
    {
        return $this->hasMany(ShipmentItem::class);
    }

    public function carrier()
    {
        return $this->belongsTo(Carrier::class, 'carrier_code', 'code');
    }

    public function trackingHistories()
    {
        return $this->hasMany(ShipmentTrackingHistory::class)->orderBy('event_time', 'desc');
    }

    public function reconciliations()
    {
        return $this->hasMany(ShipmentReconciliation::class);
    }

    public function notes()
    {
        return $this->hasMany(ShipmentNote::class)->orderBy('created_at', 'desc');
    }

    public function statusLogs()
    {
        return $this->hasMany(ShipmentStatusLog::class)->orderBy('created_at', 'desc');
    }

    public function createdByUser()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function assignedToUser()
    {
        return $this->belongsTo(User::class, 'assigned_to');
    }

    // Computed
    public function getExpectedReceivedAttribute()
    {
        return $this->cod_amount - $this->shipping_cost - $this->service_fee - $this->return_fee - $this->other_fee;
    }
}
