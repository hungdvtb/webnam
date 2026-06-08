<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductFaq extends Model
{
    use \App\Traits\BelongsToAccount;

    public const STATUS_VISIBLE = 'visible';
    public const STATUS_HIDDEN = 'hidden';

    protected $fillable = [
        'account_id',
        'product_id',
        'question',
        'answer',
        'images',
        'youtube_url',
        'sort_order',
        'status',
    ];

    protected $casts = [
        'images' => 'array',
        'sort_order' => 'integer',
    ];

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function appliedProducts()
    {
        return $this->belongsToMany(Product::class, 'product_faq_product', 'product_faq_id', 'product_id')
            ->whereDoesntHave('parentConfigurable')
            ->withPivot(['account_id'])
            ->withTimestamps()
            ->orderBy('products.name')
            ->orderBy('products.id');
    }

    public function scopeVisible($query)
    {
        return $query->where('status', self::STATUS_VISIBLE);
    }

    public function scopeOrdered($query)
    {
        return $query->orderBy('sort_order')->orderBy('id');
    }
}
