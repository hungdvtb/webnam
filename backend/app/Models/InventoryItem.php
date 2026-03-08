<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class InventoryItem extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'product_id',
        'warehouse_id',
        'qty',
        'min_qty',
        'is_in_stock',
        'account_id'
    ];

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function warehouse()
    {
        return $this->belongsTo(Warehouse::class);
    }
}
