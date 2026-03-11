<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Lead extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'account_id',
        'customer_name',
        'phone',
        'email',
        'product_id',
        'product_name',
        'message',
        'source',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'status',
        'notes',
        'ip_address',
        'user_agent',
    ];

    public function product()
    {
        return $this->belongsTo(Product::class);
    }
}
