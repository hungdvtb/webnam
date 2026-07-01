<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;

class Attribute extends Model
{
    use \App\Traits\BelongsToAccount;

    protected static string $accountScopeType = 'catalog';

    protected static ?bool $sortOrderColumnExists = null;

    protected $fillable = ['name', 'entity_type', 'code', 'frontend_type', 'swatch_type', 'is_filterable', 'is_filterable_frontend', 'is_filterable_backend', 'is_required', 'is_variant', 'status', 'sort_order', 'account_id'];

    protected $casts = [
        'is_filterable' => 'boolean',
        'is_filterable_frontend' => 'boolean',
        'is_filterable_backend' => 'boolean',
        'is_required' => 'boolean',
        'is_variant' => 'boolean',
        'status' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function scopeByEntityType($query, $type)
    {
        return $query->where('entity_type', $type);
    }

    public function scopeOrdered($query)
    {
        if (static::hasSortOrderColumn()) {
            return $query
                ->orderBy('sort_order')
                ->orderBy('id');
        }

        return $query->orderBy('id');
    }

    public static function nextSortOrderFor(string $entityType = 'product', $accountId = null): int
    {
        $query = static::query();

        if ($accountId !== null && $accountId !== '' && $accountId !== 'all') {
            $query = $query
                ->withoutGlobalScope('account_id')
                ->where('account_id', $accountId);
        }

        if (!static::hasSortOrderColumn()) {
            return (int) $query
                ->where('entity_type', $entityType)
                ->count() + 1;
        }

        return (int) $query
            ->where('entity_type', $entityType)
            ->max('sort_order') + 1;
    }

    public static function hasSortOrderColumn(): bool
    {
        if (static::$sortOrderColumnExists !== null) {
            return static::$sortOrderColumnExists;
        }

        try {
            static::$sortOrderColumnExists = Schema::hasColumn((new static())->getTable(), 'sort_order');
        } catch (\Throwable) {
            static::$sortOrderColumnExists = false;
        }

        return static::$sortOrderColumnExists;
    }

    public static function relationColumnString(array $columns, bool $includeSortOrder = true): string
    {
        $normalizedColumns = array_values(array_unique($columns));

        if (
            $includeSortOrder
            && static::hasSortOrderColumn()
            && !in_array('sort_order', $normalizedColumns, true)
        ) {
            $normalizedColumns[] = 'sort_order';
        }

        return implode(',', $normalizedColumns);
    }

    public static function sortOrderSubquery(string $foreignKeyColumn)
    {
        if (!static::hasSortOrderColumn()) {
            return null;
        }

        return static::query()
            ->select('sort_order')
            ->whereColumn('attributes.id', $foreignKeyColumn)
            ->limit(1);
    }

    public function options()
    {
        return $this->hasMany(AttributeOption::class)->orderBy('order');
    }

    public function values()
    {
        return $this->hasMany(ProductAttributeValue::class);
    }
}
