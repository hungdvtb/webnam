<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\Attribute;
use App\Models\Category;
use App\Models\Post;
use App\Models\Product;
use App\Models\SiteDomain;
use App\Services\CategoryDemoLogoService;
use App\Services\MediaService;
use App\Support\Utf8Sanitizer;
use App\Support\SimpleXlsx;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\UploadedFile;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Throwable;

class CategoryController extends Controller
{
    private const BUNDLE_FULL_SET_DISCOUNT_RATE = 0.10;
    private const BUNDLE_TOTAL_ROUNDING_UNIT = 10000;

    private bool $categoryTrashSchemaEnsured = false;

    public function __construct(
        protected MediaService $mediaService,
        protected CategoryDemoLogoService $categoryDemoLogoService
    ) {
    }

    private function calculateFullBundleDiscountedPrice(float $totalPrice): array
    {
        $normalizedTotal = max(round($totalPrice, 2), 0);
        $baseDiscountAmount = $normalizedTotal > 0
            ? round($normalizedTotal * self::BUNDLE_FULL_SET_DISCOUNT_RATE, 0)
            : 0.0;
        $subtotalAfterBaseDiscount = max($normalizedTotal - $baseDiscountAmount, 0);
        $discountedPrice = floor($subtotalAfterBaseDiscount / self::BUNDLE_TOTAL_ROUNDING_UNIT) * self::BUNDLE_TOTAL_ROUNDING_UNIT;
        $discountAmount = max($normalizedTotal - $discountedPrice, 0);

        return [
            'discount_amount' => $discountAmount,
            'discounted_price' => $discountedPrice,
        ];
    }

    private function categoryImportSelectableFieldIds(): array
    {
        return [
            'name',
            'description',
            'tree',
            'banner',
            'logo',
        ];
    }

    private function resolveCategoryImportOptions(Request $request): array
    {
        $mode = trim((string) $request->input('mode', 'replace_all')) === 'update_selected_fields'
            ? 'update_selected_fields'
            : 'replace_all';

        $allowedFields = array_fill_keys($this->categoryImportSelectableFieldIds(), true);
        $selectedFields = [];

        foreach ((array) $request->input('update_fields', []) as $rawField) {
            $field = trim((string) $rawField);

            if ($field !== '' && isset($allowedFields[$field])) {
                $selectedFields[$field] = true;
            }
        }

        return [
            'mode' => $mode,
            'is_selective_update' => $mode === 'update_selected_fields',
            'selected_fields' => $selectedFields,
        ];
    }

    private function shouldApplyCategoryImportField(array $importOptions, string $field, bool $isExisting): bool
    {
        return !$isExisting
            || !$importOptions['is_selective_update']
            || !empty($importOptions['selected_fields'][$field]);
    }

    private function extractCategoryItemsFromRequest(Request $request): ?array
    {
        if (!$request->exists('category_items')) {
            return null;
        }

        $rawItems = $request->input('category_items');

        if (is_string($rawItems)) {
            $trimmed = trim($rawItems);

            if ($trimmed === '') {
                return [];
            }

            $decoded = json_decode($trimmed, true);

            if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
                throw ValidationException::withMessages([
                    'category_items' => ['Du lieu san pham danh muc khong hop le.'],
                ]);
            }

            $rawItems = $decoded;
        }

        if ($rawItems === null) {
            return [];
        }

        if (!is_array($rawItems)) {
            throw ValidationException::withMessages([
                'category_items' => ['Du lieu san pham danh muc khong hop le.'],
            ]);
        }

