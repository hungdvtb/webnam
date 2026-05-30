<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductReviewLike extends Model
{
    protected $fillable = [
        'product_review_id',
        'account_id',
        'customer_ip_hash',
        'customer_user_agent_hash',
    ];

    public function review()
    {
        return $this->belongsTo(ProductReview::class, 'product_review_id');
    }
}
