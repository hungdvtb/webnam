<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ProductReview extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'product_id',
        'user_id',
        'customer_name',
        'rating',
        'comment',
        'is_approved',
    ];

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
