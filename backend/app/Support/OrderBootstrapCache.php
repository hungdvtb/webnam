<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;

class OrderBootstrapCache
{
    public const MODE_LIST = 'list';
    public const MODE_FORM = 'form';

    public static function key(int $accountId, string $mode): string
    {
        $normalizedMode = strtolower(trim($mode)) === self::MODE_FORM
            ? self::MODE_FORM
            : self::MODE_LIST;

        return "orders:bootstrap:{$accountId}:{$normalizedMode}";
    }

    public static function forget(int $accountId, ?string $mode = null): void
    {
        if ($mode !== null) {
            Cache::forget(self::key($accountId, $mode));
            return;
        }

        Cache::forget(self::key($accountId, self::MODE_LIST));
        Cache::forget(self::key($accountId, self::MODE_FORM));
    }
}
