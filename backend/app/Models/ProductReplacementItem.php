<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class ProductReplacementItem extends Model
{
    use BelongsToAccount;

    protected static string $accountScopeType = 'catalog';

    protected $fillable = [
        'account_id',
        'group_id',
        'product_id',
        'product_sku_snapshot',
        'product_name_snapshot',
        'sort_order',
    ];

    protected $casts = [
        'sort_order' => 'integer',
    ];

    public function group()
    {
        return $this->belongsTo(ProductReplacementGroup::class, 'group_id');
    }

    public function product()
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }
}
