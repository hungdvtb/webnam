<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attribute;
use App\Models\AttributeOption;
use App\Models\Category;
use App\Models\InventoryUnit;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Post;
use App\Models\Product;
use App\Models\ProductAttributeValue;
use App\Models\ProductImage;
use App\Models\BulkUpdateLog;
use App\Services\Inventory\ProductPricingService;
use App\Services\OrderInventorySlipService;
use App\Services\ProductSkuService;
use Illuminate\Http\Request;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

use Illuminate\Database\Eloquent\Builder;

class ProductController extends Controller
{
    private const OVERSOLD_RESERVE_SOURCE = 'oversold_reserve';

    public function __construct(
        protected ProductSkuService $productSkuService,
        protected ProductPricingService $productPricingService,
        protected OrderInventorySlipService $orderInventorySlipService
    )
    {
    }

    protected function supplierExistsRule(Request $request)
    {
        return Rule::exists('suppliers', 'id')->where(function ($query) {
            $query->whereNull('deleted_at');
        });
    }

    protected function syncProductCategories(Product $product, array $categoryIds, bool $detachMissing = true): void
    {
        $syncPayload = Category::buildProductSyncPayload($product, $categoryIds);

        if (empty($syncPayload)) {
            if ($detachMissing) {
                $product->categories()->detach();
            }

            return;
        }

        if ($detachMissing) {
            $product->categories()->sync($syncPayload);
            return;
        }

        $product->categories()->syncWithoutDetaching($syncPayload);
    }

    protected function shouldAutoCalculateCompositePrice(Request $request, ?Product $product = null): bool
    {
        $resolvedType = (string) $request->input('type', $product?->type ?? '');
        $resolvedPriceType = (string) $request->input('price_type', $product?->price_type ?? 'fixed');

        return in_array($resolvedType, ['grouped', 'bundle'], true) && $resolvedPriceType === 'sum';
    }

    protected function calculateCompositeRequestPrice(array $groupedItems): float
    {
        $total = 0.0;

        foreach ($groupedItems as $item) {
            if (!is_array($item)) {
                continue;
            }

            $quantity = max(0, (int) ($item['quantity'] ?? 0));
            $unitPrice = is_numeric($item['price'] ?? null) ? (float) $item['price'] : 0.0;
            $total += $unitPrice * $quantity;
        }

        return $total;
    }

    protected function applyCompositeAutoPrice(Request $request, array &$validated, ?Product $product = null): void
    {
        if (!$this->shouldAutoCalculateCompositePrice($request, $product)) {
            return;
        }

        if ($request->has('grouped_items')) {
            $validated['price'] = $this->calculateCompositeRequestPrice((array) $request->input('grouped_items', []));
            return;
        }

        $validated['price'] = $product?->calculateCompositePrice() ?? 0;
    }

    protected function syncCompositeAutoPrice(Product $product): void
    {
        if (!in_array($product->type, ['grouped', 'bundle'], true) || $product->price_type !== 'sum') {
            return;
        }

        $relationName = $product->type === 'bundle' ? 'bundleItems' : 'groupedItems';
        $product->unsetRelation('groupedItems');
        $product->unsetRelation('bundleItems');
        $product->load($relationName);
        $product->forceFill([
            'price' => $product->calculateCompositePrice(),
        ])->save();
    }

    protected function productResourceRelations(): array
    {
        return [
            'category:id,name',
            'categories:id,name',
            'supplier:id,name,code',
            'suppliers:id,name,code',
            'parentConfigurable:id,name,sku,type',
            'unit:id,name',
            'siteDomain:id,domain,is_active,is_default',
            'images:id,product_id,image_url,is_primary,sort_order,file_name,file_size',
            'superAttributes:id,name,code,frontend_type',
            'superAttributes.options:id,attribute_id,value,swatch_value,order',
            'attributeValues:id,product_id,attribute_id,value',
            'attributeValues.attribute:id,name,code,frontend_type',
            'linkedProducts' => function ($q) {
                $q->select(['products.id', 'products.sku', 'products.name', 'products.price', 'products.expected_cost', 'products.cost_price', 'products.stock_quantity', 'products.type', 'products.weight', 'products.inventory_unit_id'])
                    ->withPivot(['link_type', 'position', 'quantity', 'is_required'])
                    ->with([
                        'unit:id,name',
                        'images:id,product_id,image_url,is_primary,sort_order',
                        'attributeValues:id,product_id,attribute_id,value',
                        'attributeValues.attribute:id,name,code',
                    ]);
            },
            'groupedItems' => function ($q) {
                $q->select(['products.id', 'products.sku', 'products.name', 'products.price', 'products.expected_cost', 'products.cost_price', 'products.stock_quantity', 'products.type', 'products.weight', 'products.inventory_unit_id'])
                    ->withPivot(['link_type', 'position', 'quantity', 'is_required', 'price', 'cost_price'])
                    ->with([
                        'unit:id,name',
                        'images:id,product_id,image_url,is_primary,sort_order',
                        'attributeValues:id,product_id,attribute_id,value',
                    ]);
            },
            'bundleItems' => function ($q) {
                $q->select(['products.id', 'products.sku', 'products.name', 'products.price', 'products.expected_cost', 'products.cost_price', 'products.stock_quantity', 'products.type', 'products.weight', 'products.inventory_unit_id'])
                    ->withPivot(['link_type', 'position', 'quantity', 'is_required', 'option_title', 'option_post_id', 'is_default', 'variant_id', 'price', 'cost_price'])
                    ->with([
                        'unit:id,name',
                        'images:id,product_id,image_url,is_primary,sort_order',
                        'attributeValues:id,product_id,attribute_id,value',
                    ]);
            },
            'approvedReviews.user:id,name',
        ];
    }

    protected function appendSupplierMeta(Product $product): Product
    {
        if (!$product->relationLoaded('suppliers')) {
            $product->loadMissing('suppliers:id,name,code');
        }

        $supplierIds = $product->suppliers
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();

        $product->setAttribute('supplier_ids', $supplierIds);
        $product->setAttribute('supplier_count', count($supplierIds));
        $product->setAttribute('has_multiple_suppliers', count($supplierIds) > 1);

        return $this->appendBundleOptionPostMeta($product);
    }

    protected function appendBundleOptionPostMeta(Product $product): Product
    {
        if (!$product->relationLoaded('bundleItems')) {
            return $product;
        }

        $postIds = $product->bundleItems
            ->pluck('pivot.option_post_id')
            ->filter(fn ($postId) => filled($postId))
            ->map(fn ($postId) => (int) $postId)
            ->unique()
            ->values();

        if ($postIds->isEmpty()) {
            return $product;
        }

        $posts = Post::query()
            ->whereIn('id', $postIds)
            ->get(['id', 'title', 'slug'])
            ->keyBy(fn (Post $post) => (int) $post->id);

        $product->bundleItems->each(function (Product $bundleItem) use ($posts) {
            $postId = filled($bundleItem->pivot?->option_post_id ?? null)
                ? (int) $bundleItem->pivot->option_post_id
                : null;

            if (!$postId) {
                return;
            }

            $post = $posts->get($postId);
            $bundleItem->pivot->setAttribute('option_post_title', $post?->title);
            $bundleItem->pivot->setAttribute('option_post_slug', $post?->slug);
        });

        return $product;
    }

    protected function validateGroupedOrBundleItemVariants(array $items): void
    {
        $indexedItems = collect($items)
            ->map(function ($item, $index) {
                $productId = isset($item['id']) && is_numeric($item['id'])
                    ? (int) $item['id']
                    : 0;
                $variantId = isset($item['variant_id']) && is_numeric($item['variant_id'])
                    ? (int) $item['variant_id']
                    : null;

                return [
                    'index' => $index,
                    'product_id' => $productId,
                    'variant_id' => $variantId,
                ];
            })
            ->filter(fn (array $item) => $item['product_id'] > 0)
            ->values();

        if ($indexedItems->isEmpty()) {
            return;
        }

        $products = Product::query()
            ->whereIn('id', $indexedItems->pluck('product_id')->unique()->all())
            ->get(['id', 'type'])
            ->keyBy(fn (Product $product) => (int) $product->id);

        $configurableIds = $products
            ->filter(fn (Product $product) => $product->type === 'configurable')
            ->keys()
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();

        $indexedVariantItems = $indexedItems
            ->filter(fn (array $item) => $item['variant_id'] !== null)
            ->values();

        $allowedVariantPairs = [];
        if (!empty($configurableIds) && $indexedVariantItems->isNotEmpty()) {
            $allowedVariantPairs = DB::table('product_links')
                ->where('link_type', 'super_link')
                ->whereIn('product_id', $configurableIds)
                ->whereIn('linked_product_id', $indexedVariantItems->pluck('variant_id')->unique()->all())
                ->get(['product_id', 'linked_product_id'])
                ->mapWithKeys(fn ($link) => [
                    ((int) $link->product_id) . ':' . ((int) $link->linked_product_id) => true,
                ])
                ->all();
        }

        $messages = [];

        foreach ($indexedItems as $item) {
            $product = $products->get($item['product_id']);
            if (!$product) {
                continue;
            }

            if ($product->type !== 'configurable') {
                if ($item['variant_id'] === null) {
                    continue;
                }
                $messages["grouped_items.{$item['index']}.variant_id"][] = 'Biến thể chỉ được gắn với sản phẩm cha dạng configurable.';
                continue;
            }

            if ($item['variant_id'] === null) {
                $messages["grouped_items.{$item['index']}.variant_id"][] = 'San pham configurable trong bundle hoac grouped phai chon mot bien the cu the de ghi nhan dung ton kho.';
                continue;
            }

            if ($item['variant_id'] === null) {
                $messages["grouped_items.{$item['index']}.variant_id"][] = 'Sáº£n pháº©m configurable trong bundle hoáº·c grouped pháº£i chá»n má»™t biáº¿n thá»ƒ cá»¥ thá»ƒ Ä‘á»ƒ ghi nháº­n Ä‘Ãºng tá»“n kho.';
                continue;
            }

            $pairKey = $item['product_id'] . ':' . $item['variant_id'];
            if (!isset($allowedVariantPairs[$pairKey])) {
                $messages["grouped_items.{$item['index']}.variant_id"][] = 'Biến thể đã chọn không thuộc sản phẩm cha này.';
            }
        }

        if (!empty($messages)) {
            throw ValidationException::withMessages($messages);
        }
    }

    protected function loadProductResource(Product $product): Product
    {
        return $this->appendSupplierMeta($product->load($this->productResourceRelations()));
    }

    protected function generateUniqueAttributeCode(string $seed): string
    {
        $base = Str::of((string) $seed)
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', '_')
            ->trim('_')
            ->toString();

        $base = $base !== '' ? $base : 'variant_attribute';
        $candidate = Str::limit($base, 64, '');
        $suffix = 1;

        while (Attribute::query()->where('code', $candidate)->exists()) {
            $candidate = Str::limit($base, max(1, 64 - strlen((string) $suffix) - 1), '') . '_' . $suffix;
            $suffix++;
        }

        return $candidate;
    }

    protected function resolveConfigurableConversionAttribute(Product $product, ?int $attributeId, ?string $attributeName): Attribute
    {
        if ($attributeId) {
            $attribute = Attribute::query()->findOrFail($attributeId);

            if (!in_array($attribute->frontend_type, ['select', 'multiselect'], true)) {
                throw ValidationException::withMessages([
                    'attribute_id' => ['Thuộc tính biến thể phải có kiểu chọn danh sách để dùng cho sản phẩm có biến thể.'],
                ]);
            }

            $attribute->forceFill([
                'is_variant' => true,
                'status' => true,
            ])->save();

            return $attribute;
        }

        $resolvedName = trim((string) $attributeName);
        if ($resolvedName === '') {
            $resolvedName = 'Mẫu';
        }

        $existingAttribute = Attribute::query()
            ->where('entity_type', 'product')
            ->where('account_id', $product->account_id)
            ->whereRaw('LOWER(name) = ?', [Str::lower($resolvedName)])
            ->whereIn('frontend_type', ['select', 'multiselect'])
            ->first();

        if ($existingAttribute) {
            $existingAttribute->forceFill([
                'is_variant' => true,
                'status' => true,
            ])->save();

            return $existingAttribute;
        }

        return Attribute::query()->create([
            'account_id' => $product->account_id,
            'name' => $resolvedName,
            'entity_type' => 'product',
            'code' => $this->generateUniqueAttributeCode('variant_' . $resolvedName),
            'frontend_type' => 'select',
            'swatch_type' => null,
            'is_filterable' => false,
            'is_filterable_frontend' => false,
            'is_filterable_backend' => true,
            'is_required' => false,
            'is_variant' => true,
            'status' => true,
        ]);
    }

    protected function ensureVariantAttributeOptions(Attribute $attribute, array $values): void
    {
        $normalizedValues = collect($values)
            ->map(fn ($value) => trim((string) $value))
            ->filter()
            ->unique()
            ->values();

        foreach ($normalizedValues as $index => $value) {
            AttributeOption::query()->firstOrCreate(
                [
                    'attribute_id' => $attribute->id,
                    'value' => $value,
                ],
                [
                    'order' => $index,
                ]
            );
        }
    }

    protected function prepareSimpleToConfigurableVariants(Product $product, array $variants, string $parentSku): array
    {
        $messages = [];
        $prepared = [];
        $reservedSkus = array_values(array_filter([$parentSku, $product->sku]));
        $seenValues = [];

        foreach ($variants as $index => $variantData) {
            $variantValue = trim((string) ($variantData['value'] ?? ''));
            if ($variantValue === '') {
                $messages["variants.{$index}.value"][] = 'Mỗi biến thể cần có giá trị thuộc tính để phân biệt.';
                continue;
            }

            $valueKey = Str::lower(Str::squish($variantValue));
            if (isset($seenValues[$valueKey])) {
                $messages["variants.{$index}.value"][] = 'Giá trị thuộc tính biến thể đang bị trùng.';
                continue;
            }
            $seenValues[$valueKey] = true;

            $isOriginalVariant = $index === 0;
            $resolvedSku = $isOriginalVariant
                ? $product->sku
                : $this->productSkuService->normalize($variantData['sku'] ?? null);

            if (!$isOriginalVariant) {
                if (
                    $resolvedSku === null
                    || in_array($resolvedSku, $reservedSkus, true)
                    || $this->productSkuService->skuExists($resolvedSku)
                ) {
                    $resolvedSku = $this->productSkuService->generateVariantSku($parentSku, null, $reservedSkus);
                }

                $reservedSkus[] = $resolvedSku;
            }

            $prepared[] = [
                'is_original' => $isOriginalVariant,
                'value' => $variantValue,
                'name' => trim((string) ($variantData['name'] ?? '')) ?: ($isOriginalVariant ? $product->name : ($product->name . ' - ' . $variantValue)),
                'sku' => $resolvedSku,
                'price' => is_numeric($variantData['price'] ?? null) ? (float) $variantData['price'] : null,
                'expected_cost' => is_numeric($variantData['expected_cost'] ?? null) ? (float) $variantData['expected_cost'] : null,
                'weight' => filled($variantData['weight'] ?? null) ? (string) $variantData['weight'] : null,
                'inventory_unit_id' => is_numeric($variantData['inventory_unit_id'] ?? null)
                    ? (int) $variantData['inventory_unit_id']
                    : null,
            ];
        }

        if (empty($prepared)) {
            $messages['variants'][] = 'Cần ít nhất một biến thể để hoàn tất chuyển đổi.';
        }

        if (!empty($messages)) {
            throw ValidationException::withMessages($messages);
        }

        return $prepared;
    }

    protected function cloneProductDecoratorsToParent(Product $source, Product $target, ?int $excludedAttributeId = null): void
    {
        foreach ($source->images as $image) {
            ProductImage::query()->create([
                'product_id' => $target->id,
                'image_url' => $image->image_url,
                'is_primary' => $image->is_primary,
                'sort_order' => $image->sort_order,
                'file_name' => $image->file_name,
                'file_size' => $image->file_size,
            ]);
        }

        foreach ($source->attributeValues as $attributeValue) {
            if ($excludedAttributeId !== null && (int) $attributeValue->attribute_id === $excludedAttributeId) {
                continue;
            }

            ProductAttributeValue::query()->create([
                'product_id' => $target->id,
                'attribute_id' => $attributeValue->attribute_id,
                'value' => $attributeValue->value,
            ]);
        }
    }

    protected function copyRelatedProductsToParent(Product $source, Product $target): void
    {
        foreach ($source->relatedProducts as $relatedProduct) {
            $target->relatedProducts()->syncWithoutDetaching([
                $relatedProduct->id => [
                    'link_type' => 'related',
                    'position' => $relatedProduct->pivot->position ?? 0,
                    'option_title' => $relatedProduct->pivot->option_title ?? null,
                ],
            ]);
        }
    }

    protected function buildConvertedParentPayload(Product $product, string $parentName, string $parentSku): array
    {
        return [
            'account_id' => $product->account_id,
            'type' => 'configurable',
            'name' => $parentName,
            'slug' => $this->productSkuService->generateUniqueSlug($parentName),
            'description' => $product->description,
            'specifications' => $product->specifications,
            'price' => $product->price,
            'price_type' => 'fixed',
            'cost_price' => null,
            'expected_cost' => $product->expected_cost,
            'special_price' => $product->special_price,
            'special_price_from' => $product->special_price_from,
            'special_price_to' => $product->special_price_to,
            'imported_quantity_total' => 0,
            'imported_value_total' => 0,
            'category_id' => $product->category_id,
            'stock_quantity' => 0,
            'damaged_quantity' => 0,
            'status' => $product->status,
            'is_featured' => $product->is_featured,
            'is_new' => $product->is_new,
            'sku' => $parentSku,
            'meta_title' => $product->meta_title,
            'meta_description' => $product->meta_description,
            'meta_keywords' => $product->meta_keywords,
            'weight' => $product->weight,
            'inventory_unit_id' => $product->inventory_unit_id,
            'inventory_import_starred' => $product->inventory_import_starred,
            'supplier_id' => $product->supplier_id,
            'video_url' => $product->video_url,
            'additional_info' => $product->additional_info,
            'bundle_title' => null,
            'site_domain_id' => $product->site_domain_id,
        ];
    }

    protected function prepareProductSku(array &$validated, ?Product $product = null): void
    {
        $normalizedSku = $this->productSkuService->normalize($validated['sku'] ?? $product?->sku);

        if ($normalizedSku === null) {
            $normalizedSku = $this->productSkuService->ensureUniqueSku(
                null,
                $validated['name'] ?? $product?->name,
                $product?->id
            );
        } elseif ($this->productSkuService->skuExists($normalizedSku, $product?->id)) {
            throw ValidationException::withMessages([
                'sku' => ['Mã SKU này đã được sử dụng bởi một sản phẩm khác.'],
            ]);
        }

        $validated['sku'] = $normalizedSku;
    }

