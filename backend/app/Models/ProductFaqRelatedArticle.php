<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductFaqRelatedArticle extends Model
{
    public const SOURCE_POST = 'post';
    public const SOURCE_MANUAL = 'manual';

    protected $fillable = [
        'account_id',
        'product_faq_id',
        'post_id',
        'source',
        'url',
        'title',
        'excerpt',
        'image_url',
        'sort_order',
    ];

    protected $casts = [
        'post_id' => 'integer',
        'sort_order' => 'integer',
    ];

    public function faq()
    {
        return $this->belongsTo(ProductFaq::class, 'product_faq_id');
    }

    public function post()
    {
        return $this->belongsTo(Post::class);
    }
}
