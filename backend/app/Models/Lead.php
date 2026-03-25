<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Lead extends Model
{
    use BelongsToAccount;
    use SoftDeletes;

    protected $fillable = [
        'account_id',
        'lead_number',
        'lead_status_id',
        'customer_name',
        'phone',
        'email',
        'address',
        'product_id',
        'product_name',
        'product_summary',
        'product_summary_short',
        'message',
        'source',
        'tag',
        'link_url',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'status',
        'is_draft',
        'placed_at',
        'draft_captured_at',
        'converted_at',
        'total_amount',
        'discount_amount',
        'order_id',
        'draft_token',
        'status_changed_at',
        'notes',
        'latest_note_excerpt',
        'last_noted_at',
        'ip_address',
        'user_agent',
        'payload_snapshot',
        'conversion_data',
    ];

    protected $casts = [
        'placed_at' => 'datetime',
        'draft_captured_at' => 'datetime',
        'converted_at' => 'datetime',
        'status_changed_at' => 'datetime',
        'last_noted_at' => 'datetime',
        'is_draft' => 'boolean',
        'payload_snapshot' => 'array',
        'conversion_data' => 'array',
    ];

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function statusConfig()
    {
        return $this->belongsTo(LeadStatus::class, 'lead_status_id');
    }

    public function items()
    {
        return $this->hasMany(LeadItem::class)->orderBy('sort_order')->orderBy('id');
    }

    public function notesTimeline()
    {
        return $this->hasMany(LeadNote::class)->latest();
    }

    public function latestNote()
    {
        return $this->hasOne(LeadNote::class)->latestOfMany();
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function notificationReads()
    {
        return $this->hasMany(LeadNotificationRead::class);
    }
}
