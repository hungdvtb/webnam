<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Order extends Model
{
    use \App\Traits\BelongsToAccount, SoftDeletes;

    public const KIND_OFFICIAL = 'official';
    public const KIND_TEMPLATE = 'template';
    public const KIND_DRAFT = 'draft';
    public const TYPE_STANDARD = 'standard';
    public const TYPE_EXCHANGE_RETURN = 'exchange_return';
    public const TYPE_PARTIAL_DELIVERY = 'partial_delivery';

    public const KINDS = [
        self::KIND_OFFICIAL,
        self::KIND_TEMPLATE,
        self::KIND_DRAFT,
    ];

    public const TYPES = [
        self::TYPE_STANDARD,
        self::TYPE_EXCHANGE_RETURN,
        self::TYPE_PARTIAL_DELIVERY,
    ];

    protected $fillable = [
        'user_id', 'lead_id', 'order_number', 'order_kind', 'order_type', 'converted_from_order_id', 'converted_from_kind', 'total_price', 'status',
        'customer_name', 'customer_email', 'customer_phone', 
        'shipping_address', 'province', 'district', 'ward', 'notes', 'account_id',
        'source', 'type', 'shipment_status', 'shipping_fee', 'discount', 'settlement_delta', 'return_tracking_code', 'return_status', 'cost_total', 'profit_total',
        'supplement_items_total_price', 'supplement_items_cost_total', 'report_revenue_total', 'report_cost_total',
        'report_profit_total', 'customer_id',
        'shipping_status', 'shipping_synced_at', 'shipping_status_source',
        'shipping_carrier_code', 'shipping_carrier_name', 'shipping_tracking_code',
        'shipping_dispatched_at', 'shipping_issue_code', 'shipping_issue_message', 'shipping_issue_detected_at',
    ];

    protected $casts = [
        'shipping_synced_at' => 'datetime',
        'shipping_dispatched_at' => 'datetime',
        'shipping_issue_detected_at' => 'datetime',
        'settlement_delta' => 'decimal:2',
        'cost_total' => 'decimal:2',
        'profit_total' => 'decimal:2',
        'supplement_items_total_price' => 'decimal:2',
        'supplement_items_cost_total' => 'decimal:2',
        'report_revenue_total' => 'decimal:2',
        'report_cost_total' => 'decimal:2',
        'report_profit_total' => 'decimal:2',
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

    public function inventoryDocuments()
    {
        return $this->hasMany(InventoryDocument::class, 'reference_id')
            ->where('reference_type', 'order')
            ->orderBy('document_date', 'desc')
            ->orderBy('id', 'desc');
    }

    public function attributeValues()
    {
        return $this->hasMany(OrderAttributeValue::class);
    }

    public function supplementItems()
    {
        return $this->hasMany(OrderSupplementItem::class)->orderBy('id');
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

    public function isOfficial(): bool
    {
        return ($this->order_kind ?: self::KIND_OFFICIAL) === self::KIND_OFFICIAL;
    }

    public function getNormalizedOrderType(): string
    {
        $value = strtolower(trim((string) $this->order_type));

        return in_array($value, self::TYPES, true)
            ? $value
            : self::TYPE_STANDARD;
    }

    public function managesInventory(): bool
    {
        return $this->isOfficial();
    }
}
