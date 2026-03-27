<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ReturnOrderItem extends Model
{
    use \App\Traits\BelongsToAccount;

    public const GROUP_RETURNED = 'returned';
    public const GROUP_RESENT = 'resent';

    protected $fillable = [
        'account_id',
        'return_order_id',
        'item_group',
        'product_id',
        'product_name_snapshot',
        'product_sku_snapshot',
        'quantity',
        'unit_price_snapshot',
        'line_total_snapshot',
        'unit_cost_snapshot',
        'line_cost_snapshot',
        'notes',
        'sort_order',
    ];

    protected $casts = [
        'unit_price_snapshot' => 'decimal:2',
        'line_total_snapshot' => 'decimal:2',
        'unit_cost_snapshot' => 'decimal:2',
        'line_cost_snapshot' => 'decimal:2',
    ];

    public function returnOrder()
    {
        return $this->belongsTo(ReturnOrder::class);
    }

    public function product()
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }
}