    protected function prepareVariantPayloads(array $incomingVariants, string $parentSku, ?Product $product = null): array
    {
        $preparedVariants = [];
        $messages = [];
        $reservedSkus = array_values(array_filter([$parentSku]));
        $ownedVariantIds = $product
            ? array_flip($product->linkedProducts()
                ->wherePivot('link_type', 'super_link')
                ->pluck('products.id')
                ->map(fn ($id) => (int) $id)
                ->all())
            : [];
        $sharedVariantIds = ($product && !empty($ownedVariantIds))
            ? DB::table('product_links')
                ->where('link_type', 'super_link')
                ->whereIn('linked_product_id', array_keys($ownedVariantIds))
                ->where('product_id', '<>', $product->id)
                ->pluck('linked_product_id')
                ->map(fn ($id) => (int) $id)
                ->flip()
                ->all()
            : [];

        foreach ($incomingVariants as $index => $variantData) {
            $variantId = isset($variantData['id']) && is_numeric($variantData['id'])
                ? (int) $variantData['id']
                : null;
            $isExistingVariant = $variantId !== null;

            if ($isExistingVariant && !isset($ownedVariantIds[$variantId])) {
                $messages["variants.{$index}.id"][] = 'Biến thể này không thuộc sản phẩm hiện tại.';
                continue;
            }

            if ($isExistingVariant && isset($sharedVariantIds[$variantId])) {
                $messages["variants.{$index}.id"][] = 'Biến thể này đang được gán cho sản phẩm cha khác. Vui lòng tạo biến thể riêng cho sản phẩm hiện tại.';
                continue;
            }

            $normalizedSku = $this->productSkuService->normalize($variantData['sku'] ?? null);

            if ($isExistingVariant) {
                if ($normalizedSku === null) {
                    $messages["variants.{$index}.sku"][] = 'Mỗi biến thể phải có mã SKU riêng.';
                } elseif ($normalizedSku === $parentSku) {
                    $messages["variants.{$index}.sku"][] = 'Mã biến thể không được trùng với mã sản phẩm cha.';
                } elseif (in_array($normalizedSku, $reservedSkus, true)) {
                    $messages["variants.{$index}.sku"][] = 'Mã biến thể đang bị trùng trong danh sách hiện tại.';
                } elseif ($this->productSkuService->skuExists($normalizedSku, $variantId)) {
                    $messages["variants.{$index}.sku"][] = 'Mã biến thể này đã được sử dụng bởi một sản phẩm khác.';
                }
            } else {
                if (
                    $normalizedSku === null
                    || $normalizedSku === $parentSku
                    || in_array($normalizedSku, $reservedSkus, true)
                    || $this->productSkuService->skuExists($normalizedSku)
                ) {
                    $normalizedSku = $this->productSkuService->generateVariantSku($parentSku, null, $reservedSkus);
                }
            }

            if ($normalizedSku !== null) {
                $reservedSkus[] = $normalizedSku;
            }

            $variantData['sku'] = $normalizedSku;
            $preparedVariants[] = $variantData;
        }

        if (!empty($messages)) {
            throw ValidationException::withMessages($messages);
        }

        return $preparedVariants;
    }

    protected function throwSkuConstraintValidation(QueryException $exception, ?string $message = null): never
    {
        $sqlState = (string) ($exception->errorInfo[0] ?? $exception->getCode());
        $normalizedMessage = Str::lower($exception->getMessage());

        if (in_array($sqlState, ['23000', '23505'], true)) {
            if (Str::contains($normalizedMessage, [
                'product_links_unique_super_link_variant',
                'linked_product_id',
                'super_link',
            ])) {
                throw ValidationException::withMessages([
                    'variants' => ['Mỗi biến thể chỉ được thuộc về một sản phẩm cha. Dữ liệu hiện tại đang bị trùng, vui lòng tải lại và thử lại.'],
                ]);
            }

            if (Str::contains($normalizedMessage, [
                'products_sku_unique',
                'products_sku_key',
                'products.sku',
                ' sku ',
            ])) {
                throw ValidationException::withMessages([
                    'sku' => [$message ?? 'Mã SKU này đã được sử dụng bởi một sản phẩm khác.'],
                ]);
            }
        }

        throw $exception;
    }

    protected function applyLegacyExpectedCostAlias(Request $request, array &$validated): void
    {
        if (array_key_exists('cost_price', $validated)) {
            unset($validated['cost_price']);
        }

        if (array_key_exists('expected_cost', $validated)) {
            return;
        }

        if (!array_key_exists('cost_price', $request->all())) {
            return;
        }

        $validated['expected_cost'] = $request->input('cost_price');
    }

    protected function normalizeSupplierIds(Request $request, array $validated = []): array
    {
        $rawSupplierIds = $validated['supplier_ids'] ?? $request->input('supplier_ids', []);
        $legacySupplierId = $validated['supplier_id'] ?? $request->input('supplier_id');

        if (!is_array($rawSupplierIds)) {
            $rawSupplierIds = is_string($rawSupplierIds) ? explode(',', $rawSupplierIds) : [$rawSupplierIds];
        }

        if ($legacySupplierId !== null && $legacySupplierId !== '' && !in_array($legacySupplierId, $rawSupplierIds, true)) {
            $rawSupplierIds[] = $legacySupplierId;
        }

        return collect($rawSupplierIds)
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    protected function syncProductSuppliers(Product $product, array $supplierIds): array
    {
        $supplierIds = collect($supplierIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        $syncData = [];
        foreach ($supplierIds as $supplierId) {
            $syncData[$supplierId] = ['account_id' => $product->account_id];
        }

        $resolvedSupplierId = null;
        if ($product->supplier_id && in_array((int) $product->supplier_id, $supplierIds, true)) {
            $resolvedSupplierId = (int) $product->supplier_id;
        } elseif (!empty($supplierIds)) {
            $resolvedSupplierId = $supplierIds[0];
        }

        $product->suppliers()->sync($syncData);
        $product->forceFill([
            'supplier_id' => $resolvedSupplierId,
        ])->save();

        return $supplierIds;
    }

    protected function syncSuppliersToVariants(Product $product, array $supplierIds): void
    {
        $variantIds = $product->linkedProducts()
            ->wherePivot('link_type', 'super_link')
            ->pluck('products.id');

        if ($variantIds->isEmpty()) {
            return;
        }

        Product::query()
            ->whereIn('id', $variantIds)
            ->get()
            ->each(function (Product $variant) use ($supplierIds) {
                $this->syncProductSuppliers($variant, $supplierIds);
            });
    }

    protected function applySupplierFilter(Builder $query, array $supplierIds, bool $includeUnassigned = false): void
    {
        $supplierIds = collect($supplierIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($supplierIds) && !$includeUnassigned) {
            return;
        }

        $query->where(function (Builder $builder) use ($supplierIds, $includeUnassigned) {
            if (!empty($supplierIds)) {
                $builder
                    ->whereHas('suppliers', function (Builder $supplierQuery) use ($supplierIds) {
                        $supplierQuery->whereIn('suppliers.id', $supplierIds);
                    })
                    ->orWhereIn('supplier_id', $supplierIds)
                    ->orWhereHas('supplierPrices', function (Builder $priceQuery) use ($supplierIds) {
                        $priceQuery->whereIn('supplier_id', $supplierIds);
                    });
            }

            if ($includeUnassigned) {
                if (!empty($supplierIds)) {
                    $builder->orWhere(function (Builder $unassignedQuery) {
                        $unassignedQuery
                            ->doesntHave('suppliers')
                            ->whereNull('supplier_id')
                            ->whereDoesntHave('supplierPrices');
                    });
                } else {
                    $builder
                        ->doesntHave('suppliers')
                        ->whereNull('supplier_id')
                        ->whereDoesntHave('supplierPrices');
                }
            }
        });
    }

    protected function usesPostgresSearchDriver(): bool
    {
        return DB::connection()->getDriverName() === 'pgsql';
    }

    protected function loweredSearchExpression(string $column): string
    {
        $column = "COALESCE({$column}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(immutable_unaccent({$column}))";
        }

        return "LOWER({$column})";
    }

    protected function compactSearchExpression(string $column): string
    {
        $column = "COALESCE({$column}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(REGEXP_REPLACE(immutable_unaccent({$column}), '[^a-zA-Z0-9]', '', 'g'))";
        }

        $expression = $column;
        foreach (['-', '_', ' ', '/', '.', '#'] as $character) {
            $expression = "REPLACE({$expression}, '{$character}', '')";
        }

        return "LOWER({$expression})";
    }

    protected function normalizedWordsExpression(string $column): string
    {
        $column = "COALESCE({$column}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(REGEXP_REPLACE(immutable_unaccent({$column}), '[^a-zA-Z0-9]+', ' ', 'g'))";
        }

