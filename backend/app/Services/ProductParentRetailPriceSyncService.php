<?php

namespace App\Services;

use App\Models\Product;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class ProductParentRetailPriceSyncService
{
    public function syncProductAndParents(Product|int $product): array
    {
        $product = $product instanceof Product
            ? $product
            : Product::withTrashed()->find($product);

        if (!$product instanceof Product) {
            return ['self_synced' => false, 'parent_ids' => []];
        }

        $selfSynced = false;
        if (!$product->trashed() && in_array($product->type, ['configurable', 'bundle'], true)) {
            $selfSynced = $this->syncParentProduct($product);
        }

        $parentIds = $this->affectedParentIdsForProductIds([(int) $product->id]);
        $this->syncParentProductsByIds($parentIds);

        return [
            'self_synced' => $selfSynced,
            'parent_ids' => $parentIds,
        ];
    }

    public function syncAffectedParentsForProductIds(array $productIds): void
    {
        $parentIds = $this->affectedParentIdsForProductIds($productIds);
        $selfParentIds = Product::query()
            ->whereIn('id', $this->normalizeIds($productIds))
            ->whereIn('type', ['configurable', 'bundle'])
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->syncParentProductsByIds(array_merge($selfParentIds, $parentIds));
    }

    public function syncParentProduct(Product|int $product): bool
    {
        $product = $product instanceof Product
            ? $product
            : Product::query()->find($product);

        if (!$product instanceof Product || $product->trashed()) {
            return false;
        }

        $price = match ($product->type) {
            'configurable' => $this->resolveLowestActiveVariantPrice((int) $product->id),
            'bundle' => $this->resolveLowestValidBundleOptionPrice((int) $product->id),
            default => null,
        };

        if ($price === null) {
            return false;
        }

        $this->writeParentRetailPrice((int) $product->id, $price);

        return true;
    }

    public function affectedParentIdsForProductIds(array $productIds): array
    {
        $productIds = $this->normalizeIds($productIds);
        if (empty($productIds)) {
            return [];
        }

        $configurableParentIds = DB::table('product_links')
            ->where('link_type', 'super_link')
            ->whereIn('linked_product_id', $productIds)
            ->pluck('product_id')
            ->all();

        $bundleParentIds = DB::table('product_links')
            ->where('link_type', 'bundle')
            ->where(function ($query) use ($productIds) {
                $query
                    ->whereIn('linked_product_id', $productIds)
                    ->orWhereIn('variant_id', $productIds);
            })
            ->pluck('product_id')
            ->all();

        return $this->normalizeIds(array_merge($configurableParentIds, $bundleParentIds));
    }

    public function resolveLowestActiveVariantPrice(int $parentProductId): ?float
    {
        $price = DB::table('product_links')
            ->join('products as variants', 'variants.id', '=', 'product_links.linked_product_id')
            ->where('product_links.product_id', $parentProductId)
            ->where('product_links.link_type', 'super_link')
            ->whereNull('variants.deleted_at')
            ->where('variants.status', true)
            ->whereNotNull('variants.price')
            ->min('variants.price');

        return $price !== null ? round((float) $price, 2) : null;
    }

    public function resolveLowestValidBundleOptionPrice(int $bundleProductId): ?float
    {
        $rows = DB::table('product_links')
            ->leftJoin('products as linked_products', 'linked_products.id', '=', 'product_links.linked_product_id')
            ->leftJoin('products as selected_variants', 'selected_variants.id', '=', 'product_links.variant_id')
            ->where('product_links.product_id', $bundleProductId)
            ->where('product_links.link_type', 'bundle')
            ->orderBy('product_links.position')
            ->orderBy('product_links.id')
            ->get([
                'product_links.id',
                'product_links.linked_product_id',
                'product_links.variant_id',
                'product_links.quantity',
                'product_links.price as pivot_price',
                'product_links.option_title',
                'product_links.option_post_id',
                'linked_products.type as linked_type',
                'linked_products.price as linked_price',
                'linked_products.status as linked_status',
                'linked_products.deleted_at as linked_deleted_at',
                'selected_variants.price as variant_price',
                'selected_variants.status as variant_status',
                'selected_variants.deleted_at as variant_deleted_at',
                ...(Schema::hasColumn('product_links', 'bundle_option_uid') ? ['product_links.bundle_option_uid'] : []),
                ...(Schema::hasColumn('product_links', 'bundle_option_status') ? ['product_links.bundle_option_status'] : []),
            ]);

        if ($rows->isEmpty()) {
            return null;
        }

        $validVariantPairs = $this->validVariantPairsForBundleRows($rows);
        $groups = [];

        foreach ($rows as $row) {
            $groupKey = $this->bundleOptionGroupKey($row);
            $groups[$groupKey] ??= [
                'total' => 0.0,
                'count' => 0,
                'invalid' => false,
            ];

            if (!$this->isVisibleBundleOptionRow($row)) {
                $groups[$groupKey]['invalid'] = true;
                continue;
            }

            $quantity = (int) ($row->quantity ?? 0);
            if ($quantity <= 0 || !$this->isActiveProductRow($row, 'linked')) {
                $groups[$groupKey]['invalid'] = true;
                continue;
            }

            $isConfigurableItem = (string) ($row->linked_type ?? '') === 'configurable';
            if ($isConfigurableItem) {
                $variantId = is_numeric($row->variant_id ?? null) ? (int) $row->variant_id : 0;
                $pairKey = ((int) ($row->linked_product_id ?? 0)) . ':' . $variantId;

                if ($variantId <= 0 || !$this->isActiveProductRow($row, 'variant') || empty($validVariantPairs[$pairKey])) {
                    $groups[$groupKey]['invalid'] = true;
                    continue;
                }
            }

            $unitPrice = $this->resolveBundleRowUnitPrice($row, $isConfigurableItem);
            if ($unitPrice === null) {
                $groups[$groupKey]['invalid'] = true;
                continue;
            }

            $groups[$groupKey]['total'] += $unitPrice * $quantity;
            $groups[$groupKey]['count']++;
        }

        $prices = collect($groups)
            ->filter(fn (array $group) => !$group['invalid'] && $group['count'] > 0)
            ->pluck('total')
            ->map(fn ($price) => round((float) $price, 2))
            ->values();

        return $prices->isNotEmpty() ? (float) $prices->min() : null;
    }

    public function syncParentProductsByIds(array $parentIds): void
    {
        $parentIds = $this->normalizeIds($parentIds);
        if (empty($parentIds)) {
            return;
        }

        Product::query()
            ->whereIn('id', $parentIds)
            ->whereIn('type', ['configurable', 'bundle'])
            ->get(['id', 'type', 'deleted_at'])
            ->each(fn (Product $product) => $this->syncParentProduct($product));
    }

    private function writeParentRetailPrice(int $productId, float $price): void
    {
        $currentPrice = DB::table('products')
            ->where('id', $productId)
            ->whereNull('deleted_at')
            ->value('price');

        if ($currentPrice !== null && round((float) $currentPrice, 2) === round($price, 2)) {
            return;
        }

        DB::table('products')
            ->where('id', $productId)
            ->whereNull('deleted_at')
            ->update([
                'price' => round($price, 2),
                'updated_at' => now(),
            ]);
    }

    private function validVariantPairsForBundleRows($rows): array
    {
        $pairs = $rows
            ->filter(fn ($row) => (string) ($row->linked_type ?? '') === 'configurable' && is_numeric($row->variant_id ?? null))
            ->map(fn ($row) => [
                'parent_id' => (int) $row->linked_product_id,
                'variant_id' => (int) $row->variant_id,
            ])
            ->filter(fn (array $pair) => $pair['parent_id'] > 0 && $pair['variant_id'] > 0)
            ->unique(fn (array $pair) => $pair['parent_id'] . ':' . $pair['variant_id'])
            ->values();

        if ($pairs->isEmpty()) {
            return [];
        }

        return DB::table('product_links')
            ->where('link_type', 'super_link')
            ->whereIn('product_id', $pairs->pluck('parent_id')->unique()->all())
            ->whereIn('linked_product_id', $pairs->pluck('variant_id')->unique()->all())
            ->get(['product_id', 'linked_product_id'])
            ->mapWithKeys(fn ($row) => [
                ((int) $row->product_id) . ':' . ((int) $row->linked_product_id) => true,
            ])
            ->all();
    }

    private function resolveBundleRowUnitPrice(object $row, bool $isConfigurableItem): ?float
    {
        if ($row->pivot_price !== null) {
            return round((float) $row->pivot_price, 2);
        }

        if ($isConfigurableItem) {
            return $row->variant_price !== null ? round((float) $row->variant_price, 2) : null;
        }

        return $row->linked_price !== null ? round((float) $row->linked_price, 2) : null;
    }

    private function isVisibleBundleOptionRow(object $row): bool
    {
        if (!Schema::hasColumn('product_links', 'bundle_option_status')) {
            return true;
        }

        return Str::lower(Str::squish((string) ($row->bundle_option_status ?? 'visible'))) !== 'internal';
    }

    private function isActiveProductRow(object $row, string $prefix): bool
    {
        $statusColumn = $prefix . '_status';
        $deletedAtColumn = $prefix . '_deleted_at';

        return $row->{$statusColumn} !== null
            && (bool) $row->{$statusColumn}
            && $row->{$deletedAtColumn} === null;
    }

    private function bundleOptionGroupKey(object $row): string
    {
        if (Schema::hasColumn('product_links', 'bundle_option_uid')) {
            $uid = trim((string) ($row->bundle_option_uid ?? ''));
            if ($uid !== '') {
                return 'uid:' . $uid;
            }
        }

        if (!empty($row->option_post_id) && is_numeric($row->option_post_id)) {
            return 'post:' . (int) $row->option_post_id;
        }

        $title = Str::lower(Str::squish((string) ($row->option_title ?? '')));

        return 'title:' . ($title !== '' ? $title : 'mac dinh');
    }

    private function normalizeIds(array $ids): array
    {
        return collect($ids)
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values()
            ->all();
    }
}
