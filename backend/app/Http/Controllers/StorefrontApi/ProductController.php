<?php

namespace App\Http\Controllers\StorefrontApi;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\Category;
use App\Models\Attribute;
use App\Models\Post;
use App\Models\ProductAttributeValue;
use App\Support\Utf8Sanitizer;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class ProductController extends Controller
{
    private const BUNDLE_FULL_SET_DISCOUNT_RATE = 0.10;
    private const BUNDLE_TOTAL_ROUNDING_UNIT = 10000;

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

    private function normalizeBundleOptionKey($optionPostId, ?string $optionTitle): string
    {
        if (filled($optionPostId) && is_numeric($optionPostId)) {
            return 'post:' . (int) $optionPostId;
        }

        $normalizedTitle = Str::of((string) $optionTitle)
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', ' ')
            ->squish()
            ->value();

        return 'title:' . ($normalizedTitle !== '' ? $normalizedTitle : 'mac dinh');
    }

    private function normalizeLocalizedBundleOptionKey($optionPostId, ?string $optionTitle): string
    {
        if (filled($optionPostId) && is_numeric($optionPostId)) {
            return 'post:' . (int) $optionPostId;
        }

        $normalizedTitle = Str::lower(Str::squish((string) $optionTitle));

        return 'title:' . ($normalizedTitle !== '' ? $normalizedTitle : 'mac dinh');
    }

    private function getBundleOptionKeyCandidates($bundleOptionKey = null, $bundleOptionPostId = null, $bundleOptionTitle = null): array
    {
        $candidates = [];
        $explicitKey = trim((string) $bundleOptionKey);

        if ($explicitKey !== '') {
            $candidates[] = $explicitKey;
        }

        if ($this->hasBundleOptionAssignmentMeta($bundleOptionKey, $bundleOptionPostId, $bundleOptionTitle)) {
            $title = Str::squish((string) $bundleOptionTitle) ?: null;
            $candidates[] = $this->normalizeBundleOptionKey($bundleOptionPostId, $title);
            $candidates[] = $this->normalizeLocalizedBundleOptionKey($bundleOptionPostId, $title);
        }

        return collect($candidates)
            ->filter(fn ($key) => trim((string) $key) !== '')
            ->unique()
            ->values()
            ->all();
    }

    private function hasBundleOptionAssignmentMeta($bundleOptionKey = null, $bundleOptionPostId = null, $bundleOptionTitle = null): bool
    {
        return trim((string) $bundleOptionKey) !== ''
            || filled($bundleOptionPostId)
            || Str::squish((string) $bundleOptionTitle) !== '';
    }

    private function isBundleOptionAssignment($itemType = null, $bundleOptionKey = null, $bundleOptionPostId = null, $bundleOptionTitle = null): bool
    {
        if ((string) $itemType === 'bundle_option') {
            return true;
        }

        return $this->hasBundleOptionAssignmentMeta($bundleOptionKey, $bundleOptionPostId, $bundleOptionTitle);
    }

    private function resolveAssignmentBundleOptionKey($bundleOptionKey = null, $bundleOptionPostId = null, $bundleOptionTitle = null): ?string
    {
        $resolvedKey = trim((string) $bundleOptionKey);
        if ($resolvedKey !== '') {
            return $resolvedKey;
        }

        if (!$this->hasBundleOptionAssignmentMeta($bundleOptionKey, $bundleOptionPostId, $bundleOptionTitle)) {
            return null;
        }

        return $this->normalizeBundleOptionKey($bundleOptionPostId, Str::squish((string) $bundleOptionTitle) ?: null);
    }

    private function resolveBundleOptionCatalogMeta(array $catalog, int $productId, ?string $bundleOptionKey, $bundleOptionPostId = null, $bundleOptionTitle = null): ?array
    {
        if ($productId <= 0 || empty($catalog[$productId]) || !is_array($catalog[$productId])) {
            return null;
        }

        foreach ($this->getBundleOptionKeyCandidates($bundleOptionKey, $bundleOptionPostId, $bundleOptionTitle) as $candidateKey) {
            if (isset($catalog[$productId][$candidateKey]) && is_array($catalog[$productId][$candidateKey])) {
                return $catalog[$productId][$candidateKey];
            }
        }

        return null;
    }

    /**
     * Resolve account by X-Site-Code header
     */
    protected function getAccountId(Request $request)
    {
        $siteCode = $request->header('X-Site-Code');
        \Illuminate\Support\Facades\Log::info("X-Site-Code header: '{$siteCode}'");
        if (!$siteCode) return null;
        
        $account = \App\Models\Account::where('site_code', $siteCode)->first();
        if (!$account) {
            \Illuminate\Support\Facades\Log::warning("Account not found for site code: '{$siteCode}'");
        }
        return $account ? $account->id : null;
    }

    private function normalizeSearchKeyword(?string $value): string
    {
        return Str::of((string) $value)
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9\s]+/', ' ')
            ->squish()
            ->toString();
    }

    private function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }

    private function accentInsensitiveExpression(string $expression): string
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            return "LOWER(immutable_unaccent({$expression}))";
        }

        return "LOWER({$expression})";
    }

    private function compactAccentInsensitiveExpression(string $expression): string
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            return "LOWER(REGEXP_REPLACE(immutable_unaccent({$expression}), '[^a-zA-Z0-9]', '', 'g'))";
        }

        return "LOWER(REPLACE(REPLACE(REPLACE(REPLACE({$expression}, '-', ''), ' ', ''), '.', ''), '_', ''))";
    }

    private function tokenizedAccentInsensitiveExpression(string $expression): string
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            return "CONCAT(' ', LOWER(REGEXP_REPLACE(immutable_unaccent({$expression}), '[^a-zA-Z0-9]+', ' ', 'g')), ' ')";
        }

        return "' ' || LOWER(REPLACE(REPLACE(REPLACE(REPLACE({$expression}, '-', ' '), '.', ' '), '_', ' '), '/', ' ')) || ' '";
    }

    private function applyMobileQuickSearch(Builder $query, string $rawSearch): void
    {
        $normalizedSearch = $this->normalizeSearchKeyword($rawSearch);
        $tokens = collect(preg_split('/\s+/', $normalizedSearch, -1, PREG_SPLIT_NO_EMPTY))
            ->filter(fn ($token) => strlen($token) >= 2)
            ->unique()
            ->values()
            ->all();

        if ($normalizedSearch === '' || empty($tokens)) {
            return;
        }

        $nameExpr = $this->tokenizedAccentInsensitiveExpression("COALESCE(products.name, '')");
        $skuExpr = $this->accentInsensitiveExpression("COALESCE(products.sku, '')");
        $keywordExpr = $this->tokenizedAccentInsensitiveExpression("COALESCE(products.meta_keywords, '')");
        $metaTitleExpr = $this->tokenizedAccentInsensitiveExpression("COALESCE(products.meta_title, '')");
        $compactSkuExpr = $this->compactAccentInsensitiveExpression("COALESCE(products.sku, '')");
        $phraseLike = '% ' . $this->escapeLike($normalizedSearch) . ' %';
        $prefixLike = $this->escapeLike($normalizedSearch) . '%';
        $compactSearch = preg_replace('/[^a-z0-9]+/', '', $normalizedSearch);
        $compactSkuLike = $compactSearch !== '' ? '%' . $this->escapeLike($compactSearch) . '%' : null;
        $isCodeLikeSearch = preg_match('/\d/', $normalizedSearch) === 1 || count($tokens) === 1;

        $tokenMatchParts = [];
        $tokenMatchBindings = [];
        foreach ($tokens as $token) {
            $tokenLike = '% ' . $this->escapeLike($token) . ' %';
            $tokenMatchParts[] = "CASE WHEN ({$nameExpr} LIKE ? OR {$keywordExpr} LIKE ? OR {$metaTitleExpr} LIKE ?) THEN 1 ELSE 0 END";
            array_push($tokenMatchBindings, $tokenLike, $tokenLike, $tokenLike);
        }

        $tokenMatchSql = '(' . implode(' + ', $tokenMatchParts) . ')';
        $minimumMatches = count($tokens);
        $rankingParts = [
            "CASE WHEN {$nameExpr} LIKE ? THEN 1000 ELSE 0 END",
            "CASE WHEN {$keywordExpr} LIKE ? THEN 780 ELSE 0 END",
            "CASE WHEN {$metaTitleExpr} LIKE ? THEN 720 ELSE 0 END",
            "({$tokenMatchSql} * 160)",
        ];
        $rankingBindings = array_merge([$phraseLike, $phraseLike, $phraseLike], $tokenMatchBindings);

        if ($isCodeLikeSearch) {
            $rankingParts[] = "CASE WHEN {$skuExpr} LIKE ? THEN 520 ELSE 0 END";
            $rankingBindings[] = $prefixLike;

            if ($compactSkuLike !== null) {
                $rankingParts[] = "CASE WHEN {$compactSkuExpr} LIKE ? THEN 500 ELSE 0 END";
                $rankingBindings[] = $compactSkuLike;
            }
        }

        $searchRankingSql = '(' . implode(' + ', $rankingParts) . ')';
        $query->selectRaw("{$searchRankingSql} AS search_score", $rankingBindings);

        $query->where(function (Builder $searchQuery) use (
            $nameExpr,
            $keywordExpr,
            $metaTitleExpr,
            $skuExpr,
            $compactSkuExpr,
            $phraseLike,
            $prefixLike,
            $compactSkuLike,
            $tokenMatchSql,
            $tokenMatchBindings,
            $minimumMatches,
            $isCodeLikeSearch
        ) {
            $searchQuery
                ->whereRaw("{$nameExpr} LIKE ?", [$phraseLike])
                ->orWhereRaw("{$keywordExpr} LIKE ?", [$phraseLike])
                ->orWhereRaw("{$metaTitleExpr} LIKE ?", [$phraseLike])
                ->orWhereRaw("{$tokenMatchSql} >= ?", array_merge($tokenMatchBindings, [$minimumMatches]));

            if ($isCodeLikeSearch) {
                $searchQuery->orWhereRaw("{$skuExpr} LIKE ?", [$prefixLike]);

                if ($compactSkuLike !== null) {
                    $searchQuery->orWhereRaw("{$compactSkuExpr} LIKE ?", [$compactSkuLike]);
                }
            }
        });
    }

    private function getOrderedCategoryIds(Category $category, $accountId): array
    {
        $ids = [(int) $category->id];

        $children = Category::query()
            ->where('parent_id', $category->id)
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->orderBy('order')
            ->orderBy('id')
            ->get(['id']);

        foreach ($children as $child) {
            $ids = array_merge($ids, $this->getOrderedCategoryIds($child, $accountId));
        }

        return $ids;
    }

    private function joinCategoryOrdering(Builder $query, array $categoryIds, string $alias = 'category_sorting'): void
    {
        $normalizedCategoryIds = collect($categoryIds)
            ->map(fn ($categoryId) => is_numeric($categoryId) ? (int) $categoryId : null)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($normalizedCategoryIds)) {
            return;
        }

        $caseSql = collect($normalizedCategoryIds)
            ->values()
            ->map(fn ($categoryId, $index) => "WHEN {$categoryId} THEN {$index}")
            ->implode(' ');

        $subquery = DB::table('category_product')
            ->select('product_id')
            ->selectRaw("MIN((CASE category_id {$caseSql} ELSE 999999 END) * 1000000 + COALESCE(sort_order, 999999)) as category_order_key")
            ->where('item_type', 'product')
            ->whereIn('category_id', $normalizedCategoryIds)
            ->groupBy('product_id');

        $query
            ->leftJoinSub($subquery, $alias, function ($join) use ($alias) {
                $join->on("{$alias}.product_id", '=', 'products.id');
            })
            ->select('products.*');
    }

    private function joinCategoryAssignments(Builder $query, array $categoryIds, string $alias = 'category_assignments'): void
    {
        $normalizedCategoryIds = collect($categoryIds)
            ->map(fn ($categoryId) => is_numeric($categoryId) ? (int) $categoryId : null)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($normalizedCategoryIds)) {
            return;
        }

        $caseSql = collect($normalizedCategoryIds)
            ->values()
            ->map(fn ($categoryId, $index) => "WHEN {$categoryId} THEN {$index}")
            ->implode(' ');

        $bundleOptionAssignmentSql = "category_product.item_type = 'bundle_option' OR COALESCE(category_product.bundle_option_key, '') <> '' OR category_product.bundle_option_post_id IS NOT NULL OR COALESCE(category_product.bundle_option_title, '') <> ''";
        $resolvedProductIdSql = "CASE WHEN {$bundleOptionAssignmentSql} THEN category_product.product_id ELSE COALESCE(super_links.product_id, category_product.product_id) END";
        $itemTypeSql = "CASE WHEN {$bundleOptionAssignmentSql} THEN 'bundle_option' ELSE 'product' END";

        $subquery = DB::table('category_product')
            ->join('products as assigned_products', 'assigned_products.id', '=', 'category_product.product_id')
            ->leftJoin('product_links as super_links', function ($join) {
                $join->on('super_links.linked_product_id', '=', 'category_product.product_id')
                    ->where('super_links.link_type', '=', 'super_link');
            })
            ->selectRaw("{$resolvedProductIdSql} as product_id")
            ->selectRaw("{$itemTypeSql} as item_type")
            ->selectRaw("COALESCE(category_product.bundle_option_key, '') as bundle_option_key")
            ->selectRaw('category_product.bundle_option_post_id')
            ->selectRaw('category_product.bundle_option_title')
            ->selectRaw("MIN((CASE category_product.category_id {$caseSql} ELSE 999999 END) * 1000000000 + COALESCE(category_product.sort_order, 999999) * 1000) as category_order_key")
            ->whereIn('category_product.category_id', $normalizedCategoryIds)
            ->where(function ($categoryQuery) {
                $categoryQuery
                    ->whereIn('category_product.item_type', ['product', 'bundle_option'])
                    ->orWhereNull('category_product.item_type');
            })
            ->groupByRaw("{$resolvedProductIdSql}, {$itemTypeSql}, category_product.bundle_option_key, category_product.bundle_option_post_id, category_product.bundle_option_title");

        $query
            ->joinSub($subquery, $alias, function ($join) use ($alias) {
                $join->on("{$alias}.product_id", '=', 'products.id');
            })
            ->select('products.*')
            ->addSelect([
                "{$alias}.item_type as item_type",
                "{$alias}.bundle_option_key as bundle_option_key",
                "{$alias}.bundle_option_post_id as bundle_option_post_id",
                "{$alias}.bundle_option_title as bundle_option_title",
                "{$alias}.category_order_key as category_order_key",
            ]);
    }

    private function mapPostPrimaryImage(?Post $post)
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

    private function extractImageUrl($image): ?string
    {
        if (is_array($image)) {
            $candidate = trim((string) ($image['url'] ?? $image['path'] ?? $image['image_url'] ?? ''));
            return $candidate !== '' ? $candidate : null;
        }

        $candidate = trim((string) $image);
        return $candidate !== '' ? $candidate : null;
    }

    private function resolveBundleItemVariantFromMap($bundleItem, Collection $variantMap): ?Product
    {
        $selectedVariantId = filled(data_get($bundleItem, 'pivot.variant_id'))
            ? (int) data_get($bundleItem, 'pivot.variant_id')
            : 0;

        if ($selectedVariantId <= 0) {
            return null;
        }

        $selectedVariant = $variantMap->get($selectedVariantId);
        return $selectedVariant instanceof Product ? $selectedVariant : null;
    }

    private function resolveBundleItemCurrentUnitPrice($bundleItem, ?Product $selectedVariant): float
    {
        $bundlePrice = data_get($bundleItem, 'pivot.price');
        $selectedVariantId = $selectedVariant?->id ? (int) $selectedVariant->id : 0;
        $defaultVariantId = filled(data_get($bundleItem, 'pivot.variant_id'))
            ? (int) data_get($bundleItem, 'pivot.variant_id')
            : 0;

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
            $variantPrice = $selectedVariant->current_price ?? $selectedVariant->price;

            if ($variantPrice !== null && is_numeric($variantPrice)) {
                return (float) $variantPrice;
            }
        }

        if ($bundlePrice !== null && is_numeric($bundlePrice)) {
            return (float) $bundlePrice;
        }

        $itemPrice = $bundleItem->current_price ?? $bundleItem->price;
        return $itemPrice !== null && is_numeric($itemPrice) ? (float) $itemPrice : 0.0;
    }

    private function resolveBundleItemBaseUnitPrice($bundleItem, ?Product $selectedVariant, float $fallback = 0.0): float
    {
        if ($selectedVariant instanceof Product && $selectedVariant->price !== null && is_numeric($selectedVariant->price)) {
            return (float) $selectedVariant->price;
        }

        if ($bundleItem->price !== null && is_numeric($bundleItem->price)) {
            return (float) $bundleItem->price;
        }

        return $fallback;
    }

    private function resolveBundleOptionPrimaryImage(?Post $optionPost)
    {
        return $this->mapPostPrimaryImage($optionPost);
    }

    private function mapBundleOptionImageUrl(?string $imageUrl): ?array
    {
        $normalizedImageUrl = trim((string) $imageUrl);
        if ($normalizedImageUrl === '') {
            return null;
        }

        return [
            'url' => $normalizedImageUrl,
            'path' => $normalizedImageUrl,
            'image_url' => $normalizedImageUrl,
        ];
    }

    private function buildBundleOptionCatalog(Collection $bundleProducts, Collection $variantMap, Collection $optionPosts): array
    {
        return $bundleProducts->mapWithKeys(function (Product $product) use ($variantMap, $optionPosts) {
            return [
                (int) $product->id => $this->buildBundleOptionCatalogForItems(
                    $product->bundleItems instanceof Collection ? $product->bundleItems : collect(),
                    $variantMap,
                    $optionPosts,
                ),
            ];
        })->all();
    }

    private function buildBundleOptionCatalogForItems($bundleItems, Collection $variantMap, Collection $optionPosts): array
    {
        $catalog = [];
        $catalogAliases = [];

        foreach ($bundleItems as $bundleItem) {
            if (!$bundleItem instanceof Product) {
                continue;
            }

            $optionPostId = filled($bundleItem->pivot?->option_post_id ?? null)
                ? (int) $bundleItem->pivot->option_post_id
                : null;
            $optionTitle = Str::squish((string) ($bundleItem->pivot?->option_title ?? '')) ?: 'Mặc định';
            $optionKey = $this->normalizeBundleOptionKey($optionPostId, $optionTitle);
            $optionAliases = $this->getBundleOptionKeyCandidates(null, $optionPostId, $optionTitle);
            $optionPost = $optionPostId ? $optionPosts->get($optionPostId) : null;
            $selectedVariant = $this->resolveBundleItemVariantFromMap($bundleItem, $variantMap);
            $quantity = max(1, (int) ($bundleItem->pivot?->quantity ?? 1));
            $currentUnitPrice = $this->resolveBundleItemCurrentUnitPrice($bundleItem, $selectedVariant);
            $baseUnitPrice = $this->resolveBundleItemBaseUnitPrice($bundleItem, $selectedVariant, $currentUnitPrice);

            if (!isset($catalog[$optionKey])) {
                $displayImage = $this->mapBundleOptionImageUrl($bundleItem->pivot?->option_image_url ?? null)
                    ?? $this->resolveBundleOptionPrimaryImage($optionPost);
                $displayName = $optionTitle !== ''
                    ? $optionTitle
                    : (Str::squish((string) ($optionPost?->title ?? '')) ?: $bundleItem->name);

                $catalog[$optionKey] = [
                    'key' => $optionKey,
                    'name' => $displayName,
                    'title' => $optionTitle,
                    'bundle_option_title' => $optionTitle,
                    'bundle_option_post_id' => $optionPostId,
                    'bundle_option_post_title' => Str::squish((string) ($optionPost?->title ?? '')) ?: null,
                    'bundle_option_post_slug' => Str::squish((string) ($optionPost?->slug ?? '')) ?: null,
                    'primary_image' => $displayImage,
                    'main_image' => $this->extractImageUrl($displayImage),
                    'price' => 0.0,
                    'current_price' => 0.0,
                    'special_price' => null,
                    'bundle_option_total_price' => 0.0,
                    'bundle_option_discounted_price' => 0.0,
                    'bundle_option_discount_amount' => 0.0,
                    'bundle_option_discount_rate' => self::BUNDLE_FULL_SET_DISCOUNT_RATE,
                    'bundle_option_base_price' => 0.0,
                    'items_count' => 0,
                ];
            }

            $catalogAliases[$optionKey] = collect($catalogAliases[$optionKey] ?? [])
                ->merge($optionAliases)
                ->push($optionKey)
                ->filter(fn ($key) => trim((string) $key) !== '')
                ->unique()
                ->values()
                ->all();

            if (!$catalog[$optionKey]['primary_image']) {
                $displayImage = $this->mapBundleOptionImageUrl($bundleItem->pivot?->option_image_url ?? null)
                    ?? $this->resolveBundleOptionPrimaryImage($optionPost);
                $catalog[$optionKey]['primary_image'] = $displayImage;
                $catalog[$optionKey]['main_image'] = $this->extractImageUrl($displayImage);
            }

            $catalog[$optionKey]['current_price'] += $currentUnitPrice * $quantity;
            $catalog[$optionKey]['price'] += $baseUnitPrice * $quantity;
            $catalog[$optionKey]['items_count'] += $quantity;
        }

        foreach ($catalog as $optionKey => $optionMeta) {
            $totalPrice = round((float) ($optionMeta['current_price'] ?? 0), 2);
            $basePrice = round((float) ($optionMeta['price'] ?? 0), 2);

            if ($basePrice <= 0 || $basePrice < $totalPrice) {
                $basePrice = $totalPrice;
            }

            $discountedPricing = $this->calculateFullBundleDiscountedPrice($totalPrice);
            $discountAmount = $discountedPricing['discount_amount'];
            $discountedPrice = $discountedPricing['discounted_price'];

            $catalog[$optionKey]['price'] = $totalPrice;
            $catalog[$optionKey]['current_price'] = $discountedPrice;
            $catalog[$optionKey]['special_price'] = $discountedPrice < $totalPrice ? $discountedPrice : null;
            $catalog[$optionKey]['bundle_option_total_price'] = $totalPrice;
            $catalog[$optionKey]['bundle_option_discounted_price'] = $discountedPrice;
            $catalog[$optionKey]['bundle_option_discount_amount'] = $discountAmount;
            $catalog[$optionKey]['bundle_option_base_price'] = $basePrice;
            $catalog[$optionKey]['bundle_option_key_aliases'] = $catalogAliases[$optionKey] ?? [$optionKey];
        }

        foreach ($catalog as $optionKey => $optionMeta) {
            foreach ((array) ($optionMeta['bundle_option_key_aliases'] ?? []) as $aliasKey) {
                $aliasKey = trim((string) $aliasKey);

                if ($aliasKey !== '' && !isset($catalog[$aliasKey])) {
                    $catalog[$aliasKey] = $optionMeta;
                }
            }
        }

        return $catalog;
    }

    private function uniqueBundleOptionCatalogValues(array $catalog): array
    {
        return collect($catalog)
            ->filter(fn ($meta) => is_array($meta))
            ->unique(fn (array $meta) => (string) ($meta['key'] ?? $meta['bundle_option_title'] ?? ''))
            ->values()
            ->all();
    }

    private function mapBundleOptionListProduct(
        array $product,
        array $optionMeta,
        ?string $bundleOptionKey,
        ?string $bundleOptionTitle,
        $bundleOptionPostId,
        $parentProductId,
        array $attributeValues
    ): array {
        $primaryImage = $optionMeta['primary_image'] ?? ($product['primary_image'] ?? null);
        $mainImage = $optionMeta['main_image']
            ?? $this->extractImageUrl($primaryImage)
            ?? ($product['main_image'] ?? null);
        $totalPrice = round((float) ($optionMeta['bundle_option_total_price'] ?? $optionMeta['price'] ?? 0), 2);
        $finalPrice = round((float) ($optionMeta['bundle_option_discounted_price'] ?? $optionMeta['current_price'] ?? $totalPrice), 2);

        if ($totalPrice <= 0 || $totalPrice < $finalPrice) {
            $totalPrice = $finalPrice;
        }

        return [
            ...$product,
            'item_type' => 'bundle_option',
            'name' => $optionMeta['name'] ?? ($bundleOptionTitle ?: ($product['name'] ?? '')),
            'price' => $totalPrice,
            'current_price' => $finalPrice,
            'special_price' => $totalPrice > $finalPrice ? $finalPrice : null,
            'primary_image' => $primaryImage,
            'main_image' => $mainImage,
            'bundle_option_key' => $optionMeta['key'] ?? $bundleOptionKey,
            'bundle_option_title' => $optionMeta['bundle_option_title'] ?? $bundleOptionTitle,
            'bundle_option_post_id' => $optionMeta['bundle_option_post_id'] ?? $bundleOptionPostId,
            'bundle_option_post_title' => $optionMeta['bundle_option_post_title'] ?? null,
            'bundle_option_post_slug' => $optionMeta['bundle_option_post_slug'] ?? null,
            'bundle_option_total_price' => $totalPrice,
            'bundle_option_discounted_price' => $finalPrice,
            'bundle_option_discount_amount' => $optionMeta['bundle_option_discount_amount'] ?? max($totalPrice - $finalPrice, 0),
            'bundle_option_discount_rate' => $optionMeta['bundle_option_discount_rate'] ?? self::BUNDLE_FULL_SET_DISCOUNT_RATE,
            'bundle_parent_name' => $product['name'] ?? null,
            'parent_product_id' => $parentProductId,
            'attribute_values' => $attributeValues,
        ];
    }

    public function index(Request $request)
    {
        $accountId = $this->getAccountId($request);
        \Illuminate\Support\Facades\Log::info("Resolved Account ID: " . ($accountId ?? 'NULL'));

        $query = Product::query()
            ->select('products.*')
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true);
        $selectedCategoryIds = [];

        // Filter by category slug
        if ($request->filled('category')) {
            $cat = Category::where('slug', $request->category)
                ->when($accountId, fn($q) => $q->where('account_id', $accountId))
                ->first();
            if ($cat) {
                $selectedCategoryIds = $this->getOrderedCategoryIds($cat, $accountId);
            }
        }

        if ($request->filled('category_id')) {
            $cat = Category::query()
                ->when($accountId, fn ($categoryQuery) => $categoryQuery->where('account_id', $accountId))
                ->find($request->category_id);

            if ($cat) {
                $selectedCategoryIds = $this->getOrderedCategoryIds($cat, $accountId);
            }
        }

        if (!empty($selectedCategoryIds)) {
            $this->joinCategoryAssignments($query, $selectedCategoryIds);
        } elseif (!$request->boolean('allow_variants') && !$request->filled('parent_id')) {
            $query->whereDoesntHave('parentConfigurable');
        }

        // Search
        if ($request->filled('search')) {
            $s = trim((string) $request->search);
            \Illuminate\Support\Facades\Log::info("Product search keyword: '{$s}'");

            if ($request->boolean('mobile_search')) {
                $this->applyMobileQuickSearch($query, $s);
            } else {
                $query->where(function ($q) use ($s) {
                    $q->where('name', 'ilike', "%{$s}%")
                      ->orWhere('sku', 'ilike', "%{$s}%")
                      ->orWhere('description', 'ilike', "%{$s}%");
                });
            }
        }

        // Parent Filter (for sibling variations)
        // parentConfigurable() is belongsToMany via product_links(product_id->parent, linked_product_id->child)
        // whereHas on belongsToMany can't filter pivot columns reliably, so we query product_links directly.
        if ($request->filled('parent_id')) {
            $parentId = (int) $request->parent_id;
            $childIds = \Illuminate\Support\Facades\DB::table('product_links')
                ->where('product_id', $parentId)
                ->where('link_type', 'super_link')
                ->pluck('linked_product_id');
            $query->whereIn('products.id', $childIds);
        }

        // Price range
        if ($request->filled('min_price')) $query->where('price', '>=', $request->min_price);
        if ($request->filled('max_price')) $query->where('price', '<=', $request->max_price);
        
        // Before applying attribute filters, clone the query to calculate available filters
        $filterQuery = clone $query;

        // Attribute filtering: ?attrs[color]=Red&attrs[material]=Wood
        if ($request->filled('attrs')) {
            $attrs = $request->attrs;
            foreach ($attrs as $code => $value) {
                if (empty($value)) continue;
                $query->whereHas('attributeValues', function ($q) use ($code, $value) {
                    $q->whereHas('attribute', function($aq) use ($code) {
                        $aq->where('code', $code);
                    });
                    $valueArray = is_array($value) ? $value : explode(',', $value);
                    $q->where(function ($sub) use ($valueArray) {
                        foreach ($valueArray as $val) {
                            $sub->orWhere('value', $val)
                                ->orWhere('value', 'LIKE', '%"' . $val . '"%');
                        }
                    });
                });
            }
        }

        // Sort
        $sortKey = $request->get('sort', 'popular');
        $finalQuery = clone $query;

        $prioritizeCategoryOrder = !empty($selectedCategoryIds) && in_array($sortKey, ['popular', 'newest'], true);

        if ($prioritizeCategoryOrder) {
            $finalQuery->orderBy('category_order_key');
        }

        if ($request->filled('search') && $request->boolean('mobile_search')) {
            $finalQuery->orderByDesc('search_score');
        }

        if (in_array($sortKey, ['popular', 'newest'], true)) {
            $finalQuery->orderBy('products.sort_order', 'asc');
        }

        switch ($sortKey) {
            case 'price_asc':
                $finalQuery->orderBy('price', 'asc');
                break;
            case 'price_desc':
                $finalQuery->orderBy('price', 'desc');
                break;
            case 'newest':
                $finalQuery->orderBy('created_at', 'desc');
                break;
            case 'popular':
            default:
                $finalQuery->orderBy('is_featured', 'desc')->orderBy('created_at', 'desc');
                break;
        }

        if (!$prioritizeCategoryOrder && !empty($selectedCategoryIds)) {
            $finalQuery->orderBy('category_order_key');
        }

        $finalQuery->orderBy('id', 'desc');

        $perPage = min((int) $request->get('per_page', 24), 60);
        $products = $finalQuery->with(['images' => function ($q) {
                $q->orderBy('is_primary', 'desc')->orderBy('sort_order');
            }, 'category:id,name,slug'])
            ->paginate($perPage);

        // Build parent_product_id map for all products in this page (for picker mode)
        $pageProductIds = $products->getCollection()->pluck('id')->all();
        $parentIdMap = [];
        $attrValuesMap = [];
        if (!empty($pageProductIds)) {
            // parent_product_id: find which products are children (variations)
            $parentLinks = \Illuminate\Support\Facades\DB::table('product_links')
                ->whereIn('linked_product_id', $pageProductIds)
                ->where('link_type', 'super_link')
                ->get(['linked_product_id', 'product_id']);
            foreach ($parentLinks as $link) {
                $parentIdMap[(int) $link->linked_product_id] = (int) $link->product_id;
            }

            // attribute_values: fetch all attribute values for these products
            $attrRows = \Illuminate\Support\Facades\DB::table('product_attribute_values as pav')
                ->join('attributes as a', 'a.id', '=', 'pav.attribute_id')
                ->whereIn('pav.product_id', $pageProductIds)
                ->get(['pav.product_id', 'pav.attribute_id', 'a.code as attribute_code', 'a.name as attribute_name', 'pav.value']);
            foreach ($attrRows as $row) {
                $attrValuesMap[(int) $row->product_id][] = [
                    'attribute_id' => (int) $row->attribute_id,
                    'attribute_code' => $row->attribute_code,
                    'attribute_name' => $row->attribute_name,
                    'value' => $row->value,
                ];
            }
        }

        $products->getCollection()->transform(function ($product) {
            $itemType = $this->isBundleOptionAssignment(
                $product->item_type ?? null,
                $product->bundle_option_key ?? null,
                $product->bundle_option_post_id ?? null,
                $product->bundle_option_title ?? null
            ) ? 'bundle_option' : 'product';
            $bundleOptionKey = $this->resolveAssignmentBundleOptionKey(
                $product->bundle_option_key ?? null,
                $product->bundle_option_post_id ?? null,
                $product->bundle_option_title ?? null
            );
            $bundleOptionTitle = $itemType === 'bundle_option'
                ? (Str::squish((string) ($product->bundle_option_title ?? '')) ?: null)
                : null;

            $product->setAttribute('item_type', $itemType);
            $product->setAttribute('bundle_option_key', $bundleOptionKey !== '' ? $bundleOptionKey : null);
            $product->setAttribute(
                'bundle_option_post_id',
                $itemType === 'bundle_option' && filled($product->bundle_option_post_id ?? null)
                    ? (int) $product->bundle_option_post_id
                    : null
            );
            $product->setAttribute('bundle_option_title', $bundleOptionTitle);

            return $product;
        });

        $bundleOptionProductIds = $products->getCollection()
            ->filter(fn ($product) => ($product->item_type ?? '') === 'bundle_option')
            ->pluck('id')
            ->map(fn ($productId) => is_numeric($productId) ? (int) $productId : null)
            ->filter()
            ->unique()
            ->values();

        $bundleOptionCatalog = [];

        if ($bundleOptionProductIds->isNotEmpty()) {
            $bundleProducts = Product::query()
                ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
                ->whereIn('id', $bundleOptionProductIds->all())
                ->with([
                    'images' => fn ($query) => $query->orderBy('is_primary', 'desc')->orderBy('sort_order'),
                    'bundleItems' => fn ($query) => $query
                        ->where('status', true)
                        ->with([
                            'images' => fn ($imageQuery) => $imageQuery->orderBy('is_primary', 'desc')->orderBy('sort_order'),
                        ]),
                ])
                ->get();

            $variantIds = $bundleProducts
                ->flatMap(fn (Product $product) => $product->bundleItems->pluck('pivot.variant_id'))
                ->filter(fn ($variantId) => filled($variantId))
                ->map(fn ($variantId) => (int) $variantId)
                ->unique()
                ->values();

            $variantMap = $variantIds->isNotEmpty()
                ? Product::query()
                    ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
                    ->whereIn('id', $variantIds->all())
                    ->with([
                        'images' => fn ($query) => $query->orderBy('is_primary', 'desc')->orderBy('sort_order'),
                    ])
                    ->get()
                    ->keyBy(fn (Product $variant) => (int) $variant->id)
                : collect();

            $optionPostIds = $bundleProducts
                ->flatMap(fn (Product $product) => $product->bundleItems->pluck('pivot.option_post_id'))
                ->filter(fn ($postId) => filled($postId))
                ->map(fn ($postId) => (int) $postId)
                ->unique()
                ->values();

            $optionPosts = $optionPostIds->isNotEmpty()
                ? Post::query()
                    ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
                    ->with('featuredMediaAsset')
                    ->whereIn('id', $optionPostIds->all())
                    ->get(['id', 'title', 'slug', 'featured_image', 'featured_media_asset_id'])
                    ->keyBy(fn (Post $post) => (int) $post->id)
                : collect();

            $bundleOptionCatalog = $this->buildBundleOptionCatalog($bundleProducts, $variantMap, $optionPosts);
        }

        // Calculate available filters
        $availableFilters = [];
        
        $filterableAttributesQuery = \App\Models\Attribute::where('status', true)
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->ordered()
            ->with('options');

        if (isset($cat) && !empty($cat->filterable_attribute_ids)) {
            $ids = array_values(array_unique(array_map('intval', (array)$cat->filterable_attribute_ids)));
            $filterableAttributesQuery->whereIn('id', $ids);
        } else {
            $filterableAttributesQuery->where('is_filterable_frontend', true);
        }

        $filterableAttributes = $filterableAttributesQuery->get();

        // Sort if category has specific order defined
        if (isset($cat) && !empty($cat->filterable_attribute_ids)) {
            $ids = array_values(array_unique(array_map('intval', (array)$cat->filterable_attribute_ids)));
            $orderMap = array_flip($ids);
            $filterableAttributes = $filterableAttributes->sortBy(function($attr) use ($orderMap) {
                return $orderMap[$attr->id] ?? 999;
            })->values();
        }

        foreach ($filterableAttributes as $attr) {
            // Count products for each value of this attribute within the current search result
            $rawCounts = ProductAttributeValue::where('attribute_id', $attr->id)
                ->whereIn('product_id', (clone $filterQuery)->select('products.id'))
                ->selectRaw('value, count(*) as count')
                ->groupBy('value')
                ->get();

            $valueCounts = [];
            foreach ($rawCounts as $rc) {
                $v = $rc->value;
                $c = (int)$rc->count;
                if ($v !== null && str_starts_with($v, '[') && str_ends_with($v, ']')) {
                    $arr = json_decode($v, true);
                    if (is_array($arr)) {
                        foreach ($arr as $item) {
                            $valueCounts[$item] = ($valueCounts[$item] ?? 0) + $c;
                        }
                        continue;
                    }
                }
                $valueCounts[$v] = ($valueCounts[$v] ?? 0) + $c;
            }

            $options = [];
            $isGiaoDien2 = isset($cat) && !empty($cat->filterable_attribute_ids);

            // If it's a select/multiselect, use predefined options
            if (in_array($attr->frontend_type, ['select', 'multiselect'])) {
                foreach ($attr->options as $opt) {
                    $count = $valueCounts[$opt->value] ?? 0;
                    // For Giao diện 2, show all options even if count is 0
                    // For others, only show options that have products
                    if ($count > 0 || $isGiaoDien2) {
                        $options[] = [
                            'label' => $opt->value,
                            'value' => $opt->value,
                            'count' => (int)$count,
                            'swatch_value' => $opt->swatch_value
                        ];
                    }
                }
            } else {
                // For other types (text, etc.), show existing values from product counts
                foreach ($valueCounts as $val => $count) {
                    $options[] = [
                        'label' => $val,
                        'value' => $val,
                        'count' => (int)$count
                    ];
                }
            }

            if (!empty($options) || $isGiaoDien2) {
                $availableFilters[] = [
                    'id' => $attr->id,
                    'name' => $attr->name,
                    'code' => $attr->code,
                    'type' => $attr->frontend_type,
                    'options' => $options
                ];
            }
        }

        // For price filter, calculate min/max
        $priceStatsQuery = (clone $filterQuery)
            ->getQuery()
            ->cloneWithout(['columns', 'orders', 'limit', 'offset'])
            ->cloneWithoutBindings(['select', 'order']);

        $priceStats = $priceStatsQuery
            ->selectRaw('MIN(products.price) as min_price, MAX(products.price) as max_price')
            ->first();
        if ($priceStats && $priceStats->min_price !== null) {
            $availableFilters[] = [
                'name' => 'Giá',
                'code' => 'price',
                'type' => 'price_range',
                'min' => floor($priceStats->min_price),
                'max' => ceil($priceStats->max_price)
            ];
        }

        $responseData = $products->toArray();
        $responseData['data'] = collect($responseData['data'] ?? [])
            ->flatMap(function (array $product) use ($bundleOptionCatalog, $parentIdMap, $attrValuesMap) {
                $productId = is_numeric($product['id'] ?? null) ? (int) $product['id'] : 0;
                $bundleOptionKey = $this->resolveAssignmentBundleOptionKey(
                    $product['bundle_option_key'] ?? null,
                    $product['bundle_option_post_id'] ?? null,
                    $product['bundle_option_title'] ?? null
                );
                $itemType = $this->isBundleOptionAssignment(
                    $product['item_type'] ?? null,
                    $bundleOptionKey,
                    $product['bundle_option_post_id'] ?? null,
                    $product['bundle_option_title'] ?? null
                ) ? 'bundle_option' : 'product';
                $bundleOptionTitle = $itemType === 'bundle_option'
                    ? (Str::squish((string) ($product['bundle_option_title'] ?? '')) ?: null)
                    : null;
                $optionMeta = $itemType === 'bundle_option'
                    ? $this->resolveBundleOptionCatalogMeta(
                        $bundleOptionCatalog,
                        $productId,
                        $bundleOptionKey,
                        $product['bundle_option_post_id'] ?? null,
                        $product['bundle_option_title'] ?? null
                    )
                    : null;

                $pid = is_numeric($product['id'] ?? null) ? (int) $product['id'] : 0;
                $enrichedParentId = $parentIdMap[$pid] ?? null;
                $enrichedAttrValues = $attrValuesMap[$pid] ?? [];

                if (!is_array($optionMeta)) {
                    return [[
                        ...$product,
                        'item_type' => $itemType,
                        'bundle_option_key' => $bundleOptionKey,
                        'bundle_option_post_id' => $itemType === 'bundle_option' ? ($product['bundle_option_post_id'] ?? null) : null,
                        'bundle_option_title' => $bundleOptionTitle,
                        'parent_product_id' => $enrichedParentId,
                        'attribute_values' => $enrichedAttrValues,
                    ]];
                }

                return [$this->mapBundleOptionListProduct(
                    $product,
                    $optionMeta,
                    $bundleOptionKey,
                    $bundleOptionTitle,
                    $product['bundle_option_post_id'] ?? null,
                    $enrichedParentId,
                    $enrichedAttrValues
                )];
            })
            ->values()
            ->all();
        $responseData['available_filters'] = $availableFilters;

        return response()->json(Utf8Sanitizer::normalize($responseData));
    }

    public function show(Request $request, $slug)
    {
        try {
            $accountId = $this->getAccountId($request);
            \Illuminate\Support\Facades\Log::info("Fetching product detail for slug: '{$slug}' (Account: " . ($accountId ?? 'ALL') . ")");

            $product = Product::query()
                ->when($accountId, fn($q) => $q->where('account_id', $accountId))
                ->where('status', true)
                ->where(function($q) use ($slug) {
                    $q->where('slug', $slug);
                    if (is_numeric($slug)) {
                        $q->orWhere('id', (int)$slug);
                    }
                })
                ->with([
                    'images', 
                    'category', 
                    'attributeValues.attribute',
                    'superAttributes' => function($q) {
                        $q->withPivot('position');

                        if (Attribute::hasSortOrderColumn()) {
                            $q->orderBy('attributes.sort_order');
                        }

                        $q->orderBy('product_super_attributes.position', 'asc')
                            ->orderBy('attributes.id');
                    },
                    'superAttributes.options',
                    'variations' => function($q) {
                        $q->where('status', true); // Only active variants
                    },
                    'variations.images',
                    'variations.attributeValues.attribute',
                    'bundleItems.images',
                    'bundleItems.attributeValues.attribute',
                    'groupedItems.images',
                    'groupedItems.attributeValues.attribute',
                    'relatedProducts.images'
                ])
                ->firstOrFail();

            $bundleOptionPosts = collect();
            $bundleOptionCatalog = [];
            $variantMap = collect();

            // Enrich bundle items with variant data if variant_id is present
            if (($product->type === 'bundle' || $product->type === 'grouped') && $product->bundleItems) {
                // Collect all variant IDs to fetch them in one query
                $variantIds = $product->bundleItems->pluck('pivot.variant_id')->filter()->unique()->toArray();

                $optionPostIds = $product->bundleItems
                    ->pluck('pivot.option_post_id')
                    ->filter(fn ($postId) => filled($postId))
                    ->map(fn ($postId) => (int) $postId)
                    ->unique()
                    ->values()
                    ->all();

                if (!empty($variantIds)) {
                    $variantMap = Product::whereIn('id', $variantIds)
                        ->with(['images', 'attributeValues.attribute'])
                        ->get()
                        ->keyBy(fn (Product $variant) => (int) $variant->id);
                }

                if (!empty($optionPostIds)) {
                    $bundleOptionPosts = Post::query()
                        ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
                        ->with('featuredMediaAsset')
                        ->whereIn('id', $optionPostIds)
                        ->get(['id', 'title', 'slug', 'featured_image', 'featured_media_asset_id'])
                        ->keyBy(fn (Post $post) => (int) $post->id);
                }

                foreach ($product->bundleItems as $item) {
                    // 1. Apply pivot price if set (this is the refreshed/saved price for this specific combo)
                    if ($item->pivot->price !== null) {
                        $item->price = $item->pivot->price;
                    }
                    if ($item->pivot->cost_price !== null) {
                        $item->cost_price = $item->pivot->cost_price;
                    }

                    $vId = $item->pivot->variant_id;
                    if ($vId && $variantMap->has((int) $vId)) {
                        $v = $variantMap->get((int) $vId);
                        // Merge variant data into item. Fallback to variant price if pivot price was missing
                        if ($item->pivot->price === null) $item->price = $v->price;
                        if ($item->pivot->cost_price === null) $item->cost_price = $v->cost_price;
                        $item->sku = $v->sku;
                            $item->name = $v->name; 
                            
                            // Merge images if variant has images
                            if ($v->images && $v->images->count() > 0) {
                                $item->setRelation('images', $v->images);
                            }
                            
                            // Merge attributes
                            if ($v->attributeValues && $v->attributeValues->count() > 0) {
                                $item->setRelation('attributeValues', $v->attributeValues);
                            }
                        }
                    }

                if ($product->type === 'bundle') {
                    $bundleOptionCatalog = $this->buildBundleOptionCatalogForItems(
                        $product->bundleItems instanceof Collection ? $product->bundleItems : collect(),
                        $variantMap,
                        $bundleOptionPosts,
                    );
                }
            }

            if ($product->type === 'configurable') {
                // Filter options to only show what actually exists in variations
                $usedValuesByAttr = [];
                foreach ($product->variations as $v) {
                    foreach ($v->attributeValues as $av) {
                        $usedValuesByAttr[$av->attribute_id][] = $av->value;
                    }
                }

                foreach ($product->superAttributes as $attribute) {
                    $relevantValues = array_unique($usedValuesByAttr[$attribute->id] ?? []);
                    $filteredOptions = $attribute->options->filter(function($opt) use ($relevantValues) {
                        return in_array($opt->value, $relevantValues);
                    })->values();
                    $attribute->setRelation('options', $filteredOptions);
                }
            }

            // Also include all available product attributes
            $allProductAttributes = Attribute::where('entity_type', 'product')
                ->where('status', true)
                ->ordered()
                ->get(['id', 'name', 'code', 'frontend_type']);
            
            $responseData = $product->toArray();
            $responseData['video_urls'] = $product->video_urls ?: ($product->video_url ? [$product->video_url] : []);
            if (is_array($responseData['bundle_items'] ?? null)) {
                $responseData['bundle_items'] = collect($responseData['bundle_items'])
                    ->map(function (array $item) use ($bundleOptionCatalog, $bundleOptionPosts) {
                        $optionPostId = data_get($item, 'pivot.option_post_id');
                        $optionTitle = data_get($item, 'pivot.option_title');
                        $optionKey = $this->normalizeBundleOptionKey($optionPostId, $optionTitle);
                        $optionPost = filled($optionPostId) && is_numeric($optionPostId)
                            ? $bundleOptionPosts->get((int) $optionPostId)
                            : null;
                        $optionMeta = $bundleOptionCatalog[$optionKey] ?? null;
                        $item['option_key'] = $optionKey;
                        $item['option_post_title'] = Str::squish((string) ($optionPost?->title ?? '')) ?: null;
                        $item['option_post_slug'] = Str::squish((string) ($optionPost?->slug ?? '')) ?: null;
                        $item['option_post_featured_image'] = $optionMeta['primary_image'] ?? $this->mapPostPrimaryImage($optionPost);

                        return $item;
                    })
                    ->values()
                    ->all();
            }
            $responseData['bundle_options'] = $this->uniqueBundleOptionCatalogValues($bundleOptionCatalog);
            $responseData['all_attributes'] = $allProductAttributes;

            return response()->json(Utf8Sanitizer::normalize($responseData));
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("Error in ProductController@show for slug '{$slug}': " . $e->getMessage());
            \Illuminate\Support\Facades\Log::error($e->getTraceAsString());
            
            if ($e instanceof \Illuminate\Database\Eloquent\ModelNotFoundException) {
                return response()->json(['message' => 'Product not found'], 404);
            }
            
            return response()->json([
                'message' => 'Internal server error',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function related(Request $request, $slug)
    {
        $accountId = $this->getAccountId($request);
        $product = Product::query()
            ->when($accountId, fn($q) => $q->where('products.account_id', $accountId))
            ->with([
                'category:id,name,slug',
                'categories:id,name,slug',
            ])
            ->where(function ($q) use ($slug) {
                $q->where('slug', $slug);
                if (is_numeric($slug)) {
                    $q->orWhere('id', (int) $slug);
                }
            })
            ->firstOrFail();

        $limit = 8;
        $fallbackCategory = $this->resolvePrimaryCategory($product);

        $explicitRelated = $product->relatedProducts()
            ->when($accountId, fn($q) => $q->where('products.account_id', $accountId))
            ->where('products.status', true)
            ->with([
                'images' => fn($q) => $q->orderBy('is_primary', 'desc')->orderBy('sort_order'),
                'category:id,name,slug',
                'categories:id,name,slug',
            ])
            ->get();

        if ($explicitRelated->isNotEmpty()) {
            return response()->json(Utf8Sanitizer::normalize([
                'items' => $this->formatRelatedProductsResponse($explicitRelated),
                'meta' => [
                    'source' => 'explicit',
                    'has_explicit_related' => true,
                    'fallback_category' => $fallbackCategory,
                ],
            ]));
        }

        $categoryIds = collect([$product->category_id])
            ->merge($product->categories->pluck('id'))
            ->filter()
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values();

        if ($categoryIds->isEmpty()) {
            return response()->json(Utf8Sanitizer::normalize([
                'items' => [],
                'meta' => [
                    'source' => 'empty',
                    'has_explicit_related' => false,
                    'fallback_category' => $fallbackCategory,
                ],
            ]));
        }

        $fallback = Product::query()
            ->when($accountId, fn($q) => $q->where('products.account_id', $accountId))
            ->where('products.status', true)
            ->whereDoesntHave('parentConfigurable')
            ->whereKeyNot($product->id)
            ->where(function ($query) use ($categoryIds) {
                $query->whereIn('category_id', $categoryIds)
                    ->orWhereHas('categories', function ($categoryQuery) use ($categoryIds) {
                        $categoryQuery->whereIn('categories.id', $categoryIds);
                    });
            })
            ->with([
                'images' => fn($q) => $q->orderBy('is_primary', 'desc')->orderBy('sort_order'),
                'category:id,name,slug',
                'categories:id,name,slug',
            ])
            ->inRandomOrder()
            ->limit($limit)
            ->get();

        return response()->json(Utf8Sanitizer::normalize([
            'items' => $this->formatRelatedProductsResponse($fallback),
            'meta' => [
                'source' => 'category',
                'has_explicit_related' => false,
                'fallback_category' => $fallbackCategory,
            ],
        ]));
    }

    private function formatRelatedProductsResponse($products)
    {
        return $products->map(function ($product) {
            $images = $this->mapProductImages($product);
            $primaryImage = collect($images)->firstWhere('is_primary', true) ?? ($images[0] ?? null);

            return [
                'id' => $product->id,
                'name' => $product->name,
                'slug' => $product->slug,
                'price' => $product->price,
                'current_price' => $product->current_price,
                'main_image' => $product->main_image ?: ($primaryImage['url'] ?? null),
                'average_rating' => round($product->average_rating, 1),
                'primary_image' => $primaryImage,
                'images' => $images,
                'category' => $this->resolvePrimaryCategory($product),
            ];
        })->values();
    }

    private function mapProductImages(Product $product)
    {
        return $product->images->map(function ($image) {
            return [
                'id' => $image->id,
                'url' => $image->large_url ?: $image->image_url,
                'path' => $image->large_url ?: $image->image_url,
                'image_url' => $image->image_url,
                'thumbnail_url' => $image->thumbnail_url,
                'medium_url' => $image->medium_url,
                'large_url' => $image->large_url,
                'width' => $image->width,
                'height' => $image->height,
                'srcset' => $image->srcset,
                'is_primary' => (bool) $image->is_primary,
                'sort_order' => $image->sort_order,
            ];
        })->values()->all();
    }

    private function resolvePrimaryCategory(Product $product): ?array
    {
        $category = $product->category;

        if (!$category && $product->relationLoaded('categories')) {
            $category = $product->categories->first();
        }

        if (!$category) {
            return null;
        }

        return [
            'id' => (int) $category->id,
            'name' => $category->name,
            'slug' => $category->slug,
        ];
    }
}