        return array_values(
            array_filter($rawItems, static fn ($item) => is_array($item))
        );
    }

    private function normalizeCategoryBundleOptionKey(?int $optionPostId, ?string $optionTitle): string
    {
        if ($optionPostId !== null && $optionPostId > 0) {
            return 'post:' . $optionPostId;
        }

        $normalizedTitle = Str::lower(Str::squish((string) $optionTitle));

        return 'title:' . ($normalizedTitle !== '' ? $normalizedTitle : 'mac dinh');
    }

    private function normalizeCategoryAsciiBundleOptionKey(?int $optionPostId, ?string $optionTitle): string
    {
        if ($optionPostId !== null && $optionPostId > 0) {
            return 'post:' . $optionPostId;
        }

        $normalizedTitle = Str::of((string) $optionTitle)
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', ' ')
            ->squish()
            ->value();

        return 'title:' . ($normalizedTitle !== '' ? $normalizedTitle : 'mac dinh');
    }

    private function normalizeCategoryBundleOptionUid($value): ?string
    {
        $uid = trim((string) $value);

        return preg_match('/^[A-Za-z0-9:_-]{1,64}$/', $uid) === 1 ? $uid : null;
    }

    private function getCategoryBundleOptionKeyCandidates($bundleOptionKey = null, $bundleOptionPostId = null, $bundleOptionTitle = null, $bundleOptionUid = null): array
    {
        $candidates = [];
        $uid = $this->normalizeCategoryBundleOptionUid($bundleOptionUid);

        if ($uid !== null) {
            $candidates[] = 'uid:' . $uid;
            $candidates[] = $uid;
        }

        $explicitKey = Str::lower(Str::squish((string) $bundleOptionKey));

        if ($explicitKey !== '') {
            $candidates[] = $explicitKey;
        }

        $optionPostId = filled($bundleOptionPostId) && is_numeric($bundleOptionPostId)
            ? (int) $bundleOptionPostId
            : null;
        $optionTitle = Str::squish((string) $bundleOptionTitle) ?: null;

        if ($optionPostId !== null || $optionTitle !== null) {
            $candidates[] = $this->normalizeCategoryBundleOptionKey($optionPostId, $optionTitle);
            $candidates[] = $this->normalizeCategoryAsciiBundleOptionKey($optionPostId, $optionTitle);
        }

        return collect($candidates)
            ->filter(fn ($key) => trim((string) $key) !== '')
            ->unique()
            ->values()
            ->all();
    }

    private function resolveCategoryBundleOptionCatalogMeta(array $catalog, int $productId, ?string $bundleOptionKey, $bundleOptionPostId = null, $bundleOptionTitle = null, $bundleOptionUid = null): ?array
    {
        if ($productId <= 0 || empty($catalog[$productId]) || !is_array($catalog[$productId])) {
            return null;
        }

        foreach ($this->getCategoryBundleOptionKeyCandidates($bundleOptionKey, $bundleOptionPostId, $bundleOptionTitle, $bundleOptionUid) as $candidateKey) {
            if (isset($catalog[$productId][$candidateKey]) && is_array($catalog[$productId][$candidateKey])) {
                return $catalog[$productId][$candidateKey];
            }
        }

        return null;
    }

    private function isCategoryBundleOptionAssignment($itemType = null, $bundleOptionKey = null, $bundleOptionPostId = null, $bundleOptionTitle = null, $bundleOptionUid = null): bool
    {
        return (string) $itemType === 'bundle_option'
            || $this->normalizeCategoryBundleOptionUid($bundleOptionUid) !== null
            || trim((string) $bundleOptionKey) !== ''
            || filled($bundleOptionPostId)
            || Str::squish((string) $bundleOptionTitle) !== '';
    }

    private function buildCategoryAssignmentKey(string $itemType, int $productId, string $bundleOptionKey = '', ?string $bundleOptionUid = null): string
    {
        $uid = $this->normalizeCategoryBundleOptionUid($bundleOptionUid);

        return $itemType === 'bundle_option'
            ? "bundle_option:{$productId}:" . ($uid !== null ? "uid:{$uid}" : $bundleOptionKey)
            : "product:{$productId}";
    }

    private function loadCategoryAssignmentRows(int $categoryId): Collection
    {
        return DB::table('category_product')
            ->where('category_id', $categoryId)
            ->orderByRaw('CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get([
                'id',
                'product_id',
                'item_type',
                'bundle_option_uid',
                'bundle_option_key',
                'bundle_option_post_id',
                'bundle_option_title',
                'sort_order',
            ]);
    }

    private function resolveVariantParentProductIds(Collection $productIds): array
    {
        $normalizedProductIds = $productIds
            ->map(fn ($productId) => is_numeric($productId) ? (int) $productId : null)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($normalizedProductIds)) {
            return [];
        }

        return DB::table('product_links')
            ->join('products as parent_products', 'parent_products.id', '=', 'product_links.product_id')
            ->where('product_links.link_type', 'super_link')
            ->whereIn('product_links.linked_product_id', $normalizedProductIds)
            ->whereNull('parent_products.deleted_at')
            ->orderBy('product_links.position')
            ->orderBy('product_links.id')
            ->get([
                'product_links.linked_product_id',
                'product_links.product_id',
            ])
            ->mapWithKeys(fn ($row) => [
                (int) $row->linked_product_id => (int) $row->product_id,
            ])
            ->all();
    }

    private function normalizeCategoryAssignmentRowsForDisplay(Collection $assignmentRows): Collection
    {
        if ($assignmentRows->isEmpty()) {
            return collect();
        }

        $variantParentProductIds = $this->resolveVariantParentProductIds(
            $assignmentRows
                ->filter(fn ($row) => !$this->isCategoryBundleOptionAssignment(
                    $row->item_type ?? null,
                    $row->bundle_option_key ?? null,
                    $row->bundle_option_post_id ?? null,
                    $row->bundle_option_title ?? null,
                    $row->bundle_option_uid ?? null
                ))
                ->pluck('product_id')
        );
        $seenKeys = [];
        $normalizedRows = collect();

        foreach ($assignmentRows as $row) {
            $itemType = $this->isCategoryBundleOptionAssignment(
                $row->item_type ?? null,
                $row->bundle_option_key ?? null,
                $row->bundle_option_post_id ?? null,
                $row->bundle_option_title ?? null,
                $row->bundle_option_uid ?? null
            ) ? 'bundle_option' : 'product';
            $productId = (int) $row->product_id;
            $bundleOptionUid = $itemType === 'bundle_option'
                ? $this->normalizeCategoryBundleOptionUid($row->bundle_option_uid ?? null)
                : null;
            $bundleOptionKey = $itemType === 'bundle_option'
                ? Str::lower(Str::squish((string) ($row->bundle_option_key ?? '')))
                : '';

            if ($itemType === 'product' && isset($variantParentProductIds[$productId])) {
                $productId = (int) $variantParentProductIds[$productId];
            }

            if ($itemType === 'bundle_option' && $bundleOptionKey === '') {
                $bundleOptionKey = $this->normalizeCategoryBundleOptionKey(
                    filled($row->bundle_option_post_id ?? null) ? (int) $row->bundle_option_post_id : null,
                    Str::squish((string) ($row->bundle_option_title ?? '')) ?: null
                );
            }

            $assignmentKey = $this->buildCategoryAssignmentKey($itemType, $productId, $bundleOptionKey, $bundleOptionUid);
            if (isset($seenKeys[$assignmentKey])) {
                continue;
            }

            $seenKeys[$assignmentKey] = true;
            $normalizedRow = clone $row;
            $normalizedRow->product_id = $productId;
            $normalizedRow->item_type = $itemType;
            $normalizedRow->bundle_option_uid = $bundleOptionUid;
            $normalizedRow->bundle_option_key = $bundleOptionKey;

            if ($itemType === 'product') {
                $normalizedRow->bundle_option_uid = null;
                $normalizedRow->bundle_option_post_id = null;
                $normalizedRow->bundle_option_title = null;
            }

            $normalizedRows->push($normalizedRow);
        }

        return $normalizedRows->values();
    }

    private function buildCategorySearchText(array $parts): string
    {
        return Str::squish(
            collect($parts)
                ->filter(fn ($value) => $value !== null && $value !== '')
                ->implode(' ')
        );
    }

    private function extractCategoryImageUrl($image): ?string
    {
        if (is_array($image)) {
            $candidate = trim((string) ($image['url'] ?? $image['path'] ?? $image['image_url'] ?? ''));

            return $candidate !== '' ? $candidate : null;
        }

        $candidate = trim((string) $image);

        return $candidate !== '' ? $candidate : null;
    }

    private function mapCategoryPostPrimaryImage(?Post $post)
    {
        if (!$post) {
            return null;
        }

        $featuredMedia = $post->featured_image_media;
        if (is_array($featuredMedia) && !empty($featuredMedia)) {
            return $featuredMedia;
        }

        $featuredImage = trim((string) ($post->featured_image ?? ''));
        if ($featuredImage === '') {
            return null;
        }

        return [
            'url' => $featuredImage,
            'path' => $featuredImage,
            'image_url' => $featuredImage,
        ];
    }

    private function resolveCategoryProductCurrentPrice(?Product $product): float
    {
        if (!$product) {
            return 0.0;
        }

        $price = $product->current_price ?? $product->price ?? 0;

        return is_numeric($price) ? (float) $price : 0.0;
    }

    private function resolveCategoryBundleItemCurrentUnitPrice($bundleLinkRow, ?Product $bundleItem, ?Product $selectedVariant): float
    {
        $bundlePrice = $bundleLinkRow->price ?? null;
        $selectedVariantId = $selectedVariant?->id ? (int) $selectedVariant->id : 0;
        $defaultVariantId = filled($bundleLinkRow->variant_id ?? null) ? (int) $bundleLinkRow->variant_id : 0;

        if (
            $selectedVariant instanceof Product
            && $bundlePrice !== null
            && is_numeric($bundlePrice)
            && $selectedVariantId > 0
            && $defaultVariantId > 0
            && $selectedVariantId === $defaultVariantId
        ) {
            return (float) $bundlePrice;
        }

        if ($selectedVariant instanceof Product) {
            return $this->resolveCategoryProductCurrentPrice($selectedVariant);
        }

        if ($bundlePrice !== null && is_numeric($bundlePrice)) {
            return (float) $bundlePrice;
        }

        return $this->resolveCategoryProductCurrentPrice($bundleItem);
    }

    private function resolveCategoryBundleItemBaseUnitPrice(?Product $bundleItem, ?Product $selectedVariant, float $fallback = 0.0): float
    {
        if ($selectedVariant instanceof Product && $selectedVariant->price !== null && is_numeric($selectedVariant->price)) {
            return (float) $selectedVariant->price;
        }

        if ($bundleItem instanceof Product && $bundleItem->price !== null && is_numeric($bundleItem->price)) {
            return (float) $bundleItem->price;
        }

        return $fallback;
    }

    private function buildCategoryBundleOptionCatalog(array $productIds): array
    {
        $normalizedProductIds = collect($productIds)
            ->map(fn ($productId) => is_numeric($productId) ? (int) $productId : null)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($normalizedProductIds)) {
            return [];
        }

        $rows = DB::table('product_links')
            ->leftJoin('products as linked_products', 'linked_products.id', '=', 'product_links.linked_product_id')
            ->leftJoin('products as variant_products', 'variant_products.id', '=', 'product_links.variant_id')
            ->where('product_links.link_type', 'bundle')
            ->whereIn('product_links.product_id', $normalizedProductIds)
            ->orderBy('product_links.product_id')
            ->orderBy('product_links.position')
            ->orderBy('product_links.id')
            ->get([
                'product_links.product_id',
                'product_links.linked_product_id',
                'product_links.variant_id',
                'product_links.option_post_id',
                'product_links.bundle_option_uid',
                'product_links.option_title',
                'product_links.quantity',
                'product_links.price',
                'product_links.position',
                'linked_products.name as linked_product_name',
                'linked_products.sku as linked_product_sku',
                'variant_products.name as variant_product_name',
                'variant_products.sku as variant_product_sku',
            ]);

        $componentProductIds = $rows
            ->flatMap(fn ($row) => [
                is_numeric($row->linked_product_id ?? null) ? (int) $row->linked_product_id : null,
                is_numeric($row->variant_id ?? null) ? (int) $row->variant_id : null,
            ])
            ->filter()
            ->unique()
            ->values();

        $componentProducts = $componentProductIds->isNotEmpty()
            ? Product::query()
                ->with(['images:id,product_id,image_url,is_primary,sort_order'])
                ->whereIn('id', $componentProductIds->all())
                ->get([
                    'id',
                    'name',
                    'sku',
                    'price',
                    'special_price',
                    'special_price_from',
                    'special_price_to',
                    'status',
                ])
                ->keyBy(fn (Product $product) => (int) $product->id)
            : collect();

        $optionPostIds = $rows
            ->pluck('option_post_id')
            ->filter(fn ($postId) => filled($postId) && is_numeric($postId))
            ->map(fn ($postId) => (int) $postId)
            ->unique()
            ->values();

        $optionPosts = $optionPostIds->isNotEmpty()
            ? Post::query()
                ->with('featuredMediaAsset')
                ->whereIn('id', $optionPostIds->all())
                ->get(['id', 'title', 'slug', 'featured_image', 'featured_media_asset_id'])
                ->keyBy(fn (Post $post) => (int) $post->id)
            : collect();

        $catalog = [];
        $catalogAliases = [];

        foreach ($rows as $row) {
            $productId = (int) $row->product_id;
            $optionPostId = filled($row->option_post_id) ? (int) $row->option_post_id : null;
            /** @var Post|null $optionPost */
            $optionPost = $optionPostId ? $optionPosts->get($optionPostId) : null;
            $optionTitle = Str::squish((string) ($row->option_title ?? ''));
            $resolvedTitle = $optionTitle !== ''
                ? $optionTitle
                : (Str::squish((string) ($optionPost?->title ?? '')) ?: 'Mac dinh');
            $optionUid = $this->normalizeCategoryBundleOptionUid($row->bundle_option_uid ?? null);
            $optionKey = $this->normalizeCategoryBundleOptionKey($optionPostId, $resolvedTitle);
            $catalogKey = $optionUid !== null ? 'uid:' . $optionUid : $optionKey;
            $optionAliases = $this->getCategoryBundleOptionKeyCandidates(null, $optionPostId, $resolvedTitle, $optionUid);
            /** @var Product|null $bundleItem */
            $bundleItem = is_numeric($row->linked_product_id ?? null)
                ? $componentProducts->get((int) $row->linked_product_id)
                : null;
            /** @var Product|null $selectedVariant */
            $selectedVariant = is_numeric($row->variant_id ?? null)
                ? $componentProducts->get((int) $row->variant_id)
                : null;
            $resolvedProduct = $selectedVariant ?: $bundleItem;

            if (!isset($catalog[$productId][$catalogKey])) {
                $postImage = $this->mapCategoryPostPrimaryImage($optionPost);
                $componentImage = $resolvedProduct instanceof Product ? $resolvedProduct->main_image : null;

                $catalog[$productId][$catalogKey] = [
                    'bundle_option_uid' => $optionUid,
                    'bundle_option_key' => $optionKey,
                    'bundle_option_post_id' => $optionPostId,
                    'bundle_option_title' => $resolvedTitle,
                    'bundle_option_post_title' => Str::squish((string) ($optionPost?->title ?? '')) ?: null,
                    'bundle_option_post_slug' => Str::squish((string) ($optionPost?->slug ?? '')) ?: null,
                    'option_key_display' => $optionKey,
                    'primary_image' => $postImage,
                    'main_image' => $this->extractCategoryImageUrl($postImage) ?: $componentImage,
                    'price' => 0.0,
                    'current_price' => 0.0,
                    'special_price' => null,
                    'bundle_option_total_price' => 0.0,
                    'bundle_option_discounted_price' => 0.0,
                    'bundle_option_discount_amount' => 0.0,
                    'bundle_option_discount_rate' => self::BUNDLE_FULL_SET_DISCOUNT_RATE,
                    'status' => true,
                    'bundle_items_count' => 0,
                    'bundle_items_summary' => [],
                ];
            }

            $catalogAliases[$productId][$catalogKey] = collect($catalogAliases[$productId][$catalogKey] ?? [])
                ->merge($optionAliases)
                ->push($catalogKey)
                ->push($optionKey)
                ->filter(fn ($key) => trim((string) $key) !== '')
                ->unique()
                ->values()
                ->all();

            if (!$catalog[$productId][$catalogKey]['main_image'] && $resolvedProduct instanceof Product) {
                $catalog[$productId][$catalogKey]['main_image'] = $resolvedProduct->main_image;
            }

            if ($resolvedProduct instanceof Product && !$resolvedProduct->status) {
                $catalog[$productId][$catalogKey]['status'] = false;
            }

            $quantity = max(1, (int) ($row->quantity ?? 1));
            $currentUnitPrice = $this->resolveCategoryBundleItemCurrentUnitPrice($row, $bundleItem, $selectedVariant);
            $baseUnitPrice = $this->resolveCategoryBundleItemBaseUnitPrice($bundleItem, $selectedVariant, $currentUnitPrice);
            $catalog[$productId][$catalogKey]['current_price'] += $currentUnitPrice * $quantity;
            $catalog[$productId][$catalogKey]['price'] += $baseUnitPrice * $quantity;

            $itemName = Str::squish((string) ($resolvedProduct?->name ?? $row->variant_product_name ?? $row->linked_product_name ?? ''));
            $itemSku = Str::squish((string) ($resolvedProduct?->sku ?? $row->variant_product_sku ?? $row->linked_product_sku ?? ''));
            $summaryKey = Str::lower($itemName . '|' . $itemSku);

            if ($summaryKey !== '|' && !isset($catalog[$productId][$catalogKey]['bundle_items_summary'][$summaryKey])) {
                $catalog[$productId][$catalogKey]['bundle_items_summary'][$summaryKey] = [
                    'name' => $itemName,
                    'sku' => $itemSku,
                ];
            }

            $catalog[$productId][$catalogKey]['bundle_items_count']++;
        }

        foreach ($catalog as $productId => $options) {
            foreach ($options as $optionKey => $optionMeta) {
                $totalPrice = round((float) ($optionMeta['current_price'] ?? 0), 2);
                $basePrice = round((float) ($optionMeta['price'] ?? 0), 2);

                if ($basePrice <= 0 || $basePrice < $totalPrice) {
                    $basePrice = $totalPrice;
                }

                $discountedPricing = $this->calculateFullBundleDiscountedPrice($totalPrice);
                $discountAmount = $discountedPricing['discount_amount'];
                $discountedPrice = $discountedPricing['discounted_price'];

                $catalog[$productId][$optionKey]['price'] = $totalPrice;
                $catalog[$productId][$optionKey]['current_price'] = $discountedPrice;
                $catalog[$productId][$optionKey]['special_price'] = $discountedPrice < $totalPrice ? $discountedPrice : null;
                $catalog[$productId][$optionKey]['bundle_option_total_price'] = $totalPrice;
                $catalog[$productId][$optionKey]['bundle_option_discounted_price'] = $discountedPrice;
                $catalog[$productId][$optionKey]['bundle_option_discount_amount'] = $discountAmount;
                $catalog[$productId][$optionKey]['bundle_option_base_price'] = $basePrice;
                $catalog[$productId][$optionKey]['bundle_option_key_aliases'] = $catalogAliases[$productId][$optionKey] ?? [$optionKey];
                $catalog[$productId][$optionKey]['bundle_items_summary'] = array_values($optionMeta['bundle_items_summary']);
            }
        }

        foreach ($catalog as $productId => $options) {
            foreach ($options as $optionKey => $optionMeta) {
                foreach ((array) ($optionMeta['bundle_option_key_aliases'] ?? []) as $aliasKey) {
                    $aliasKey = trim((string) $aliasKey);

                    if ($aliasKey !== '' && !isset($catalog[$productId][$aliasKey])) {
                        $catalog[$productId][$aliasKey] = $optionMeta;
                    }
                }
            }
        }

        return $catalog;
    }

    private function resolveRequestedCategoryItems(array $rawItems): Collection
    {
        if (empty($rawItems)) {
            return collect();
        }

        $normalizedItems = collect($rawItems)
            ->values()
            ->map(function (array $item, int $index) {
                $itemType = Str::lower(trim((string) ($item['item_type'] ?? 'product')));
                $productId = is_numeric($item['product_id'] ?? null) ? (int) $item['product_id'] : null;
                $optionPostId = is_numeric($item['bundle_option_post_id'] ?? null)
                    ? (int) $item['bundle_option_post_id']
                    : null;
                $optionTitle = Str::squish((string) ($item['bundle_option_title'] ?? ''));
                $optionKey = Str::lower(Str::squish((string) ($item['bundle_option_key'] ?? '')));
                $optionUid = $this->normalizeCategoryBundleOptionUid($item['bundle_option_uid'] ?? null);

                return [
                    'index' => $index,
                    'item_type' => $itemType === 'bundle_option' ? 'bundle_option' : 'product',
                    'product_id' => $productId,
                    'bundle_option_uid' => $optionUid,
                    'bundle_option_key' => $optionKey,
                    'bundle_option_post_id' => $optionPostId,
                    'bundle_option_title' => $optionTitle,
                ];
            });

        $variantParentProductIds = $this->resolveVariantParentProductIds(
            $normalizedItems
                ->where('item_type', 'product')
                ->pluck('product_id')
        );

        $productIds = $normalizedItems
            ->pluck('product_id')
            ->merge(array_values($variantParentProductIds))
            ->filter()
            ->unique()
            ->values()
            ->all();

        $products = Product::query()
            ->whereIn('id', $productIds)
            ->get(['id', 'type'])
            ->keyBy(fn (Product $product) => (int) $product->id);

        $bundleOptionCatalog = $this->buildCategoryBundleOptionCatalog(
            $normalizedItems
                ->where('item_type', 'bundle_option')
                ->pluck('product_id')
                ->filter()
                ->unique()
                ->values()
                ->all()
        );

        $messages = [];
        $resolvedItems = [];

        foreach ($normalizedItems as $item) {
            $index = (int) $item['index'];
            $requestedProductId = (int) ($item['product_id'] ?? 0);
            $productId = $item['item_type'] === 'product'
                ? (int) ($variantParentProductIds[$requestedProductId] ?? $requestedProductId)
                : $requestedProductId;
            /** @var Product|null $product */
            $product = $products->get($productId);

            if (!$product) {
                $messages["category_items.{$index}.product_id"][] = 'San pham khong ton tai.';
                continue;
            }

            if ($item['item_type'] === 'bundle_option') {
                if ($product->type !== 'bundle') {
                    $messages["category_items.{$index}.item_type"][] = 'Chi san pham bundle/combo moi co the gan tuy chon vao danh muc.';
                    continue;
                }

                $resolvedOptionKey = $item['bundle_option_key'] !== ''
                    ? $item['bundle_option_key']
                    : $this->normalizeCategoryBundleOptionKey(
                        $item['bundle_option_post_id'],
                        $item['bundle_option_title']
                    );

                $optionMeta = $this->resolveCategoryBundleOptionCatalogMeta(
                    $bundleOptionCatalog,
                    $productId,
                    $resolvedOptionKey,
                    $item['bundle_option_post_id'],
                    $item['bundle_option_title'],
                    $item['bundle_option_uid']
                );

                if (!$optionMeta) {
                    $messages["category_items.{$index}.bundle_option_key"][] = 'Tuy chon bundle khong hop le hoac da khong con ton tai.';
                    continue;
                }

                $resolvedOptionKey = $optionMeta['bundle_option_key'] ?? $resolvedOptionKey;
                $resolvedOptionUid = $this->normalizeCategoryBundleOptionUid($optionMeta['bundle_option_uid'] ?? $item['bundle_option_uid'] ?? null);
                $assignmentKey = $this->buildCategoryAssignmentKey('bundle_option', $productId, $resolvedOptionKey, $resolvedOptionUid);

                if (!isset($resolvedItems[$assignmentKey])) {
                    $resolvedItems[$assignmentKey] = [
                        'assignment_key' => $assignmentKey,
                        'item_type' => 'bundle_option',
                        'product_id' => $productId,
                        'bundle_option_uid' => $resolvedOptionUid,
                        'bundle_option_key' => $resolvedOptionKey,
                        'bundle_option_post_id' => $optionMeta['bundle_option_post_id'],
                        'bundle_option_title' => $optionMeta['bundle_option_title'],
                    ];
                }

                continue;
            }

            $assignmentKey = $this->buildCategoryAssignmentKey('product', $productId);

            if (!isset($resolvedItems[$assignmentKey])) {
                $resolvedItems[$assignmentKey] = [
                    'assignment_key' => $assignmentKey,
                    'item_type' => 'product',
                    'product_id' => $productId,
                    'bundle_option_uid' => null,
                    'bundle_option_key' => '',
                    'bundle_option_post_id' => null,
                    'bundle_option_title' => null,
                ];
            }
        }

        if (!empty($messages)) {
            throw ValidationException::withMessages($messages);
        }

        return collect(array_values($resolvedItems))
            ->values()
            ->map(fn (array $item, int $index) => [
                ...$item,
                'sort_order' => $index,
            ]);
    }

    private function syncCategoryItems(Category $category, array $rawItems): void
    {
        $requestedItems = $this->resolveRequestedCategoryItems($rawItems);

        DB::transaction(function () use ($category, &$requestedItems) {
            $existingRows = $this->loadCategoryAssignmentRows((int) $category->id);
            $timestamp = now();
            $existingByKey = $existingRows->keyBy(function ($row) {
                $itemType = $this->isCategoryBundleOptionAssignment(
                    $row->item_type ?? null,
                    $row->bundle_option_key ?? null,
                    $row->bundle_option_post_id ?? null,
                    $row->bundle_option_title ?? null,
                    $row->bundle_option_uid ?? null
                ) ? 'bundle_option' : 'product';
                $bundleOptionUid = $itemType === 'bundle_option'
                    ? $this->normalizeCategoryBundleOptionUid($row->bundle_option_uid ?? null)
                    : null;
                $bundleOptionKey = $itemType === 'bundle_option'
                    ? trim((string) ($row->bundle_option_key ?? ''))
                    : '';

                return $this->buildCategoryAssignmentKey(
                    $itemType,
                    (int) $row->product_id,
                    $bundleOptionKey,
                    $bundleOptionUid
                );
            });
            $requestedKeys = $requestedItems
                ->pluck('assignment_key')
                ->flip()
                ->all();
            $protectedPrimaryProductIds = Product::query()
                ->leftJoin('product_links as parent_links', function ($join) {
                    $join->on('products.id', '=', 'parent_links.linked_product_id')
                        ->where('parent_links.link_type', '=', 'super_link');
                })
                ->where('category_id', $category->id)
                ->whereNull('parent_links.product_id')
                ->pluck('products.id')
                ->map(fn ($productId) => (int) $productId)
                ->flip()
                ->all();

            $deleteIds = $existingRows
                ->filter(function ($row) use ($requestedKeys, $protectedPrimaryProductIds) {
                    $itemType = $this->isCategoryBundleOptionAssignment(
                        $row->item_type ?? null,
                        $row->bundle_option_key ?? null,
                        $row->bundle_option_post_id ?? null,
                        $row->bundle_option_title ?? null,
                        $row->bundle_option_uid ?? null
                    ) ? 'bundle_option' : 'product';
                    $bundleOptionUid = $itemType === 'bundle_option'
                        ? $this->normalizeCategoryBundleOptionUid($row->bundle_option_uid ?? null)
                        : null;
                    $bundleOptionKey = $itemType === 'bundle_option'
                        ? trim((string) ($row->bundle_option_key ?? ''))
                        : '';
                    $assignmentKey = $this->buildCategoryAssignmentKey(
                        $itemType,
                        (int) $row->product_id,
                        $bundleOptionKey,
                        $bundleOptionUid
                    );

                    if (isset($requestedKeys[$assignmentKey])) {
                        return false;
                    }

                    if ($itemType === 'product' && isset($protectedPrimaryProductIds[(int) $row->product_id])) {
                        return false;
                    }

                    return true;
                })
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->all();

            if (!empty($deleteIds)) {
                DB::table('category_product')
                    ->whereIn('id', $deleteIds)
                    ->delete();
            }

            foreach ($requestedItems as $index => $item) {
                $payload = [
                    'item_type' => $item['item_type'],
                    'bundle_option_uid' => $item['bundle_option_uid'],
                    'bundle_option_key' => $item['bundle_option_key'],
                    'bundle_option_post_id' => $item['bundle_option_post_id'],
                    'bundle_option_title' => $item['bundle_option_title'],
                    'sort_order' => $index,
                    'updated_at' => $timestamp,
                ];

                $existingRow = $existingByKey->get($item['assignment_key']);

                if ($existingRow) {
                    DB::table('category_product')
                        ->where('id', $existingRow->id)
                        ->update($payload);

                    continue;
                }

                DB::table('category_product')->insert([
                    'product_id' => $item['product_id'],
                    'category_id' => $category->id,
                    ...$payload,
                    'created_at' => $timestamp,
                ]);
            }

            Category::ensureProductAssignments((int) $category->id);
        });
    }

    public function index(Request $request)
    {
        $isTrashView = $this->shouldUseCategoryTrashView($request);

        if ($isTrashView) {
            $this->ensureCategoryTrashSchema();
        }

        $query = $isTrashView
            ? Category::onlyTrashed()
            : Category::query();

        $categories = $query
            ->with([
                'bannerMediaAsset',
                'logoMediaAsset',
                'siteDomain:id,domain,is_active,is_default',
                'parent' => static function ($parentQuery) use ($isTrashView) {
                    if ($isTrashView) {
                        $parentQuery->withTrashed();
                    }

                    $parentQuery->select(['id', 'name']);
                },
            ])
            ->withCount('products')
            ->orderBy('order')
            ->orderBy('id')
            ->get();

        return response()->json($this->orderedCategoriesForTree($categories));
    }

    public function store(Request $request)
    {
        $parsedCategoryItems = $this->extractCategoryItemsFromRequest($request);

        $validator = \Validator::make(array_merge($request->all(), [
            'category_items' => $parsedCategoryItems,
        ]), [
            'name' => 'required|string|max:255',
            'code' => 'nullable|string|max:120',
            'slug' => 'nullable|string|max:255',
            'site_domain_id' => 'nullable|exists:site_domains,id',
            'parent_id' => 'nullable|integer',
            'description' => 'nullable|string',
            'meta_title' => 'nullable|string|max:255',
            'meta_description' => 'nullable|string',
            'meta_keywords' => 'nullable|string|max:255',
            'banner' => 'nullable|image|max:5120',
            'logo' => 'nullable|image|max:5120',
            'filterable_attribute_ids' => 'nullable|array',
            'category_items' => 'nullable|array',
            'category_items.*' => 'array',
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        $parentId = $this->resolveValidatedParentId($request->input('parent_id'));
        $normalizedName = $this->normalizeRequiredString($request->input('name'));
        $slugSource = $this->normalizeRequiredString($request->input('slug') ?: $normalizedName) ?: $normalizedName;

        $normalizedCode = Category::normalizeCode($request->input('code'));

        try {
            $bannerAsset = $request->hasFile('banner')
                ? $this->mediaService->uploadImage($request->file('banner'), [
                    'collection' => 'category-banners',
                    'source' => 'category-form-upload',
                ])
                : null;
            $logoAsset = $request->hasFile('logo')
                ? $this->mediaService->uploadImage($request->file('logo'), [
                    'collection' => 'category-logos',
                    'source' => 'category-form-upload',
                ])
                : null;

            $category = Category::create([
                'name' => $normalizedName,
                'code' => $normalizedCode ? Category::buildUniqueCode($normalizedCode) : Category::buildUniqueCode($normalizedName),
                'site_domain_id' => $request->filled('site_domain_id') ? (int) $request->input('site_domain_id') : null,
                'slug' => Category::buildUniqueSlug($slugSource),
                'parent_id' => $parentId,
                'description' => $this->normalizeNullableString($request->input('description')),
                'meta_title' => $this->normalizeNullableString($request->input('meta_title')),
                'meta_description' => $this->normalizeNullableString($request->input('meta_description')),
                'meta_keywords' => $this->normalizeNullableString($request->input('meta_keywords')),
                'banner_path' => $bannerAsset ? $this->mediaService->buildAssetUrl($bannerAsset, 'large') : null,
                'banner_media_asset_id' => $bannerAsset?->id,
                'logo_path' => $logoAsset ? $this->mediaService->buildAssetUrl($logoAsset, 'large') : null,
                'logo_media_asset_id' => $logoAsset?->id,
                'status' => $request->status ?? 1,
                'order' => $this->nextSiblingOrder($parentId),
                'display_layout' => 'layout_1',
                'filterable_attribute_ids' => $this->normalizeFilterableAttributeIds(
                    $request->input('filterable_attribute_ids')
                ),
            ]);

            if ($parsedCategoryItems !== null) {
                $this->syncCategoryItems($category, $parsedCategoryItems);
            }

            $this->categoryDemoLogoService->syncDemoLogoPath($category);
        } catch (Throwable $exception) {
            \Log::error('Error creating category: ' . $exception->getMessage());
            return response()->json(['error' => $exception->getMessage()], 500);
        }

        return response()->json($category->load(['bannerMediaAsset', 'logoMediaAsset', 'siteDomain:id,domain,is_active,is_default']), 201);
    }

    public function show($id)
    {
        $category = Category::with(['children.bannerMediaAsset', 'children.logoMediaAsset', 'products', 'bannerMediaAsset', 'logoMediaAsset', 'siteDomain:id,domain,is_active,is_default'])->findOrFail($id);

        return response()->json($category);
    }

    public function update(Request $request, $id)
    {
        \Log::info("Category update request for ID: {$id}", [
            'data' => $request->all(),
            'has_file' => $request->hasFile('banner'),
            'has_logo_file' => $request->hasFile('logo'),
        ]);

        $category = Category::findOrFail($id);
        $previousBannerAssetId = $category->banner_media_asset_id;
        $previousLogoAssetId = $category->logo_media_asset_id;
        $originalParentId = $category->parent_id ? (int) $category->parent_id : null;
        $parentChanged = false;
        $parsedCategoryItems = $this->extractCategoryItemsFromRequest($request);

        $validator = \Validator::make(array_merge($request->all(), [
            'category_items' => $parsedCategoryItems,
        ]), [
            'name' => 'sometimes|required|string|max:255',
            'code' => 'nullable|string|max:120',
            'slug' => 'nullable|string|max:255',
            'site_domain_id' => 'nullable|exists:site_domains,id',
            'parent_id' => 'sometimes|nullable|integer',
            'description' => 'nullable|string',
            'meta_title' => 'nullable|string|max:255',
            'meta_description' => 'nullable|string',
            'meta_keywords' => 'nullable|string|max:255',
            'banner' => 'nullable|image|max:5120',
            'logo' => 'nullable|image|max:5120',
            'filterable_attribute_ids' => 'nullable|array',
            'category_items' => 'nullable|array',
            'category_items.*' => 'array',
        ]);

        if ($validator->fails()) {
            \Log::error('Category validation failed: ' . json_encode($validator->errors()->toArray()));
            return response()->json(['errors' => $validator->errors()], 422);
        }

        if ($request->has('name')) {
            $normalizedName = $this->normalizeRequiredString($request->input('name'));
            $category->name = $normalizedName;
        }

        if ($request->has('slug') || $request->has('name')) {
            $slugSource = $request->has('slug')
                ? $this->normalizeRequiredString($request->input('slug'))
                : $this->normalizeRequiredString($category->name);
            $category->slug = Category::buildUniqueSlug($slugSource ?: $category->name, (int) $category->id);
        }

        if ($request->has('site_domain_id')) {
            $category->site_domain_id = $request->filled('site_domain_id') ? (int) $request->input('site_domain_id') : null;
        }

        if ($request->filled('code')) {
            $category->code = Category::buildUniqueCode($request->input('code'), (int) $category->id);
        }

        if ($request->hasFile('banner')) {
            $this->replaceCategoryMediaAsset($category, 'banner', $request->file('banner'));
        } elseif ($request->input('remove_banner') === 'true') {
            $category->banner_path = null;
            $category->banner_media_asset_id = null;
        }

        if ($request->hasFile('logo')) {
            $this->replaceCategoryMediaAsset($category, 'logo', $request->file('logo'));
        } elseif ($request->input('remove_logo') === 'true') {
            $category->logo_path = null;
            $category->logo_media_asset_id = null;
        }

        if ($request->has('parent_id')) {
            $resolvedParentId = $this->resolveValidatedParentId(
                $request->input('parent_id'),
                (int) $category->id
            );
            $parentChanged = $resolvedParentId !== $originalParentId;
            $category->parent_id = $resolvedParentId;

            if ($parentChanged) {
                $category->order = $this->nextSiblingOrder($resolvedParentId, (int) $category->id);
            }
        }
        if ($request->has('description')) {
            $category->description = $this->normalizeNullableString($request->input('description'));
        }
        if ($request->has('meta_title')) {
            $category->meta_title = $this->normalizeNullableString($request->input('meta_title'));
        }
        if ($request->has('meta_description')) {
            $category->meta_description = $this->normalizeNullableString($request->input('meta_description'));
        }
        if ($request->has('meta_keywords')) {
            $category->meta_keywords = $this->normalizeNullableString($request->input('meta_keywords'));
        }
        $category->status = $request->input('status', $category->status);
        $category->display_layout = 'layout_1';

        if ($request->has('filterable_attribute_ids')) {
            $category->filterable_attribute_ids = $this->normalizeFilterableAttributeIds(
                $request->input('filterable_attribute_ids')
            );
        } elseif ($request->has('clear_attributes') && $request->input('clear_attributes') == 'true') {
            $category->filterable_attribute_ids = [];
        }

        try {
            $category->save();

            if ($parsedCategoryItems !== null) {
                $this->syncCategoryItems($category, $parsedCategoryItems);
            }

            $this->categoryDemoLogoService->syncDemoLogoPath($category);

            if ($parentChanged) {
                $this->resequenceCategoryOrders();
            }
        } catch (Throwable $exception) {
            \Log::error('Error saving category: ' . $exception->getMessage());
            return response()->json(['error' => $exception->getMessage()], 500);
        }

        if ($request->input('remove_banner') === 'true' && $previousBannerAssetId) {
            $this->mediaService->deleteAsset($previousBannerAssetId);
        }

        if ($request->input('remove_logo') === 'true' && $previousLogoAssetId) {
            $this->mediaService->deleteAsset($previousLogoAssetId);
        }

        return response()->json($category->load(['bannerMediaAsset', 'logoMediaAsset', 'siteDomain:id,domain,is_active,is_default']));
    }

    public function destroy($id)
    {
        $this->ensureCategoryTrashSchema();

        $category = Category::findOrFail($id);
        $cascadeIds = $this->resolveCategoryTrashCascadeIds([(int) $category->id]);
        $deletedBy = auth()->id();

        DB::transaction(function () use ($cascadeIds, $deletedBy) {
            Category::query()
                ->whereIn('id', $cascadeIds)
                ->delete();

            $this->stampDeletedByForCategories($cascadeIds, $deletedBy);
        });

        return response()->json([
            'message' => 'Đã chuyển danh mục vào Thùng rác.',
            'trashed_count' => count($cascadeIds),
        ]);
    }

    public function restore($id)
    {
        $this->ensureCategoryTrashSchema();

        $category = Category::onlyTrashed()->findOrFail($id);
        $restoredIds = $this->restoreCategoryTree([(int) $category->id]);

        return response()->json([
            'message' => 'Đã khôi phục danh mục từ Thùng rác.',
            'restored_count' => count($restoredIds),
        ]);
    }

    public function reorder(Request $request)
    {
        $request->validate([
            'items' => 'nullable|array',
            'items.*.id' => 'required|integer|min:1',
            'items.*.parent_id' => 'nullable|integer|min:1',
            'items.*.order' => 'nullable|integer|min:0',
        ]);

        $items = collect($request->input('items', []))
            ->map(fn (array $item) => [
                'id' => (int) $item['id'],
                'parent_id' => $this->normalizeParentIdInput($item['parent_id'] ?? null),
                'order' => isset($item['order']) ? (int) $item['order'] : 0,
            ])
            ->values();

        if ($items->isEmpty()) {
            return response()->json([
                'message' => 'Tree reordered successfully',
                'categories' => $this->orderedCategoriesForTree(
                    Category::with(['bannerMediaAsset', 'logoMediaAsset', 'siteDomain:id,domain,is_active,is_default'])
                        ->withCount('products')
                        ->get()
                ),
            ]);
        }

        $this->validateReorderPayload($items);

        DB::transaction(function () use ($items) {
            $categories = Category::query()
                ->get(['id', 'parent_id', 'order'])
                ->keyBy(fn (Category $category) => (int) $category->id);

            $stateById = $categories
                ->mapWithKeys(fn (Category $category) => [
                    (int) $category->id => [
                        'id' => (int) $category->id,
                        'parent_id' => $category->parent_id ? (int) $category->parent_id : null,
                        'order' => (int) ($category->order ?? 0),
                    ],
                ])
                ->all();

            foreach ($items as $item) {
                $stateById[$item['id']] = [
                    'id' => (int) $item['id'],
                    'parent_id' => $item['parent_id'],
                    'order' => (int) ($item['order'] ?? 0),
                ];
            }

            $timestamp = now();
            $groupedSiblings = collect($stateById)
                ->groupBy(fn (array $item) => $this->parentGroupKey($item['parent_id']));

            foreach ($groupedSiblings as $siblings) {
                $sortedSiblings = $siblings
                    ->sortBy([
                        ['order', 'asc'],
                        ['id', 'asc'],
                    ])
                    ->values();

                foreach ($sortedSiblings as $index => $sibling) {
                    /** @var Category|null $existingCategory */
                    $existingCategory = $categories->get((int) $sibling['id']);

                    if (!$existingCategory) {
                        continue;
                    }

                    $currentParentId = $existingCategory->parent_id ? (int) $existingCategory->parent_id : null;
                    $currentOrder = (int) ($existingCategory->order ?? 0);

                    if ($currentParentId === $sibling['parent_id'] && $currentOrder === $index) {
                        continue;
                    }

                    Category::query()
                        ->whereKey((int) $sibling['id'])
                        ->update([
                            'parent_id' => $sibling['parent_id'],
                            'order' => $index,
                            'updated_at' => $timestamp,
                        ]);
                }
            }
        });

        return response()->json([
            'message' => 'Tree reordered successfully',
            'categories' => $this->orderedCategoriesForTree(
                Category::with(['bannerMediaAsset', 'logoMediaAsset', 'siteDomain:id,domain,is_active,is_default'])
                    ->withCount('products')
                    ->get()
            ),
        ]);
    }

    public function bulkDestroy(Request $request)
    {
        $this->ensureCategoryTrashSchema();

        $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer|distinct',
        ]);

        $ids = collect($request->input('ids', []))
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            throw ValidationException::withMessages([
                'ids' => ['Vui long chon it nhat mot danh muc hop le de xoa.'],
            ]);
        }

        $existingIds = Category::query()
            ->whereIn('id', $ids)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values();

        if ($existingIds->count() !== $ids->count()) {
            throw ValidationException::withMessages([
                'ids' => ['Mot hoac nhieu danh muc khong ton tai hoac khong hop le.'],
            ]);
        }

        $cascadeIds = $this->resolveCategoryTrashCascadeIds($existingIds->all());
        $deletedBy = auth()->id();

        DB::transaction(function () use ($cascadeIds, $deletedBy) {
            Category::query()
                ->whereIn('id', $cascadeIds)
                ->delete();

            $this->stampDeletedByForCategories($cascadeIds, $deletedBy);
        });

        return response()->json([
            'message' => 'Đã chuyển các danh mục đã chọn vào Thùng rác.',
            'trashed_count' => count($cascadeIds),
        ]);
    }

    public function bulkRestore(Request $request)
    {
        $this->ensureCategoryTrashSchema();

        $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer|distinct',
        ]);

        $ids = collect($request->input('ids', []))
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            throw ValidationException::withMessages([
                'ids' => ['Vui lòng chọn ít nhất một danh mục hợp lệ để khôi phục.'],
            ]);
        }

        $existingIds = Category::onlyTrashed()
            ->whereIn('id', $ids)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values();

        if ($existingIds->count() !== $ids->count()) {
            throw ValidationException::withMessages([
                'ids' => ['Một hoặc nhiều danh mục không còn trong Thùng rác hoặc không hợp lệ.'],
            ]);
        }

        $restoredIds = $this->restoreCategoryTree($existingIds->all());

        return response()->json([
            'message' => 'Đã khôi phục các danh mục đã chọn.',
            'restored_count' => count($restoredIds),
        ]);
    }

    public function downloadImportTemplate()
    {
        return $this->xlsxDownloadResponse(
            'mau-import-danh-muc-san-pham.xlsx',
            [[
                'name' => 'DanhMucSanPham',
                'rows' => array_merge([$this->categoryImportHeaders()], $this->categoryTemplateRows()),
            ]]
        );
    }

    public function exportExcel(Request $request)
    {
        $request->validate([
            'ids' => 'nullable',
        ]);

        $allCategories = Category::query()
            ->orderBy('order')
            ->orderBy('id')
            ->get([
                'account_id',
                'id',
                'name',
                'code',
                'slug',
                'parent_id',
                'description',
                'status',
                'order',
                'display_layout',
                'filterable_attribute_ids',
                'banner_path',
                'logo_path',
            ]);

        $requestedIds = $this->normalizeCategoryExportIds($request->input('ids'));
        $categories = $this->filterCategoriesForExport($allCategories, $requestedIds);

        return $this->xlsxDownloadResponse(
            'danh-muc-san-pham-' . now()->format('Ymd-His') . '.xlsx',
            [[
                'name' => 'DanhMucSanPham',
                'rows' => array_merge(
                    [$this->categoryExportHeaders()],
                    $this->buildCategoryExportRows($categories)
                ),
            ]]
        );
    }

    public function importExcel(Request $request)
    {
        $request->validate([
            'file' => 'required|file|mimes:xlsx|max:10240',
            'mode' => 'nullable|string|in:replace_all,update_selected_fields',
            'update_fields' => 'nullable|array',
            'update_fields.*' => 'nullable|string|max:60',
        ]);

        $importOptions = $this->resolveCategoryImportOptions($request);
        if ($importOptions['is_selective_update'] && empty($importOptions['selected_fields'])) {
            return response()->json([
                'message' => 'Vui long chon it nhat 1 truong can cap nhat truoc khi import.',
                'errors' => [[
                    'row' => 1,
                    'column' => 'Truong cap nhat',
                    'message' => 'Chua co truong nao duoc chon de cap nhat.',
                ]],
            ], 422);
        }

        try {
            $rows = SimpleXlsx::readRows($request->file('file')->getRealPath());
        } catch (Throwable $exception) {
            return response()->json([
                'message' => 'Khong the doc file Excel. Vui long dung file .xlsx hop le.',
                'errors' => [[
                    'row' => 1,
                    'column' => 'File',
                    'message' => $exception->getMessage(),
                ]],
            ], 422);
        }

        [$records, $errors] = $this->validateCategoryImportRows($rows, $importOptions);

        if (!empty($errors)) {
            return response()->json([
                'message' => 'Phat hien loi trong file import. Khong co du lieu nao duoc cap nhat.',
                'errors' => $errors,
            ], 422);
        }

        try {
            $summary = DB::transaction(fn () => $this->applyCategoryImport($records, $importOptions));
        } catch (Throwable $exception) {
            return response()->json([
                'message' => 'Import danh muc that bai. ' . $exception->getMessage(),
                'errors' => [[
                    'row' => 0,
                    'column' => 'Du lieu',
                    'message' => $exception->getMessage(),
                ]],
            ], 422);
        }

        return response()->json([
            'message' => sprintf(
                'Import thanh cong: %d them moi, %d cap nhat, %d anh dong bo.',
                $summary['created'],
                $summary['updated'],
                $summary['images_imported'] ?? 0
            ),
            'summary' => $summary,
        ]);
    }

    public function products($id)
    {
        $category = Category::findOrFail($id);
        Category::ensureProductAssignments((int) $category->id);

        return response()->json($this->buildCategoryProductPayload($category));
    }

    public function reorderProducts(Request $request, $id)
    {
        $category = Category::findOrFail($id);
        Category::ensureProductAssignments((int) $category->id);

        if ($request->has('items')) {
            $request->validate([
                'items' => 'required|array',
                'items.*' => 'array',
            ]);

            $requestedItems = $this->resolveRequestedCategoryItems((array) $request->input('items', []));
        } else {
            $request->validate([
                'product_ids' => 'required|array',
                'product_ids.*' => 'integer|distinct',
            ]);

            $requestedItems = collect($request->input('product_ids', []))
                ->map(fn ($productId) => is_numeric($productId) ? (int) $productId : null)
                ->filter()
                ->unique()
                ->values()
                ->map(fn (int $productId, int $index) => [
                    'assignment_key' => $this->buildCategoryAssignmentKey('product', $productId),
                    'item_type' => 'product',
                    'product_id' => $productId,
                    'bundle_option_key' => '',
                    'bundle_option_post_id' => null,
                    'bundle_option_title' => null,
                    'sort_order' => $index,
                ]);
        }

        if ($request->has('items')) {
            $this->syncCategoryItems($category, $request->input('items'));
        } else {
            $this->syncCategoryItems($category, $requestedItems->toArray());
        }

        Category::ensureProductAssignments((int) $category->id);

        return response()->json([
            'message' => 'Da cap nhat thu tu item trong danh muc.',
            ...$this->buildCategoryProductPayload($category->fresh()),
        ]);
    }

    protected function buildCategoryProductPayload(Category $category): array
    {
        $category->loadMissing(['bannerMediaAsset', 'logoMediaAsset', 'siteDomain:id,domain,is_active,is_default']);
        $assignmentRows = $this->normalizeCategoryAssignmentRowsForDisplay(
            $this->loadCategoryAssignmentRows((int) $category->id)
        );

        if ($assignmentRows->isEmpty()) {
            return [
                'category' => $this->buildCategoryMetaPayload($category, 0),
                'products' => [],
            ];
        }

        $productsById = Product::query()
            ->with([
                'images:id,product_id,image_url,is_primary,sort_order',
                'category:id,name',
                'parentConfigurable:id,name,sku',
            ])
            ->whereIn('id', $assignmentRows->pluck('product_id')->unique()->values()->all())
            ->get([
                'products.id',
                'products.type',
                'products.name',
                'products.slug',
                'products.sku',
                'products.price',
                'products.special_price',
                'products.special_price_from',
                'products.special_price_to',
                'products.status',
                'products.category_id',
            ])
            ->keyBy(fn (Product $product) => (int) $product->id);

        $bundleOptionCatalog = $this->buildCategoryBundleOptionCatalog(
            $assignmentRows
                ->filter(fn ($row) => $this->isCategoryBundleOptionAssignment(
                    $row->item_type ?? null,
                    $row->bundle_option_key ?? null,
                    $row->bundle_option_post_id ?? null,
                    $row->bundle_option_title ?? null,
                    $row->bundle_option_uid ?? null
                ))
                ->pluck('product_id')
                ->map(fn ($productId) => (int) $productId)
                ->unique()
                ->values()
                ->all()
        );

        $products = $assignmentRows
            ->map(function ($row) use ($category, $productsById, $bundleOptionCatalog) {
                /** @var Product|null $product */
                $product = $productsById->get((int) $row->product_id);

                if (!$product) {
                    return null;
                }

                $itemType = $this->isCategoryBundleOptionAssignment(
                    $row->item_type ?? null,
                    $row->bundle_option_key ?? null,
                    $row->bundle_option_post_id ?? null,
                    $row->bundle_option_title ?? null,
                    $row->bundle_option_uid ?? null
                ) ? 'bundle_option' : 'product';
                $bundleOptionUid = $itemType === 'bundle_option'
                    ? $this->normalizeCategoryBundleOptionUid($row->bundle_option_uid ?? null)
                    : null;
                $bundleOptionKey = $itemType === 'bundle_option'
                    ? Str::lower(Str::squish((string) ($row->bundle_option_key ?? '')))
                    : '';
                if ($itemType === 'bundle_option' && $bundleOptionKey === '') {
                    $bundleOptionKey = $this->normalizeCategoryBundleOptionKey(
                        filled($row->bundle_option_post_id ?? null) ? (int) $row->bundle_option_post_id : null,
                        Str::squish((string) ($row->bundle_option_title ?? '')) ?: null
                    );
                }
                $assignmentKey = $this->buildCategoryAssignmentKey($itemType, (int) $product->id, $bundleOptionKey, $bundleOptionUid);
                $basePayload = [
                    'id' => $assignmentKey,
                    'assignment_key' => $assignmentKey,
                    'item_type' => $itemType,
                    'product_id' => (int) $product->id,
                    'admin_product_id' => (int) $product->id,
                    'slug' => $product->slug,
                    'status' => (bool) $product->status,
                    'category_id' => $product->category_id ? (int) $product->category_id : null,
                    'category_name' => $product->category?->name,
                    'main_image' => $product->main_image,
                    'price' => $product->price !== null ? (float) $product->price : null,
                    'current_price' => $product->current_price !== null ? (float) $product->current_price : null,
                    'special_price' => $product->special_price !== null ? (float) $product->special_price : null,
                    'display_sku' => $product->sku,
                    'sort_order' => (int) ($row->sort_order ?? 0),
                ];

                if ($itemType === 'bundle_option') {
                    $optionMeta = $this->resolveCategoryBundleOptionCatalogMeta(
                        $bundleOptionCatalog,
                        (int) $product->id,
                        $bundleOptionKey,
                        $row->bundle_option_post_id ?? null,
                        $row->bundle_option_title ?? null,
                        $bundleOptionUid
                    ) ?? [
                        'bundle_option_uid' => $bundleOptionUid,
                        'bundle_option_key' => $bundleOptionKey,
                        'bundle_option_post_id' => filled($row->bundle_option_post_id) ? (int) $row->bundle_option_post_id : null,
                        'bundle_option_title' => Str::squish((string) ($row->bundle_option_title ?? '')) ?: 'Mac dinh',
                        'option_key_display' => $bundleOptionKey,
                        'main_image' => null,
                        'price' => null,
                        'current_price' => null,
                        'special_price' => null,
                        'bundle_option_total_price' => null,
                        'bundle_option_discounted_price' => null,
                        'bundle_option_discount_amount' => null,
                        'bundle_option_discount_rate' => self::BUNDLE_FULL_SET_DISCOUNT_RATE,
                        'status' => true,
                        'bundle_items_count' => 0,
                        'bundle_items_summary' => [],
                    ];
                    $summaryParts = collect($optionMeta['bundle_items_summary'] ?? [])
                        ->map(fn (array $item) => $this->buildCategorySearchText([$item['name'] ?? '', $item['sku'] ?? '']))
                        ->filter()
                        ->values();
                    $resolvedOptionKey = $optionMeta['bundle_option_key'] ?? $bundleOptionKey;
                    $resolvedOptionUid = $this->normalizeCategoryBundleOptionUid($optionMeta['bundle_option_uid'] ?? $bundleOptionUid);
                    $optionKeyDisplay = $optionMeta['option_key_display'] ?? $resolvedOptionKey;
                    $optionCurrentPrice = $optionMeta['current_price'] ?? $optionMeta['bundle_option_discounted_price'] ?? null;
                    $optionBasePrice = $optionMeta['price'] ?? $optionMeta['bundle_option_total_price'] ?? null;

                    return [
                        ...$basePayload,
                        'name' => $optionMeta['bundle_option_title'],
                        'sku' => $product->sku ?: $optionKeyDisplay,
                        'display_sku' => $product->sku ?: $optionKeyDisplay,
                        'option_key_display' => $optionKeyDisplay,
                        'product_type' => 'bundle_option',
                        'display_type' => 'bundle_option',
                        'display_label' => 'Tuy chon bundle',
                        'main_image' => $optionMeta['main_image'] ?: $product->main_image,
                        'price' => $optionBasePrice !== null ? (float) $optionBasePrice : null,
                        'current_price' => $optionCurrentPrice !== null ? (float) $optionCurrentPrice : null,
                        'special_price' => isset($optionMeta['special_price']) && $optionMeta['special_price'] !== null
                            ? (float) $optionMeta['special_price']
                            : null,
                        'status' => (bool) $product->status && (bool) ($optionMeta['status'] ?? true),
                        'bundle_parent_name' => $product->name,
                        'bundle_parent_product_id' => (int) $product->id,
                        'bundle_option_uid' => $resolvedOptionUid,
                        'bundle_option_key' => $resolvedOptionKey,
                        'bundle_option_post_id' => $optionMeta['bundle_option_post_id'],
                        'bundle_option_title' => $optionMeta['bundle_option_title'],
                        'bundle_option_post_title' => $optionMeta['bundle_option_post_title'] ?? null,
                        'bundle_option_post_slug' => $optionMeta['bundle_option_post_slug'] ?? null,
                        'bundle_option_total_price' => $optionMeta['bundle_option_total_price'] ?? null,
                        'bundle_option_discounted_price' => $optionMeta['bundle_option_discounted_price'] ?? null,
                        'bundle_option_discount_amount' => $optionMeta['bundle_option_discount_amount'] ?? null,
                        'bundle_option_discount_rate' => $optionMeta['bundle_option_discount_rate'] ?? self::BUNDLE_FULL_SET_DISCOUNT_RATE,
                        'bundle_items_count' => (int) ($optionMeta['bundle_items_count'] ?? 0),
                        'bundle_items_summary' => $optionMeta['bundle_items_summary'] ?? [],
                        'is_primary_category' => false,
                        'is_variant_child' => false,
                        'is_removable' => true,
                        'search_text' => $this->buildCategorySearchText([
                            $product->name,
                            $product->sku,
                            $optionMeta['bundle_option_title'] ?? '',
                            $optionKeyDisplay,
                            $summaryParts->implode(' '),
                        ]),
                    ];
                }

                $parentConfigurable = $product->parentConfigurable->first();
                $isVariantChild = $parentConfigurable instanceof Product;
                $isPrimaryCategory = (int) ($product->category_id ?? 0) === (int) $category->id;

                return [
                    ...$basePayload,
                    'name' => $product->name,
                    'sku' => $product->sku,
                    'product_type' => $product->type,
                    'display_type' => $isVariantChild ? 'variant' : $product->type,
                    'display_label' => $isVariantChild
                        ? 'Bien the'
                        : match ($product->type) {
                            'bundle' => 'Bundle',
                            'configurable' => 'San pham co bien the',
                            'grouped' => 'Nhom san pham',
                            default => 'San pham',
                        },
                    'variant_parent_name' => $isVariantChild ? $parentConfigurable->name : null,
                    'variant_parent_product_id' => $isVariantChild ? (int) $parentConfigurable->id : null,
                    'is_primary_category' => $isPrimaryCategory,
                    'is_variant_child' => $isVariantChild,
                    'is_removable' => !$isPrimaryCategory,
                    'bundle_option_uid' => null,
                    'bundle_option_key' => null,
                    'bundle_option_post_id' => null,
                    'bundle_option_title' => null,
                    'option_key_display' => null,
                    'bundle_items_count' => 0,
                    'bundle_items_summary' => [],
                    'search_text' => $this->buildCategorySearchText([
                        $product->name,
                        $product->sku,
                        $isVariantChild ? $parentConfigurable->name : null,
                        $product->category?->name,
                    ]),
                ];
            })
            ->filter()
            ->values();

        return [
            'category' => $this->buildCategoryMetaPayload($category, (int) $products->count()),
            'products' => $products,
        ];
    }

    private function buildCategoryMetaPayload(Category $category, int $itemsCount): array
    {
        return [
            'id' => (int) $category->id,
            'name' => $category->name,
            'slug' => $category->slug,
            'site_domain_id' => $category->site_domain_id ? (int) $category->site_domain_id : null,
            'site_domain' => $category->relationLoaded('siteDomain') && $category->siteDomain ? [
                'id' => (int) $category->siteDomain->id,
                'domain' => $category->siteDomain->domain,
                'is_active' => (bool) $category->siteDomain->is_active,
                'is_default' => (bool) $category->siteDomain->is_default,
            ] : null,
            'parent_id' => $category->parent_id ? (int) $category->parent_id : null,
            'description' => $category->description,
            'meta_title' => $category->meta_title,
            'meta_description' => $category->meta_description,
            'meta_keywords' => $category->meta_keywords,
            'display_layout' => $category->display_layout ?: 'layout_1',
            'status' => (int) $category->status,
            'filterable_attribute_ids' => $category->filterable_attribute_ids ?: [],
            'banner_path' => $category->banner_path,
            'logo_path' => $category->logo_path,
            'banner_media_asset_id' => $category->banner_media_asset_id ? (int) $category->banner_media_asset_id : null,
            'logo_media_asset_id' => $category->logo_media_asset_id ? (int) $category->logo_media_asset_id : null,
            'banner_image' => $category->banner_image,
            'logo_image' => $category->logo_image,
            'products_count' => $itemsCount,
            'items_count' => $itemsCount,
        ];
    }

    private function categoryImportHeaders(): array
    {
        return [
            'Ma danh muc',
            'Ten danh muc',
            'Mo ta',
            'Danh muc cha',
            'Thu tu trong cay',
            'Link anh banner',
            'Link anh nho',
        ];
    }

    private function categoryExportHeaders(): array
    {
        return $this->categoryImportHeaders();
    }

    private function categoryTemplateRows(): array
    {
        return [
            [
                '#vd-do-tho-bat-trang',
                '#Ten danh muc',
                '#Mo ta danh muc',
                '#CODE:ma-cha hoac ID:12 hoac NAME:Ten danh muc cha',
                '#0',
                '#https://cdn.example.com/category/banner.jpg',
                '#https://cdn.example.com/category/logo.jpg',
            ],
            [
                '#chi-dan',
                '#Ten danh muc bat buoc khi tao moi hoac khi cap nhat truong ten',
                '#De trong = xoa mo ta khi import day du. Nhap NULL/deletE/CLEAR de xoa trong update mode',
                '#De trong = dua ve cap goc khi import day du hoac khi chon cap nhat cay',
                '#Thu tu trong nhom anh em. Neu bo trong, he thong giu thu tu cu hoac noi tiep',
                '#Chi nhan URL http/https. Import se luu lai ve kho anh online cua he thong',
                '#De trong = bo qua khi update 1 phan. Nhap NULL/deletE/CLEAR de xoa anh',
            ],
        ];
    }

    private function buildCategoryExportRows(Collection $categories): array
    {
        $categoriesById = $categories->keyBy(fn ($category) => (int) $category->id);

        return array_map(function (Category $category) use ($categoriesById) {
            /** @var Category|null $parent */
            $parent = $category->parent_id ? $categoriesById->get((int) $category->parent_id) : null;

            return [
                $category->resolvedCode(),
                $category->name,
                $category->description ?? '',
                $parent ? ('CODE:' . $parent->resolvedCode()) : '',
                (int) ($category->order ?? 0),
                $this->resolveCategoryAssetPublicUrl($category->banner_path),
                $this->resolveCategoryAssetPublicUrl($category->logo_path),
            ];
        }, $this->orderedCategoriesForTree($categories));
    }

    private function normalizeCategoryExportIds($value): array
    {
        $items = $value;

        if (is_string($items)) {
            $items = preg_split('/[\s,;|]+/', $items) ?: [];
        }

        return collect((array) $items)
            ->map(fn ($item) => is_numeric($item) ? (int) $item : null)
            ->filter(fn ($item) => $item !== null && $item > 0)
            ->unique()
            ->values()
            ->all();
    }

    private function filterCategoriesForExport(Collection $categories, array $requestedIds): Collection
    {
        if (empty($requestedIds)) {
            return $categories;
        }

        $categoriesById = $categories->keyBy(fn (Category $category) => (int) $category->id);
        $childrenByParent = $categories->groupBy(fn (Category $category) => $category->parent_id ? (int) $category->parent_id : 0);
        $includedIds = [];

        $includeAncestors = function (int $categoryId) use (&$includeAncestors, &$includedIds, $categoriesById): void {
            $category = $categoriesById->get($categoryId);
            if (!$category) {
                return;
            }

            $includedIds[$categoryId] = true;

            if ($category->parent_id) {
                $includeAncestors((int) $category->parent_id);
            }
        };

        $includeDescendants = function (int $parentId) use (&$includeDescendants, &$includedIds, $childrenByParent): void {
            foreach ($childrenByParent->get($parentId, collect()) as $child) {
                $childId = (int) $child->id;

                if (isset($includedIds[$childId])) {
                    continue;
                }

                $includedIds[$childId] = true;
                $includeDescendants($childId);
            }
        };

        foreach ($requestedIds as $requestedId) {
            $includeAncestors((int) $requestedId);
            $includeDescendants((int) $requestedId);
        }

        return $categories
            ->filter(fn (Category $category) => isset($includedIds[(int) $category->id]))
            ->values();
    }

    private function parseCategoryNullableImportCell(string $value, bool $clearWhenBlank): array
    {
        $trimmed = trim($value);

        if ($trimmed === '') {
            return $clearWhenBlank
                ? ['provided' => true, 'clear' => true, 'value' => null]
                : ['provided' => false, 'clear' => false, 'value' => null];
        }

        if ($this->isCategoryImportNullishValue($trimmed)) {
            return ['provided' => true, 'clear' => true, 'value' => null];
        }

        return ['provided' => true, 'clear' => false, 'value' => $trimmed];
    }

    private function isCategoryImportNullishValue(string $value): bool
    {
        return in_array(
            $this->normalizeLookupValue($value),
            ['null', 'none', 'clear', 'delete', 'xoa', '__clear__'],
            true
        );
    }

    private function isValidImportedImageUrl(string $value): bool
    {
        return filter_var($value, FILTER_VALIDATE_URL) !== false
            && preg_match('#^https?://#i', $value) === 1;
    }

    private function categoryAssetDisk(): string
    {
        $publicDriver = (string) config('filesystems.disks.public.driver', 'local');

        if ($publicDriver !== '' && $publicDriver !== 'local') {
            return 'public';
        }

        return filled(config('filesystems.disks.s3.bucket'))
            ? 's3'
            : 'public';
    }

    private function storeUploadedCategoryAsset(UploadedFile $file, string $directory): string
    {
        $disk = $this->categoryAssetDisk();
        $path = Storage::disk($disk)->putFile($directory, $file, ['visibility' => 'public']);

        if (!$path) {
            throw new \RuntimeException('Khong the luu anh danh muc len kho online.');
        }

        return $this->buildAbsoluteStorageUrl($disk, $path);
    }

    private function importCategoryAssetFromUrl(string $sourceUrl, ?string $currentValue, string $directory): array
    {
        $normalizedSourceUrl = trim($sourceUrl);
        $disk = $this->categoryAssetDisk();
        $currentManagedUrl = $this->resolveCategoryAssetPublicUrl($currentValue);

        if ($currentManagedUrl !== '' && $this->normalizeComparableUrl($currentManagedUrl) === $this->normalizeComparableUrl($normalizedSourceUrl)) {
            return [
                'url' => $currentManagedUrl,
                'stored' => false,
            ];
        }

        $existingManagedPath = $this->extractManagedCategoryAssetPath($normalizedSourceUrl, $disk);
        if ($existingManagedPath !== null) {
            return [
                'url' => $this->buildAbsoluteStorageUrl($disk, $existingManagedPath),
                'stored' => false,
            ];
        }

        $response = Http::timeout(30)
            ->withHeaders(['Accept' => 'image/*,*/*;q=0.8'])
            ->get($normalizedSourceUrl);

        if (!$response->successful()) {
            throw new \RuntimeException('Khong the tai anh tu link online: ' . $normalizedSourceUrl);
        }

        $contentType = trim((string) $response->header('Content-Type', ''));
        if ($contentType !== '' && !str_starts_with(Str::lower($contentType), 'image/')) {
            throw new \RuntimeException('Link anh khong tra ve du lieu hinh anh hop le: ' . $normalizedSourceUrl);
        }

        $extension = $this->guessCategoryAssetExtension($normalizedSourceUrl, $contentType);
        $path = trim($directory, '/') . '/' . Str::uuid()->toString() . '.' . $extension;
        $stored = Storage::disk($disk)->put($path, $response->body(), [
            'visibility' => 'public',
            'ContentType' => $contentType !== '' ? $contentType : null,
        ]);

        if (!$stored) {
            throw new \RuntimeException('Khong the luu anh da import vao kho online.');
        }

        return [
            'url' => $this->buildAbsoluteStorageUrl($disk, $path),
            'stored' => true,
        ];
    }

    private function guessCategoryAssetExtension(string $url, string $contentType): string
    {
        $extensionFromContentType = match (Str::lower(trim($contentType))) {
            'image/jpeg', 'image/jpg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
            'image/avif' => 'avif',
            'image/svg+xml' => 'svg',
            default => null,
        };

        if ($extensionFromContentType !== null) {
            return $extensionFromContentType;
        }

        $path = parse_url($url, PHP_URL_PATH) ?: $url;
        $extension = Str::lower((string) pathinfo((string) $path, PATHINFO_EXTENSION));

        return in_array($extension, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg'], true)
            ? ($extension === 'jpeg' ? 'jpg' : $extension)
            : 'jpg';
    }

    private function resolveCategoryAssetPublicUrl(?string $value): string
    {
        $rawValue = trim((string) $value);

        if ($rawValue === '') {
            return '';
        }

        if (preg_match('#^https?://#i', $rawValue) === 1) {
            return $rawValue;
        }

        $path = preg_replace('#^/?storage/#i', '', $rawValue) ?? $rawValue;

        return $this->buildAbsoluteStorageUrl($this->categoryAssetDisk(), ltrim($path, '/'));
    }

    private function buildAbsoluteStorageUrl(string $disk, string $path): string
    {
        $url = Storage::disk($disk)->url($path);

        if (preg_match('#^https?://#i', $url) === 1) {
            return $url;
        }

        if (str_starts_with($url, '//')) {
            return 'https:' . $url;
        }

        $baseUrl = rtrim((string) (request()?->getSchemeAndHttpHost() ?: config('app.url', '')), '/');

        return $baseUrl !== '' && str_starts_with($url, '/')
            ? $baseUrl . $url
            : $url;
    }

    private function extractManagedCategoryAssetPath(?string $value, string $disk): ?string
    {
        $rawValue = trim((string) $value);

        if ($rawValue === '') {
            return null;
        }

        if (preg_match('#^https?://#i', $rawValue) !== 1) {
            return ltrim((string) preg_replace('#^/?storage/#i', '', $rawValue), '/');
        }

        $diskBaseUrls = array_filter([
            rtrim($this->buildAbsoluteStorageUrl($disk, ''), '/'),
            rtrim((string) config('filesystems.disks.public.url', ''), '/'),
        ]);

        foreach ($diskBaseUrls as $baseUrl) {
            if ($baseUrl !== '' && str_starts_with($rawValue, $baseUrl . '/')) {
                return ltrim(substr($rawValue, strlen($baseUrl)), '/');
            }
        }

        $path = parse_url($rawValue, PHP_URL_PATH);
        if (is_string($path) && preg_match('#/storage/(.+)$#i', $path, $matches) === 1) {
            return ltrim($matches[1], '/');
        }

        return null;
    }

    private function normalizeComparableUrl(string $value): string
    {
        return Str::lower(rtrim(trim($value), '/'));
    }

    private function buildCategoryDomainLookup(Collection $categories): array
    {
        $accountIds = $categories
            ->pluck('account_id')
            ->filter()
            ->map(fn ($accountId) => (int) $accountId)
            ->unique()
            ->values();

        if ($accountIds->isEmpty()) {
            return [];
        }

        $domainsByAccount = SiteDomain::query()
            ->whereIn('account_id', $accountIds)
            ->orderByDesc('is_default')
            ->orderByDesc('is_active')
            ->orderBy('id')
            ->get(['account_id', 'domain', 'is_active', 'is_default'])
            ->groupBy(fn ($domain) => (int) $domain->account_id);

        $accountsById = Account::query()
            ->whereIn('id', $accountIds)
            ->get(['id', 'domain'])
            ->keyBy(fn ($account) => (int) $account->id);

        $resolved = [];

        foreach ($accountIds as $accountId) {
            $accountDomainRows = $domainsByAccount->get((int) $accountId, collect());
            $siteDomain = $accountDomainRows->first(
                fn ($domain) => (bool) $domain->is_active && (bool) $domain->is_default
            ) ?? $accountDomainRows->first(
                fn ($domain) => (bool) $domain->is_active
            ) ?? $accountDomainRows->first(
                fn ($domain) => (bool) $domain->is_default
            ) ?? $accountDomainRows->first();

            $baseUrl = $this->normalizeCategoryBaseUrl(
                $siteDomain?->domain ?? $accountsById->get((int) $accountId)?->domain
            );

            if ($baseUrl !== null) {
                $resolved[(int) $accountId] = $baseUrl;
            }
        }

        return $resolved;
    }

    private function buildCategoryPublicUrl(Category $category, array $domainsByAccountId): string
    {
        $slug = trim((string) ($category->slug ?? ''));
        if ($slug === '') {
            return '';
        }

        $path = '/category/' . rawurlencode($slug);
        $categoryDomain = $category->relationLoaded('siteDomain') && $category->siteDomain
            ? $this->normalizeCategoryBaseUrl($category->siteDomain->domain)
            : null;
        $baseUrl = $categoryDomain ?: ($domainsByAccountId[(int) ($category->account_id ?? 0)] ?? null);

        return $baseUrl ? rtrim($baseUrl, '/') . $path : $path;
    }

    private function normalizeCategoryBaseUrl(?string $value): ?string
    {
        $domain = trim((string) $value);
        if ($domain === '') {
            return null;
        }

        if (!preg_match('/^https?:\/\//i', $domain)) {
            $domain = 'https://' . ltrim($domain, '/');
        }

        $parts = parse_url($domain);
        if (!$parts || empty($parts['host'])) {
            return null;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? 'https'));
        $host = strtolower((string) $parts['host']);
        $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
        $path = trim((string) ($parts['path'] ?? ''), '/');

        return $scheme . '://' . $host . $port . ($path !== '' ? '/' . $path : '');
    }

    private function orderedCategoriesForTree(Collection $categories): array
    {
        $sorted = $categories
            ->sortBy(fn ($category) => sprintf(
                '%010d-%010d',
                (int) ($category->order ?? 0),
                (int) $category->id
            ))
            ->values();

        $childrenByParent = [];
        foreach ($sorted as $category) {
            $childrenByParent[$this->parentGroupKey($category->parent_id)][] = $category;
        }

        $ordered = [];
        $visited = [];

        $visit = function (string $parentKey) use (&$visit, &$ordered, &$visited, $childrenByParent): void {
            foreach ($childrenByParent[$parentKey] ?? [] as $category) {
                if (isset($visited[$category->id])) {
                    continue;
                }

                $visited[$category->id] = true;
                $ordered[] = $category;
                $visit($this->parentGroupKey((int) $category->id));
            }
        };

        $visit($this->parentGroupKey(null));

        foreach ($sorted as $category) {
            if (!isset($visited[$category->id])) {
                $ordered[] = $category;
            }
        }

        return $ordered;
    }

    private function nextSiblingOrder(?int $parentId, ?int $ignoreCategoryId = null): int
    {
        $query = Category::query()->where('parent_id', $parentId);

        if ($ignoreCategoryId !== null) {
            $query->where('id', '!=', $ignoreCategoryId);
        }

        $maxOrder = $query->max('order');

        return $maxOrder === null ? 0 : ((int) $maxOrder + 1);
    }

    private function ensureCategoryTrashSchema(): void
    {
        if ($this->categoryTrashSchemaEnsured) {
            return;
        }

        if (!Schema::hasTable('categories')) {
            $this->refreshCategoryTrashModelState();
            $this->categoryTrashSchemaEnsured = true;

            return;
        }

        $needsDeletedAt = !Schema::hasColumn('categories', 'deleted_at');
        $needsDeletedBy = !Schema::hasColumn('categories', 'deleted_by');

        if ($needsDeletedAt || $needsDeletedBy) {
            Schema::table('categories', function (Blueprint $table) use ($needsDeletedAt, $needsDeletedBy) {
                if ($needsDeletedAt) {
                    $table->softDeletes()->after('updated_at');
                }

                if ($needsDeletedBy) {
                    $table->unsignedBigInteger('deleted_by')->nullable()->after($needsDeletedAt ? 'deleted_at' : 'updated_at');
                }
            });
        }

        if (Schema::hasColumn('categories', 'deleted_at') && !Schema::hasIndex('categories', ['deleted_at'])) {
            Schema::table('categories', function (Blueprint $table) {
                $table->index('deleted_at');
            });
        }

        if (Schema::hasColumn('categories', 'deleted_by') && !Schema::hasIndex('categories', ['deleted_by'])) {
            Schema::table('categories', function (Blueprint $table) {
                $table->index('deleted_by');
            });
        }

        if (
            Schema::hasColumn('categories', 'parent_id')
            && Schema::hasColumn('categories', 'deleted_at')
            && Schema::hasColumn('categories', 'order')
            && !Schema::hasIndex('categories', ['parent_id', 'deleted_at', 'order'])
        ) {
            Schema::table('categories', function (Blueprint $table) {
                $table->index(['parent_id', 'deleted_at', 'order'], 'categories_parent_deleted_at_order_index');
            });
        }

        $this->refreshCategoryTrashModelState();
        $this->categoryTrashSchemaEnsured = true;
    }

    private function refreshCategoryTrashModelState(): void
    {
        Category::forgetOptionalSoftDeleteSupportCache();
        Model::clearBootedModels();
    }

    private function categoryUsesSoftDeletes(): bool
    {
        Category::forgetOptionalSoftDeleteSupportCache();

        return Category::supportsTrash();
    }

    private function stampDeletedByForCategories(array $categoryIds, ?int $userId): void
    {
        if (empty($categoryIds) || !Category::supportsTrashAudit()) {
            return;
        }

        Category::withTrashed()
            ->whereIn('id', $categoryIds)
            ->update([
                'deleted_by' => $userId,
                'updated_at' => now(),
            ]);
    }

    private function clearDeletedByForCategories(array $categoryIds): void
    {
        if (empty($categoryIds) || !Category::supportsTrashAudit()) {
            return;
        }

        Category::query()
            ->whereIn('id', $categoryIds)
            ->update([
                'deleted_by' => null,
                'updated_at' => now(),
            ]);
    }

    private function shouldUseCategoryTrashView(Request $request): bool
    {
        $rawValue = $request->query('is_trash', $request->query('trashed', false));

        if (is_bool($rawValue)) {
            $wantsTrash = $rawValue;
        } else {
            $wantsTrash = in_array(
                Str::lower(trim((string) $rawValue)),
                ['1', 'true', 'yes', 'trash', 'trashed'],
                true
            );
        }

        if (! $wantsTrash) {
            return false;
        }

        if (auth()->check() || Auth::guard('sanctum')->check()) {
            return true;
        }

        abort(403, 'Ban can dang nhap de xem Thung rac danh muc.');
    }

    private function categoryTreeState(bool $withTrashed = false): Collection
    {
        $query = $withTrashed
            ? Category::withTrashed()
            : Category::query();

        $columns = ['id', 'parent_id', 'order'];

        if ($this->categoryUsesSoftDeletes()) {
            $columns[] = 'deleted_at';
        }

        return $query
            ->orderBy('order')
            ->orderBy('id')
            ->get($columns)
            ->keyBy(fn ($category) => (int) $category->id);
    }

    private function buildCategoryChildrenLookup(Collection $categories): array
    {
        $lookup = [];

        foreach ($categories as $category) {
            $parentId = $category->parent_id ? (int) $category->parent_id : 0;
            $lookup[$parentId][] = (int) $category->id;
        }

        return $lookup;
    }

    private function collectCategorySubtreeIds(array $rootIds, Collection $categories): array
    {
        $childrenLookup = $this->buildCategoryChildrenLookup($categories);
        $stack = collect($rootIds)
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter(fn ($id) => $id !== null && $categories->has($id))
            ->unique()
            ->values()
            ->all();

        $resolvedIds = [];

        while (!empty($stack)) {
            $currentId = array_pop($stack);

            if (isset($resolvedIds[$currentId])) {
                continue;
            }

            $resolvedIds[$currentId] = true;

            foreach (array_reverse($childrenLookup[$currentId] ?? []) as $childId) {
                $stack[] = (int) $childId;
            }
        }

        return array_map('intval', array_keys($resolvedIds));
    }

    private function collectCategoryAncestorIds(array $ids, Collection $categories): array
    {
        $resolvedIds = [];

        foreach ($ids as $rawId) {
            $currentId = is_numeric($rawId) ? (int) $rawId : null;

            while ($currentId !== null && $categories->has($currentId)) {
                if (isset($resolvedIds[$currentId])) {
                    break;
                }

                $resolvedIds[$currentId] = true;
                $parentId = $categories->get($currentId)?->parent_id;
                $currentId = $parentId ? (int) $parentId : null;
            }
        }

        return array_map('intval', array_keys($resolvedIds));
    }

    private function resolveCategoryTrashCascadeIds(array $ids): array
    {
        return $this->collectCategorySubtreeIds($ids, $this->categoryTreeState());
    }

    private function resolveCategoryRestoreCascadeIds(array $ids): array
    {
        $categories = $this->categoryTreeState(true);

        return collect([
            ...$this->collectCategoryAncestorIds($ids, $categories),
            ...$this->collectCategorySubtreeIds($ids, $categories),
        ])
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();
    }

    private function restoreCategoryTree(array $ids): array
    {
        $restoreIds = $this->resolveCategoryRestoreCascadeIds($ids);

        $trashedIds = Category::onlyTrashed()
            ->whereIn('id', $restoreIds)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();

        if (empty($trashedIds)) {
            return [];
        }

        DB::transaction(function () use ($trashedIds) {
            Category::onlyTrashed()
                ->whereIn('id', $trashedIds)
                ->restore();

            $this->normalizeRestoredCategoryOrders($trashedIds);
            $this->clearDeletedByForCategories($trashedIds);
        });

        return $trashedIds;
    }

    private function normalizeRestoredCategoryOrders(array $restoredIds): void
    {
        if (empty($restoredIds)) {
            return;
        }

        $restoredGroups = Category::query()
            ->whereIn('id', $restoredIds)
            ->get(['id', 'parent_id', 'order'])
            ->groupBy(fn ($category) => $this->parentGroupKey($category->parent_id));

        $timestamp = now();

        foreach ($restoredGroups as $siblings) {
            if ($siblings->isEmpty()) {
                continue;
            }

            $parentId = $siblings->first()->parent_id ? (int) $siblings->first()->parent_id : null;
            $restoredIdLookup = array_fill_keys(
                $siblings->pluck('id')->map(fn ($id) => (int) $id)->all(),
                true
            );

            $activeSiblings = Category::query()
                ->where('parent_id', $parentId)
                ->orderBy('order')
                ->orderBy('id')
                ->get(['id', 'order']);

            $finalOrder = $activeSiblings
                ->reject(fn ($category) => isset($restoredIdLookup[(int) $category->id]))
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();

            $siblings
                ->sortBy([
                    ['order', 'asc'],
                    ['id', 'asc'],
                ])
                ->values()
                ->each(function ($category) use (&$finalOrder): void {
                    $targetIndex = (int) ($category->order ?? count($finalOrder));
                    $targetIndex = max(0, min($targetIndex, count($finalOrder)));

                    array_splice($finalOrder, $targetIndex, 0, [(int) $category->id]);
                });

            $currentOrderById = $activeSiblings->mapWithKeys(fn ($category) => [
                (int) $category->id => (int) ($category->order ?? 0),
            ]);

            foreach ($finalOrder as $index => $categoryId) {
                if (($currentOrderById->get($categoryId) ?? -1) === $index) {
                    continue;
                }

                Category::query()
                    ->whereKey($categoryId)
                    ->update([
                        'order' => $index,
                        'updated_at' => $timestamp,
                    ]);
            }
        }
    }

    private function validateCategoryImportRows(array $rows, array $importOptions): array
    {
        if (empty($rows)) {
            return [[], [[
                'row' => 1,
                'column' => 'File',
                'message' => 'File Excel khong co du lieu.',
            ]]];
        }

        $headerMap = $this->resolveCategoryImportHeaderMap($rows[0] ?? []);
        $errors = [];

        if (!isset($headerMap['code']) && !isset($headerMap['name']) && !isset($headerMap['id'])) {
            $errors[] = [
                'row' => 1,
                'column' => 'Ma danh muc',
                'message' => 'File import can co it nhat mot cot dinh danh (Ma danh muc hoac ID) hoac cot Ten danh muc.',
            ];

            return [[], $errors];
        }

        $categories = Category::query()->orderBy('id')->get([
            'id',
            'name',
            'code',
            'slug',
            'parent_id',
            'description',
            'banner_path',
            'logo_path',
            'status',
            'order',
            'display_layout',
            'filterable_attribute_ids',
        ]);

        $existingById = [];
        $existingByCode = [];
        foreach ($categories as $category) {
            $existingById[(int) $category->id] = $category;
            $existingByCode[$category->resolvedCode()] = $category;
        }

        $records = [];
        $duplicateCandidates = [];

        for ($index = 1; $index < count($rows); $index++) {
            $row = $rows[$index] ?? [];
            $rowNumber = $index + 1;

            if ($this->shouldSkipCategoryImportRow($row)) {
                continue;
            }

            $rowErrors = [];
            $id = $this->parseImportedCategoryId(
                $this->importCellValue($row, $headerMap, 'id'),
                $rowNumber,
                $rowErrors
            );

            $codeInput = $this->importCellValue($row, $headerMap, 'code');
            $normalizedCode = $codeInput !== '' ? Category::normalizeCode($codeInput) : null;
            if ($codeInput !== '' && $normalizedCode === null) {
                $rowErrors[] = $this->importError($rowNumber, 'Ma danh muc', 'Ma danh muc khong hop le.');
            }

            $existingByIdMatch = $id !== null ? ($existingById[$id] ?? null) : null;
            if ($id !== null && !$existingByIdMatch) {
                $rowErrors[] = $this->importError($rowNumber, 'ID', 'Khong tim thay danh muc theo ID da nhap.');
            }

            $existingByCodeMatch = $normalizedCode !== null ? ($existingByCode[$normalizedCode] ?? null) : null;
            if (
                $existingByIdMatch
                && $existingByCodeMatch
                && (int) $existingByIdMatch->id !== (int) $existingByCodeMatch->id
            ) {
                $rowErrors[] = $this->importError(
                    $rowNumber,
                    'Ma danh muc',
                    'Ma danh muc dang tro toi mot danh muc khac voi ID da nhap.'
                );
            }

            $existingCategory = $existingByIdMatch ?? $existingByCodeMatch;

            $name = trim($this->importCellValue($row, $headerMap, 'name'));
            $nameIsRequired = !$existingCategory
                || !$importOptions['is_selective_update']
                || !empty($importOptions['selected_fields']['name']);

            if ($nameIsRequired && $name === '') {
                $rowErrors[] = $this->importError($rowNumber, 'Ten danh muc', 'Ten danh muc khong duoc de trong.');
            }

            $resolvedCode = $normalizedCode
                ?? ($existingCategory ? $existingCategory->resolvedCode() : ($name !== '' ? Category::buildUniqueCode($name) : null));

            if ($resolvedCode !== null) {
                $duplicateCandidates[] = [
                    'row_number' => $rowNumber,
                    'code' => $resolvedCode,
                    'existing_id' => $existingCategory ? (int) $existingCategory->id : null,
                ];
            }

            if ($resolvedCode === null) {
                $rowErrors[] = $this->importError($rowNumber, 'Ma danh muc', 'Khong the xac dinh ma danh muc cho dong nay.');
            }

            [$sortOrder, $sortOrderError] = $this->parseImportedSortOrder(
                $this->importCellValue($row, $headerMap, 'tree_order')
            );
            if ($sortOrderError !== null) {
                $rowErrors[] = $this->importError($rowNumber, 'Thu tu trong cay', $sortOrderError);
            }

            $treeModeActive = !$existingCategory
                || !$importOptions['is_selective_update']
                || !empty($importOptions['selected_fields']['tree']);
            $descriptionClearWhenBlank = !$existingCategory || !$importOptions['is_selective_update'];
            $imageClearWhenBlank = !$existingCategory || !$importOptions['is_selective_update'];

            $parentPayload = isset($headerMap['parent'])
                ? $this->parseCategoryNullableImportCell(
                    $this->importCellValue($row, $headerMap, 'parent'),
                    $treeModeActive
                )
                : ['provided' => false, 'clear' => false, 'value' => null];
            $descriptionPayload = isset($headerMap['description'])
                ? $this->parseCategoryNullableImportCell(
                    $this->importCellValue($row, $headerMap, 'description'),
                    $descriptionClearWhenBlank
                )
                : ['provided' => false, 'clear' => false, 'value' => null];
            $bannerPayload = isset($headerMap['banner_url'])
                ? $this->parseCategoryNullableImportCell(
                    $this->importCellValue($row, $headerMap, 'banner_url'),
                    $imageClearWhenBlank
                )
                : ['provided' => false, 'clear' => false, 'value' => null];
            $logoPayload = isset($headerMap['logo_url'])
                ? $this->parseCategoryNullableImportCell(
                    $this->importCellValue($row, $headerMap, 'logo_url'),
                    $imageClearWhenBlank
                )
                : ['provided' => false, 'clear' => false, 'value' => null];

            if (!empty($bannerPayload['provided']) && empty($bannerPayload['clear']) && !$this->isValidImportedImageUrl((string) $bannerPayload['value'])) {
                $rowErrors[] = $this->importError($rowNumber, 'Link anh banner', 'Link anh banner phai la URL http/https hop le.');
            }

            if (!empty($logoPayload['provided']) && empty($logoPayload['clear']) && !$this->isValidImportedImageUrl((string) $logoPayload['value'])) {
                $rowErrors[] = $this->importError($rowNumber, 'Link anh nho', 'Link anh nho phai la URL http/https hop le.');
            }

            if (!empty($rowErrors)) {
                $errors = array_merge($errors, $rowErrors);
                continue;
            }

            $records[] = [
                'row_number' => $rowNumber,
                'record_key' => $existingCategory ? ('existing:' . $existingCategory->id) : ('new:' . $resolvedCode),
                'existing_id' => $existingCategory ? (int) $existingCategory->id : null,
                'existing_parent_id' => $existingCategory && $existingCategory->parent_id ? (int) $existingCategory->parent_id : null,
                'existing_order' => $existingCategory ? (int) ($existingCategory->order ?? 0) : null,
                'code' => $resolvedCode,
                'name' => $name,
                'parent_ref' => !empty($parentPayload['clear']) ? '' : trim((string) ($parentPayload['value'] ?? '')),
                'parent_payload' => $parentPayload,
                'order' => $sortOrder,
                'description_payload' => $descriptionPayload,
                'banner_payload' => $bannerPayload,
                'logo_payload' => $logoPayload,
            ];
        }

        if (!empty($errors)) {
            $errors = array_merge($errors, $this->validateDuplicateCategoryImportRecords($duplicateCandidates));
            return [[], $errors];
        }

        $errors = array_merge($errors, $this->validateDuplicateCategoryImportRecords($records));
        if (!empty($errors)) {
            return [[], $errors];
        }

        $recordsByKey = [];
        $recordsByCode = [];
        $recordsByName = [];
        $recordByExistingId = [];

        foreach ($records as $index => $record) {
            $recordsByKey[$record['record_key']] = &$records[$index];
            $recordsByCode[$record['code']] = &$records[$index];
            $recordsByName[$this->normalizeLookupValue($record['name'])][] = &$records[$index];

            if ($record['existing_id'] !== null) {
                $recordByExistingId[$record['existing_id']] = &$records[$index];
            }
        }

        $existingByName = [];
        foreach ($categories as $category) {
            if (isset($recordByExistingId[(int) $category->id])) {
                continue;
            }

            $existingByName[$this->normalizeLookupValue($category->name)][] = $category;
        }

        foreach ($records as $index => $record) {
            [$resolvedParent, $parentErrors] = $this->resolveImportedParentReference(
                $record,
                $recordsByCode,
                $recordsByName,
                $existingById,
                $existingByCode,
                $existingByName
            );

            if (!empty($parentErrors)) {
                $errors = array_merge($errors, $parentErrors);
                continue;
            }

            $records[$index]['resolved_parent'] = $resolvedParent;
        }

        if (!empty($errors)) {
            return [[], $errors];
        }

        foreach ($records as $record) {
            if ($this->detectCategoryCycle($record['record_key'], $recordsByKey, $recordByExistingId, $existingById)) {
                $errors[] = $this->importError(
                    $record['row_number'],
                    'Danh muc cha',
                    'Quan he cha con tao thanh vong lap. Vui long kiem tra lai cot Danh muc cha.'
                );
            }
        }

        return [empty($errors) ? $records : [], $errors];
    }

    private function applyCategoryImport(array $records, array $importOptions): array
    {
        $persistedByKey = [];
        $created = 0;
        $updated = 0;
        $imagesImported = 0;

        foreach ($records as $record) {
            $category = $record['existing_id']
                ? Category::query()->findOrFail($record['existing_id'])
                : new Category();

            $isExisting = $category->exists;

            if (!$isExisting) {
                $category->code = Category::buildUniqueCode($record['code'] ?: $record['name']);
                $category->status = 1;
                $category->display_layout = 'layout_1';
                $category->filterable_attribute_ids = [];
                $category->parent_id = null;
                $category->order = 0;
            } elseif (!filled($category->code) && !empty($record['code'])) {
                $category->code = Category::buildUniqueCode($record['code'], (int) $category->id);
            }

            if ($this->shouldApplyCategoryImportField($importOptions, 'name', $isExisting)) {
                $category->name = $record['name'];
                $category->slug = Category::buildUniqueSlug($record['name'], $record['existing_id']);
            } elseif (!$isExisting) {
                $category->name = $record['name'];
                $category->slug = Category::buildUniqueSlug($record['name']);
            }

            if (!empty($record['description_payload']['provided']) && $this->shouldApplyCategoryImportField($importOptions, 'description', $isExisting)) {
                $category->description = !empty($record['description_payload']['clear'])
                    ? null
                    : trim((string) ($record['description_payload']['value'] ?? ''));
            }

            if (!empty($record['banner_payload']['provided']) && $this->shouldApplyCategoryImportField($importOptions, 'banner', $isExisting)) {
                if (!empty($record['banner_payload']['clear'])) {
                    if ($category->banner_media_asset_id) {
                        $this->mediaService->deleteAsset($category->banner_media_asset_id);
                    }
                    $category->banner_path = null;
                    $category->banner_media_asset_id = null;
                } else {
                    $previousAssetId = $category->banner_media_asset_id;
                    $bannerAsset = $this->mediaService->importFromReference((string) $record['banner_payload']['value'], [
                        'collection' => 'category-banners',
                        'source' => 'category-import',
                    ]);

                    if ($bannerAsset) {
                        $category->banner_media_asset_id = $bannerAsset->id;
                        $category->banner_path = $this->mediaService->buildAssetUrl($bannerAsset, 'large');
                        $imagesImported++;

                        if ($previousAssetId && $previousAssetId !== $bannerAsset->id) {
                            $this->mediaService->deleteAsset($previousAssetId);
                        }
                    }
                }
            }

            if (!empty($record['logo_payload']['provided']) && $this->shouldApplyCategoryImportField($importOptions, 'logo', $isExisting)) {
                if (!empty($record['logo_payload']['clear'])) {
                    if ($category->logo_media_asset_id) {
                        $this->mediaService->deleteAsset($category->logo_media_asset_id);
                    }
                    $category->logo_path = null;
                    $category->logo_media_asset_id = null;
                } else {
                    $previousAssetId = $category->logo_media_asset_id;
                    $logoAsset = $this->mediaService->importFromReference((string) $record['logo_payload']['value'], [
                        'collection' => 'category-logos',
                        'source' => 'category-import',
                    ]);

                    if ($logoAsset) {
                        $category->logo_media_asset_id = $logoAsset->id;
                        $category->logo_path = $this->mediaService->buildAssetUrl($logoAsset, 'large');
                        $imagesImported++;

                        if ($previousAssetId && $previousAssetId !== $logoAsset->id) {
                            $this->mediaService->deleteAsset($previousAssetId);
                        }
                    }
                }
            }

            $category->save();
            $this->categoryDemoLogoService->syncDemoLogoPath($category);
            $persistedByKey[$record['record_key']] = $category;

            if ($isExisting) {
                $updated++;
            } else {
                $created++;
            }
        }

        $nextOrderByParent = $this->buildNextOrderLookup();

        foreach ($records as $record) {
            $category = $persistedByKey[$record['record_key']];
            $shouldApplyTree = $this->shouldApplyCategoryImportField($importOptions, 'tree', $record['existing_id'] !== null);

            if (!$shouldApplyTree) {
                continue;
            }

            $parentId = $this->resolveImportedParentId($record['resolved_parent'] ?? null, $persistedByKey);
            $orderKey = $this->parentGroupKey($parentId);
            $desiredOrder = $record['order'];

            if ($desiredOrder === null) {
                if (
                    $record['existing_id'] !== null
                    && $record['existing_parent_id'] === $parentId
                    && $record['existing_order'] !== null
                ) {
                    $desiredOrder = (int) $record['existing_order'];
                } else {
                    $desiredOrder = $nextOrderByParent[$orderKey] ?? 0;
                }
            }

            $nextOrderByParent[$orderKey] = max($nextOrderByParent[$orderKey] ?? 0, $desiredOrder + 1);

            $category->parent_id = $parentId;
            $category->order = $desiredOrder;
            $category->save();
        }

        $this->resequenceCategoryOrders();

        return [
            'created' => $created,
            'updated' => $updated,
            'processed' => $created + $updated,
            'images_imported' => $imagesImported,
        ];
    }

    private function resolveCategoryImportHeaderMap(array $headers): array
    {
        $aliases = [
            'code' => ['ma_danh_muc', 'ma', 'code', 'category_code'],
            'id' => ['id', 'category_id'],
            'name' => ['ten_danh_muc', 'name', 'category_name'],
            'parent' => ['danh_muc_cha', 'parent', 'parent_ref', 'parent_category'],
            'tree_order' => ['thu_tu_trong_cay', 'thu_tu_hien_thi', 'tree_order', 'sort_order', 'order'],
            'description' => ['mo_ta', 'description', 'ghi_chu', 'note'],
            'banner_url' => ['link_anh_banner', 'anh_banner', 'banner', 'banner_url', 'banner_link'],
            'logo_url' => ['link_anh_nho', 'anh_nho', 'logo', 'logo_url', 'logo_link', 'small_image'],
        ];

        $resolved = [];

        foreach ($headers as $index => $header) {
            $normalizedHeader = $this->normalizeImportHeader((string) $header);

            foreach ($aliases as $field => $fieldAliases) {
                if (in_array($normalizedHeader, $fieldAliases, true) && !isset($resolved[$field])) {
                    $resolved[$field] = $index;
                }
            }
        }

        return $resolved;
    }

    private function validateDuplicateCategoryImportRecords(array $records): array
    {
        $errors = [];
        $rowsByCode = [];
        $rowsByExistingId = [];

        foreach ($records as $record) {
            if (isset($rowsByCode[$record['code']])) {
                $errors[] = $this->importError(
                    $record['row_number'],
                    'Ma danh muc',
                    'Trung ma danh muc voi dong ' . $rowsByCode[$record['code']] . '.'
                );
            } else {
                $rowsByCode[$record['code']] = $record['row_number'];
            }

            if ($record['existing_id'] !== null) {
                if (isset($rowsByExistingId[$record['existing_id']])) {
                    $errors[] = $this->importError(
                        $record['row_number'],
                        'ID',
                        'Danh muc nay da xuat hien o dong ' . $rowsByExistingId[$record['existing_id']] . '.'
                    );
                } else {
                    $rowsByExistingId[$record['existing_id']] = $record['row_number'];
                }
            }
        }

        return $errors;
    }

    private function resolveImportedParentReference(
        array $record,
        array $recordsByCode,
        array $recordsByName,
        array $existingById,
        array $existingByCode,
        array $existingByName
    ): array {
        $reference = trim((string) ($record['parent_ref'] ?? ''));
        if ($reference === '') {
            return [null, []];
        }

        [$mode, $needle] = $this->splitReferenceToken($reference);
        $currentKey = $record['record_key'];

        if ($mode === 'code' || $mode === null) {
            $code = Category::normalizeCode($needle);
            if ($code !== null) {
                if (isset($recordsByCode[$code])) {
                    $candidate = $recordsByCode[$code];
                    if ($candidate['record_key'] === $currentKey) {
                        return [null, [$this->importError($record['row_number'], 'Danh muc cha', 'Danh muc khong the tu lam cha cua chinh no.')]];
                    }

                    return [[
                        'type' => 'record',
                        'key' => $candidate['record_key'],
                    ], []];
                }

                if (isset($existingByCode[$code])) {
                    if ($record['existing_id'] !== null && (int) $existingByCode[$code]->id === (int) $record['existing_id']) {
                        return [null, [$this->importError($record['row_number'], 'Danh muc cha', 'Danh muc khong the tu lam cha cua chinh no.')]];
                    }

                    return [[
                        'type' => 'existing',
                        'id' => (int) $existingByCode[$code]->id,
                    ], []];
                }
            }

            if ($mode === 'code') {
                return [null, [$this->importError(
                    $record['row_number'],
                    'Danh muc cha',
                    'Khong tim thay danh muc cha theo ma da khai bao.'
                )]];
            }
        }

        if ($mode === 'id' || ($mode === null && ctype_digit($needle))) {
            $parentId = (int) $needle;
            if (isset($existingById[$parentId])) {
                if ($record['existing_id'] !== null && $parentId === (int) $record['existing_id']) {
                    return [null, [$this->importError($record['row_number'], 'Danh muc cha', 'Danh muc khong the tu lam cha cua chinh no.')]];
                }

                return [[
                    'type' => 'existing',
                    'id' => $parentId,
                ], []];
            }

            if ($mode === 'id') {
                return [null, [$this->importError(
                    $record['row_number'],
                    'Danh muc cha',
                    'Khong tim thay danh muc cha theo ID da khai bao.'
                )]];
            }
        }

        $nameKey = $this->normalizeLookupValue($needle);
        $candidates = [];

        foreach ($recordsByName[$nameKey] ?? [] as $candidate) {
            $candidates[$candidate['record_key']] = [
                'type' => 'record',
                'key' => $candidate['record_key'],
            ];
        }

        foreach ($existingByName[$nameKey] ?? [] as $candidate) {
            $candidates['existing:' . $candidate->id] = [
                'type' => 'existing',
                'id' => (int) $candidate->id,
            ];
        }

        if (count($candidates) === 1) {
            $resolved = array_values($candidates)[0];
            if (
                ($resolved['type'] === 'record' && $resolved['key'] === $currentKey)
                || ($resolved['type'] === 'existing' && $record['existing_id'] !== null && $resolved['id'] === (int) $record['existing_id'])
            ) {
                return [null, [$this->importError($record['row_number'], 'Danh muc cha', 'Danh muc khong the tu lam cha cua chinh no.')]];
            }

            return [$resolved, []];
        }

        if (count($candidates) > 1) {
            return [null, [$this->importError(
                $record['row_number'],
                'Danh muc cha',
                'Ten danh muc cha dang bi trung. Vui long dung CODE:... hoac ID:... de xac dinh ro.'
            )]];
        }

        return [null, [$this->importError(
            $record['row_number'],
            'Danh muc cha',
            'Khong tim thay danh muc cha. Hay dung CODE:ma, ID:so hoac NAME:ten chinh xac.'
        )]];
    }

    private function detectCategoryCycle(
        string $startKey,
        array $recordsByKey,
        array $recordByExistingId,
        array $existingById
    ): bool {
        $visited = [];
        $currentKey = $startKey;

        while ($currentKey !== null) {
            if (isset($visited[$currentKey])) {
                return true;
            }

            $visited[$currentKey] = true;
            $currentKey = $this->nextParentRecordKey($currentKey, $recordsByKey, $recordByExistingId, $existingById);
        }

        return false;
    }

    private function nextParentRecordKey(
        string $recordKey,
        array $recordsByKey,
        array $recordByExistingId,
        array $existingById
    ): ?string {
        $record = $recordsByKey[$recordKey] ?? null;
        if ($record !== null) {
            $resolvedParent = $record['resolved_parent'] ?? null;

            if ($resolvedParent === null) {
                return null;
            }

            if ($resolvedParent['type'] === 'record') {
                return $resolvedParent['key'];
            }

            $parentId = (int) $resolvedParent['id'];
            if (isset($recordByExistingId[$parentId])) {
                return $recordByExistingId[$parentId]['record_key'];
            }

            return isset($existingById[$parentId]) ? ('existing:' . $parentId) : null;
        }

        if (!str_starts_with($recordKey, 'existing:')) {
            return null;
        }

        $existingId = (int) Str::after($recordKey, 'existing:');
        if (isset($recordByExistingId[$existingId])) {
            return $recordByExistingId[$existingId]['record_key'];
        }

        $category = $existingById[$existingId] ?? null;
        if (!$category || !$category->parent_id) {
            return null;
        }

        $parentId = (int) $category->parent_id;
        if (isset($recordByExistingId[$parentId])) {
            return $recordByExistingId[$parentId]['record_key'];
        }

        return isset($existingById[$parentId]) ? ('existing:' . $parentId) : null;
    }

    private function buildAttributeLookupMaps(Collection $attributes): array
    {
        $byId = [];
        $byCode = [];
        $byName = [];

        foreach ($attributes as $attribute) {
            $byId[(int) $attribute->id] = $attribute;

            if ($attribute->code) {
                $byCode[Category::normalizeCode($attribute->code) ?? (string) $attribute->code] = $attribute;
            }

            $byName[$this->normalizeLookupValue($attribute->name)][] = $attribute;
        }

        return [
            'by_id' => $byId,
            'by_code' => $byCode,
            'by_name' => $byName,
        ];
    }

    private function parseImportedAttributeTokens(string $rawValue, array $attributeMaps, int $rowNumber): array
    {
        $value = trim($rawValue);
        if ($value === '') {
            return [[], []];
        }

        $tokens = preg_split('/[\r\n,;|]+/', $value) ?: [];
        $attributeIds = [];
        $errors = [];

        foreach ($tokens as $token) {
            $token = trim((string) $token);
            if ($token === '') {
                continue;
            }

            [$mode, $needle] = $this->splitReferenceToken($token);

            if ($mode === 'code' || $mode === null) {
                $code = Category::normalizeCode($needle);
                if ($code !== null && isset($attributeMaps['by_code'][$code])) {
                    $attributeIds[] = (int) $attributeMaps['by_code'][$code]->id;
                    continue;
                }

                if ($mode === 'code') {
                    $errors[] = $this->importError(
                        $rowNumber,
                        'Bo loc thuoc tinh',
                        'Khong tim thay thuoc tinh theo ma "' . $token . '".'
                    );
                    continue;
                }
            }

            if ($mode === 'id' || ($mode === null && ctype_digit($needle))) {
                $attributeId = (int) $needle;
                if (isset($attributeMaps['by_id'][$attributeId])) {
                    $attributeIds[] = $attributeId;
                    continue;
                }

                if ($mode === 'id') {
                    $errors[] = $this->importError(
                        $rowNumber,
                        'Bo loc thuoc tinh',
                        'Khong tim thay thuoc tinh theo ID "' . $token . '".'
                    );
                    continue;
                }
            }

            $nameKey = $this->normalizeLookupValue($needle);
            $nameCandidates = $attributeMaps['by_name'][$nameKey] ?? [];

            if (count($nameCandidates) === 1) {
                $attributeIds[] = (int) $nameCandidates[0]->id;
                continue;
            }

            if (count($nameCandidates) > 1) {
                $errors[] = $this->importError(
                    $rowNumber,
                    'Bo loc thuoc tinh',
                    'Ten thuoc tinh "' . $token . '" dang bi trung. Hay dung ma thuoc tinh.'
                );
                continue;
            }

            $errors[] = $this->importError(
                $rowNumber,
                'Bo loc thuoc tinh',
                'Khong tim thay thuoc tinh "' . $token . '".'
            );
        }

        return [array_values(array_unique($attributeIds)), $errors];
    }

    private function parseImportedCategoryId(string $value, int $rowNumber, array &$errors): ?int
    {
        $value = trim($value);
        if ($value === '') {
            return null;
        }

        if (!ctype_digit($value)) {
            $errors[] = $this->importError($rowNumber, 'ID', 'ID phai la so nguyen duong.');
            return null;
        }

        return (int) $value;
    }

    private function parseImportedLayout(string $value, ?string $fallback = null): array
    {
        $value = trim($value);
        if ($value === '') {
            return ['layout_1', null];
        }

        $normalized = $this->normalizeLookupValue($value);

        return match ($normalized) {
            'layout_1', 'layout1', '1', 'giao_dien_1', 'giao_dien_mot',
            'layout_2', 'layout2', '2', 'giao_dien_2', 'giao_dien_hai' => ['layout_1', null],
            default => [null, 'Giao dien chi hop le voi layout_1.'],
        };
    }

    private function parseImportedStatus(string $value, ?int $fallback = null): array
    {
        $value = trim($value);
        if ($value === '') {
            return [$fallback ?? 1, null];
        }

        $normalized = $this->normalizeLookupValue($value);

        return match ($normalized) {
            '1', 'true', 'yes', 'hien_thi', 'dang_hien_thi', 'active' => [1, null],
            '0', 'false', 'no', 'an', 'dang_an', 'inactive', 'hidden' => [0, null],
            default => [null, 'Trang thai hien thi chi hop le voi 1 hoac 0.'],
        };
    }

    private function parseImportedSortOrder(string $value): array
    {
        $value = trim($value);
        if ($value === '') {
            return [null, null];
        }

        if (!preg_match('/^-?\d+$/', $value)) {
            return [null, 'Thu tu hien thi phai la so nguyen.'];
        }

        $sortOrder = (int) $value;
        if ($sortOrder < 0) {
            return [null, 'Thu tu hien thi khong duoc nho hon 0.'];
        }

        return [$sortOrder, null];
    }

    private function buildNextOrderLookup(): array
    {
        $lookup = [];

        Category::query()
            ->get(['parent_id', 'order'])
            ->groupBy(fn ($category) => $this->parentGroupKey($category->parent_id))
            ->each(function (Collection $siblings, string $key) use (&$lookup) {
                $lookup[$key] = ((int) $siblings->max('order')) + 1;
            });

        return $lookup;
    }

    private function resequenceCategoryOrders(): void
    {
        $groups = Category::query()
            ->orderBy('order')
            ->orderBy('id')
            ->get(['id', 'parent_id', 'order'])
            ->groupBy(fn ($category) => $this->parentGroupKey($category->parent_id));

        foreach ($groups as $siblings) {
            foreach ($siblings->values() as $index => $category) {
                if ((int) ($category->order ?? -1) !== $index) {
                    Category::query()
                        ->where('id', $category->id)
                        ->update(['order' => $index]);
                }
            }
        }
    }

    private function resolveImportedParentId(?array $resolvedParent, array $persistedByKey): ?int
    {
        if ($resolvedParent === null) {
            return null;
        }

        if ($resolvedParent['type'] === 'record') {
            return isset($persistedByKey[$resolvedParent['key']])
                ? (int) $persistedByKey[$resolvedParent['key']]->id
                : null;
        }

        return (int) $resolvedParent['id'];
    }

    private function formatCategoryAttributeTokens(array $attributeIds, Collection $attributesById): string
    {
        return collect($attributeIds)
            ->map(function ($attributeId) use ($attributesById) {
                $attribute = $attributesById->get((int) $attributeId);
                if ($attribute) {
                    return trim((string) ($attribute->code ?: $attribute->name));
                }

                return 'ID:' . (int) $attributeId;
            })
            ->filter()
            ->implode(', ');
    }

    private function replaceCategoryMediaAsset(Category $category, string $type, UploadedFile $file): void
    {
        $collection = $type === 'logo' ? 'category-logos' : 'category-banners';
        $foreignKey = $type === 'logo' ? 'logo_media_asset_id' : 'banner_media_asset_id';
        $urlField = $type === 'logo' ? 'logo_path' : 'banner_path';
        $previousAssetId = (int) ($category->{$foreignKey} ?? 0);

        $asset = $this->mediaService->uploadImage($file, [
            'collection' => $collection,
            'source' => 'category-form-upload',
        ]);

        $category->{$foreignKey} = $asset->id;
        $category->{$urlField} = $this->mediaService->buildAssetUrl($asset, 'large');

        if ($previousAssetId > 0 && $previousAssetId !== $asset->id) {
            $this->mediaService->deleteAsset($previousAssetId);
        }
    }

    private function normalizeFilterableAttributeIds($value): ?array
    {
        if ($value === null) {
            return null;
        }

        $ids = $value;
        if (is_string($ids)) {
            $decoded = json_decode($ids, true);
            $ids = is_array($decoded) ? $decoded : explode(',', $ids);
        }

        return array_values(array_unique(array_map('intval', array_filter((array) $ids, fn ($id) => $id !== '' && $id !== null))));
    }

    private function normalizeNullableString($value): ?string
    {
        if ($value === null) {
            return null;
        }

        $normalized = $this->normalizeRequiredString($value);

        return $normalized !== '' ? $normalized : null;
    }

    private function normalizeRequiredString($value): string
    {
        return trim(Utf8Sanitizer::normalizeString((string) $value));
    }

    private function shouldSkipCategoryImportRow(array $row): bool
    {
        $values = array_map(fn ($value) => trim((string) $value), $row);
        $nonEmptyValues = array_values(array_filter($values, fn ($value) => $value !== ''));

        if (empty($nonEmptyValues)) {
            return true;
        }

        return str_starts_with($nonEmptyValues[0], '#');
    }

    private function importCellValue(array $row, array $headerMap, string $field): string
    {
        $index = $headerMap[$field] ?? null;

        return $index === null ? '' : $this->normalizeRequiredString($row[$index] ?? '');
    }

    private function splitReferenceToken(string $value): array
    {
        $value = trim($value);

        if (preg_match('/^(code|id|name)\s*:\s*(.+)$/i', $value, $matches) === 1) {
            return [Str::lower($matches[1]), trim($matches[2])];
        }

        return [null, $value];
    }

    private function normalizeImportHeader(string $value): string
    {
        return trim((string) Str::of(Str::ascii($value))
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', '_'), '_');
    }

    private function normalizeLookupValue(string $value): string
    {
        return trim((string) Str::of(Str::ascii($value))
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', '_'), '_');
    }

    private function normalizeParentIdInput($value): ?int
    {
        if ($value === null || $value === '' || $value === 0 || $value === '0') {
            return null;
        }

        if (!is_numeric($value) || (int) $value <= 0) {
            throw ValidationException::withMessages([
                'parent_id' => ['Danh muc cha khong hop le.'],
            ]);
        }

        return (int) $value;
    }

    private function resolveValidatedParentId($value, ?int $categoryId = null): ?int
    {
        $parentId = $this->normalizeParentIdInput($value);

        if ($parentId === null) {
            return null;
        }

        if (!Category::query()->whereKey($parentId)->exists()) {
            throw ValidationException::withMessages([
                'parent_id' => ['Danh muc cha khong ton tai.'],
            ]);
        }

        if ($categoryId !== null) {
            $parentMap = $this->buildCategoryParentMap();
            $parentMap[$categoryId] = $parentId;
            $this->assertCategoryParentMapHasNoCycles($parentMap, 'parent_id');
        }

        return $parentId;
    }

    private function validateReorderPayload(Collection $items): void
    {
        $requestedIds = $items->pluck('id')->map(fn ($id) => (int) $id)->values();

        if ($requestedIds->duplicates()->isNotEmpty()) {
            throw ValidationException::withMessages([
                'items' => ['Danh sach danh muc sap xep dang bi trung ID.'],
            ]);
        }

        $parentMap = $this->buildCategoryParentMap();

        foreach ($requestedIds as $categoryId) {
            if (!array_key_exists($categoryId, $parentMap)) {
                throw ValidationException::withMessages([
                    'items' => ['Co danh muc khong ton tai trong yeu cau sap xep.'],
                ]);
            }
        }

        foreach ($items as $item) {
            $parentId = $item['parent_id'];

            if ($parentId !== null && !array_key_exists($parentId, $parentMap)) {
                throw ValidationException::withMessages([
                    'items' => ['Danh muc cha khong ton tai trong pham vi hien tai.'],
                ]);
            }

            $parentMap[$item['id']] = $parentId;
        }

        $this->assertCategoryParentMapHasNoCycles($parentMap, 'items');
    }

    private function buildCategoryParentMap(): array
    {
        return Category::query()
            ->get(['id', 'parent_id'])
            ->mapWithKeys(fn ($category) => [
                (int) $category->id => $category->parent_id ? (int) $category->parent_id : null,
            ])
            ->all();
    }

    private function assertCategoryParentMapHasNoCycles(array $parentMap, string $attribute): void
    {
        foreach ($parentMap as $categoryId => $parentId) {
            $visited = [(int) $categoryId => true];
            $cursor = $parentId === null ? null : (int) $parentId;

            while ($cursor !== null) {
                if (isset($visited[$cursor])) {
                    throw ValidationException::withMessages([
                        $attribute => ['Khong the tao vong lap danh muc cha.'],
                    ]);
                }

                if (!array_key_exists($cursor, $parentMap)) {
                    break;
                }

                $visited[$cursor] = true;
                $nextParentId = $parentMap[$cursor];
                $cursor = $nextParentId === null ? null : (int) $nextParentId;
            }
        }
    }

    private function parentGroupKey($parentId): string
    {
        return $parentId ? ('parent:' . (int) $parentId) : 'root';
    }

    private function importError(int $row, string $column, string $message): array
    {
        return [
            'row' => $row,
            'column' => $column,
            'message' => $message,
        ];
    }

    private function xlsxDownloadResponse(string $filename, array $sheets)
    {
        $binary = SimpleXlsx::buildWorkbook($sheets);

        return response($binary, 200, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'Cache-Control' => 'no-store, no-cache, must-revalidate',
        ]);
    }
}
