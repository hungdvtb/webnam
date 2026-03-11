<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OrderStatus extends Model
{
    protected $fillable = [
        'account_id',
        'code',
        'name',
        'color',
        'sort_order',
        'is_default',
        'is_system',
        'is_active'
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }
}
