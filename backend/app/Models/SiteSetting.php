<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SiteSetting extends Model
{
    protected $fillable = [
        'account_id',
        'key',
        'value'
    ];

    public static function getValue($key, $accountId, $default = null)
    {
        $setting = self::where('account_id', $accountId)->where('key', $key)->first();
        return $setting ? $setting->value : $default;
    }

    public static function setValue($key, $value, $accountId)
    {
        return self::updateOrCreate(
            ['account_id' => $accountId, 'key' => $key],
            ['value' => $value]
        );
    }
}