        return "LOWER({$column})";
    }

    protected function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }

    protected function normalizeCodeSearchText(string $value): string
    {
        return (string) Str::of($value)
            ->lower()
            ->ascii()
            ->replaceMatches('/\s+/', ' ')
            ->trim();
    }

    protected function normalizeNameSearchText(string $value): string
    {
        return (string) Str::of($value)
            ->lower()
            ->ascii()
            ->replaceMatches('/[^a-z0-9]+/', ' ')
            ->squish();
    }

    protected function compactSearchText(string $value): string
    {
        return preg_replace('/[^a-z0-9]+/', '', $this->normalizeNameSearchText($value)) ?? '';
    }

    protected function splitCompactNameSearchTokens(string $value): array
    {
        if ($value === '') {
            return [];
        }

        preg_match_all('/[a-z]+|\d+/i', $value, $matches);

        return collect($matches[0] ?? [])
            ->map(fn ($token) => trim((string) $token))
            ->filter(fn ($token) => mb_strlen($token) >= 2)
            ->unique()
            ->values()
            ->all();
    }

    protected function extractNameSearchTokens(string $normalizedName, string $compactName): array
    {
        $normalizedTokens = collect(preg_split('/\s+/', $normalizedName, -1, PREG_SPLIT_NO_EMPTY))
            ->map(fn ($token) => trim((string) $token))
            ->filter(fn ($token) => mb_strlen($token) >= 2)
            ->values();

        if ($normalizedTokens->count() > 1) {
            return $normalizedTokens
                ->unique()
                ->take(12)
                ->values()
                ->all();
        }

        $compactTokens = collect($this->splitCompactNameSearchTokens($compactName));

        if ($compactTokens->count() > 1) {
            return $compactTokens
                ->take(12)
                ->values()
                ->all();
        }

        return $compactTokens
            ->merge($normalizedTokens)
            ->filter(fn ($token) => mb_strlen((string) $token) >= 2)
            ->unique()
            ->take(12)
            ->values()
            ->all();
    }

    protected function attachActualStockSubqueries(Builder $query, Request $request): array
    {
        $accountId = (int) $request->header('X-Account-Id');

        $liveBatchStockSub = DB::table('inventory_batches')
            ->selectRaw('inventory_batches.product_id')
            ->selectRaw('COALESCE(SUM(inventory_batches.remaining_quantity), 0) AS available_stock')
            ->where('inventory_batches.remaining_quantity', '>', 0)
            ->where(function ($builder) {
                $builder
                    ->whereNull('inventory_batches.source_type')
                    ->orWhere('inventory_batches.source_type', '!=', self::OVERSOLD_RESERVE_SOURCE);
            })
            ->groupBy('inventory_batches.product_id');

        if ($accountId > 0) {
            $liveBatchStockSub->where('inventory_batches.account_id', $accountId);
        }

        $oversoldReservedSub = DB::table('inventory_batch_allocations')
            ->join('inventory_batches', 'inventory_batches.id', '=', 'inventory_batch_allocations.inventory_batch_id')
            ->selectRaw('inventory_batch_allocations.product_id')
            ->selectRaw('COALESCE(SUM(inventory_batch_allocations.quantity), 0) AS total_reserved')
            ->where('inventory_batches.source_type', self::OVERSOLD_RESERVE_SOURCE)
            ->groupBy('inventory_batch_allocations.product_id');

        if ($accountId > 0) {
            $oversoldReservedSub->where('inventory_batches.account_id', $accountId);
        }

        $pendingOutboundQtySub = $this->buildPendingOutboundQuantitySubquery($request);
        $pendingReturnQtySub = $this->buildPendingReturnQuantitySubquery($request);

        $query->leftJoinSub($liveBatchStockSub, 'live_batch_stock', function ($join) {
            $join->on('live_batch_stock.product_id', '=', 'products.id');
        });

        $query->leftJoinSub($oversoldReservedSub, 'oversold_reserved', function ($join) {
            $join->on('oversold_reserved.product_id', '=', 'products.id');
        });

        $query->leftJoinSub($pendingOutboundQtySub, 'pending_outbound', function ($join) {
            $join->on('pending_outbound.product_id', '=', 'products.id');
        });

        $query->leftJoinSub($pendingReturnQtySub, 'pending_returns', function ($join) {
            $join->on('pending_returns.product_id', '=', 'products.id');
        });

        $baseStockSql = "
            CASE
                WHEN live_batch_stock.product_id IS NOT NULL OR oversold_reserved.product_id IS NOT NULL
                    THEN COALESCE(live_batch_stock.available_stock, 0) - COALESCE(oversold_reserved.total_reserved, 0)
                ELSE COALESCE(products.stock_quantity, 0)
            END
        ";
        $pendingExportQtySql = 'COALESCE(pending_outbound.pending_export_quantity, 0)';
        $pendingReturnQtySql = 'COALESCE(pending_returns.pending_return_quantity, 0)';
        $actualStockSql = '(' . $baseStockSql . ' - ' . $pendingExportQtySql . ' + ' . $pendingReturnQtySql . ')';

        return [
            'base_stock_sql' => $baseStockSql,
            'pending_export_sql' => $pendingExportQtySql,
            'pending_return_sql' => $pendingReturnQtySql,
            'actual_stock_sql' => $actualStockSql,
        ];
    }

    protected function buildPendingOutboundQuantitySubquery(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $manualExportScopeSql = "
            CASE
                WHEN inventory_documents.reference_type = 'order'
                    AND inventory_documents.reference_id IS NOT NULL
                    THEN inventory_documents.reference_id
                ELSE -inventory_documents.id
            END
        ";

        $manualExportQtySub = DB::table('inventory_document_items')
            ->join('inventory_documents', 'inventory_documents.id', '=', 'inventory_document_items.inventory_document_id')
            ->selectRaw($manualExportScopeSql . ' AS order_id')
            ->selectRaw('inventory_document_items.product_id')
            ->selectRaw('COALESCE(SUM(inventory_document_items.quantity), 0) AS exported_quantity')
            ->where('inventory_documents.type', 'export')
            ->where('inventory_documents.status', 'completed')
            ->groupByRaw($manualExportScopeSql . ', inventory_document_items.product_id');

        if ($accountId > 0) {
            $manualExportQtySub->where('inventory_documents.account_id', $accountId);
        }

        if (Schema::hasColumn('inventory_documents', 'deleted_at')) {
            $manualExportQtySub->whereNull('inventory_documents.deleted_at');
        }

        $pendingOrderItemsSub = OrderItem::query()
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->selectRaw('order_items.order_id')
            ->selectRaw('order_items.product_id')
            ->selectRaw('COALESCE(SUM(order_items.quantity), 0) AS ordered_quantity')
            ->whereNotNull('order_items.product_id')
            ->groupBy('order_items.order_id', 'order_items.product_id');

        $this->applyPendingOutboundEligibleOrderScope($pendingOrderItemsSub, $request);

        return DB::query()
            ->fromSub($pendingOrderItemsSub, 'pending_order_items')
            ->leftJoinSub($manualExportQtySub, 'manual_exports', function ($join) {
                $join
                    ->on('manual_exports.order_id', '=', 'pending_order_items.order_id')
                    ->on('manual_exports.product_id', '=', 'pending_order_items.product_id');
            })
            ->selectRaw('pending_order_items.product_id')
            ->selectRaw('COALESCE(SUM(GREATEST(pending_order_items.ordered_quantity - COALESCE(manual_exports.exported_quantity, 0), 0)), 0) AS pending_export_quantity')
            ->groupBy('pending_order_items.product_id');
    }

    protected function buildPendingReturnQuantitySubquery(Request $request)
    {
        $pendingReturnItemsSub = OrderItem::query()
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->selectRaw('order_items.order_id')
            ->selectRaw('order_items.product_id')
            ->selectRaw('COALESCE(SUM(order_items.quantity), 0) AS pending_return_quantity')
            ->whereNotNull('order_items.product_id')
            ->groupBy('order_items.order_id', 'order_items.product_id');

        $this->applyPendingReturnEligibleOrderScope($pendingReturnItemsSub, $request);

        return DB::query()
            ->fromSub($pendingReturnItemsSub, 'pending_return_items')
            ->selectRaw('pending_return_items.product_id')
            ->selectRaw('COALESCE(SUM(pending_return_items.pending_return_quantity), 0) AS pending_return_quantity')
            ->groupBy('pending_return_items.product_id');
    }

    protected function applyPendingOutboundEligibleOrderScope($query, Request $request): void
    {
        $accountId = (int) $request->header('X-Account-Id');

        if ($accountId > 0) {
            $query->where('orders.account_id', $accountId);
        }

        if (Schema::hasColumn('orders', 'deleted_at')) {
            $query->whereNull('orders.deleted_at');
        }

        $query->where(function ($builder) {
            $builder
                ->where('orders.order_kind', Order::KIND_OFFICIAL)
                ->orWhereNull('orders.order_kind')
                ->orWhere('orders.order_kind', '');
        });

        $this->applyPendingOutboundInvalidStatusFilter($query, 'orders.status');

        $query
            ->where(function ($builder) {
                $builder
                    ->whereNull('orders.type')
                    ->orWhere('orders.type', '!=', 'inventory_export');
            })
            ->where(function ($builder) {
                $builder
                    ->whereNull('orders.shipping_tracking_code')
                    ->orWhere('orders.shipping_tracking_code', '');
            })
            ->whereNotExists(function ($shipmentQuery) {
                $shipmentQuery
                    ->select(DB::raw(1))
                    ->from('shipments')
                    ->whereColumn('shipments.order_id', 'orders.id');

                $this->applyActiveShipmentFilters($shipmentQuery, 'shipments');
            });
    }

    protected function applyPendingReturnEligibleOrderScope($query, Request $request): void
    {
        $accountId = (int) $request->header('X-Account-Id');

        if ($accountId > 0) {
            $query->where('orders.account_id', $accountId);
        }

        if (Schema::hasColumn('orders', 'deleted_at')) {
            $query->whereNull('orders.deleted_at');
        }

        $query->where(function ($builder) {
            $builder
                ->where('orders.order_kind', Order::KIND_OFFICIAL)
                ->orWhereNull('orders.order_kind')
                ->orWhere('orders.order_kind', '');
        });

        $query
            ->where(function ($builder) {
                $builder
                    ->whereNull('orders.type')
                    ->orWhere('orders.type', '!=', 'inventory_export');
            })
            ->whereIn('orders.status', ['pending_return', 'returned']);

        $this->orderInventorySlipService->applyReturnSlipStateFilter($query, 'missing');
    }

    protected function applyActiveShipmentFilters($query, string $shipmentTable = 'shipments'): void
    {
        if (Schema::hasColumn('shipments', 'deleted_at')) {
            $query->whereNull("{$shipmentTable}.deleted_at");
        }

        $query->whereNotIn("{$shipmentTable}.shipment_status", ['canceled']);
    }

    protected function applyPendingOutboundInvalidStatusFilter($query, string $column): void
    {
        $statusExpression = "LOWER(COALESCE({$column}, ''))";

        foreach ([
            'cancel',
            'canceled',
            'cancelled',
            'return',
            'returned',
            'returning',
            'pending return',
            'pending_return',
            'draft',
            'nhap',
            'huy',
            'hoan',
            'void',
        ] as $keyword) {
            $query->whereRaw($statusExpression . ' NOT LIKE ?', ['%' . $keyword . '%']);
        }
    }

    protected function buildActualStockMap(Request $request, array $productIds): array
    {
        $normalizedIds = collect($productIds)
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values();

        if ($normalizedIds->isEmpty()) {
            return [];
        }

        $stockQuery = Product::withTrashed()
            ->select(['products.id', 'products.stock_quantity'])
            ->whereIn('products.id', $normalizedIds->all());

        $stockContext = $this->attachActualStockSubqueries($stockQuery, $request);

        return $stockQuery
            ->selectRaw($stockContext['actual_stock_sql'] . ' AS actual_stock')
            ->get()
            ->mapWithKeys(function (Product $product) {
                $actualStock = (int) round((float) ($product->actual_stock ?? $product->stock_quantity ?? 0));

                return [(int) $product->id => $actualStock];
            })
            ->all();
    }

    protected function syncProductStocksFromInventory(Product $product, array $stockMap): Product
    {
        $applyStock = function (Product $item) use ($stockMap): void {
            $productId = (int) ($item->id ?? 0);
            if ($productId <= 0) {
                return;
            }

            $actualStock = array_key_exists($productId, $stockMap)
                ? (int) $stockMap[$productId]
                : (int) round((float) ($item->actual_stock ?? $item->stock_quantity ?? 0));
            $item->setAttribute('actual_stock', $actualStock);
            $item->setAttribute('stock_quantity', $actualStock);
        };

        $applyStock($product);

        foreach (['variations', 'groupedItems', 'bundleItems', 'linkedProducts'] as $relation) {
            if (!$product->relationLoaded($relation)) {
                continue;
            }

            $product->{$relation}->each(function ($relatedProduct) use ($applyStock) {
                if ($relatedProduct instanceof Product) {
                    $applyStock($relatedProduct);
                }
            });
        }

        return $product;
    }

    protected function looksLikeProductCodeSearch(string $rawSearch): bool
    {
        $trimmed = trim($rawSearch);
        if ($trimmed === '') {
            return false;
        }

        $compactSearch = $this->compactSearchText($trimmed);
        if ($compactSearch === '') {
            return false;
        }

        $hasDigit = preg_match('/\d/u', $trimmed) === 1;
        $hasSeparator = preg_match('/[-_.\/\\\\]/u', $trimmed) === 1;
        $hasWhitespace = preg_match('/\s/u', $trimmed) === 1;
        $allowedCharactersOnly = preg_match('/^[\pL\pN\s\-_.\/\\\\]+$/u', $trimmed) === 1;

        if (!$allowedCharactersOnly) {
            return false;
        }

        if (!$hasWhitespace && ($hasDigit || $hasSeparator)) {
            return true;
        }

        return ctype_digit($compactSearch) && strlen($compactSearch) >= 3;
    }

    protected function applyProductSearch(Builder $query, string $rawSearch): array
    {
        $trimmedSearch = trim($rawSearch);
        if ($trimmedSearch === '') {
            return [null, []];
        }

        if ($this->looksLikeProductCodeSearch($trimmedSearch)) {
            $codeProbeQuery = clone $query;
            [$codeSearchRankingSql] = $this->applyProductCodeSearch($codeProbeQuery, $trimmedSearch);

            if ($codeSearchRankingSql !== null && $codeProbeQuery->exists()) {
                return $this->applyProductCodeSearch($query, $trimmedSearch);
            }
        }

        return $this->applyProductNameSearch($query, $trimmedSearch);
    }

    protected function applyProductCodeSearch(Builder $query, string $rawSearch): array
    {
        $normalizedCode = $this->normalizeCodeSearchText($rawSearch);
        $compactCode = $this->compactSearchText($rawSearch);

        if ($normalizedCode === '' && $compactCode === '') {
            return [null, []];
        }

        $skuExpr = $this->loweredSearchExpression('products.sku');
        $compactSkuExpr = $this->compactSearchExpression('products.sku');
        $exactCodeSearch = function (Builder $searchQuery) use ($skuExpr, $compactSkuExpr, $normalizedCode, $compactCode) {
            $searchQuery
                ->where(function (Builder $directQuery) use ($skuExpr, $compactSkuExpr, $normalizedCode, $compactCode) {
                    $directQuery->whereRaw("{$skuExpr} = ?", [$normalizedCode]);

                    if ($compactCode !== '') {
                        $directQuery->orWhereRaw("{$compactSkuExpr} = ?", [$compactCode]);
                    }
                })
                ->orWhereHas('variations', function (Builder $variationQuery) use ($normalizedCode, $compactCode) {
                    $variationSkuExpr = $this->loweredSearchExpression('sku');
                    $variationCompactSkuExpr = $this->compactSearchExpression('sku');

                    $variationQuery->where(function (Builder $directVariationQuery) use ($variationSkuExpr, $variationCompactSkuExpr, $normalizedCode, $compactCode) {
                        $directVariationQuery->whereRaw("{$variationSkuExpr} = ?", [$normalizedCode]);

                        if ($compactCode !== '') {
                            $directVariationQuery->orWhereRaw("{$variationCompactSkuExpr} = ?", [$compactCode]);
                        }
                    });
                });

        };

        $hasExactCodeMatch = (clone $query)->where($exactCodeSearch)->exists();

        if ($hasExactCodeMatch) {
            $searchRankingParts = [
                "CASE WHEN {$skuExpr} = ? THEN 5000 ELSE 0 END",
            ];
            $searchRankingBindings = [$normalizedCode];

            if ($compactCode !== '') {
                $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} = ? THEN 4900 ELSE 0 END";
                $searchRankingBindings[] = $compactCode;
            }

            $searchRankingSql = '(' . implode(' + ', $searchRankingParts) . ')';
            $query->selectRaw("{$searchRankingSql} AS search_score", $searchRankingBindings);
            $query->where($exactCodeSearch);

            return [$searchRankingSql, $searchRankingBindings];
        }

        $codePrefixLike = $this->escapeLike($normalizedCode) . '%';
        $codeContainsLike = '%' . $this->escapeLike($normalizedCode) . '%';
        $compactCodePrefixLike = $compactCode !== '' ? $this->escapeLike($compactCode) . '%' : null;
        $compactCodeContainsLike = $compactCode !== '' ? '%' . $this->escapeLike($compactCode) . '%' : null;

        $searchRankingParts = [
            "CASE WHEN {$skuExpr} LIKE ? ESCAPE '\\' THEN 2400 ELSE 0 END",
            "CASE WHEN {$skuExpr} LIKE ? ESCAPE '\\' THEN 1800 ELSE 0 END",
        ];
        $searchRankingBindings = [
            $codePrefixLike,
            $codeContainsLike,
        ];

        if ($compactCodePrefixLike !== null) {
            $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} LIKE ? ESCAPE '\\' THEN 2300 ELSE 0 END";
            $searchRankingBindings[] = $compactCodePrefixLike;
        }

        if ($compactCodeContainsLike !== null) {
            $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} LIKE ? ESCAPE '\\' THEN 1700 ELSE 0 END";
            $searchRankingBindings[] = $compactCodeContainsLike;
        }

        $searchRankingSql = '(' . implode(' + ', $searchRankingParts) . ')';
        $query->selectRaw("{$searchRankingSql} AS search_score", $searchRankingBindings);
        $query->where(function (Builder $searchQuery) use ($skuExpr, $compactSkuExpr, $codeContainsLike, $compactCodeContainsLike) {
            $searchQuery
                ->where(function (Builder $directQuery) use ($skuExpr, $compactSkuExpr, $codeContainsLike, $compactCodeContainsLike) {
                    $directQuery->whereRaw("{$skuExpr} LIKE ? ESCAPE '\\'", [$codeContainsLike]);

                    if ($compactCodeContainsLike !== null) {
                        $directQuery->orWhereRaw("{$compactSkuExpr} LIKE ? ESCAPE '\\'", [$compactCodeContainsLike]);
                    }
                })
                ->orWhereHas('variations', function (Builder $variationQuery) use ($codeContainsLike, $compactCodeContainsLike) {
                    $variationSkuExpr = $this->loweredSearchExpression('sku');
                    $variationCompactSkuExpr = $this->compactSearchExpression('sku');

                    $variationQuery->where(function (Builder $directVariationQuery) use ($variationSkuExpr, $variationCompactSkuExpr, $codeContainsLike, $compactCodeContainsLike) {
                        $directVariationQuery->whereRaw("{$variationSkuExpr} LIKE ? ESCAPE '\\'", [$codeContainsLike]);

                        if ($compactCodeContainsLike !== null) {
                            $directVariationQuery->orWhereRaw("{$variationCompactSkuExpr} LIKE ? ESCAPE '\\'", [$compactCodeContainsLike]);
                        }
                    });
                });

        });

        return [$searchRankingSql, $searchRankingBindings];
    }

    protected function applyProductSearchAttributeValueLikeConstraint(Builder $query, string $likeValue): void
    {
        $valueExpr = $this->normalizedWordsExpression('value');

        $query->whereRaw("{$valueExpr} LIKE ? ESCAPE '\\'", [$likeValue]);
    }

    protected function applyBundleNamePhraseConstraint(Builder $query, string $nameContainsLike, ?string $compactNameContainsLike = null): void
    {
        $query->orWhereHas('bundleItems', function (Builder $bundleQuery) use ($nameContainsLike, $compactNameContainsLike) {
            $bundleOptionExpr = $this->normalizedWordsExpression('product_links.option_title');
            $bundleOptionCompactExpr = $this->compactSearchExpression('product_links.option_title');

            $bundleQuery->where(function (Builder $directBundleQuery) use ($bundleOptionExpr, $bundleOptionCompactExpr, $nameContainsLike, $compactNameContainsLike) {
                $directBundleQuery->whereRaw("{$bundleOptionExpr} LIKE ? ESCAPE '\\'", [$nameContainsLike]);

                if ($compactNameContainsLike !== null) {
                    $directBundleQuery->orWhereRaw("{$bundleOptionCompactExpr} LIKE ? ESCAPE '\\'", [$compactNameContainsLike]);
                }
            });
        });
    }

    protected function applyBundleNameTokenConstraint(Builder $query, array $tokenLikes): void
    {
        $query->orWhereHas('bundleItems', function (Builder $bundleQuery) use ($tokenLikes) {
            $bundleOptionExpr = $this->normalizedWordsExpression('product_links.option_title');
            $bundleOptionCompactExpr = $this->compactSearchExpression('product_links.option_title');

            $bundleQuery->where(function (Builder $directBundleQuery) use ($bundleOptionExpr, $bundleOptionCompactExpr, $tokenLikes) {
                foreach ($tokenLikes as $tokenLike) {
                    $directBundleQuery->where(function (Builder $segmentQuery) use ($bundleOptionExpr, $bundleOptionCompactExpr, $tokenLike) {
                        $segmentQuery
                            ->whereRaw("{$bundleOptionExpr} LIKE ? ESCAPE '\\'", [$tokenLike])
                            ->orWhereRaw("{$bundleOptionCompactExpr} LIKE ? ESCAPE '\\'", [$tokenLike]);
                    });
                }
            });
        });
    }

    protected function applyBundleNameAdjacentPhraseConstraint(Builder $query, array $adjacentPhraseLikes): void
    {
        $query->orWhereHas('bundleItems', function (Builder $bundleQuery) use ($adjacentPhraseLikes) {
            $bundleOptionExpr = $this->normalizedWordsExpression('product_links.option_title');

            $bundleQuery->where(function (Builder $directBundleQuery) use ($bundleOptionExpr, $adjacentPhraseLikes) {
                foreach ($adjacentPhraseLikes as $phraseLike) {
                    $directBundleQuery->orWhereRaw("{$bundleOptionExpr} LIKE ? ESCAPE '\\'", [$phraseLike]);
                }
            });
        });
    }

    protected function applyProductNamePhraseConstraint(Builder $query, string $nameContainsLike, ?string $compactNameContainsLike = null): void
    {
        $nameExpr = $this->normalizedWordsExpression('products.name');
        $compactNameExpr = $this->compactSearchExpression('products.name');

        $query
            ->where(function (Builder $directQuery) use ($nameExpr, $compactNameExpr, $nameContainsLike, $compactNameContainsLike) {
                $directQuery->whereRaw("{$nameExpr} LIKE ? ESCAPE '\\'", [$nameContainsLike]);

                if ($compactNameContainsLike !== null) {
                    $directQuery->orWhereRaw("{$compactNameExpr} LIKE ? ESCAPE '\\'", [$compactNameContainsLike]);
                }
            })
            ->orWhereHas('variations', function (Builder $variationQuery) use ($nameContainsLike, $compactNameContainsLike) {
                $variationNameExpr = $this->normalizedWordsExpression('name');
                $variationCompactNameExpr = $this->compactSearchExpression('name');

                $variationQuery->where(function (Builder $directVariationQuery) use ($variationNameExpr, $variationCompactNameExpr, $nameContainsLike, $compactNameContainsLike) {
                    $directVariationQuery->whereRaw("{$variationNameExpr} LIKE ? ESCAPE '\\'", [$nameContainsLike]);

                    if ($compactNameContainsLike !== null) {
                        $directVariationQuery->orWhereRaw("{$variationCompactNameExpr} LIKE ? ESCAPE '\\'", [$compactNameContainsLike]);
                    }
                });
            })
            ->orWhereHas('attributeValues', function (Builder $attributeValueQuery) use ($nameContainsLike) {
                $this->applyProductSearchAttributeValueLikeConstraint($attributeValueQuery, $nameContainsLike);
            })
            ->orWhereHas('variations.attributeValues', function (Builder $attributeValueQuery) use ($nameContainsLike) {
                $this->applyProductSearchAttributeValueLikeConstraint($attributeValueQuery, $nameContainsLike);
            });

        $this->applyBundleNamePhraseConstraint($query, $nameContainsLike, $compactNameContainsLike);
    }

    protected function applyProductNameTokenConstraint(Builder $query, array $tokenLikes, bool $includeSku = false): void
    {
        $nameExpr = $this->normalizedWordsExpression('products.name');
        $compactNameExpr = $this->compactSearchExpression('products.name');
        $compactSkuExpr = $includeSku ? $this->compactSearchExpression('products.sku') : null;

        $query
            ->where(function (Builder $directQuery) use ($nameExpr, $compactNameExpr, $compactSkuExpr, $tokenLikes) {
                foreach ($tokenLikes as $tokenLike) {
                    $directQuery->where(function (Builder $segmentQuery) use ($nameExpr, $compactNameExpr, $compactSkuExpr, $tokenLike) {
                        $segmentQuery
                            ->whereRaw("{$nameExpr} LIKE ? ESCAPE '\\'", [$tokenLike])
                            ->orWhereRaw("{$compactNameExpr} LIKE ? ESCAPE '\\'", [$tokenLike]);

                        if ($compactSkuExpr !== null) {
                            $segmentQuery->orWhereRaw("{$compactSkuExpr} LIKE ? ESCAPE '\\'", [$tokenLike]);
                        }
                    });
                }
            })
            ->orWhereHas('variations', function (Builder $variationQuery) use ($tokenLikes, $includeSku) {
                $variationNameExpr = $this->normalizedWordsExpression('name');
                $variationCompactNameExpr = $this->compactSearchExpression('name');
                $variationCompactSkuExpr = $includeSku ? $this->compactSearchExpression('sku') : null;

                foreach ($tokenLikes as $tokenLike) {
                    $variationQuery->where(function (Builder $segmentQuery) use ($variationNameExpr, $variationCompactNameExpr, $variationCompactSkuExpr, $tokenLike) {
                        $segmentQuery
                            ->whereRaw("{$variationNameExpr} LIKE ? ESCAPE '\\'", [$tokenLike])
                            ->orWhereRaw("{$variationCompactNameExpr} LIKE ? ESCAPE '\\'", [$tokenLike]);

                        if ($variationCompactSkuExpr !== null) {
                            $segmentQuery->orWhereRaw("{$variationCompactSkuExpr} LIKE ? ESCAPE '\\'", [$tokenLike]);
                        }
                    });
                }
            })
            ->orWhereHas('attributeValues', function (Builder $attributeValueQuery) use ($tokenLikes) {
                foreach ($tokenLikes as $tokenLike) {
                    $this->applyProductSearchAttributeValueLikeConstraint($attributeValueQuery, $tokenLike);
                }
            })
            ->orWhereHas('variations.attributeValues', function (Builder $attributeValueQuery) use ($tokenLikes) {
                foreach ($tokenLikes as $tokenLike) {
                    $this->applyProductSearchAttributeValueLikeConstraint($attributeValueQuery, $tokenLike);
                }
            });

        $this->applyBundleNameTokenConstraint($query, $tokenLikes);
    }

    protected function applyProductNameAdjacentPhraseConstraint(Builder $query, array $adjacentPhraseLikes): void
    {
        $nameExpr = $this->normalizedWordsExpression('products.name');

        $query
            ->where(function (Builder $directQuery) use ($nameExpr, $adjacentPhraseLikes) {
                foreach ($adjacentPhraseLikes as $phraseLike) {
                    $directQuery->orWhereRaw("{$nameExpr} LIKE ? ESCAPE '\\'", [$phraseLike]);
                }
            })
            ->orWhereHas('variations', function (Builder $variationQuery) use ($adjacentPhraseLikes) {
                $variationNameExpr = $this->normalizedWordsExpression('name');

                $variationQuery->where(function (Builder $directVariationQuery) use ($variationNameExpr, $adjacentPhraseLikes) {
                    foreach ($adjacentPhraseLikes as $phraseLike) {
                        $directVariationQuery->orWhereRaw("{$variationNameExpr} LIKE ? ESCAPE '\\'", [$phraseLike]);
                    }
                });
            });

        $this->applyBundleNameAdjacentPhraseConstraint($query, $adjacentPhraseLikes);
    }

    protected function applyProductNameSearch(Builder $query, string $rawSearch): array
    {
        $normalizedName = $this->normalizeNameSearchText($rawSearch);
        if ($normalizedName === '') {
            return [null, []];
        }

        $nameExpr = $this->normalizedWordsExpression('products.name');
        $compactNameExpr = $this->compactSearchExpression('products.name');
        $nameExact = $normalizedName;
        $namePrefixLike = $this->escapeLike($normalizedName) . '%';
        $nameContainsLike = '%' . $this->escapeLike($normalizedName) . '%';
        $compactName = $this->compactSearchText($rawSearch);
        $compactNameExact = $compactName !== '' ? $compactName : null;
        $compactNamePrefixLike = $compactName !== '' ? $this->escapeLike($compactName) . '%' : null;
        $compactNameContainsLike = $compactName !== '' ? '%' . $this->escapeLike($compactName) . '%' : null;
        $nameTokens = $this->extractNameSearchTokens($normalizedName, $compactName);
        $isCompactCompositeSearch = !preg_match('/\s/u', trim($rawSearch)) && count($nameTokens) > 1;
        $tokenLikes = array_map(
            fn ($token) => '%' . $this->escapeLike($token) . '%',
            $nameTokens
        );
        $adjacentPhraseLikes = collect($nameTokens)
            ->sliding(2)
            ->map(function ($tokens) {
                $phrase = collect($tokens)->implode(' ');

                return '%' . $this->escapeLike($phrase) . '%';
            })
            ->unique()
            ->values()
            ->all();

        $phraseRankingParts = [
            "CASE WHEN {$nameExpr} = ? THEN 2600 ELSE 0 END",
            "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 2100 ELSE 0 END",
            "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 1700 ELSE 0 END",
        ];
        $phraseRankingBindings = [
            $nameExact,
            $namePrefixLike,
            $nameContainsLike,
        ];

        if ($compactNameExact !== null) {
            $phraseRankingParts[] = "CASE WHEN {$compactNameExpr} = ? THEN 2200 ELSE 0 END";
            $phraseRankingBindings[] = $compactNameExact;
        }

        if ($compactNamePrefixLike !== null) {
            $phraseRankingParts[] = "CASE WHEN {$compactNameExpr} LIKE ? ESCAPE '\\' THEN 1850 ELSE 0 END";
            $phraseRankingBindings[] = $compactNamePrefixLike;
        }

        if ($compactNameContainsLike !== null) {
            $phraseRankingParts[] = "CASE WHEN {$compactNameExpr} LIKE ? ESCAPE '\\' THEN 1550 ELSE 0 END";
            $phraseRankingBindings[] = $compactNameContainsLike;
        }

        $phraseRankingSql = '(' . implode(' + ', $phraseRankingParts) . ')';

        $hasPhraseMatch = (clone $query)
            ->where(function (Builder $searchQuery) use ($nameContainsLike, $compactNameContainsLike) {
                $this->applyProductNamePhraseConstraint($searchQuery, $nameContainsLike, $compactNameContainsLike);
            })
            ->exists();

        if ($hasPhraseMatch || empty($tokenLikes)) {
            $query->selectRaw("{$phraseRankingSql} AS search_score", $phraseRankingBindings);
            $query->where(function (Builder $searchQuery) use ($nameContainsLike, $compactNameContainsLike) {
                $this->applyProductNamePhraseConstraint($searchQuery, $nameContainsLike, $compactNameContainsLike);
            });

            return [$phraseRankingSql, $phraseRankingBindings];
        }

        $hasAdjacentPhraseMatch = !empty($adjacentPhraseLikes)
            && (clone $query)
                ->where(function (Builder $searchQuery) use ($adjacentPhraseLikes) {
                    $this->applyProductNameAdjacentPhraseConstraint($searchQuery, $adjacentPhraseLikes);
                })
                ->exists();

        $searchRankingParts = [
            "CASE WHEN {$nameExpr} = ? THEN 1800 ELSE 0 END",
            "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 1500 ELSE 0 END",
            "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 1200 ELSE 0 END",
        ];
        $searchRankingBindings = [
            $nameExact,
            $namePrefixLike,
            $nameContainsLike,
        ];
        $compactSkuExpr = $isCompactCompositeSearch ? $this->compactSearchExpression('products.sku') : null;

        foreach ($tokenLikes as $tokenLike) {
            $searchRankingParts[] = "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 120 ELSE 0 END";
            $searchRankingBindings[] = $tokenLike;

            if ($compactSkuExpr !== null) {
                $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} LIKE ? ESCAPE '\\' THEN 90 ELSE 0 END";
                $searchRankingBindings[] = $tokenLike;
            }
        }

        if ($hasAdjacentPhraseMatch) {
            foreach ($adjacentPhraseLikes as $phraseLike) {
                $searchRankingParts[] = "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 260 ELSE 0 END";
                $searchRankingBindings[] = $phraseLike;
            }
        }

        $searchRankingSql = '(' . implode(' + ', $searchRankingParts) . ')';
        $query->selectRaw("{$searchRankingSql} AS search_score", $searchRankingBindings);
        $query->where(function (Builder $searchQuery) use ($tokenLikes, $isCompactCompositeSearch) {
            $this->applyProductNameTokenConstraint($searchQuery, $tokenLikes, $isCompactCompositeSearch);
        });

        if ($hasAdjacentPhraseMatch) {
            $query->where(function (Builder $searchQuery) use ($adjacentPhraseLikes) {
                $this->applyProductNameAdjacentPhraseConstraint($searchQuery, $adjacentPhraseLikes);
            });
        }

        return [$searchRankingSql, $searchRankingBindings];
    }

    protected function applyAttributeValueConstraint(Builder $query, int $attributeId, array $valueArray): void
    {
        $query
            ->where('attribute_id', $attributeId)
            ->where(function (Builder $valueQuery) use ($valueArray) {
                foreach ($valueArray as $value) {
                    $escapedValue = $this->escapeLike($value);

                    $valueQuery
                        ->orWhere('value', $value)
                        ->orWhereRaw("value LIKE ? ESCAPE '\\'", ['%"' . $escapedValue . '"%']);
                }
            });
    }

    protected function applyProductAttributeFilters(Builder $query, $inputAttributes): void
    {
        if (!is_array($inputAttributes) || empty($inputAttributes)) {
            return;
        }

        foreach ($inputAttributes as $attrId => $values) {
            if (!is_numeric($attrId)) {
                continue;
            }

            $valueArray = collect(is_array($values) ? $values : explode(',', (string) $values))
                ->map(function ($value) {
                    if (!is_scalar($value)) {
                        return null;
                    }

                    return trim((string) $value);
                })
                ->filter(fn ($value) => $value !== null && $value !== '')
                ->unique()
                ->values()
                ->all();

            if (empty($valueArray)) {
                continue;
            }

            $attributeId = (int) $attrId;

            $query->where(function (Builder $attributeQuery) use ($attributeId, $valueArray) {
                $attributeQuery
                    ->whereHas('attributeValues', function (Builder $attributeValueQuery) use ($attributeId, $valueArray) {
                        $this->applyAttributeValueConstraint($attributeValueQuery, $attributeId, $valueArray);
                    })
                    ->orWhereHas('variations.attributeValues', function (Builder $attributeValueQuery) use ($attributeId, $valueArray) {
                        $this->applyAttributeValueConstraint($attributeValueQuery, $attributeId, $valueArray);
                    });
            });
        }
    }

    protected function normalizedSortExpression(string $expression): string
    {
        $expression = "COALESCE({$expression}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(immutable_unaccent({$expression}))";
        }

        return "LOWER({$expression})";
    }

    protected function normalizedAttributeSortExpression(string $expression): string
    {
        $expression = "TRIM(COALESCE({$expression}, ''))";
        $expression = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE({$expression}, '[', ''), ']', ''), '{', ''), '}', ''), '\"', '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(immutable_unaccent({$expression}))";
        }

        return "LOWER({$expression})";
    }

    protected function applyTextSort(Builder $query, string $expression, string $direction): void
    {
        $query->orderByRaw("CASE WHEN TRIM(COALESCE({$expression}, '')) = '' THEN 1 ELSE 0 END ASC");
        $query->orderByRaw($this->normalizedSortExpression($expression) . ' ' . $direction);
    }

    protected function resolveProductCategorySortExpression(): string
    {
        return "COALESCE(
            (SELECT categories.name
                FROM categories
                WHERE categories.id = products.category_id
                LIMIT 1),
            (SELECT categories.name
                FROM categories
                INNER JOIN category_product ON category_product.category_id = categories.id
                WHERE category_product.product_id = products.id
                ORDER BY category_product.sort_order ASC, categories.id ASC
                LIMIT 1),
            ''
        )";
    }

    protected function resolveProductSupplierCodeSortExpression(): ?string
    {
        if (Schema::hasTable('supplier_product_prices') && Schema::hasColumn('supplier_product_prices', 'supplier_product_code')) {
            return "(SELECT supplier_product_prices.supplier_product_code
                FROM supplier_product_prices
                WHERE supplier_product_prices.product_id = products.id
                    AND supplier_product_prices.supplier_product_code IS NOT NULL
                    AND supplier_product_prices.supplier_product_code <> ''
                ORDER BY CASE WHEN supplier_product_prices.supplier_id = products.supplier_id THEN 0 ELSE 1 END ASC,
                    supplier_product_prices.id ASC
                LIMIT 1)";
        }

        if (Schema::hasTable('products') && Schema::hasColumn('products', 'supplier_product_code')) {
            return 'products.supplier_product_code';
        }

        return null;
    }

    protected function applyRequestedProductSort(Builder $query, string $sortBy, string $direction, string $actualStockSql): bool
    {
        $resolvedSort = match ($sortBy) {
            'stock', 'stock_quantity' => 'actual_stock',
            default => $sortBy,
        };

        if (preg_match('/^attr_(\d+)$/', $resolvedSort, $matches) === 1) {
            $attributeId = (int) $matches[1];
            $attributeValueExpression = "(SELECT product_attribute_values.value
                FROM product_attribute_values
                WHERE product_attribute_values.product_id = products.id
                    AND product_attribute_values.attribute_id = {$attributeId}
                ORDER BY product_attribute_values.id ASC
                LIMIT 1)";

            $query->orderByRaw("CASE WHEN TRIM(COALESCE({$attributeValueExpression}, '')) = '' THEN 1 ELSE 0 END ASC");
            $query->orderByRaw($this->normalizedAttributeSortExpression($attributeValueExpression) . ' ' . $direction);

            return true;
        }

        if ($resolvedSort === 'actual_stock') {
            $query->orderByRaw($actualStockSql . ' ' . $direction);
            return true;
        }

        if ($resolvedSort === 'category') {
            $this->applyTextSort($query, $this->resolveProductCategorySortExpression(), $direction);
            return true;
        }

        if ($resolvedSort === 'supplier_product_code') {
            $supplierCodeExpression = $this->resolveProductSupplierCodeSortExpression();

            if ($supplierCodeExpression !== null) {
                $this->applyTextSort($query, $supplierCodeExpression, $direction);
                return true;
            }

            return false;
        }

        $textSortColumns = [
            'sku' => 'products.sku',
            'name' => 'products.name',
            'type' => 'products.type',
            'specifications' => 'products.specifications',
        ];

        if (isset($textSortColumns[$resolvedSort])) {
            $this->applyTextSort($query, $textSortColumns[$resolvedSort], $direction);
            return true;
        }

        $directSortColumns = [
            'id' => 'products.id',
            'price' => 'products.price',
            'expected_cost' => 'products.expected_cost',
            'cost_price' => 'products.cost_price',
            'created_at' => 'products.created_at',
            'status' => 'products.status',
            'is_featured' => 'products.is_featured',
            'is_new' => 'products.is_new',
            'category_id' => 'products.category_id',
            'stock_quantity' => 'products.stock_quantity',
        ];

        if (isset($directSortColumns[$resolvedSort])) {
            $query->orderBy($directSortColumns[$resolvedSort], $direction);
            return true;
        }

        return false;
    }

    protected function pickerPrimaryImage(?Product $product): ?string
    {
        if (!$product) {
            return null;
        }

        $primaryImage = $product->images->firstWhere('is_primary', true)
            ?: $product->images->sortBy('sort_order')->first();

        return $primaryImage?->image_url;
    }

    protected function pickerAttributePayload(Product $product): array
    {
        return $product->attributeValues
            ->map(fn ($attributeValue) => [
                'attribute_id' => (int) $attributeValue->attribute_id,
                'value' => $attributeValue->value,
            ])
            ->values()
            ->all();
    }

    protected function pickerAttributeSummary(Product $product): string
    {
        return collect($this->pickerAttributePayload($product))
            ->flatMap(function (array $attributeValue) {
                $rawValue = $attributeValue['value'] ?? null;

                if (is_string($rawValue)) {
                    $trimmed = trim($rawValue);
                    if ($trimmed !== '' && (
                        (str_starts_with($trimmed, '[') && str_ends_with($trimmed, ']'))
                        || (str_starts_with($trimmed, '{') && str_ends_with($trimmed, '}'))
                    )) {
                        $decoded = json_decode($trimmed, true);
                        if (is_array($decoded)) {
                            return collect($decoded)->flatten(1)->map(fn ($value) => trim((string) $value))->filter();
                        }
                    }
                }

                return [trim((string) $rawValue)];
            })
            ->filter()
            ->unique()
            ->implode(' / ');
    }

    protected function pickerBundleOptions(Product $product): array
    {
        if ($product->type !== 'bundle' || !$product->relationLoaded('bundleItems')) {
            return [];
        }

        return $product->bundleItems
            ->groupBy(function (Product $bundleItem) {
                $optionPostId = filled($bundleItem->pivot?->option_post_id ?? null)
                    ? (int) $bundleItem->pivot->option_post_id
                    : null;
                $optionTitle = trim((string) ($bundleItem->pivot?->option_post_title
                    ?? $bundleItem->pivot?->option_title
                    ?? 'Mặc định'));

                return $optionPostId
                    ? 'post:' . $optionPostId
                    : 'title:' . Str::lower($optionTitle);
            })
            ->map(function ($items, string $groupKey) {
                /** @var Product|null $firstItem */
                $firstItem = $items->first();
                if (!$firstItem) {
                    return null;
                }

                $optionPostId = filled($firstItem->pivot?->option_post_id ?? null)
                    ? (int) $firstItem->pivot->option_post_id
                    : null;
                $optionTitle = trim((string) ($firstItem->pivot?->option_post_title
                    ?? $firstItem->pivot?->option_title
                    ?? 'Mặc định'));

                $resolvedItems = $items->map(function (Product $bundleItem) {
                    $selectedVariantId = filled($bundleItem->pivot?->variant_id ?? null)
                        ? (int) $bundleItem->pivot->variant_id
                        : null;
                    $selectedVariant = $selectedVariantId
                        ? $bundleItem->variations->firstWhere('id', $selectedVariantId)
                        : null;
                    $resolvedProduct = $selectedVariant ?: $bundleItem;

                    return [
                        'base_product_id' => (int) $bundleItem->id,
                        'product_id' => (int) $resolvedProduct->id,
                        'variant_id' => $selectedVariant?->id ? (int) $selectedVariant->id : null,
                        'name' => $resolvedProduct->name,
                        'sku' => $resolvedProduct->sku,
                        'display_name' => $resolvedProduct->name,
                        'display_sku' => $resolvedProduct->sku,
                        'quantity' => max(1, (int) ($bundleItem->pivot->quantity ?? 1)),
                        'price' => (float) ($bundleItem->pivot->price
                            ?? $resolvedProduct->price
                            ?? 0),
                        'expected_cost' => $resolvedProduct->expected_cost !== null ? (float) $resolvedProduct->expected_cost : null,
                        'cost_price' => (float) ($bundleItem->pivot->cost_price
                            ?? $resolvedProduct->cost_price
                            ?? $resolvedProduct->expected_cost
                            ?? 0),
                        'main_image' => $this->pickerPrimaryImage($selectedVariant ?: $bundleItem),
                        'attribute_values' => $this->pickerAttributePayload($resolvedProduct),
                        'option_label' => $this->pickerAttributeSummary($resolvedProduct),
                        'variant_name' => $selectedVariant?->name,
                    ];
                })->values();

                return [
                    'key' => $groupKey,
                    'option_title' => $optionTitle,
                    'option_post_id' => $optionPostId,
                    'option_post_title' => filled($firstItem->pivot?->option_post_title ?? null)
                        ? (string) $firstItem->pivot->option_post_title
                        : null,
                    'subtotal' => (float) $resolvedItems->sum(fn (array $item) => ((float) $item['price']) * ((int) $item['quantity'])),
                    'items' => $resolvedItems->all(),
                ];
            })
            ->filter()
            ->values()
            ->all();
    }

    protected function pickerIndex(Request $request)
    {
        $query = Product::query()->select([
            'products.id',
            'products.sku',
            'products.name',
            'products.price',
            'products.cost_price',
            'products.expected_cost',
            'products.stock_quantity',
            'products.type',
        ]);

        $searchRankingSql = null;
        $searchRankingBindings = [];

        $this->applyProductAttributeFilters($query, $request->input('attributes'));

        if ($request->filled('search')) {
            [$searchRankingSql, $searchRankingBindings] = $this->applyProductSearch(
                $query,
                (string) $request->input('search')
            );
        }

        if (!$request->filled('type')) {
            $query->whereDoesntHave('parentConfigurable');
        }

        $query->with([
            'images:id,product_id,image_url,is_primary,sort_order',
            'attributeValues:id,product_id,attribute_id,value',
            'variations:id,sku,name,price,cost_price,expected_cost,type',
            'variations.attributeValues:id,product_id,attribute_id,value',
            'variations.images:id,product_id,image_url,is_primary,sort_order',
            'bundleItems:id,sku,name,price,cost_price,expected_cost,type',
            'bundleItems.attributeValues:id,product_id,attribute_id,value',
            'bundleItems.images:id,product_id,image_url,is_primary,sort_order',
            'bundleItems.variations:id,sku,name,price,cost_price,expected_cost,type',
            'bundleItems.variations.attributeValues:id,product_id,attribute_id,value',
            'bundleItems.variations.images:id,product_id,image_url,is_primary,sort_order',
        ]);

        if ($searchRankingSql !== null) {
            $query->orderByRaw("{$searchRankingSql} DESC", $searchRankingBindings)
                ->orderByRaw("CASE WHEN type = 'configurable' THEN 0 ELSE 1 END")
                ->orderBy('name', 'asc');
        } else {
            $query->orderByRaw("CASE WHEN type = 'configurable' THEN 0 ELSE 1 END")
                ->orderBy('name', 'asc');
        }

        $maxPerPage = $request->boolean('picker') ? 200 : 100;
        $perPage = min(max((int) $request->get('per_page', 50), 1), $maxPerPage);
        $paginated = $query->paginate($perPage);

        $paginated->setCollection(
            $paginated->getCollection()->map(function (Product $product) {
                $product = $this->appendBundleOptionPostMeta($product);

                return [
                    'id' => (int) $product->id,
                    'sku' => $product->sku,
                    'name' => $product->name,
                    'price' => (float) ($product->price ?? 0),
                    'expected_cost' => $product->expected_cost !== null ? (float) $product->expected_cost : null,
                    'cost_price' => (float) ($product->cost_price ?? $product->expected_cost ?? 0),
                    'stock_quantity' => (float) ($product->stock_quantity ?? 0),
                    'type' => $product->type,
                    'main_image' => $this->pickerPrimaryImage($product),
                    'attribute_values' => $this->pickerAttributePayload($product),
                    'variations' => $product->variations
                        ->map(fn (Product $variation) => [
                            'id' => (int) $variation->id,
                            'sku' => $variation->sku,
                            'name' => $variation->name,
                            'price' => (float) ($variation->price ?? 0),
                            'expected_cost' => $variation->expected_cost !== null ? (float) $variation->expected_cost : null,
                            'cost_price' => (float) ($variation->cost_price ?? $variation->expected_cost ?? 0),
                            'type' => $variation->type,
                            'main_image' => $this->pickerPrimaryImage($variation),
                            'attribute_values' => $this->pickerAttributePayload($variation),
                        ])
                        ->values()
                        ->all(),
                    'bundle_options' => $this->pickerBundleOptions($product),
                ];
            })
        );

        return response()->json($paginated);
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        if ($request->boolean('picker')) {
            return $this->pickerIndex($request);
        }

        // Start with optimized column selection for products list to reduce memory & payload
        $query = Product::query()
            ->select([
            'id', 'sku', 'name', 'price', 'expected_cost', 'cost_price', 'stock_quantity',
            'supplier_id', 'inventory_unit_id',
            'type', 'category_id', 'is_featured', 'is_new', 'created_at', 'status', 'specifications', 'video_url', 'bundle_title'
        ])
            ->withCount('suppliers')
            ->with([
            'categories:id,name',
            'category:id,name',
            'supplier:id,name,code',
            'suppliers:id,name,code',
            'unit:id,name',
            'siteDomain:id,domain',
            'images:id,product_id,image_url,is_primary',
            'attributeValues:id,product_id,attribute_id,value',
            'attributeValues.attribute:id,name,code,is_filterable,is_filterable_backend',
            'variations:id,sku,name,price,expected_cost,cost_price,stock_quantity,type,inventory_unit_id',
            'variations.attributeValues:id,product_id,attribute_id,value',
            'variations.unit:id,name',
            'variations.images:id,product_id,image_url,is_primary',
            'groupedItems:id,sku,name,price,expected_cost,cost_price,stock_quantity,type,inventory_unit_id',
            'groupedItems.unit:id,name',
            'groupedItems.images:id,product_id,image_url,is_primary',
            'bundleItems:id,sku,name,price,expected_cost,cost_price,stock_quantity,type,inventory_unit_id',
            'bundleItems.unit:id,name',
            'bundleItems.images:id,product_id,image_url,is_primary'
        ]);

        $stockContext = $this->attachActualStockSubqueries($query, $request);
        $actualStockSql = $stockContext['actual_stock_sql'];
        $query->selectRaw($actualStockSql . ' AS actual_stock');

        // Handle Trash View
        if ($request->boolean('is_trash')) {
            $query->onlyTrashed();
        }

        // Filter by category
        if ($request->filled('category_id')) {
            if ($request->category_id === 'uncategorized') {
                $query->whereNull('category_id')->doesntHave('categories');
            }
            else {
                $query->where(function ($q) use ($request) {
                    $q->where('category_id', $request->category_id)
                        ->orWhereHas('categories', function ($sub) use ($request) {
                        $sub->where('categories.id', $request->category_id);
                    }
                    );
                });
            }
        }

        if ($request->filled('category_ids')) {
            $catIds = is_array($request->category_ids) ? $request->category_ids : explode(',', $request->category_ids);
            $query->where(function ($q) use ($catIds) {
                $q->whereIn('category_id', $catIds)
                    ->orWhereHas('categories', function ($sub) use ($catIds) {
                    $sub->whereIn('categories.id', $catIds);
                }
                );
            });
        }

        $rawSupplierIds = $request->input('supplier_ids', $request->input('supplier_id'));
        $includeUnassignedSuppliers = false;
        $supplierIds = [];
        if ($rawSupplierIds !== null && $rawSupplierIds !== '') {
            $normalizedSupplierFilter = is_array($rawSupplierIds) ? $rawSupplierIds : explode(',', (string) $rawSupplierIds);
            $includeUnassignedSuppliers = in_array('unassigned', $normalizedSupplierFilter, true);
            $supplierIds = collect($normalizedSupplierFilter)
                ->reject(fn ($value) => $value === 'unassigned')
                ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
                ->filter()
                ->unique()
                ->values()
                ->all();
            $this->applySupplierFilter($query, $supplierIds, $includeUnassignedSuppliers);
        }

        if ($request->boolean('missing_purchase_price')) {
            $query->whereDoesntHave('supplierPrices', function (Builder $priceQuery) {
                $priceQuery
                    ->whereNotNull('unit_cost')
                    ->where('unit_cost', '>', 0);
            });
        }

        if ($request->boolean('multiple_suppliers')) {
            $query->where(function (Builder $builder) {
                $builder
                    ->has('suppliers', '>', 1)
                    ->orWhereIn('id', function ($subQuery) {
                        $subQuery
                            ->from('supplier_product_prices')
                            ->select('product_id')
                            ->groupBy('product_id')
                            ->havingRaw('COUNT(DISTINCT supplier_id) > 1');
                    });
            });
        }

        $searchRankingSql = null;
        $searchRankingBindings = [];

        // Search by name & SKU & more (Advanced Fuzzy & Token Matching)
        if (false && $request->filled('search')) {
            $search = trim($request->search);
            // Split into tokens
            $tokens = preg_split('/\s+/', $search, -1, PREG_SPLIT_NO_EMPTY);

            if (!empty($tokens)) {
                $query->where(function (Builder $q) use ($tokens) {
                    foreach ($tokens as $token) {
                        $q->where(function (Builder $sub) use ($token) {
                                    $escapedToken = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $token) . '%';
                                    $fuzzyToken = '%' . implode('%', preg_split('//u', str_replace(['%', '_'], '', $token), -1, PREG_SPLIT_NO_EMPTY)) . '%';

                                    // Name match
                                    $sub->whereRaw('immutable_unaccent(name) ILIKE immutable_unaccent(?)', [$escapedToken])
                                        // SKU match (substring or compacted substring)
                                        ->orWhereRaw('immutable_unaccent(sku) ILIKE immutable_unaccent(?)', [$escapedToken])
                                        ->orWhereRaw("immutable_unaccent(REGEXP_REPLACE(sku, '[^a-zA-Z0-9]', '', 'g')) ILIKE immutable_unaccent(?)", [$escapedToken])
                                        // SKU fuzzy/subsequence match
                                        ->orWhereRaw("immutable_unaccent(REGEXP_REPLACE(sku, '[^a-zA-Z0-9]', '', 'g')) ILIKE immutable_unaccent(?)", [$fuzzyToken])

                                        // Nếu là sản phẩm cha, hãy kiểm tra xem có biến thể nào khớp không
                                        ->orWhereHas('variations', function (Builder $sq) use ($escapedToken) {
                                $sq->whereRaw('immutable_unaccent(name) ILIKE immutable_unaccent(?)', [$escapedToken])
                                    ->orWhereRaw('immutable_unaccent(sku) ILIKE immutable_unaccent(?)', [$escapedToken]);
                            }
                            );

                        }
                        );
                    }
                });
            }
        }

        if (false && $request->filled('search')) {
            $rawSearch = trim($request->search);
            $normalizedSearch = Str::of($rawSearch)
                ->lower()
                ->ascii()
                ->replaceMatches('/[^a-z0-9\s]+/', ' ')
                ->squish()
                ->toString();
            $strictTokens = collect(preg_split('/\s+/', $normalizedSearch, -1, PREG_SPLIT_NO_EMPTY))
                ->map(fn ($token) => trim($token))
                ->filter(fn ($token) => mb_strlen($token) >= 2)
                ->unique()
                ->take(6)
                ->values()
                ->all();

            if ($rawSearch !== '' || !empty($strictTokens)) {
                $escapeLike = static fn ($value) => str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
                $nameExpr = "immutable_unaccent(COALESCE(products.name, ''))";
                $skuExpr = "immutable_unaccent(COALESCE(products.sku, ''))";
                $compactSkuExpr = "immutable_unaccent(REGEXP_REPLACE(COALESCE(products.sku, ''), '[^a-zA-Z0-9]', '', 'g'))";
                $phraseLike = '%' . $escapeLike($rawSearch) . '%';
                $prefixLike = $escapeLike($rawSearch) . '%';
                $compactSearch = preg_replace('/[^a-z0-9]+/', '', $normalizedSearch);
                $compactPhraseLike = $compactSearch !== '' ? '%' . $escapeLike($compactSearch) . '%' : null;
                $compactPrefixLike = $compactSearch !== '' ? $escapeLike($compactSearch) . '%' : null;
                $strictTokenMatchParts = [];
                $strictTokenMatchBindings = [];

                foreach ($strictTokens as $token) {
                    $tokenLike = '%' . $escapeLike($token) . '%';
                    $compactToken = preg_replace('/[^a-z0-9]+/', '', $token);
                    $compactTokenLike = '%' . $escapeLike($compactToken) . '%';
                    $strictTokenMatchParts[] = "CASE WHEN ({$nameExpr} ILIKE immutable_unaccent(?) OR {$skuExpr} ILIKE immutable_unaccent(?) OR {$compactSkuExpr} ILIKE immutable_unaccent(?)) THEN 1 ELSE 0 END";
                    array_push($strictTokenMatchBindings, $tokenLike, $tokenLike, $compactTokenLike);
                }

                $strictTokenMatchSql = !empty($strictTokenMatchParts) ? '(' . implode(' + ', $strictTokenMatchParts) . ')' : '0';
                $minimumRelevantMatches = count($strictTokens) <= 1 ? 1 : max(2, count($strictTokens) - 1);

                $searchRankingParts = [
                    "CASE WHEN {$skuExpr} = immutable_unaccent(?) THEN 1500 ELSE 0 END",
                    "CASE WHEN {$nameExpr} = immutable_unaccent(?) THEN 1400 ELSE 0 END",
                    "CASE WHEN {$skuExpr} ILIKE immutable_unaccent(?) THEN 950 ELSE 0 END",
                    "CASE WHEN {$nameExpr} ILIKE immutable_unaccent(?) THEN 900 ELSE 0 END",
                    "CASE WHEN {$skuExpr} ILIKE immutable_unaccent(?) THEN 820 ELSE 0 END",
                    "CASE WHEN {$nameExpr} ILIKE immutable_unaccent(?) THEN 780 ELSE 0 END",
                ];
                $searchRankingBindings = [
                    $rawSearch,
                    $rawSearch,
                    $prefixLike,
                    $prefixLike,
                    $phraseLike,
                    $phraseLike,
                ];

                if ($compactPhraseLike !== null) {
                    $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} ILIKE immutable_unaccent(?) THEN 900 ELSE 0 END";
                    $searchRankingBindings[] = $compactPhraseLike;
                }

                if ($compactPrefixLike !== null) {
                    $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} ILIKE immutable_unaccent(?) THEN 880 ELSE 0 END";
                    $searchRankingBindings[] = $compactPrefixLike;
                }

                if (!empty($strictTokenMatchParts)) {
                    $searchRankingParts[] = "({$strictTokenMatchSql} * 140)";
                    $searchRankingBindings = array_merge($searchRankingBindings, $strictTokenMatchBindings);
                }

                $searchRankingSql = '(' . implode(' + ', $searchRankingParts) . ')';
                $query->selectRaw("{$searchRankingSql} AS search_score", $searchRankingBindings);
                $query->where(function (Builder $strictSearchQuery) use (
                    $nameExpr,
                    $skuExpr,
                    $compactSkuExpr,
                    $phraseLike,
                    $compactPhraseLike,
                    $strictTokenMatchSql,
                    $strictTokenMatchBindings,
                    $minimumRelevantMatches
                ) {
                    $strictSearchQuery
                        ->whereRaw("{$nameExpr} ILIKE immutable_unaccent(?)", [$phraseLike])
                        ->orWhereRaw("{$skuExpr} ILIKE immutable_unaccent(?)", [$phraseLike]);

                    if ($compactPhraseLike !== null) {
                        $strictSearchQuery
                            ->orWhereRaw("{$compactSkuExpr} ILIKE immutable_unaccent(?)", [$compactPhraseLike]);
                    }

                    if ($strictTokenMatchSql !== '0') {
                        $strictSearchQuery->orWhereRaw("{$strictTokenMatchSql} >= ?", array_merge($strictTokenMatchBindings, [$minimumRelevantMatches]));
                    }

                    $strictSearchQuery->orWhereHas('variations', function (Builder $variationQuery) use ($phraseLike, $compactPhraseLike) {
                        $variationNameExpr = "immutable_unaccent(COALESCE(products.name, ''))";
                        $variationSkuExpr = "immutable_unaccent(COALESCE(products.sku, ''))";
                        $variationCompactSkuExpr = "immutable_unaccent(REGEXP_REPLACE(COALESCE(products.sku, ''), '[^a-zA-Z0-9]', '', 'g'))";

                        $variationQuery
                            ->whereRaw("{$variationNameExpr} ILIKE immutable_unaccent(?)", [$phraseLike])
                            ->orWhereRaw("{$variationSkuExpr} ILIKE immutable_unaccent(?)", [$phraseLike]);

                        if ($compactPhraseLike !== null) {
                            $variationQuery
                                ->orWhereRaw("{$variationCompactSkuExpr} ILIKE immutable_unaccent(?)", [$compactPhraseLike]);
                        }
                    });
                });
            }
        }

        // Numberic Filters
        if ($request->filled('min_price'))
            $query->where('price', '>=', $request->min_price);
        if ($request->filled('max_price'))
            $query->where('price', '<=', $request->max_price);
        if ($request->filled('min_stock'))
            $query->whereRaw($actualStockSql . ' >= ?', [(int) $request->min_stock]);
        if ($request->filled('max_stock'))
            $query->whereRaw($actualStockSql . ' <= ?', [(int) $request->max_stock]);

        // Filter by date range
        if ($request->filled('start_date'))
            $query->whereDate('created_at', '>=', $request->start_date);
        if ($request->filled('end_date'))
            $query->whereDate('created_at', '<=', $request->end_date);

        // Flags
        if ($request->filled('is_featured'))
            $query->where('is_featured', $request->boolean('is_featured'));
        if ($request->filled('is_new'))
            $query->where('is_new', $request->boolean('is_new'));
        // Type Filtering (Improved for Multiple Types & Variants logic)
        if ($request->filled('type')) {
            $types = is_array($request->type) ? $request->type : explode(',', $request->type);
            $query->where(function ($q) use ($types) {
                foreach ($types as $type) {
                    $q->orWhere(function ($sub) use ($type) {
                        if ($type === 'configurable') {
                            // Trả về sản phẩm cha thực sự có biến thể
                            $sub->where('type', 'configurable')
                                ->whereHas('variations');
                        } elseif ($type === 'simple') {
                            // Trả về sản phẩm đơn độc lập (không phải là biến thể của sản phẩm khác)
                            $sub->where('type', 'simple')
                                ->whereDoesntHave('parentConfigurable');
                        } else {
                            $sub->where('type', $type);
                        }
                    });
                }
            });
        }

        // Filter by EAV Attributes
        $this->applyProductAttributeFilters($query, $request->input('attributes'));
        // Mặc định luôn ẩn sản phẩm con (biến thể) ở danh sách chính
        // Sản phẩm con chỉ hiển thị khi bấm mở rộng sản phẩm cha ở frontend
        if ($request->filled('search')) {
            [$searchRankingSql, $searchRankingBindings] = $this->applyProductSearch(
                $query,
                (string) $request->input('search')
            );
        }

        if (!$request->filled('type')) {
            $query->whereDoesntHave('parentConfigurable');
        }

        // Sorting
        $sortBy = $request->input('sort_by', 'created_at');
        $sortOrder = $request->input('sort_order', 'desc');

        if ($sortBy === 'random') {
            $query->inRandomOrder();
        } else {
            $requestedSort = is_string($sortBy) && trim($sortBy) !== '' ? trim($sortBy) : 'created_at';
            $order = strtolower((string) $sortOrder) === 'asc' ? 'asc' : 'desc';

            // Tôn trọng tiêu chí sắp xếp từ bảng quản lý sản phẩm; mặc định là mới nhất lên đầu.
            if ($searchRankingSql !== null) {
                $query->orderByRaw("{$searchRankingSql} DESC", $searchRankingBindings);
            }

            if (!$this->applyRequestedProductSort($query, $requestedSort, $order, $actualStockSql)) {
                $query->orderByDesc('products.created_at');
            }

            $query->orderByDesc('products.id');
        }

        $perPage = (int)$request->get('per_page', 20);
        // Ensure perPage is reasonable
        $perPage = min(max($perPage, 1), 100);

        $paginated = $query->paginate($perPage);
        $stockMap = $this->buildActualStockMap(
            $request,
            $paginated->getCollection()
                ->flatMap(function (Product $product) {
                    $ids = [$product->id];

                    if ($product->relationLoaded('variations')) {
                        $ids = array_merge($ids, $product->variations->pluck('id')->all());
                    }

                    if ($product->relationLoaded('groupedItems')) {
                        $ids = array_merge($ids, $product->groupedItems->pluck('id')->all());
                    }

                    return $ids;
                })
                ->all()
        );
        $paginated->setCollection(
            $paginated->getCollection()->map(function (Product $product) use ($stockMap) {
                return $this->syncProductStocksFromInventory(
                    $this->appendSupplierMeta($product),
                    $stockMap
                );
            })
        );

        return response()->json($paginated);
    }

    protected function normalizeVideoUrlCandidate(?string $value): string
    {
        $normalized = trim(html_entity_decode((string) $value, ENT_QUOTES | ENT_HTML5, 'UTF-8'));

        if ($normalized === '') {
            return '';
        }

        if (Str::startsWith($normalized, '//')) {
            return 'https:' . $normalized;
        }

        if (preg_match('/^(?:www\.|m\.youtube\.com|youtube\.com|youtu\.be|youtube-nocookie\.com)/i', $normalized)) {
            return 'https://' . ltrim($normalized, '/');
        }

        return $normalized;
    }

    protected function extractYouTubeVideoId(?string $value): ?string
    {
        $normalized = $this->normalizeVideoUrlCandidate($value);

        if ($normalized === '') {
            return null;
        }

        $fallbackMatch = [];
        preg_match(
            '/(?:youtube(?:-nocookie)?\.com\/(?:watch\?.*?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i',
            $normalized,
            $fallbackMatch
        );

        $parts = parse_url($normalized);

        if ($parts !== false) {
            $host = Str::lower((string) ($parts['host'] ?? ''));
            $path = trim((string) ($parts['path'] ?? ''), '/');

            if (Str::contains($host, 'youtu.be') && $path !== '') {
                $segments = explode('/', $path);

                return $segments[0] ?: ($fallbackMatch[1] ?? null);
            }

            if (Str::contains($host, 'youtube.com') || Str::contains($host, 'youtube-nocookie.com')) {
                if (!empty($parts['query'])) {
                    parse_str($parts['query'], $queryParams);

                    if (!empty($queryParams['v'])) {
                        return (string) $queryParams['v'];
                    }
                }

                $segments = array_values(array_filter(explode('/', $path)));
                $embedIndex = array_search('embed', $segments, true);
                $liveIndex = array_search('live', $segments, true);
                $shortsIndex = array_search('shorts', $segments, true);
                $targetIndex = $embedIndex !== false ? $embedIndex : ($liveIndex !== false ? $liveIndex : $shortsIndex);

                if ($targetIndex !== false && !empty($segments[$targetIndex + 1])) {
                    return $segments[$targetIndex + 1];
                }
            }
        }

        return $fallbackMatch[1] ?? null;
    }

    protected function normalizeVideoUrl(?string $value): ?string
    {
        $normalized = $this->normalizeVideoUrlCandidate($value);

        if ($normalized === '') {
            return null;
        }

        $videoId = $this->extractYouTubeVideoId($normalized);

        if ($videoId) {
            return 'https://www.youtube.com/watch?v=' . $videoId;
        }

        return $normalized;
    }


    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'type' => 'required|string|in:simple,configurable,grouped,virtual,bundle,downloadable',
            'name' => 'required|string|max:255',
            'category_id' => 'nullable|exists:categories,id',
            'category_ids' => 'nullable|array',
            'category_ids.*' => 'exists:categories,id',
            'price' => $this->shouldAutoCalculateCompositePrice($request)
                ? 'nullable|numeric|min:0'
                : 'required|numeric|min:0',
            'price_type' => 'nullable|string|in:fixed,sum',
            'expected_cost' => 'nullable|numeric|min:0',
            'cost_price' => 'nullable|numeric|min:0',
            'special_price' => 'nullable|numeric|min:0',
            'special_price_from' => 'nullable|date',
            'special_price_to' => 'nullable|date',
            'description' => 'nullable|string',
            'is_featured' => 'boolean',
            'is_new' => 'boolean',
            'stock_quantity' => 'integer|min:0',
            'weight' => 'nullable|string',
            'inventory_unit_id' => 'nullable|exists:inventory_units,id',
            'sku' => 'nullable|string|max:120',
            'meta_title' => 'nullable|string',
            'meta_description' => 'nullable|string',
            'meta_keywords' => 'nullable|string',
            'specifications' => 'nullable|string',
            'status' => 'nullable|boolean',
            'video_url' => 'nullable|string|max:2048',
            'slug' => 'nullable|string|max:255|unique:products,slug',
            'bundle_title' => 'nullable|string|max:255',
            'site_domain_id' => 'nullable|exists:site_domains,id',
            'supplier_id' => ['nullable', $this->supplierExistsRule($request)],
            'supplier_ids' => 'nullable|array',
            'supplier_ids.*' => ['nullable', $this->supplierExistsRule($request)],
            'linked_product_ids' => 'nullable|array',
            'link_type' => 'nullable|string',
            'grouped_items' => 'nullable|array',
            'grouped_items.*.id' => 'required|exists:products,id',
            'grouped_items.*.quantity' => 'required|integer|min:1',
            'grouped_items.*.is_required' => 'required|boolean',
            'grouped_items.*.variant_id' => 'nullable|exists:products,id',
            'grouped_items.*.option_title' => 'nullable|string',
            'grouped_items.*.option_post_id' => 'nullable|exists:posts,id',
            'grouped_items.*.is_default' => 'nullable|boolean',
            'grouped_items.*.price' => 'nullable|numeric|min:0',
            'grouped_items.*.cost_price' => 'nullable|numeric|min:0',
            'super_attribute_ids' => 'nullable|array',
            'super_attribute_ids.*' => 'exists:attributes,id',
            'custom_attributes' => 'nullable|array',
            'main_image' => 'nullable|image',
            'images' => 'nullable|array',
            'images.*' => 'image',
            'variants' => 'nullable|array',
            'variants.*.id' => 'nullable|integer',
            'variants.*.sku' => 'nullable|string|max:120',
            'variants.*.name' => 'nullable|string|max:255',
            'variants.*.price' => 'nullable|numeric|min:0',
            'variants.*.expected_cost' => 'nullable|numeric|min:0',
            'variants.*.weight' => 'nullable|string',
            'variants.*.inventory_unit_id' => 'nullable|exists:inventory_units,id',
            'variants.*.stock_quantity' => 'nullable|integer|min:0',
            'variants.*.attributes' => 'nullable|array',
        ], [
            'type.required' => 'Vui lòng chọn loại sản phẩm.',
            'name.required' => 'Vui lòng nhập tên tác phẩm nghệ thuật.',
            'price.required' => 'Vui lòng nhập giá bán.',
            'stock_quantity.integer' => 'Số lượng tồn kho phải là số nguyên.',
            'slug.unique' => 'Đường dẫn (slug) này đã tồn tại, vui lòng chọn tên khác.',
        ]);
        $this->applyLegacyExpectedCostAlias($request, $validated);
        $this->applyCompositeAutoPrice($request, $validated);

        $validated['slug'] = $this->productSkuService->generateUniqueSlug(
            !empty($validated['slug']) ? $validated['slug'] : $validated['name']
        );
        $validated['video_url'] = $this->normalizeVideoUrl($validated['video_url'] ?? null);

        $supplierIds = $this->normalizeSupplierIds($request, $validated);
        $validated['supplier_id'] = $supplierIds[0] ?? null;
        unset($validated['supplier_ids']);

        if (!empty($validated['grouped_items']) && in_array($validated['type'] ?? null, ['grouped', 'bundle'], true)) {
            $this->validateGroupedOrBundleItemVariants($validated['grouped_items']);
        }

        try {
            $product = DB::transaction(function () use ($request, $validated, $supplierIds) {
                $this->prepareProductSku($validated);
                $preparedVariants = $validated['type'] === 'configurable'
                    ? $this->prepareVariantPayloads($request->input('variants', []), $validated['sku'])
                    : [];

                $product = Product::create(array_merge($validated, ['account_id' => $request->header('X-Account-Id')]));
                $this->syncProductSuppliers($product, $supplierIds);
                $this->productPricingService->syncExpectedCost(
                    $product,
                    $validated['expected_cost'] ?? null,
                    $product->supplier_id,
                    auth()->id()
                );

                if ($request->has('category_ids')) {
                    $this->syncProductCategories($product, (array) $request->category_ids);
                } elseif ($request->has('category_id') && !empty($request->category_id)) {
                    $this->syncProductCategories($product, [(int) $request->category_id]);
                }

                if ($request->hasFile('main_image')) {
                    $disk = 's3';
                    $imageFile = $request->file('main_image');
                    $path = Storage::disk($disk)->put('products', $imageFile, 'public');
                    $baseUrl = rtrim(config('filesystems.disks.s3.url'), '/');
                    $url = $baseUrl . '/' . ltrim($path, '/');

                    ProductImage::create([
                        'product_id' => $product->id,
                        'image_url' => $url,
                        'file_name' => $imageFile->getClientOriginalName(),
                        'file_size' => $imageFile->getSize(),
                        'is_primary' => true,
                    ]);
                }

                if ($request->hasFile('images')) {
                    $disk = 's3';
                    foreach ($request->file('images') as $idx => $image) {
                        $path = Storage::disk($disk)->put('products', $image, 'public');
                        $baseUrl = rtrim(config('filesystems.disks.s3.url'), '/');
                        $url = $baseUrl . '/' . ltrim($path, '/');
                        $isPrimary = (!$request->hasFile('main_image')) && ($idx === 0);

                        ProductImage::create([
                            'product_id' => $product->id,
                            'image_url' => $url,
                            'file_name' => $image->getClientOriginalName(),
                            'file_size' => $image->getSize(),
                            'is_primary' => $isPrimary,
                            'sort_order' => $idx,
                        ]);
                    }
                }

                if ($request->has('custom_attributes')) {
                    $validAttrIds = \App\Models\Attribute::whereIn('id', array_keys($request->custom_attributes))->pluck('id')->toArray();
                    foreach ($request->custom_attributes as $attrId => $val) {
                        if (!in_array($attrId, $validAttrIds)) {
                            continue;
                        }

                        $rawValue = is_array($val) ? json_encode($val) : $val;
                        \App\Models\ProductAttributeValue::create([
                            'product_id' => $product->id,
                            'attribute_id' => $attrId,
                            'value' => $rawValue,
                        ]);
                    }
                }

                if ($request->has('linked_product_ids')) {
                    $type = $request->get('link_type', 'related');
                    $links = [];
                    foreach ($request->linked_product_ids as $idx => $idOrObj) {
                        if (is_array($idOrObj)) {
                            if (!empty($idOrObj['id'])) {
                                $links[$idOrObj['id']] = [
                                    'link_type' => $type,
                                    'position' => $idx,
                                    'option_title' => $idOrObj['option_title'] ?? null,
                                ];
                            }
                        } elseif (!empty($idOrObj)) {
                            $links[$idOrObj] = ['link_type' => $type, 'position' => $idx];
                        }
                    }

                    if (!empty($links)) {
                        $product->linkedProducts()->syncWithoutDetaching($links);
                    }
                }

                if ($request->has('grouped_items') && in_array($product->type, ['grouped', 'bundle'], true)) {
                    $linkType = $product->type === 'bundle' ? 'bundle' : 'grouped';

                    if ($product->type === 'bundle') {
                        $product->bundleItems()->detach();
                    } else {
                        $product->groupedItems()->detach();
                    }

                    foreach ($request->grouped_items as $idx => $item) {
                        $pivotData = [
                            'quantity' => $item['quantity'],
                            'is_required' => $item['is_required'],
                            'link_type' => $linkType,
                            'position' => $idx,
                            'option_title' => $item['option_title'] ?? null,
                            'option_post_id' => $item['option_post_id'] ?? null,
                            'is_default' => $item['is_default'] ?? false,
                            'variant_id' => $item['variant_id'] ?? null,
                            'price' => $item['price'] ?? null,
                            'cost_price' => $item['cost_price'] ?? null,
                        ];

                        if ($product->type === 'bundle') {
                            $product->bundleItems()->attach($item['id'], $pivotData);
                        } else {
                            $product->groupedItems()->attach($item['id'], $pivotData);
                        }
                    }
                }

                $this->syncCompositeAutoPrice($product);

                if ($request->has('super_attribute_ids') && $product->type === 'configurable') {
                    $attrs = [];
                    foreach ($request->super_attribute_ids as $idx => $id) {
                        $attrs[$id] = ['position' => $idx];
                    }
                    $product->superAttributes()->sync($attrs);
                }

                if (!empty($preparedVariants) && $product->type === 'configurable') {
                    foreach ($preparedVariants as $idx => $vData) {
                        $variantProduct = Product::create([
                            'account_id' => $product->account_id,
                            'type' => 'simple',
                            'name' => $vData['name'] ?? ($product->name . ' - ' . ($vData['sku'] ?? 'Variant')),
                            'sku' => $vData['sku'],
                            'price' => $vData['price'] ?? $product->price,
                            'expected_cost' => $vData['expected_cost'] ?? null,
                            'weight' => $vData['weight'] ?? null,
                            'inventory_unit_id' => $vData['inventory_unit_id'] ?? $product->inventory_unit_id,
                            'supplier_id' => $product->supplier_id,
                            'stock_quantity' => $vData['stock_quantity'] ?? 0,
                            'category_id' => $product->category_id,
                            'status' => $product->status ?? true,
                        ]);
                        $this->syncProductSuppliers($variantProduct, $supplierIds);
                        $this->productPricingService->syncExpectedCost(
                            $variantProduct,
                            $vData['expected_cost'] ?? null,
                            $variantProduct->supplier_id,
                            auth()->id()
                        );

                        if ($request->hasFile("variants.{$idx}.image")) {
                            $imageFile = $request->file("variants.{$idx}.image");
                            $path = $imageFile->store('products', 'public');
                            \App\Models\ProductImage::create([
                                'product_id' => $variantProduct->id,
                                'image_url' => \Illuminate\Support\Facades\Storage::disk('public')->url($path),
                                'is_primary' => true,
                                'file_name' => $imageFile->getClientOriginalName(),
                                'file_size' => $imageFile->getSize(),
                            ]);
                        }

                        $product->linkedProducts()->attach($variantProduct->id, [
                            'link_type' => 'super_link',
                            'position' => $idx,
                        ]);

                        if (isset($vData['attributes'])) {
                            $validVariantAttrIds = \App\Models\Attribute::whereIn('id', array_keys($vData['attributes']))->pluck('id')->toArray();
                            foreach ($vData['attributes'] as $attrId => $val) {
                                if (!in_array($attrId, $validVariantAttrIds)) {
                                    continue;
                                }

                                \App\Models\ProductAttributeValue::create([
                                    'product_id' => $variantProduct->id,
                                    'attribute_id' => $attrId,
                                    'value' => $val,
                                ]);
                            }
                        }
                    }
                }

                $this->syncSuppliersToVariants($product, $supplierIds);

                return $product;
            });
        } catch (QueryException $exception) {
            $this->throwSkuConstraintValidation($exception, 'Đã phát hiện mã SKU bị trùng trong quá trình lưu. Vui lòng kiểm tra lại mã sản phẩm và biến thể.');
        }

        return response()->json($this->loadProductResource($product), 201);
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        $product = Product::with($this->productResourceRelations())->findOrFail($id);

        if ($product->type === 'configurable') {
            // Get variations manually to find all used attribute values from IN-STOCK variations
            $variations = $product->linkedProducts()
                ->wherePivot('link_type', 'super_link')
                ->where('stock_quantity', '>', 0) // Only count in-stock variations for initial attribute listing
                ->with('attributeValues')
                ->get();
            
            $usedValuesByAttr = [];
            foreach ($variations as $v) {
                foreach ($v->attributeValues as $av) {
                    $usedValuesByAttr[$av->attribute_id][] = $av->value;
                }
            }

            // Filter the eager-loaded superAttributes to only include those that have valid in-stock options
            $filteredSuperAttributes = $product->superAttributes->filter(function($attribute) use ($usedValuesByAttr) {
                $relevantValues = array_unique($usedValuesByAttr[$attribute->id] ?? []);
                if (empty($relevantValues)) return false;

                $filteredOptions = $attribute->options->filter(function($opt) use ($relevantValues) {
                    return in_array($opt->value, $relevantValues);
                })->values();

                $attribute->setRelation('options', $filteredOptions);
                return $filteredOptions->count() > 0;
            })->values();

            $product->setRelation('superAttributes', $filteredSuperAttributes);

            // Also expose ALL variations (including out of stock ones if needed, 
            // but for filtering we might want to know about them, or just keep what's returned by linkedProducts)
            // Re-fetch all variations to ensure we have the full list for frontend logic if it needs to show "out of stock" instead of hiding
            // But user said "không có hàng... phải ẩn hẳn", so let's stick to in-stock variations for selection logic.
            $product->setRelation('variations', $variations);
        }

        return response()->json($this->appendSupplierMeta($product));
    }

    public function refreshOrderItems(Request $request)
    {
        $validated = $request->validate([
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|integer',
            'items.*.sku' => 'nullable|string|max:120',
            'items.*.name' => 'nullable|string|max:255',
        ]);

        $requestedItems = collect($validated['items'])
            ->map(function (array $item) {
                return [
                    'product_id' => (int) $item['product_id'],
                    'sku' => trim((string) ($item['sku'] ?? '')),
                    'name' => trim((string) ($item['name'] ?? '')),
                ];
            })
            ->filter(fn (array $item) => $item['product_id'] > 0)
            ->unique('product_id')
            ->values();

        $products = Product::withTrashed()
            ->select(['id', 'sku', 'name', 'price', 'cost_price', 'expected_cost', 'status', 'deleted_at'])
            ->whereIn('id', $requestedItems->pluck('product_id')->all())
            ->get()
            ->keyBy('id');

        $items = [];
        $issues = [];

        foreach ($requestedItems as $requestedItem) {
            $productId = $requestedItem['product_id'];
            /** @var Product|null $product */
            $product = $products->get($productId);

            if (!$product) {
                $issues[] = [
                    'product_id' => $productId,
                    'sku' => $requestedItem['sku'] ?: null,
                    'name' => $requestedItem['name'] ?: "Sản phẩm #{$productId}",
                    'reason' => 'missing',
                    'message' => 'Sản phẩm không còn tồn tại hoặc không thuộc tài khoản hiện tại.',
                ];
                continue;
            }

            $items[] = [
                'product_id' => (int) $product->id,
                'sku' => $product->sku,
                'name' => $product->name,
                'price' => (float) ($product->price ?? 0),
                'expected_cost' => $product->expected_cost !== null ? (float) $product->expected_cost : null,
                'cost_price' => (float) ($product->cost_price ?? $product->expected_cost ?? 0),
                'status' => (bool) $product->status,
                'deleted' => $product->trashed(),
            ];

            if ($product->trashed()) {
                $issues[] = [
                    'product_id' => (int) $product->id,
                    'sku' => $product->sku,
                    'name' => $product->name,
                    'reason' => 'deleted',
                    'message' => 'Sản phẩm đã bị xóa khỏi kho.',
                ];
                continue;
            }

            if (!(bool) $product->status) {
                $issues[] = [
                    'product_id' => (int) $product->id,
                    'sku' => $product->sku,
                    'name' => $product->name,
                    'reason' => 'inactive',
                    'message' => 'Sản phẩm đang ở trạng thái ngừng hoạt động.',
                ];
            }
        }

        return response()->json([
            'items' => $items,
            'issues' => $issues,
            'requested_count' => $requestedItems->count(),
            'refreshed_count' => count($items),
        ]);
    }

    public function convertToConfigurable(Request $request, $id)
    {
        $validated = $request->validate([
            'attribute_id' => 'nullable|exists:attributes,id',
            'attribute_name' => 'nullable|string|max:255',
            'parent_name' => 'nullable|string|max:255',
            'parent_sku' => 'nullable|string|max:120',
            'variants' => 'required|array|min:1',
            'variants.*.value' => 'required|string|max:255',
            'variants.*.name' => 'nullable|string|max:255',
            'variants.*.sku' => 'nullable|string|max:120',
            'variants.*.price' => 'nullable|numeric|min:0',
            'variants.*.expected_cost' => 'nullable|numeric|min:0',
            'variants.*.weight' => 'nullable|string|max:255',
            'variants.*.inventory_unit_id' => 'nullable|exists:inventory_units,id',
        ], [
            'variants.required' => 'Cần ít nhất một biến thể để chuyển đổi sản phẩm.',
            'variants.min' => 'Cần ít nhất một biến thể để chuyển đổi sản phẩm.',
        ]);

        $parent = DB::transaction(function () use ($request, $validated, $id) {
            $product = Product::query()
                ->with([
                    'images',
                    'attributeValues',
                    'categories:id',
                    'relatedProducts:id',
                    'suppliers:id',
                ])
                ->lockForUpdate()
                ->findOrFail($id);

            if ($product->type !== 'simple') {
                throw ValidationException::withMessages([
                    'product' => ['Chỉ có thể chuyển sản phẩm đơn thành sản phẩm có biến thể từ màn hình này.'],
                ]);
            }

            if ($product->parentConfigurable()->exists()) {
                throw ValidationException::withMessages([
                    'product' => ['Sản phẩm này đã là biến thể con của một sản phẩm cha khác.'],
                ]);
            }

            $parentName = trim((string) ($validated['parent_name'] ?? '')) ?: $product->name;
            $parentSkuSeed = $validated['parent_sku'] ?? ($product->sku ? ($product->sku . '-CFG') : null);
            $parentSku = $this->productSkuService->ensureUniqueSku(
                $parentSkuSeed,
                $parentName,
                null,
                array_values(array_filter([$product->sku]))
            );
            $preparedVariants = $this->prepareSimpleToConfigurableVariants(
                $product,
                (array) $request->input('variants', []),
                $parentSku
            );
            $attribute = $this->resolveConfigurableConversionAttribute(
                $product,
                isset($validated['attribute_id']) ? (int) $validated['attribute_id'] : null,
                $validated['attribute_name'] ?? null
            );
            $this->ensureVariantAttributeOptions($attribute, array_column($preparedVariants, 'value'));

            $supplierIds = $product->suppliers
                ->pluck('id')
                ->map(fn ($supplierId) => (int) $supplierId)
                ->filter()
                ->values()
                ->all();
            $categoryIds = $product->categories
                ->pluck('id')
                ->map(fn ($categoryId) => (int) $categoryId)
                ->filter()
                ->values()
                ->all();

            $parent = Product::query()->create(
                $this->buildConvertedParentPayload($product, $parentName, $parentSku)
            );

            if (!empty($supplierIds)) {
                $this->syncProductSuppliers($parent, $supplierIds);
            }

            if (!empty($categoryIds)) {
                $this->syncProductCategories($parent, $categoryIds);
            } elseif ($product->category_id) {
                $this->syncProductCategories($parent, [(int) $product->category_id]);
            }

            $this->cloneProductDecoratorsToParent($product, $parent, $attribute->id);
            $this->copyRelatedProductsToParent($product, $parent);
            $parent->superAttributes()->sync([
                $attribute->id => ['position' => 0],
            ]);

            $firstVariant = $preparedVariants[0];
            $product->forceFill([
                'name' => $firstVariant['name'],
                'price' => $firstVariant['price'] ?? $product->price,
                'expected_cost' => $firstVariant['expected_cost'] ?? $product->expected_cost,
                'weight' => $firstVariant['weight'] ?? $product->weight,
                'inventory_unit_id' => $firstVariant['inventory_unit_id'] ?? $product->inventory_unit_id,
            ])->save();

            if (!empty($supplierIds) || $firstVariant['expected_cost'] !== null) {
                $this->productPricingService->syncExpectedCost(
                    $product,
                    $firstVariant['expected_cost'] ?? $product->expected_cost,
                    $product->supplier_id,
                    auth()->id()
                );
                $product->refresh();
            }

            ProductAttributeValue::query()->updateOrCreate(
                [
                    'product_id' => $product->id,
                    'attribute_id' => $attribute->id,
                ],
                [
                    'value' => $firstVariant['value'],
                ]
            );

            $parent->linkedProducts()->attach($product->id, [
                'link_type' => 'super_link',
                'position' => 0,
            ]);

            foreach (array_slice($preparedVariants, 1) as $index => $variantData) {
                $variant = Product::query()->create([
                    'account_id' => $product->account_id,
                    'type' => 'simple',
                    'name' => $variantData['name'],
                    'slug' => $this->productSkuService->generateUniqueSlug($variantData['name']),
                    'description' => $product->description,
                    'specifications' => $product->specifications,
                    'price' => $variantData['price'] ?? $product->price,
                    'price_type' => 'fixed',
                    'cost_price' => null,
                    'expected_cost' => $variantData['expected_cost'] ?? $product->expected_cost,
                    'special_price' => null,
                    'special_price_from' => null,
                    'special_price_to' => null,
                    'imported_quantity_total' => 0,
                    'imported_value_total' => 0,
                    'category_id' => $product->category_id,
                    'stock_quantity' => 0,
                    'damaged_quantity' => 0,
                    'status' => $product->status,
                    'is_featured' => false,
                    'is_new' => false,
                    'sku' => $variantData['sku'],
                    'meta_title' => null,
                    'meta_description' => null,
                    'meta_keywords' => null,
                    'weight' => $variantData['weight'] ?? $product->weight,
                    'inventory_unit_id' => $variantData['inventory_unit_id'] ?? $product->inventory_unit_id,
                    'inventory_import_starred' => false,
                    'supplier_id' => $product->supplier_id,
                    'video_url' => null,
                    'additional_info' => null,
                    'bundle_title' => null,
                    'site_domain_id' => $product->site_domain_id,
                ]);

                if (!empty($supplierIds)) {
                    $this->syncProductSuppliers($variant, $supplierIds);
                }

                if (!empty($categoryIds)) {
                    $this->syncProductCategories($variant, $categoryIds);
                } elseif ($product->category_id) {
                    $this->syncProductCategories($variant, [(int) $product->category_id]);
                }

                $this->productPricingService->syncExpectedCost(
                    $variant,
                    $variantData['expected_cost'] ?? $product->expected_cost,
                    $variant->supplier_id,
                    auth()->id()
                );

                ProductAttributeValue::query()->create([
                    'product_id' => $variant->id,
                    'attribute_id' => $attribute->id,
                    'value' => $variantData['value'],
                ]);

                $parent->linkedProducts()->attach($variant->id, [
                    'link_type' => 'super_link',
                    'position' => $index + 1,
                ]);
            }

            return $this->loadProductResource($parent->fresh());
        });

        return response()->json([
            'message' => 'Sản phẩm đã được chuyển thành sản phẩm có biến thể.',
            'data' => $parent,
            'parent_product_id' => (int) $parent->id,
        ]);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, $id)
    {
        $product = Product::findOrFail($id);

        $validated = $request->validate([
            'type' => 'sometimes|required|string|in:simple,configurable,grouped,virtual,bundle,downloadable',
            'name' => 'sometimes|required|string|max:255',
            'category_id' => 'nullable|exists:categories,id',
            'category_ids' => 'nullable|array',
            'category_ids.*' => 'exists:categories,id',
            'price' => $this->shouldAutoCalculateCompositePrice($request, $product)
                ? 'nullable|numeric|min:0'
                : 'sometimes|required|numeric|min:0',
            'price_type' => 'nullable|string|in:fixed,sum',
            'expected_cost' => 'nullable|numeric|min:0',
            'cost_price' => 'nullable|numeric|min:0',
            'special_price' => 'nullable|numeric|min:0',
            'special_price_from' => 'nullable|date',
            'special_price_to' => 'nullable|date',
            'description' => 'nullable|string',
            'is_featured' => 'boolean',
            'is_new' => 'boolean',
            'stock_quantity' => 'nullable|integer|min:0',
            'weight' => 'nullable|string',
            'inventory_unit_id' => 'nullable|exists:inventory_units,id',
            'sku' => 'nullable|string|max:120',
            'status' => 'nullable|boolean',
            'meta_title' => 'nullable|string',
            'meta_description' => 'nullable|string',
            'meta_keywords' => 'nullable|string',
            'specifications' => 'nullable|string',
            'video_url' => 'nullable|string|max:2048',
            'slug' => 'nullable|string|max:255|unique:products,slug,' . $id,
            'bundle_title' => 'nullable|string|max:255',
            'site_domain_id' => 'nullable|exists:site_domains,id',
            'supplier_id' => ['nullable', $this->supplierExistsRule($request)],
            'supplier_ids' => 'nullable|array',
            'supplier_ids.*' => ['nullable', $this->supplierExistsRule($request)],
            'clear_supplier_ids' => 'nullable|boolean',
            'linked_product_ids' => 'nullable|array',
            'link_type' => 'nullable|string',
            'grouped_items' => 'nullable|array',
            'grouped_items.*.id' => 'required|exists:products,id',
            'grouped_items.*.quantity' => 'required|integer|min:1',
            'grouped_items.*.is_required' => 'required|boolean',
            'grouped_items.*.variant_id' => 'nullable|exists:products,id',
            'grouped_items.*.option_title' => 'nullable|string',
            'grouped_items.*.option_post_id' => 'nullable|exists:posts,id',
            'grouped_items.*.is_default' => 'nullable|boolean',
            'grouped_items.*.price' => 'nullable|numeric|min:0',
            'grouped_items.*.cost_price' => 'nullable|numeric|min:0',
            'super_attribute_ids' => 'nullable|array',
            'super_attribute_ids.*' => 'exists:attributes,id',
            // EAV custom values
            'custom_attributes' => 'nullable|array',
            'variants' => 'nullable|array',
            'variants.*.id' => 'nullable|integer',
            'variants.*.sku' => 'nullable|string|max:120',
            'variants.*.name' => 'nullable|string|max:255',
            'variants.*.price' => 'nullable|numeric|min:0',
            'variants.*.expected_cost' => 'nullable|numeric|min:0',
            'variants.*.weight' => 'nullable|string',
            'variants.*.inventory_unit_id' => 'nullable|exists:inventory_units,id',
            'variants.*.stock_quantity' => 'nullable|integer|min:0',
            'variants.*.attributes' => 'nullable|array',
        ], [
            'name.required' => 'Tên sản phẩm không được để trống.',
            'price.required' => 'Giá bán không được để trống.',
            'sku.unique' => 'Mã SKU này đã được sử dụng.',
            'slug.unique' => 'Đường dẫn (slug) này đã tồn tại, vui lòng chọn tên khác.',
            'slug.regex' => 'Đường dẫn chỉ được chứa chữ cái thường, số và dấu gạch ngang (VD: san-pham-1).',
        ]);
        $this->applyLegacyExpectedCostAlias($request, $validated);
        $this->applyCompositeAutoPrice($request, $validated, $product);

        $incomingSupplierIds = $request->has('supplier_ids') || $request->has('supplier_id') || $request->boolean('clear_supplier_ids');
        $supplierIds = $incomingSupplierIds
            ? ($request->boolean('clear_supplier_ids') ? [] : $this->normalizeSupplierIds($request, $validated))
            : $product->suppliers()->pluck('suppliers.id')->map(fn ($value) => (int) $value)->values()->all();

        if ($incomingSupplierIds) {
            $validated['supplier_id'] = ($product->supplier_id && in_array((int) $product->supplier_id, $supplierIds, true))
                ? (int) $product->supplier_id
                : ($supplierIds[0] ?? null);
        }

        unset($validated['supplier_ids'], $validated['clear_supplier_ids']);

        if (isset($validated['slug'])) {
            $validated['slug'] = $this->productSkuService->generateUniqueSlug(
                !empty($validated['slug']) ? $validated['slug'] : ($validated['name'] ?? $product->name),
                $product->id
            );
        }

        if ($request->has('video_url') || array_key_exists('video_url', $validated)) {
            $validated['video_url'] = $this->normalizeVideoUrl($validated['video_url'] ?? null);
        }

        $resolvedType = $validated['type'] ?? $product->type;
        if ($resolvedType === 'configurable' && $product->type !== 'configurable') {
            throw ValidationException::withMessages([
                'type' => ['Để chuyển sản phẩm hiện có thành sản phẩm có biến thể mà không làm lệch tồn kho và đơn hàng cũ, vui lòng dùng thao tác "Chuyển thành sản phẩm có biến thể".'],
            ]);
        }

        if (!empty($validated['grouped_items']) && in_array($resolvedType, ['grouped', 'bundle'], true)) {
            $this->validateGroupedOrBundleItemVariants($validated['grouped_items']);
        }

        try {
            $product = DB::transaction(function () use ($request, $validated, $product, $incomingSupplierIds, $supplierIds) {
                $this->prepareProductSku($validated, $product);
                $resolvedType = $validated['type'] ?? $product->type;
                $preparedVariants = ($request->has('variants') && $resolvedType === 'configurable')
                    ? $this->prepareVariantPayloads($request->input('variants', []), $validated['sku'], $product)
                    : [];

                $product->fill($validated);
                $nameChanged = $product->isDirty('name');
                $skuChanged = $product->isDirty('sku');
                $product->save();

                if ($incomingSupplierIds) {
                    $this->syncProductSuppliers($product, $supplierIds);
                }

                if ($incomingSupplierIds || array_key_exists('expected_cost', $validated)) {
                    $this->productPricingService->syncExpectedCost(
                        $product,
                        $validated['expected_cost'] ?? $product->expected_cost,
                        $product->supplier_id,
                        auth()->id()
                    );
                    $product->refresh();
                }

        // ─── Sync snapshots on all linked order_items (batch UPDATE) ────────────
        // Runs one SQL query regardless of how many orders reference this product.
        if ($nameChanged || $skuChanged) {
            \App\Models\OrderItem::where('product_id', $product->id)
                ->update([
                'product_name_snapshot' => $product->name,
                'product_sku_snapshot' => $product->sku,
            ]);
        }
        // ────────────────────────────────────────────────────────────────────────
        // Sync categories
        if ($request->has('category_ids')) {
            $this->syncProductCategories($product, (array) $request->category_ids);
        }
        elseif ($request->has('category_id') && !empty($request->category_id)) {
            // If only primary category changed, sync it as well
            $this->syncProductCategories($product, [(int) $request->category_id], false);
        }
        elseif ($request->has('category_id') && empty($request->category_id)) {
            // If primary category was explicitly cleared
            $product->categories()->detach();
            $product->update(['category_id' => null]);
        }
        // Sync EAV custom attributes
        if ($request->has('custom_attributes')) {
            $validAttrIds = \App\Models\Attribute::whereIn('id', array_keys($request->custom_attributes))->pluck('id')->toArray();
            foreach ($request->custom_attributes as $attrId => $val) {
                if (!in_array($attrId, $validAttrIds)) continue;
                // $val could be string, or array (for multiselect)
                $rawValue = is_array($val) ? json_encode($val) : $val;

                \App\Models\ProductAttributeValue::updateOrCreate(
                    ['product_id' => $product->id, 'attribute_id' => $attrId],
                    ['value' => $rawValue]
                );
            }
        }

        if ($request->has('linked_product_ids')) {
            $links = [];
            foreach (array_values($request->linked_product_ids) as $idx => $idOrObj) {
                if (is_array($idOrObj)) {
                    if (!empty($idOrObj['id'])) {
                        $links[$idOrObj['id']] = ['link_type' => 'related', 'position' => $idx, 'option_title' => $idOrObj['option_title'] ?? null];
                    }
                } else {
                    if (!empty($idOrObj)) {
                        $links[$idOrObj] = ['link_type' => 'related', 'position' => $idx];
                    }
                }
            }

            \Illuminate\Support\Facades\DB::table('product_links')
                ->where('product_id', $product->id)
                ->where('link_type', 'related')
                ->delete();

            if (!empty($links)) {
                $product->relatedProducts()->attach($links);
            }
        } elseif ($request->get('clear_linked_products') == '1') {
            \Illuminate\Support\Facades\DB::table('product_links')
                ->where('product_id', $product->id)
                ->where('link_type', 'related')
                ->delete();
        }

        if ($request->has('grouped_items') && in_array($product->type, ['grouped', 'bundle'])) {
            $linkType = $product->type === 'bundle' ? 'bundle' : 'grouped';
            
            if ($product->type === 'bundle') {
                $product->bundleItems()->detach();
            } else {
                $product->groupedItems()->detach();
            }

            foreach ($request->grouped_items as $idx => $item) {
                $pivotData = [
                    'quantity' => $item['quantity'],
                    'is_required' => $item['is_required'],
                    'link_type' => $linkType,
                    'position' => $idx,
                    'option_title' => $item['option_title'] ?? null,
                    'option_post_id' => $item['option_post_id'] ?? null,
                    'is_default' => $item['is_default'] ?? false,
                    'variant_id' => $item['variant_id'] ?? null,
                    'price' => $item['price'] ?? null,
                    'cost_price' => $item['cost_price'] ?? null,
                ];

                if ($product->type === 'bundle') {
                    $product->bundleItems()->attach($item['id'], $pivotData);
                } else {
                    $product->groupedItems()->attach($item['id'], $pivotData);
                }
            }
        }

        $this->syncCompositeAutoPrice($product);

        if ($request->has('super_attribute_ids') && $product->type === 'configurable') {
            $attrs = [];
            foreach ($request->super_attribute_ids as $idx => $id) {
                $attrs[$id] = ['position' => $idx];
            }
            $product->superAttributes()->sync($attrs);
        }

        // Handle variants sync
        if ($request->has('variants') && $product->type === 'configurable') {
            $incomingVariants = $preparedVariants;
            $incomingVariantIds = [];

            // 1. Identify which variants to keep vs delete
            foreach ($incomingVariants as $vData) {
                if (isset($vData['id'])) {
                    $incomingVariantIds[] = $vData['id'];
                }
            }

            // 2. Remove variants that are no longer in the list (Clean up orphans) FIRST
            // This prevents duplicate SKU errors if a variant is recreated with the same SKU
            $existingVariantIds = $product->linkedProducts()
                ->wherePivot('link_type', 'super_link')
                ->pluck('products.id')
                ->toArray();
            
            $toDelete = array_diff($existingVariantIds, $incomingVariantIds);
            if (!empty($toDelete)) {
                $product->linkedProducts()->detach($toDelete);
                Product::whereIn('id', $toDelete)->delete();
            }

            // 3. Process remaining variants (Update or Create)
            foreach ($incomingVariants as $idx => $vData) {
                if (isset($vData['id'])) {
                    $variant = Product::findOrFail($vData['id']);
                    $variantPayload = [
                        'name' => $vData['name'] ?? $variant->name,
                        'sku' => $vData['sku'],
                        'price' => $vData['price'] ?? $variant->price,
                        'expected_cost' => $vData['expected_cost'] ?? null,
                        'weight' => $vData['weight'] ?? null,
                        'inventory_unit_id' => $vData['inventory_unit_id'] ?? $product->inventory_unit_id,
                        'supplier_id' => $variant->supplier_id ?? $product->supplier_id,
                    ];

                    if (array_key_exists('stock_quantity', $vData)) {
                        $variantPayload['stock_quantity'] = $vData['stock_quantity'];
                    }

                    $variant->update($variantPayload);

                    if ($incomingSupplierIds) {
                        $this->syncProductSuppliers($variant, $supplierIds);
                    }

                    if ($incomingSupplierIds || array_key_exists('expected_cost', $vData)) {
                        $this->productPricingService->syncExpectedCost(
                            $variant,
                            $vData['expected_cost'] ?? $variant->expected_cost,
                            $variant->supplier_id,
                            auth()->id()
                        );
                        $variant->refresh();
                    }

                    // Handle variant image update/removal
                    if ($request->hasFile("variants.{$idx}.image")) {
                        $disk = 's3';
                        $variant->images()->delete();
                        $imageFile = $request->file("variants.{$idx}.image");
                        $path = Storage::disk($disk)->put('products', $imageFile, 'public');

                        // Construct Clean S3 URL
                        $baseUrl = rtrim(config('filesystems.disks.s3.url'), '/');
                        $url = $baseUrl . '/' . ltrim($path, '/');

                        \App\Models\ProductImage::create([
                            'product_id' => $variant->id,
                            'image_url' => $url,
                            'is_primary' => true,
                            'file_name' => $imageFile->getClientOriginalName(),
                            'file_size' => $imageFile->getSize(),
                        ]);
                    }
                    elseif (isset($vData['remove_image']) && $vData['remove_image'] == 'true') {
                        $variant->images()->delete();
                    }

                    // Save/Update variant attribute values
                    if (isset($vData['attributes'])) {
                        $vValidAttrIds = \App\Models\Attribute::whereIn('id', array_keys($vData['attributes']))->pluck('id')->toArray();
                        foreach ($vData['attributes'] as $attrId => $val) {
                            if (!in_array($attrId, $vValidAttrIds)) continue;
                            \App\Models\ProductAttributeValue::updateOrCreate(
                                ['product_id' => $variant->id, 'attribute_id' => $attrId],
                                ['value' => $val]
                            );
                        }
                    }

                    DB::table('product_links')
                        ->where('product_id', $product->id)
                        ->where('linked_product_id', $variant->id)
                        ->where('link_type', 'super_link')
                        ->update([
                            'position' => $idx,
                            'updated_at' => now(),
                        ]);
                }
                else {
                    // It's a "new" variant from frontend's perspective.
                    // But maybe it's actually an existing simple product by SKU?
                    // (Optional: can try to find by SKU if you want to be extra safe,
                    // but usually create is fine as long as toDelete happened)
                    $variant = Product::create([
                        'account_id' => $product->account_id,
                        'type' => 'simple',
                        'name' => $vData['name'] ?? ($product->name . ' - ' . ($vData['sku'] ?? 'Variant')),
                        'sku' => $vData['sku'],
                        'price' => $vData['price'] ?? $product->price,
                        'expected_cost' => $vData['expected_cost'] ?? null,
                        'weight' => $vData['weight'] ?? null,
                        'inventory_unit_id' => $vData['inventory_unit_id'] ?? $product->inventory_unit_id,
                        'supplier_id' => $product->supplier_id,
                        'stock_quantity' => $vData['stock_quantity'] ?? 0,
                        'category_id' => $product->category_id,
                        'status' => $product->status ?? true,
                    ]);

                    $this->syncProductSuppliers($variant, $supplierIds);
                    $this->productPricingService->syncExpectedCost(
                        $variant,
                        $vData['expected_cost'] ?? null,
                        $variant->supplier_id,
                        auth()->id()
                    );

                    if ($request->hasFile("variants.{$idx}.image")) {
                        $disk = 's3';
                        $imageFile = $request->file("variants.{$idx}.image");
                        $path = Storage::disk($disk)->put('products', $imageFile, 'public');

                        // Construct Clean S3 URL
                        $baseUrl = rtrim(config('filesystems.disks.s3.url'), '/');
                        $url = $baseUrl . '/' . ltrim($path, '/');

                        \App\Models\ProductImage::create([
                            'product_id' => $variant->id,
                            'image_url' => $url,
                            'is_primary' => true,
                            'file_name' => $imageFile->getClientOriginalName(),
                            'file_size' => $imageFile->getSize(),
                        ]);
                    }

                    $product->linkedProducts()->attach($variant->id, [
                        'link_type' => 'super_link',
                        'position' => $idx,
                    ]);

                    if (isset($vData['attributes'])) {
                        $vValidAttrIds = \App\Models\Attribute::whereIn('id', array_keys($vData['attributes']))->pluck('id')->toArray();
                        foreach ($vData['attributes'] as $attrId => $val) {
                            if (!in_array($attrId, $vValidAttrIds)) continue;
                            \App\Models\ProductAttributeValue::create([
                                'product_id' => $variant->id,
                                'attribute_id' => $attrId,
                                'value' => $val
                            ]);
                        }
                    }
                }
            }
        }

                if ($incomingSupplierIds) {
                    $this->syncSuppliersToVariants($product, $supplierIds);
                }

                return $product;
            });
        } catch (QueryException $exception) {
            $this->throwSkuConstraintValidation($exception, 'Đã phát hiện mã SKU bị trùng trong quá trình cập nhật. Vui lòng kiểm tra lại mã sản phẩm và biến thể.');
        }

        return response()->json($this->loadProductResource($product));
    }

    /**
     * Duplicate the specified resource.
     */
    public function duplicate($id)
    {
        try {
            $clone = DB::transaction(function () use ($id) {
                $original = Product::with([
                    'attributeValues',
                    'images',
                    'superAttributes',
                    'suppliers:id,name,code',
                    'supplierPrices',
                    'categories:id,name',
                    'relatedProducts',
                    'groupedItems',
                    'bundleItems',
                    'variations.images',
                    'variations.attributeValues',
                    'variations.suppliers:id,name,code',
                    'variations.supplierPrices',
                ])->where('id', $id)->firstOrFail();
                $originalSupplierIds = $original->suppliers
                    ->pluck('id')
                    ->map(fn ($value) => (int) $value)
                    ->values()
                    ->all();

                $clone = $original->replicate();
                $clone->name = $original->name . ' (Copy)';
                $clone->sku = $this->productSkuService->generateCopySku($original->sku, $original->name);
                $clone->slug = $this->productSkuService->generateUniqueSlug($clone->name);
                $clone->status = false;
                $clone->is_new = true;
                $this->productSkuService->resetInventoryDerivedState($clone);
                $clone->save();

                $this->syncProductSuppliers($clone, $originalSupplierIds);
                $this->productSkuService->copyProductDecorators($original, $clone);

                if ($original->type === 'configurable') {
                    foreach ($original->superAttributes as $superAttribute) {
                        $clone->superAttributes()->attach($superAttribute->id, [
                            'position' => $superAttribute->pivot->position,
                        ]);
                    }

                    foreach ($original->variations as $index => $variation) {
                        $this->productSkuService->cloneVariantForParent($variation, $clone, [
                            'position' => $variation->pivot->position ?? $index,
                        ]);
                    }
                }

                foreach ($original->relatedProducts as $relatedProduct) {
                    $clone->relatedProducts()->attach($relatedProduct->id, [
                        'link_type' => 'related',
                        'position' => $relatedProduct->pivot->position ?? 0,
                        'option_title' => $relatedProduct->pivot->option_title ?? null,
                    ]);
                }

                foreach ($original->groupedItems as $groupedItem) {
                    $clone->groupedItems()->attach($groupedItem->id, [
                        'link_type' => 'grouped',
                        'position' => $groupedItem->pivot->position ?? 0,
                        'quantity' => $groupedItem->pivot->quantity ?? 1,
                        'is_required' => $groupedItem->pivot->is_required ?? true,
                        'variant_id' => $groupedItem->pivot->variant_id ?? null,
                        'price' => $groupedItem->pivot->price ?? null,
                        'cost_price' => null,
                    ]);
                }

                foreach ($original->bundleItems as $bundleItem) {
                    $clone->bundleItems()->attach($bundleItem->id, [
                        'link_type' => 'bundle',
                        'position' => $bundleItem->pivot->position ?? 0,
                        'quantity' => $bundleItem->pivot->quantity ?? 1,
                        'is_required' => $bundleItem->pivot->is_required ?? true,
                        'option_title' => $bundleItem->pivot->option_title ?? null,
                        'option_post_id' => $bundleItem->pivot->option_post_id ?? null,
                        'is_default' => $bundleItem->pivot->is_default ?? false,
                        'variant_id' => $bundleItem->pivot->variant_id ?? null,
                        'price' => $bundleItem->pivot->price ?? null,
                        'cost_price' => null,
                    ]);
                }

                $this->syncProductCategories($clone, $original->categories->pluck('id')->toArray());

                return $this->loadProductResource($clone);
            });
        } catch (QueryException $exception) {
            $this->throwSkuConstraintValidation($exception, 'Không thể nhân bản sản phẩm vì mã SKU vừa phát sinh bị trùng. Vui lòng thử lại.');
        }

        return response()->json([
            'message' => 'Sản phẩm đã được nhân bản thành công',
            'data' => $clone,
        ]);

        $clone = DB::transaction(function () use ($id) {
            $original = Product::with([
                'attributeValues',
                'images',
                'superAttributes',
                'suppliers:id,name,code',
                'supplierPrices',
                'categories:id,name',
                'relatedProducts',
                'groupedItems',
                'bundleItems',
                'variations.images',
                'variations.attributeValues',
                'variations.suppliers:id,name,code',
                'variations.supplierPrices',
            ])->where('id', $id)->firstOrFail();
            $originalSupplierIds = $original->suppliers->pluck('id')->map(fn ($value) => (int) $value)->values()->all();

            $clone = $original->replicate();
            $clone->name = $original->name . ' (Copy)';
            $clone->sku = $this->productSkuService->generateCopySku($original->sku, $original->name);
            $clone->slug = $this->productSkuService->generateUniqueSlug($clone->name);
            $clone->status = false;
            $clone->is_new = true;
            $clone->save();
            $this->syncProductSuppliers($clone, $originalSupplierIds);
            $this->productSkuService->copyProductDecorators($original, $clone);

            if ($original->type === 'configurable') {
                foreach ($original->superAttributes as $sa) {
                    $clone->superAttributes()->attach($sa->id, ['position' => $sa->pivot->position]);
                }
            }

            if (in_array($original->type, ['grouped', 'bundle', 'configurable'], true)) {
                foreach ($original->linkedProducts as $linkedProduct) {
                    if ($linkedProduct->pivot->link_type === 'super_link') {
                        $this->productSkuService->cloneVariantForParent($linkedProduct, $clone, [
                            'position' => $linkedProduct->pivot->position,
                        ]);
                        continue;
                    }

                    $clone->linkedProducts()->attach($linkedProduct->id, [
                        'link_type' => $linkedProduct->pivot->link_type,
                        'position' => $linkedProduct->pivot->position,
                        'quantity' => $linkedProduct->pivot->quantity ?? 1,
                        'is_required' => $linkedProduct->pivot->is_required ?? true,
                    ]);
                }
            }

            $this->syncProductCategories($clone, $original->categories->pluck('id')->toArray());

            return $this->loadProductResource($clone);
        });

        return response()->json([
            'message' => 'Sản phẩm đã được nhân bản thành công',
            'data' => $clone,
        ]);

        /*

            $this->productSkuService->copyProductDecorators($original, $clone);

            if ($original->type === 'configurable') {
                foreach ($original->superAttributes as $superAttribute) {
                    $clone->superAttributes()->attach($superAttribute->id, ['position' => $superAttribute->pivot->position]);
                }

                foreach ($original->variations as $index => $variation) {
                    $this->productSkuService->cloneVariantForParent($variation, $clone, [
                        'position' => $variation->pivot->position ?? $index,
                    ]);
                }
            }

            foreach ($original->relatedProducts as $relatedProduct) {
                $clone->relatedProducts()->attach($relatedProduct->id, [
                    'link_type' => 'related',
                    'position' => $relatedProduct->pivot->position ?? 0,
                    'option_title' => $relatedProduct->pivot->option_title ?? null,
                ]);
            }

            foreach ($original->groupedItems as $groupedItem) {
                $clone->groupedItems()->attach($groupedItem->id, [
                    'link_type' => 'grouped',
                    'position' => $groupedItem->pivot->position ?? 0,
                    'quantity' => $groupedItem->pivot->quantity ?? 1,
                    'is_required' => $groupedItem->pivot->is_required ?? true,
                    'variant_id' => $groupedItem->pivot->variant_id ?? null,
                    'price' => $groupedItem->pivot->price ?? null,
                    'cost_price' => $groupedItem->pivot->cost_price ?? null,
                ]);
            }

            foreach ($original->bundleItems as $bundleItem) {
                $clone->bundleItems()->attach($bundleItem->id, [
                    'link_type' => 'bundle',
                    'position' => $bundleItem->pivot->position ?? 0,
                    'quantity' => $bundleItem->pivot->quantity ?? 1,
                    'is_required' => $bundleItem->pivot->is_required ?? true,
                    'option_title' => $bundleItem->pivot->option_title ?? null,
                    'option_post_id' => $bundleItem->pivot->option_post_id ?? null,
                    'is_default' => $bundleItem->pivot->is_default ?? false,
                    'variant_id' => $bundleItem->pivot->variant_id ?? null,
                    'price' => $bundleItem->pivot->price ?? null,
                    'cost_price' => $bundleItem->pivot->cost_price ?? null,
                ]);
            }

        // Copy categories
            $this->syncProductCategories($clone, $original->categories->pluck('id')->toArray());

            return $clone;
        });

        return response()->json($this->loadProductResource($clone)); /*
            'message' => 'Sản phẩm đã được nhân bản thành công',
        ]);
        */
    }


    /**
     * Remove the specified resource from storage.
     */
    public function destroy($id)
    {
        $product = Product::findOrFail($id);
        $product->delete();

        return response()->json(['message' => 'Sản phẩm đã được chuyển vào thùng rác']);
    }

    /**
     * Restore the specified resource from trash.
     */
    public function restore($id)
    {
        $product = Product::onlyTrashed()->findOrFail($id);
        $product->restore();

        return response()->json(['message' => 'Sản phẩm đã được khôi phục thành công']);
    }

    /**
     * Permanently remove the specified resource from storage.
     */
    public function forceDelete($id)
    {
        $product = Product::onlyTrashed()->findOrFail($id);
        $product->forceDelete();

        return response()->json(['message' => 'Sản phẩm đã được xóa vĩnh viễn']);
    }

    /**
     * Bulk restore resources from trash.
     */
    public function bulkRestore(Request $request)
    {
        $ids = $request->input('ids', []);
        Product::onlyTrashed()->whereIn('id', $ids)->restore();
        return response()->json(['message' => 'Đã khôi phục các sản phẩm đã chọn']);
    }

    /**
     * Bulk permanently remove resources.
     */
    public function bulkForceDelete(Request $request)
    {
        $ids = $request->input('ids', []);
        Product::onlyTrashed()->whereIn('id', $ids)->forceDelete();
        return response()->json(['message' => 'Đã xóa vĩnh viễn các sản phẩm đã chọn']);
    }

    /**
     * Bulk move resources to trash.
     */
    public function bulkDelete(Request $request)
    {
        $ids = $request->input('ids', []);
        Product::whereIn('id', $ids)->delete();
        return response()->json(['message' => 'Đã chuyển các sản phẩm đã chọn vào thùng rác']);
    }

    /**
     * Bulk update attributes.
     */
    public function bulkUpdateAttributes(Request $request)
    {
        $basicUpdateFields = ['category_id', 'price', 'expected_cost', 'stock_quantity', 'supplier_id', 'is_featured', 'is_new', 'status', 'type', 'specifications', 'additional_info'];

        $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'exists:products,id',
            'basic_info' => 'nullable|array',
            'basic_info.cost_price' => 'nullable|numeric|min:0',
            'basic_info.expected_cost' => 'nullable|numeric|min:0',
            'basic_info.specifications' => 'nullable|string',
            'basic_info.additional_info' => 'nullable|string',
            'basic_info.supplier_id' => ['nullable', $this->supplierExistsRule($request)],
            'basic_info.supplier_ids' => 'nullable|array',
            'basic_info.supplier_ids.*' => ['nullable', $this->supplierExistsRule($request)],
            'attributes' => 'nullable|array',
        ]);

        $ids = $request->input('ids');
        $basicInfo = $request->input('basic_info', []);
        if (!array_key_exists('expected_cost', $basicInfo) && array_key_exists('cost_price', $basicInfo)) {
            $basicInfo['expected_cost'] = $basicInfo['cost_price'];
        }
        $attributesData = $request->input('attributes', []);

        if (empty($basicInfo) && empty($attributesData)) {
            return response()->json(['message' => 'Không có dữ liệu để cập nhật'], 422);
        }

        // --- Logging original data for BACKUP/UNDO ---
        $originalDataLog = [];
        $products = Product::with(['attributeValues', 'categories', 'suppliers:id,name,code'])->whereIn('id', $ids)->get();

        foreach ($products as $product) {
            $pData = [
                'id' => $product->id,
                'basic' => [],
                'attributes' => [],
                'category_ids' => $product->categories->pluck('id')->toArray(),
                'supplier_ids' => $product->suppliers->pluck('id')->map(fn ($value) => (int) $value)->values()->all(),
            ];

            // Store original basic fields that ARE being updated
            foreach ($basicUpdateFields as $field) {
                if (array_key_exists($field, $basicInfo) && $basicInfo[$field] !== '' && $basicInfo[$field] !== null) {
                    $pData['basic'][$field] = $product->{ $field};
                }
            }

            if (array_key_exists('supplier_ids', $basicInfo) && is_array($basicInfo['supplier_ids'])) {
                $pData['basic']['supplier_id'] = $product->supplier_id;
            }

            // Store original EAV attributes that ARE being updated
            foreach ($attributesData as $attrId => $val) {
                if ($val !== null && $val !== '') {
                    $av = $product->attributeValues->where('attribute_id', $attrId)->first();
                    $pData['attributes'][$attrId] = $av ? $av->value : null;
                }
            }

            $originalDataLog[] = $pData;
        }

        $log = BulkUpdateLog::create([
            'batch_name' => 'Cập nhật hàng loạt ' . now()->format('d/m/Y H:i'),
            'product_count' => count($ids),
            'original_data' => $originalDataLog,
        ]);
        // ---------------------------------------------

        foreach ($ids as $productId) {
            $product = $products->find($productId);
            if (!$product)
                continue;

            // 1. Update basic info (direct columns)
            if (!empty($basicInfo)) {
                $toUpdate = [];
                foreach ($basicUpdateFields as $field) {
                    if (array_key_exists($field, $basicInfo) && $basicInfo[$field] !== '' && $basicInfo[$field] !== null) {
                        $toUpdate[$field] = $basicInfo[$field];
                    }
                }
                if (!empty($toUpdate)) {
                    $product->update($toUpdate);
                }
                if (isset($basicInfo['category_ids']) && is_array($basicInfo['category_ids']) && !empty($basicInfo['category_ids'])) {
                    $this->syncProductCategories($product, $basicInfo['category_ids']);
                }

                if (array_key_exists('supplier_ids', $basicInfo) && is_array($basicInfo['supplier_ids'])) {
                    $this->syncProductSuppliers($product, $basicInfo['supplier_ids']);
                    $this->syncSuppliersToVariants($product, $basicInfo['supplier_ids']);
                }

                if (
                    array_key_exists('expected_cost', $basicInfo)
                    || (array_key_exists('supplier_ids', $basicInfo) && is_array($basicInfo['supplier_ids']))
                ) {
                    $this->productPricingService->syncExpectedCost(
                        $product,
                        $basicInfo['expected_cost'] ?? $product->expected_cost,
                        $product->supplier_id,
                        auth()->id()
                    );
                }
            }

            // 2. Update EAV attributes
            if (!empty($attributesData)) {
                foreach ($attributesData as $attrId => $val) {
                    if ($val === null || $val === '')
                        continue;
                    $rawValue = is_array($val) ? json_encode($val) : $val;
                    \App\Models\ProductAttributeValue::updateOrCreate(
                    ['product_id' => $productId, 'attribute_id' => $attrId],
                    ['value' => $rawValue]
                    );
                }
            }
        }

        return response()->json([
            'message' => 'Cập nhật hàng loạt thành công',
            'log_id' => $log->id
        ]);
    }

    /**
     * Undo a bulk update operation.
     */
    public function undoBulkUpdate(Request $request)
    {
        $request->validate(['log_id' => 'required|exists:bulk_update_logs,id']);

        $log = BulkUpdateLog::findOrFail($request->log_id);
        $originalData = $log->original_data;

        foreach ($originalData as $pData) {
            $product = Product::find($pData['id']);
            if (!$product)
                continue;

            // Restore basic info
            if (!empty($pData['basic'])) {
                $product->update($pData['basic']);
            }

            if (array_key_exists('supplier_ids', $pData)) {
                $this->syncProductSuppliers($product, $pData['supplier_ids'] ?? []);
                $this->syncSuppliersToVariants($product, $pData['supplier_ids'] ?? []);
            }

            if (array_key_exists('expected_cost', $pData['basic'] ?? []) || array_key_exists('supplier_ids', $pData)) {
                $this->productPricingService->syncExpectedCost(
                    $product,
                    $pData['basic']['expected_cost'] ?? $product->expected_cost,
                    $product->supplier_id,
                    auth()->id()
                );
            }

            // Restore category sync
            if (isset($pData['category_ids'])) {
                $this->syncProductCategories($product, (array) $pData['category_ids']);
            }

            // Restore EAV attributes
            if (!empty($pData['attributes'])) {
                foreach ($pData['attributes'] as $attrId => $originalValue) {
                    if ($originalValue === null) {
                        \App\Models\ProductAttributeValue::where('product_id', $product->id)
                            ->where('attribute_id', $attrId)
                            ->delete();
                    }
                    else {
                        \App\Models\ProductAttributeValue::updateOrCreate(
                        ['product_id' => $product->id, 'attribute_id' => $attrId],
                        ['value' => $originalValue]
                        );
                    }
                }
            }
        }

        // Optional: delete the log after undoing
        $log->delete();

        return response()->json(['message' => 'Đã hoàn tác cập nhật thành công']);
    }
}
