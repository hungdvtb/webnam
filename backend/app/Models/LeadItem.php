<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class LeadItem extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'lead_id',
        'product_id',
        'product_name',
        'product_sku',
        'product_slug',
        'product_url',
        'quantity',
        'unit_price',
        'line_total',
        'options',
        'bundle_items',
        'sort_order',
    ];

    protected $casts = [
        'options' => 'array',
        'bundle_items' => 'array',
    ];

    public function lead()
    {
        return $this->belongsTo(Lead::class);
    }

    public function product()
    {
        return $this->belongsTo(Product::class);
    }
}
