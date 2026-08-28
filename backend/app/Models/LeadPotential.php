<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class LeadPotential extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'code',
        'name',
        'color',
        'sort_order',
        'is_default',
        'counts_as_potential',
        'is_active',
    ];

    protected $casts = [
        'is_default' => 'boolean',
        'counts_as_potential' => 'boolean',
        'is_active' => 'boolean',
    ];

    public static function defaultDefinitions(): array
    {
        return [
            ['name' => 'Khách tiềm năng', 'code' => 'khach-tiem-nang', 'color' => '#16a34a', 'sort_order' => 1, 'is_default' => false, 'counts_as_potential' => true],
            ['name' => 'Khách chỉ tham khảo', 'code' => 'khach-chi-tham-khao', 'color' => '#f59e0b', 'sort_order' => 2, 'is_default' => false, 'counts_as_potential' => false],
            ['name' => 'Khách chê đắt', 'code' => 'khach-che-dat', 'color' => '#ef4444', 'sort_order' => 3, 'is_default' => false, 'counts_as_potential' => false],
        ];
    }

    public static function ensureDefaultsForAccount(?int $accountId): Collection
    {
        if (!$accountId) {
            return collect();
        }

        $existing = static::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->get()
            ->keyBy('code');

        foreach (static::defaultDefinitions() as $definition) {
            if ($existing->has($definition['code'])) {
                continue;
            }

            static::withoutGlobalScopes()->create([
                'account_id' => $accountId,
                'code' => $definition['code'] ?: Str::slug($definition['name']),
                'name' => $definition['name'],
                'color' => $definition['color'],
                'sort_order' => $definition['sort_order'],
                'is_default' => $definition['is_default'],
                'counts_as_potential' => $definition['counts_as_potential'],
                'is_active' => true,
            ]);
        }

        return static::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();
    }

    public static function defaultForAccount(?int $accountId): ?self
    {
        return static::ensureDefaultsForAccount($accountId)
            ->first(fn (self $potential) => $potential->is_default && $potential->is_active);
    }

    public static function uniqueCodeForAccount(int $accountId, string $source): string
    {
        $baseCode = Str::slug($source) ?: 'tiem-nang';
        $baseCode = Str::limit($baseCode, 70, '');
        $code = $baseCode;
        $suffix = 2;

        while (static::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->where('code', $code)
            ->exists()) {
            $code = Str::limit($baseCode, 65, '') . '-' . $suffix;
            $suffix++;
        }

        return $code;
    }
}
