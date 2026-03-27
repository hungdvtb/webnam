<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OrderSupplementItem extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'order_id',
        'account_id',
        'product_id',
        'product_name_snapshot',
        'product_sku_snapshot',
        'quantity',
        'price',
        'cost_price',
        'total_price',
        'total_cost',
        'notes',
    ];

    protected $casts = [
        'price' => 'decimal:2',
        'cost_price' => 'decimal:2',
        'total_price' => 'decimal:2',
        'total_cost' => 'decimal:2',
    ];

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function product()
    {
        return $this->belongsTo(Product::class);
    }
}
