<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class ProfitCenter extends Model
{
    use SoftDeletes;

    public const CHANNEL_ONLINE = 'online';
    public const CHANNEL_OFFLINE = 'offline';
    public const CHANNEL_SHARED = 'shared';

    public const CHANNELS = [
        self::CHANNEL_ONLINE,
        self::CHANNEL_OFFLINE,
        self::CHANNEL_SHARED,
    ];

    protected $fillable = [
        'account_id',
        'name',
        'code',
        'channel',
        'manager_user_id',
        'description',
        'is_active',
        'sort_order',
        'metadata',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'sort_order' => 'integer',
        'metadata' => 'array',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }

    public function manager()
    {
        return $this->belongsTo(User::class, 'manager_user_id');
    }

    public function adAccountMappings()
    {
        return $this->hasMany(AdAccountProfitCenter::class);
    }
}
