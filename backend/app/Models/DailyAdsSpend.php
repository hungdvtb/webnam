<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DailyAdsSpend extends Model
{
    protected $fillable = [
        'date',
        'amount',
        'account_id',
    ];

    protected $casts = [
        'date' => 'date',
        'amount' => 'decimal:2',
    ];
}
