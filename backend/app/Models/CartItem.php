<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CartItem extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = ['cart_id', 'product_id', 'product_group_id', 'quantity', 'price', 'options', 'account_id'];

    protected $casts = [
        'options' => 'array',
    ];

    public function cart()
    {
        return $this->belongsTo(Cart::class);
    }

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function productGroup()
    {
        return $this->belongsTo(ProductGroup::class);
    }
}
