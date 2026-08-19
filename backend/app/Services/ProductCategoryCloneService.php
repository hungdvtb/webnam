<?php

namespace App\Services;

use App\Models\Category;
use App\Models\Product;
use App\Models\ProductImage;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ProductCategoryCloneService
{
    public function __construct(
        protected ProductSkuService $productSkuService,
    ) {}

    public function preview(array $payload): array
    {
        $graph = $this->collectSourceGraph((int) $payload['source_category_id']);
        $sourceCategory = $graph['category'];
        $targetCategoryName = $this->targetCategoryName($payload, $sourceCategory);

        return [
            'source_category' => $this->categoryPayload($sourceCategory),
            'target_category' => [
                'id' => $payload['target_category_id'] ?? null,
                'name' => $targetCategoryName,
                'exists' => $this->findExistingTargetCategory($sourceCategory, $targetCategoryName)?->exists ?? false,
            ],
            'rules' => [
                ['from' => 'M2', 'to' => 'M3'],
                ['from' => 'mẫu 2', 'to' => 'mẫu 3'],
                ['from' => 'MR71', 'to' => 'MR72'],
                ['from' => 'ML71', 'to' => 'ML72'],
            ],
            'summary' => [
                'root_products' => count($graph['root_ids']),
                'child_products' => count($graph['all_product_ids']) - count($graph['root_ids']),
                'total_rows' => count($graph['all_product_ids']),
                'skipped_products' => count($graph['skipped_root_ids'] ?? []),
            ],
            'rows' => $this->buildPreviewRows($graph),
        ];
    }

    public function apply(array $payload): array
    {
        $graph = $this->collectSourceGraph((int) $payload['source_category_id']);
        $preparedRows = $this->prepareApplyRows($graph, (array) ($payload['rows'] ?? []));

        return DB::transaction(function () use ($payload, $graph, $preparedRows) {
            $sourceCategory = $graph['category'];
            $targetCategory = $this->resolveTargetCategory($payload, $sourceCategory);
            $idMap = [];
            $createdProducts = [];
            $createdRootCount = 0;
            $createdChildCount = 0;

            foreach ($graph['clone_order'] as $sourceProduct) {
                $sourceId = (int) $sourceProduct->id;
                if (!isset($preparedRows[$sourceId])) {
                    continue;
                }

                $clone = $this->cloneProduct($sourceProduct, $preparedRows[$sourceId], $sourceCategory, $targetCategory, $graph);
                $idMap[$sourceId] = (int) $clone->id;
                $createdProducts[] = $clone;
                if (isset($graph['root_id_set'][$sourceId])) {
                    $createdRootCount++;
                } else {
                    $createdChildCount++;
                }

                $this->copyProductImages($sourceProduct, $clone);
                $this->copyAttributeValues($sourceProduct, $clone);
                $this->copySuperAttributes($sourceProduct, $clone);
                $this->copyProductSuppliers($sourceProduct, $clone);
                $this->copySupplierPrices($sourceProduct, $clone, $preparedRows[$sourceId]['expected_cost']);
                $this->copyProductCategories($sourceProduct, $clone, $sourceCategory, $targetCategory, $graph);
            }

            $this->copyProductLinks($graph, $idMap);

            return [
                'message' => 'Đã copy danh mục sản phẩm thành công.',
                'target_category' => $this->categoryPayload($targetCategory->fresh() ?: $targetCategory),
                'summary' => [
                    'created_products' => count($createdProducts),
                    'root_products' => $createdRootCount,
                    'child_products' => $createdChildCount,
                    'removed_products' => max(0, count($graph['all_product_ids']) - count($preparedRows)),
                    'skipped_products' => count($graph['skipped_root_ids'] ?? []),
                ],
                'created_products' => collect($createdProducts)
                    ->map(fn (Product $product) => [
                        'id' => (int) $product->id,
                        'source_id' => (int) array_search((int) $product->id, $idMap, true),
                        'name' => $product->name,
                        'sku' => $product->sku,
                        'type' => $product->type,
                    ])
                    ->values()
                    ->all(),
            ];
        });
    }

    protected function collectSourceGraph(int $sourceCategoryId): array
    {
        $category = Category::query()->whereKey($sourceCategoryId)->firstOrFail();

        $assignmentRows = DB::table('category_product')
            ->where('category_id', $category->id)
            ->where('item_type', 'product')
            ->orderByRaw('CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        if ($assignmentRows->isEmpty()) {
            throw ValidationException::withMessages([
                'source_category_id' => ['Danh mục nguồn chưa có sản phẩm để copy.'],
            ]);
        }

        $rootIds = $assignmentRows
            ->pluck('product_id')
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        $rootsById = Product::query()
            ->with([
                'variations',
            ])
            ->whereIn('id', $rootIds)
            ->get()
            ->keyBy(fn (Product $product) => (int) $product->id);

        $skippedRootIds = collect($rootIds)
            ->reject(fn (int $id) => $rootsById->has($id))
            ->values()
            ->all();

        $rootIds = collect($rootIds)
            ->filter(fn (int $id) => $rootsById->has($id))
            ->values()
            ->all();

        if (empty($rootIds)) {
            throw ValidationException::withMessages([
                'source_category_id' => ['Danh mục nguồn không còn sản phẩm hợp lệ để copy.'],
            ]);
        }

        $childIdsOfRootProducts = DB::table('product_links')
            ->whereIn('product_id', $rootIds)
            ->where('link_type', 'super_link')
            ->pluck('linked_product_id')
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->flip()
            ->all();

        $rootIds = collect($rootIds)
            ->reject(fn (int $id) => isset($childIdsOfRootProducts[$id]))
            ->values()
            ->all();

        $orderedRoots = collect($rootIds)
            ->map(fn (int $id) => $rootsById->get($id))
            ->filter(fn ($product) => $product instanceof Product)
            ->values();

        $allProductsById = collect();
        $cloneOrder = collect();

        foreach ($orderedRoots as $root) {
            $this->pushCloneCandidate($root, $allProductsById, $cloneOrder);

            foreach ($root->variations as $variation) {
                $this->pushCloneCandidate($variation, $allProductsById, $cloneOrder);
            }
        }

        return [
            'category' => $category,
            'assignment_rows' => $assignmentRows->keyBy(fn ($row) => (int) $row->product_id),
            'root_ids' => $rootIds,
            'root_id_set' => array_fill_keys($rootIds, true),
            'skipped_root_ids' => $skippedRootIds,
            'roots' => $orderedRoots,
            'all_products_by_id' => $allProductsById,
            'all_product_ids' => $allProductsById->keys()->map(fn ($id) => (int) $id)->values()->all(),
            'clone_order' => $cloneOrder,
        ];
    }

    protected function pushCloneCandidate(Product $product, Collection $allProductsById, Collection $cloneOrder): void
    {
        $id = (int) $product->id;

        if ($allProductsById->has($id)) {
            return;
        }

        $allProductsById->put($id, $product);
        $cloneOrder->push($product);
    }

    protected function buildPreviewRows(array $graph): array
    {
        $rows = [];
        $reservedSkus = [];
        $renderedIds = [];

        foreach ($graph['roots'] as $root) {
            $rootChildren = $root->variations ?? collect();
            $renderedIds[(int) $root->id] = true;
            $rows[] = $this->previewRow($root, null, 'parent', $rootChildren->count(), $reservedSkus);

            foreach ($rootChildren as $variation) {
                if (isset($renderedIds[(int) $variation->id])) {
                    continue;
                }

                $renderedIds[(int) $variation->id] = true;
                $rows[] = $this->previewRow($variation, $root, 'child', 0, $reservedSkus);
            }
        }

        return $rows;
    }

    protected function previewRow(Product $product, ?Product $parent, string $level, int $childrenCount, array &$reservedSkus): array
    {
        $newName = $this->transformName((string) $product->name);
        $newSku = $this->buildPreviewSku($product, $newName, $reservedSkus);

        return [
            'row_key' => $level . '-' . $product->id,
            'source_product_id' => (int) $product->id,
            'parent_source_product_id' => $parent ? (int) $parent->id : null,
            'level' => $level,
            'product_type' => $product->type,
            'children_count' => $childrenCount,
            'current_name' => $product->name,
            'current_sku' => $product->sku,
            'current_expected_cost' => $this->decimalOrNull($product->expected_cost),
            'current_price' => $this->decimalOrNull($product->price) ?? 0,
            'name' => $newName,
            'sku' => $newSku,
            'expected_cost' => $this->decimalOrNull($product->expected_cost),
            'price' => $this->decimalOrNull($product->price) ?? 0,
        ];
    }

    protected function buildPreviewSku(Product $product, string $newName, array &$reservedSkus): string
    {
        $sourceSku = (string) ($product->sku ?: '');
        $candidate = $this->transformSku($sourceSku);

        if ($candidate === '' || $this->productSkuService->normalize($candidate) === $this->productSkuService->normalize($sourceSku)) {
            $candidate = trim($sourceSku) !== '' ? ($sourceSku . '-M3') : $newName;
        }

        $sku = $this->productSkuService->ensureUniqueSku($candidate, $newName, null, $reservedSkus);
        $reservedSkus[] = $sku;

        return $sku;
    }

    protected function prepareApplyRows(array $graph, array $rows): array
    {
        $allProductIds = array_fill_keys($graph['all_product_ids'], true);
        $rowsBySourceId = [];
        $rowIndexBySourceId = [];
        $messages = [];

        foreach ($rows as $index => $row) {
            $sourceId = isset($row['source_product_id']) && is_numeric($row['source_product_id'])
                ? (int) $row['source_product_id']
                : null;

            if (!$sourceId || !isset($allProductIds[$sourceId])) {
                $messages["rows.{$index}.source_product_id"][] = 'Dòng này không thuộc danh mục nguồn hiện tại.';
                continue;
            }

            if (isset($rowsBySourceId[$sourceId])) {
                $messages["rows.{$index}.source_product_id"][] = 'Sản phẩm này bị lặp trong bảng copy.';
                continue;
            }

            $rowsBySourceId[$sourceId] = $row;
            $rowIndexBySourceId[$sourceId] = $index;
        }

        if (empty($rowsBySourceId)) {
            $messages['rows'][] = 'Chọn ít nhất một sản phẩm để copy.';
        }

        $preparedRows = [];
        $reservedSkus = [];

        foreach ($graph['all_product_ids'] as $sourceId) {
            if (!isset($rowsBySourceId[$sourceId])) {
                continue;
            }

            $row = $rowsBySourceId[$sourceId];
            $index = $rowIndexBySourceId[$sourceId];
            $sourceProduct = $graph['all_products_by_id']->get($sourceId);
            $name = trim((string) ($row['name'] ?? ''));

            if ($name === '') {
                $messages["rows.{$index}.name"][] = 'Tên sản phẩm mới không được để trống.';
            }

            $sku = $this->productSkuService->normalize($row['sku'] ?? null);
            if ($sku === null && $name !== '') {
                $sku = $this->productSkuService->ensureUniqueSku(null, $name, null, $reservedSkus);
            }

            if ($sku !== null) {
                if (in_array($sku, $reservedSkus, true)) {
                    $messages["rows.{$index}.sku"][] = "SKU {$sku} bị trùng trong bảng copy.";
                } elseif ($this->productSkuService->skuExists($sku)) {
                    $messages["rows.{$index}.sku"][] = "SKU {$sku} đã tồn tại.";
                } else {
                    $reservedSkus[] = $sku;
                }
            }

            $expectedCost = $this->normalizeMoney($row['expected_cost'] ?? null, true);
            $price = $this->normalizeMoney($row['price'] ?? null, false);

            if ($price === null) {
                $messages["rows.{$index}.price"][] = 'Giá bán mới không được để trống.';
            }

            $preparedRows[$sourceId] = [
                'name' => $name !== '' ? $name : (string) $sourceProduct->name,
                'sku' => $sku,
                'expected_cost' => $expectedCost,
                'price' => $price ?? 0,
            ];
        }

        if (!empty($messages)) {
            throw ValidationException::withMessages($messages);
        }

        return $preparedRows;
    }

    protected function resolveTargetCategory(array $payload, Category $sourceCategory): Category
    {
        $targetId = isset($payload['target_category_id']) && is_numeric($payload['target_category_id'])
            ? (int) $payload['target_category_id']
            : null;

        if ($targetId) {
            if ((int) $sourceCategory->id === $targetId) {
                throw ValidationException::withMessages([
                    'target_category_id' => ['Danh mục đích phải khác danh mục nguồn.'],
                ]);
            }

            return Category::query()->whereKey($targetId)->firstOrFail();
        }

        $targetName = $this->targetCategoryName($payload, $sourceCategory);
        $existing = $this->findExistingTargetCategory($sourceCategory, $targetName);

        if ($existing instanceof Category) {
            if ((int) $existing->id === (int) $sourceCategory->id) {
                throw ValidationException::withMessages([
                    'target_category_name' => ['Danh mục đích phải khác danh mục nguồn.'],
                ]);
            }

            return $existing;
        }

        $target = $sourceCategory->replicate();
        $target->forceFill([
            'name' => $targetName,
            'slug' => Category::buildUniqueSlug($targetName),
            'code' => Category::buildUniqueCode($targetName),
            'banner_media_asset_id' => null,
            'logo_media_asset_id' => null,
        ]);
        $target->save();

        return $target;
    }

    protected function findExistingTargetCategory(Category $sourceCategory, string $targetName): ?Category
    {
        return Category::query()
            ->where('account_id', $sourceCategory->account_id)
            ->where('name', $targetName)
            ->first();
    }

    protected function cloneProduct(Product $source, array $row, Category $sourceCategory, Category $targetCategory, array $graph): Product
    {
        $isRootProduct = isset($graph['root_id_set'][(int) $source->id]);
        $categoryId = $isRootProduct || (int) ($source->category_id ?? 0) === (int) $sourceCategory->id
            ? (int) $targetCategory->id
            : $source->category_id;

        $clone = $source->replicate();
        $clone->forceFill([
            'name' => $row['name'],
            'sku' => $row['sku'],
            'slug' => $this->productSkuService->generateUniqueSlug($row['name']),
            'price' => $row['price'],
            'expected_cost' => $row['expected_cost'],
            'cost_price' => null,
            'stock_quantity' => 0,
            'damaged_quantity' => 0,
            'imported_quantity_total' => 0,
            'imported_value_total' => 0,
            'category_id' => $categoryId,
            'warehouse_sequence' => null,
            'google_merchant_sync_status' => 'not_synced',
            'google_merchant_last_synced_at' => null,
            'google_merchant_last_attempted_at' => null,
            'google_merchant_last_error' => null,
            'google_merchant_offer_id' => null,
            'google_merchant_product_input_name' => null,
            'google_merchant_last_payload_hash' => null,
            'google_merchant_last_action' => null,
        ]);
        $clone->save();

        return $clone;
    }

    protected function copyProductImages(Product $source, Product $clone): void
    {
        ProductImage::query()
            ->with('mediaAsset')
            ->where('product_id', $source->id)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->each(function (ProductImage $image) use ($clone) {
                ProductImage::create([
                    'product_id' => $clone->id,
                    'image_url' => $image->large_url ?: $image->image_url,
                    'is_primary' => $image->is_primary,
                    'sort_order' => $image->sort_order,
                    'file_name' => $image->file_name,
                    'file_size' => $image->file_size,
                ]);
            });
    }

    protected function copyAttributeValues(Product $source, Product $clone): void
    {
        $this->copyTableRows('product_attribute_values', 'product_id', $source->id, $clone->id, [
            'account_id',
            'attribute_id',
            'value',
        ]);
    }

    protected function copySuperAttributes(Product $source, Product $clone): void
    {
        $this->copyTableRows('product_super_attributes', 'product_id', $source->id, $clone->id, [
            'account_id',
            'attribute_id',
            'position',
        ]);
    }

    protected function copyProductSuppliers(Product $source, Product $clone): void
    {
        $this->copyTableRows('product_suppliers', 'product_id', $source->id, $clone->id, [
            'account_id',
            'supplier_id',
        ]);
    }

    protected function copySupplierPrices(Product $source, Product $clone, $expectedCost): void
    {
        if (!Schema::hasTable('supplier_product_prices')) {
            return;
        }

        $columns = Schema::getColumnListing('supplier_product_prices');
        $copyColumns = array_values(array_intersect([
            'account_id',
            'supplier_id',
            'supplier_product_code',
            'unit_cost',
            'notes',
            'updated_by',
        ], $columns));

        $now = now();
        $rows = DB::table('supplier_product_prices')
            ->where('product_id', $source->id)
            ->get();

        foreach ($rows as $row) {
            $insert = ['product_id' => $clone->id];

            foreach ($copyColumns as $column) {
                $insert[$column] = $column === 'unit_cost' && $expectedCost !== null
                    ? $expectedCost
                    : ($row->{$column} ?? null);
            }

            if (in_array('created_at', $columns, true)) {
                $insert['created_at'] = $now;
            }

            if (in_array('updated_at', $columns, true)) {
                $insert['updated_at'] = $now;
            }

            DB::table('supplier_product_prices')->insert($insert);
        }
    }

    protected function copyProductCategories(Product $source, Product $clone, Category $sourceCategory, Category $targetCategory, array $graph): void
    {
        if (!Schema::hasTable('category_product')) {
            return;
        }

        $columns = Schema::getColumnListing('category_product');
        $copyColumns = array_values(array_intersect([
            'sort_order',
            'item_type',
            'bundle_option_key',
            'bundle_option_uid',
            'bundle_option_post_id',
            'bundle_option_title',
        ], $columns));
        $now = now();
        $seen = [];
        $rows = DB::table('category_product')
            ->where('product_id', $source->id)
            ->where('item_type', 'product')
            ->get();

        foreach ($rows as $row) {
            $categoryId = (int) ($row->category_id ?? 0) === (int) $sourceCategory->id
                ? (int) $targetCategory->id
                : (int) ($row->category_id ?? 0);

            if (!$categoryId) {
                continue;
            }

            $bundleOptionKey = (string) ($row->bundle_option_key ?? '');
            $uniqueKey = $categoryId . '|product|' . $bundleOptionKey;
            if (isset($seen[$uniqueKey])) {
                continue;
            }
            $seen[$uniqueKey] = true;

            $insert = [
                'product_id' => $clone->id,
                'category_id' => $categoryId,
            ];

            foreach ($copyColumns as $column) {
                $insert[$column] = $row->{$column} ?? null;
            }

            if (in_array('item_type', $columns, true)) {
                $insert['item_type'] = 'product';
            }

            if (in_array('bundle_option_key', $columns, true)) {
                $insert['bundle_option_key'] = $bundleOptionKey;
            }

            if (in_array('created_at', $columns, true)) {
                $insert['created_at'] = $now;
            }

            if (in_array('updated_at', $columns, true)) {
                $insert['updated_at'] = $now;
            }

            DB::table('category_product')->insert($insert);
        }

        if (isset($graph['root_id_set'][(int) $source->id]) && !isset($seen[(int) $targetCategory->id . '|product|'])) {
            $assignment = $graph['assignment_rows']->get((int) $source->id);
            $insert = [
                'product_id' => $clone->id,
                'category_id' => $targetCategory->id,
            ];

            if (in_array('sort_order', $columns, true)) {
                $insert['sort_order'] = $assignment?->sort_order ?? null;
            }

            if (in_array('item_type', $columns, true)) {
                $insert['item_type'] = 'product';
            }

            if (in_array('bundle_option_key', $columns, true)) {
                $insert['bundle_option_key'] = '';
            }

            if (in_array('created_at', $columns, true)) {
                $insert['created_at'] = $now;
            }

            if (in_array('updated_at', $columns, true)) {
                $insert['updated_at'] = $now;
            }

            DB::table('category_product')->insert($insert);
        }
    }

    protected function copyProductLinks(array $graph, array $idMap): void
    {
        if (!Schema::hasTable('product_links')) {
            return;
        }

        $columns = Schema::getColumnListing('product_links');
        $copyColumns = array_values(array_intersect([
            'account_id',
            'link_type',
            'position',
            'option_title',
            'option_post_id',
            'option_image_url',
            'option_video_url',
            'option_video_source',
            'quantity',
            'is_required',
            'variant_id',
            'price',
            'cost_price',
            'is_default',
            'bundle_option_uid',
            'bundle_option_status',
        ], $columns));
        $now = now();
        $rootIds = $graph['root_ids'];
        $graphProductIdSet = array_fill_keys($graph['all_product_ids'], true);

        $links = DB::table('product_links')
            ->whereIn('product_id', $rootIds)
            ->orderBy('product_id')
            ->orderBy('position')
            ->orderBy('id')
            ->get();

        foreach ($links as $link) {
            $sourceParentId = (int) $link->product_id;
            if (!isset($idMap[$sourceParentId])) {
                continue;
            }

            $linkedProductId = (int) ($link->linked_product_id ?? 0);
            $variantId = isset($link->variant_id) && is_numeric($link->variant_id)
                ? (int) $link->variant_id
                : null;

            if (isset($graphProductIdSet[$linkedProductId]) && !isset($idMap[$linkedProductId])) {
                continue;
            }

            if ($variantId && isset($graphProductIdSet[$variantId]) && !isset($idMap[$variantId])) {
                continue;
            }

            $insert = [
                'product_id' => $idMap[$sourceParentId],
                'linked_product_id' => $idMap[$linkedProductId] ?? $linkedProductId,
            ];

            foreach ($copyColumns as $column) {
                if ($column === 'variant_id') {
                    $insert[$column] = $variantId ? ($idMap[$variantId] ?? $variantId) : null;
                    continue;
                }

                if ($column === 'cost_price') {
                    $insert[$column] = null;
                    continue;
                }

                $insert[$column] = $link->{$column} ?? null;
            }

            if (in_array('created_at', $columns, true)) {
                $insert['created_at'] = $now;
            }

            if (in_array('updated_at', $columns, true)) {
                $insert['updated_at'] = $now;
            }

            DB::table('product_links')->insert($insert);
        }
    }

    protected function copyTableRows(string $table, string $foreignKey, int $sourceId, int $cloneId, array $copyColumns): void
    {
        if (!Schema::hasTable($table)) {
            return;
        }

        $columns = Schema::getColumnListing($table);
        $copyColumns = array_values(array_intersect($copyColumns, $columns));
        $now = now();

        DB::table($table)
            ->where($foreignKey, $sourceId)
            ->orderBy('id')
            ->get()
            ->each(function ($row) use ($table, $foreignKey, $cloneId, $copyColumns, $columns, $now) {
                $insert = [$foreignKey => $cloneId];

                foreach ($copyColumns as $column) {
                    $insert[$column] = $row->{$column} ?? null;
                }

                if (in_array('created_at', $columns, true)) {
                    $insert['created_at'] = $now;
                }

                if (in_array('updated_at', $columns, true)) {
                    $insert['updated_at'] = $now;
                }

                DB::table($table)->insert($insert);
            });
    }

    protected function targetCategoryName(array $payload, Category $sourceCategory): string
    {
        $targetName = trim((string) ($payload['target_category_name'] ?? ''));

        return $targetName !== '' ? $targetName : $this->transformName($sourceCategory->name);
    }

    protected function transformName(string $value): string
    {
        $replaced = str_replace(['M2', 'm2'], ['M3', 'm3'], $value);
        $replaced = str_ireplace(['mẫu 2', 'mau 2'], ['mẫu 3', 'mau 3'], $replaced);

        return $replaced;
    }

    protected function transformSku(string $value): string
    {
        return str_replace(
            ['MR71', 'ML71', 'M2', 'm2'],
            ['MR72', 'ML72', 'M3', 'm3'],
            $value,
        );
    }

    protected function normalizeMoney($value, bool $nullable): ?float
    {
        if ($value === null || $value === '') {
            return $nullable ? null : 0.0;
        }

        $normalized = str_replace([',', ' '], ['', ''], (string) $value);

        if (!is_numeric($normalized)) {
            return $nullable ? null : 0.0;
        }

        return round(max(0, (float) $normalized), 2);
    }

    protected function decimalOrNull($value): ?float
    {
        return $value === null || $value === '' ? null : (float) $value;
    }

    protected function categoryPayload(Category $category): array
    {
        return [
            'id' => (int) $category->id,
            'name' => $category->name,
            'slug' => $category->slug,
            'account_id' => $category->account_id ? (int) $category->account_id : null,
        ];
    }
}
