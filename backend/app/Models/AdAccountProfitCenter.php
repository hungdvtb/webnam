<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AdAccountProfitCenter extends Model
{
    protected $fillable = [
        'account_id',
        'platform',
        'external_account_id',
        'external_account_name',
        'profit_center_id',
        'allocation_percent',
        'is_active',
        'metadata',
    ];

    protected $casts = [
        'allocation_percent' => 'decimal:4',
        'is_active' => 'boolean',
        'metadata' => 'array',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }

    public function profitCenter()
    {
        return $this->belongsTo(ProfitCenter::class);
    }

    public static function normalizeExternalAccountId(mixed $value): string
    {
        $raw = trim((string) $value);
        $digits = preg_replace('/\D+/', '', $raw);

        return $digits !== '' ? $digits : $raw;
    }

    public static function resolveProfitCenterId(string $platform, mixed $externalAccountId): ?int
    {
        $normalizedId = self::normalizeExternalAccountId($externalAccountId);
        if ($normalizedId === '') {
            return null;
        }

        $profitCenterId = self::query()
            ->where('platform', $platform)
            ->where('external_account_id', $normalizedId)
            ->where('is_active', true)
            ->whereNotNull('profit_center_id')
            ->latest('updated_at')
            ->value('profit_center_id');

        return $profitCenterId ? (int) $profitCenterId : null;
    }
}
