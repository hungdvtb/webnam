<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class LeadStatus extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'code',
        'name',
        'color',
        'sort_order',
        'is_default',
        'blocks_order_create',
        'is_active',
    ];

    protected $casts = [
        'is_default' => 'boolean',
        'blocks_order_create' => 'boolean',
        'is_active' => 'boolean',
    ];

    public function leads()
    {
        return $this->hasMany(Lead::class, 'lead_status_id');
    }

    public static function defaultDefinitions(): array
    {
        return [
            ['name' => 'Don moi', 'code' => 'don-moi', 'color' => '#2563eb', 'sort_order' => 1, 'is_default' => true, 'blocks_order_create' => false],
            ['name' => 'Da tao don', 'code' => 'da-tao-don', 'color' => '#059669', 'sort_order' => 2, 'is_default' => false, 'blocks_order_create' => true],
            ['name' => 'KNM1', 'code' => 'knm1', 'color' => '#7c3aed', 'sort_order' => 3, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'KNM2', 'code' => 'knm2', 'color' => '#8b5cf6', 'sort_order' => 4, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'KNM3', 'code' => 'knm3', 'color' => '#a855f7', 'sort_order' => 5, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'Huy don', 'code' => 'huy-don', 'color' => '#dc2626', 'sort_order' => 6, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'Sai sdt', 'code' => 'sai-sdt', 'color' => '#ef4444', 'sort_order' => 7, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'Cho xem lai', 'code' => 'cho-xem-lai', 'color' => '#f59e0b', 'sort_order' => 8, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'Hen goi lai', 'code' => 'hen-goi-lai', 'color' => '#0ea5e9', 'sort_order' => 9, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'Da chot', 'code' => 'da-chot', 'color' => '#14b8a6', 'sort_order' => 10, 'is_default' => false, 'blocks_order_create' => false],
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
                'blocks_order_create' => $definition['blocks_order_create'],
                'is_active' => true,
            ]);
        }

        return static::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();
    }
}
