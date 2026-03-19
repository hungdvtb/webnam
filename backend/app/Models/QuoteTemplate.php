<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class QuoteTemplate extends Model
{
    protected $fillable = [
        'account_id',
        'name',
        'image_url',
        'sort_order',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }
}
