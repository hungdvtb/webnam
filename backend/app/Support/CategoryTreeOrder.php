<?php

namespace App\Support;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class CategoryTreeOrder
{
    public static function ordered(Collection $categories, ?array $accountIds = null, ?array $storeIds = null): Collection
    {
        if ($categories->isEmpty()) {
            return $categories;
        }

        $originalIndexById = [];
        foreach ($categories->values() as $index => $category) {
            $originalIndexById[(int) $category->id] = $index;
        }

        $accountRank = self::rankIds(
            self::normalizeIds($accountIds ?? [])
                ?: $categories
                    ->pluck('account_id')
                    ->map(fn ($accountId) => is_numeric($accountId) ? (int) $accountId : null)
                    ->filter()
                    ->unique()
                    ->sort()
                    ->values()
                    ->all()
        );
        $storeRank = self::storeRank($categories, $storeIds, $accountRank);
        $byId = $categories->keyBy(fn ($category) => (int) $category->id);
        $childrenByParent = [];

        foreach ($categories as $category) {
            $parentId = (int) ($category->parent_id ?? 0);
            $parentKey = $parentId > 0 && $byId->has($parentId) ? $parentId : 0;
            $childrenByParent[$parentKey] ??= [];
            $childrenByParent[$parentKey][] = $category;
        }

        $compare = function ($left, $right) use ($accountRank, $storeRank, $originalIndexById): int {
            return self::sortTuple($left, $accountRank, $storeRank, $originalIndexById)
                <=> self::sortTuple($right, $accountRank, $storeRank, $originalIndexById);
        };

        foreach ($childrenByParent as &$siblings) {
            usort($siblings, $compare);
        }
        unset($siblings);

        $ordered = [];
        $visited = [];
        $visit = function ($category) use (&$visit, &$ordered, &$visited, $childrenByParent): void {
            $categoryId = (int) $category->id;
            if ($categoryId <= 0 || isset($visited[$categoryId])) {
                return;
            }

            $visited[$categoryId] = true;
            $ordered[] = $category;

            foreach ($childrenByParent[$categoryId] ?? [] as $child) {
                $visit($child);
            }
        };

        foreach ($childrenByParent[0] ?? [] as $root) {
            $visit($root);
        }

        $remaining = $categories
            ->filter(fn ($category) => !isset($visited[(int) $category->id]))
            ->values()
            ->all();
        usort($remaining, $compare);

        foreach ($remaining as $category) {
            $visit($category);
        }

        return collect($ordered);
    }

    private static function sortTuple($category, array $accountRank, array $storeRank, array $originalIndexById): array
    {
        $categoryId = (int) ($category->id ?? 0);
        $accountId = (int) ($category->account_id ?? 0);
        $storeId = (int) ($category->store_id ?? 0);

        return [
            $accountRank[$accountId] ?? PHP_INT_MAX,
            $storeId > 0 ? ($storeRank[$storeId] ?? PHP_INT_MAX) : PHP_INT_MAX,
            $storeId > 0 ? $storeId : PHP_INT_MAX,
            (int) ($category->order ?? 0),
            $originalIndexById[$categoryId] ?? PHP_INT_MAX,
        ];
    }

    private static function storeRank(Collection $categories, ?array $storeIds, array $accountRank): array
    {
        $normalizedStoreIds = self::normalizeIds($storeIds ?? []);
        if ($normalizedStoreIds !== []) {
            return self::rankIds($normalizedStoreIds);
        }

        $categoryStoreIds = $categories
            ->pluck('store_id')
            ->map(fn ($storeId) => is_numeric($storeId) ? (int) $storeId : null)
            ->filter()
            ->unique()
            ->values();

        if ($categoryStoreIds->isEmpty() || !Schema::hasTable('stores')) {
            return [];
        }

        $stores = DB::table('stores')
            ->whereIn('id', $categoryStoreIds->all())
            ->get(['id', 'account_id', 'sort_order']);

        $rankedStores = $stores
            ->sortBy(fn ($store) => [
                $accountRank[(int) ($store->account_id ?? 0)] ?? PHP_INT_MAX,
                (int) ($store->sort_order ?? 0),
                (int) $store->id,
            ])
            ->pluck('id')
            ->map(fn ($storeId) => (int) $storeId)
            ->values()
            ->all();

        return self::rankIds($rankedStores);
    }

    private static function rankIds(array $ids): array
    {
        return collect($ids)
            ->values()
            ->mapWithKeys(fn ($id, $index) => [(int) $id => (int) $index])
            ->all();
    }

    private static function normalizeIds(array $ids): array
    {
        return collect($ids)
            ->filter(fn ($id) => is_numeric($id) && (int) $id > 0)
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();
    }
}
