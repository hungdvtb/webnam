<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DailyAdsSpend extends Model
{
    public const PLATFORM_FACEBOOK = 'facebook';
    public const PLATFORM_GOOGLE = 'google';

    protected $fillable = [
        'platform',
        'date',
        'amount',
        'account_id',
        'profit_center_id',
    ];

    protected $casts = [
        'date' => 'date',
        'amount' => 'decimal:2',
    ];

    public function profitCenter()
    {
        return $this->belongsTo(ProfitCenter::class);
    }
}
