<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SiteAnalyticsEvent extends Model
{
    public const EVENT_PAGE_VIEW = 'page_view';
    public const EVENT_PRODUCT_VIEW = 'product_view';
    public const EVENT_ADD_TO_CART = 'add_to_cart';
    public const EVENT_CHECKOUT_STARTED = 'checkout_started';
    public const EVENT_PURCHASE = 'purchase';
    public const EVENT_ORDER_PLACED = 'order_placed';
    public const EVENT_LEAD = 'lead';

    public const PUBLIC_EVENTS = [
        self::EVENT_PAGE_VIEW,
        self::EVENT_PRODUCT_VIEW,
        self::EVENT_ADD_TO_CART,
        self::EVENT_CHECKOUT_STARTED,
        self::EVENT_PURCHASE,
        self::EVENT_LEAD,
    ];

    protected $fillable = [
        'account_id',
        'event_name',
        'event_date',
        'occurred_at',
        'product_id',
        'lead_id',
        'order_id',
        'visitor_id',
        'session_id',
        'ip_hash',
        'quantity',
        'value',
        'path',
        'url',
        'referrer',
        'user_agent',
        'metadata',
    ];

    protected $casts = [
        'event_date' => 'date',
        'occurred_at' => 'datetime',
        'metadata' => 'array',
        'quantity' => 'integer',
        'value' => 'decimal:2',
    ];

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function lead()
    {
        return $this->belongsTo(Lead::class);
    }
}
