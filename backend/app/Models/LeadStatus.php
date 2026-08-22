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
            ['name' => 'Đơn nháp', 'code' => 'don-nhap', 'color' => '#94a3b8', 'sort_order' => 0, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'Số mới', 'code' => 'don-moi', 'color' => '#2563eb', 'sort_order' => 1, 'is_default' => true, 'blocks_order_create' => false],
            ['name' => 'Đã gọi', 'code' => 'hen-goi-lai', 'color' => '#0ea5e9', 'sort_order' => 2, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'Không nghe máy', 'code' => 'knm1', 'color' => '#f59e0b', 'sort_order' => 3, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'Khách tiềm năng', 'code' => 'cho-xem-lai', 'color' => '#8b5cf6', 'sort_order' => 4, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'Đã chốt', 'code' => 'da-chot', 'color' => '#16a34a', 'sort_order' => 5, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'Không nhu cầu', 'code' => 'huy-don', 'color' => '#64748b', 'sort_order' => 6, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'Đã tạo đơn', 'code' => 'da-tao-don', 'color' => '#059669', 'sort_order' => 7, 'is_default' => false, 'blocks_order_create' => true],
            ['name' => 'Sai số', 'code' => 'sai-sdt', 'color' => '#ef4444', 'sort_order' => 8, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'Không nghe máy lần 2', 'code' => 'knm2', 'color' => '#fb923c', 'sort_order' => 9, 'is_default' => false, 'blocks_order_create' => false],
            ['name' => 'Không nghe máy lần 3', 'code' => 'knm3', 'color' => '#ea580c', 'sort_order' => 10, 'is_default' => false, 'blocks_order_create' => false],
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

        $legacyNames = ['Don moi', 'Da tao don', 'KNM1', 'KNM2', 'KNM3', 'Huy don', 'Sai sdt', 'Cho xem lai', 'Hen goi lai', 'Da chot'];

        foreach (static::defaultDefinitions() as $definition) {
            if ($existing->has($definition['code'])) {
                $existingStatus = $existing->get($definition['code']);

                if ($definition['code'] === 'don-nhap' || in_array($existingStatus->name, $legacyNames, true)) {
                    $existingStatus->forceFill([
                        'name' => $definition['name'],
                        'color' => $definition['color'],
                        'sort_order' => $definition['sort_order'],
                        'is_default' => $definition['is_default'],
                        'blocks_order_create' => $definition['blocks_order_create'],
                    ])->save();
                }

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
