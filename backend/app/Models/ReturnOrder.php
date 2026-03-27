<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ReturnOrder extends Model
{
    use \App\Traits\BelongsToAccount;

    public const STATUS_NEW = 'new';
    public const STATUS_RECEIVED = 'received';
    public const STATUS_SHIPPED = 'shipped';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_CANCELLED = 'cancelled';

    public const STATUSES = [
        self::STATUS_NEW,
        self::STATUS_RECEIVED,
        self::STATUS_SHIPPED,
        self::STATUS_COMPLETED,
        self::STATUS_CANCELLED,
    ];

    public const STATUS_META = [
        self::STATUS_NEW => ['label' => 'Moi tao', 'color' => '#2563EB'],
        self::STATUS_RECEIVED => ['label' => 'Da nhan hang hoan', 'color' => '#0891B2'],
        self::STATUS_SHIPPED => ['label' => 'Da gui hang', 'color' => '#7C3AED'],
        self::STATUS_COMPLETED => ['label' => 'Hoan tat', 'color' => '#15803D'],
        self::STATUS_CANCELLED => ['label' => 'Huy', 'color' => '#DC2626'],
    ];

    protected $fillable = [
        'account_id',
        'return_number',
        'origin_order_id',
        'status',
        'exchange_date',
        'customer_name',
        'customer_phone',
        'customer_address',
        'returned_total_quantity',
        'resent_total_quantity',
        'returned_total_amount',
        'resent_total_amount',
        'profit_loss_amount',
        'return_document_id',
        'export_document_id',
        'created_by',
        'received_at',
        'shipped_at',
        'completed_at',
        'cancelled_at',
        'notes',
    ];

    protected $casts = [
        'exchange_date' => 'date',
        'returned_total_amount' => 'decimal:2',
        'resent_total_amount' => 'decimal:2',
        'profit_loss_amount' => 'decimal:2',
        'received_at' => 'datetime',
        'shipped_at' => 'datetime',
        'completed_at' => 'datetime',
        'cancelled_at' => 'datetime',
    ];

    public function originOrder()
    {
        return $this->belongsTo(Order::class, 'origin_order_id')->withTrashed();
    }

    public function items()
    {
        return $this->hasMany(ReturnOrderItem::class)
            ->orderBy('item_group')
            ->orderBy('sort_order')
            ->orderBy('id');
    }

    public function returnedItems()
    {
        return $this->hasMany(ReturnOrderItem::class)
            ->where('item_group', ReturnOrderItem::GROUP_RETURNED)
            ->orderBy('sort_order')
            ->orderBy('id');
    }

    public function resentItems()
    {
        return $this->hasMany(ReturnOrderItem::class)
            ->where('item_group', ReturnOrderItem::GROUP_RESENT)
            ->orderBy('sort_order')
            ->orderBy('id');
    }

    public function returnDocument()
    {
        return $this->belongsTo(InventoryDocument::class, 'return_document_id')->withTrashed();
    }

    public function exportDocument()
    {
        return $this->belongsTo(InventoryDocument::class, 'export_document_id')->withTrashed();
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public static function statusMeta(?string $status): array
    {
        return self::STATUS_META[$status] ?? self::STATUS_META[self::STATUS_NEW];
    }

    public static function statusOptions(): array
    {
        return collect(self::STATUS_META)
            ->map(fn (array $meta, string $status) => [
                'value' => $status,
                'label' => $meta['label'],
                'color' => $meta['color'],
            ])
            ->values()
            ->all();
    }
}
