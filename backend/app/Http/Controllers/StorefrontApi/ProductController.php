<?php

namespace App\Http\Controllers\StorefrontApi;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\Category;
use App\Models\Attribute;
use App\Models\Post;
use App\Models\ProductAttributeValue;
use App\Models\ProductImage;
use App\Support\Utf8Sanitizer;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class ProductController extends Controller
{
    private const BUNDLE_FULL_SET_DISCOUNT_RATE = 0.10;
    private const BUNDLE_TOTAL_ROUNDING_UNIT = 10000;
    private const BUNDLE_OPTION_STATUS_INTERNAL = 'internal';

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

    private function normalizeBundleOptionUid($value): ?string
    {
        $uid = trim((string) $value);

        return preg_match('/^[A-Za-z0-9:_-]{1,64}$/', $uid) === 1 ? $uid : null;
    }

    private function hasProductLinksBundleOptionUid(): bool
    {
        return Schema::hasColumn('product_links', 'bundle_option_uid');
    }

    private function hasProductLinksBundleOptionStatus(): bool
    {
        return Schema::hasColumn('product_links', 'bundle_option_status');
    }

    private function isInternalBundleOptionStatus($value): bool
    {
        return Str::lower(Str::squish((string) $value)) === self::BUNDLE_OPTION_STATUS_INTERNAL;
    }

    private function applyVisibleBundleOptionConstraint($query): void
    {
        if (!$this->hasProductLinksBundleOptionStatus()) {
            return;
        }

        $query->where(function ($visibleQuery) {
            $visibleQuery
                ->whereNull('product_links.bundle_option_status')
                ->orWhere('product_links.bundle_option_status', '<>', self::BUNDLE_OPTION_STATUS_INTERNAL);
        });
    }

    private function getBundleOptionKeyCandidates($bundleOptionKey = null, $bundleOptionPostId = null, $bundleOptionTitle = null, $bundleOptionUid = null): array
    {
        $candidates = [];
        $uid = $this->normalizeBundleOptionUid($bundleOptionUid);

        if ($uid !== null) {
            $candidates[] = 'uid:' . $uid;
            $candidates[] = $uid;
        }

        $explicitKey = trim((string) $bundleOptionKey);

        if ($explicitKey !== '') {
            $candidates[] = $explicitKey;
        }

        if ($this->hasBundleOptionAssignmentMeta($bundleOptionKey, $bundleOptionPostId, $bundleOptionTitle, $bundleOptionUid)) {
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

    private function hasBundleOptionAssignmentMeta($bundleOptionKey = null, $bundleOptionPostId = null, $bundleOptionTitle = null, $bundleOptionUid = null): bool
    {
        return $this->normalizeBundleOptionUid($bundleOptionUid) !== null
            || trim((string) $bundleOptionKey) !== ''
            || filled($bundleOptionPostId)
            || Str::squish((string) $bundleOptionTitle) !== '';
    }

    private function isBundleOptionAssignment($itemType = null, $bundleOptionKey = null, $bundleOptionPostId = null, $bundleOptionTitle = null, $bundleOptionUid = null): bool
    {
        if ((string) $itemType === 'bundle_option') {
            return true;
        }

        return $this->hasBundleOptionAssignmentMeta($bundleOptionKey, $bundleOptionPostId, $bundleOptionTitle, $bundleOptionUid);
    }

    private function markTiming(array &$timings, string $name, float $startedAt): float
    {
        $now = microtime(true);
        $timings[$name] = round(($now - $startedAt) * 1000, 1);

        return $now;
    }

    private function timedJsonResponse(array $payload, array $timings)
    {
        $sanitizeStartedAt = microtime(true);
        $normalizedPayload = Utf8Sanitizer::normalize($payload);
        $timings['sanitize'] = round((microtime(true) - $sanitizeStartedAt) * 1000, 1);

        $encodeStartedAt = microtime(true);
        $jsonPayload = json_encode(
            $normalizedPayload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
        );
        if ($jsonPayload === false) {
            $jsonPayload = '{}';
        }
        $timings['json_encode'] = round((microtime(true) - $encodeStartedAt) * 1000, 1);

        $serverTiming = collect($timings)
            ->map(fn ($duration, $name) => sprintf('%s;dur=%s', preg_replace('/[^a-zA-Z0-9_-]/', '_', $name), $duration))
            ->implode(', ');

        return response()
            ->make($jsonPayload)
            ->header('Content-Type', 'application/json')
            ->header('Server-Timing', $serverTiming)
            ->header('X-Webgom-Timing', json_encode($timings, JSON_UNESCAPED_SLASHES));
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

    private function resolveBundleOptionCatalogMeta(array $catalog, int $productId, ?string $bundleOptionKey, $bundleOptionPostId = null, $bundleOptionTitle = null, $bundleOptionUid = null): ?array
    {
        if ($productId <= 0 || empty($catalog[$productId]) || !is_array($catalog[$productId])) {
            return null;
        }

        foreach ($this->getBundleOptionKeyCandidates($bundleOptionKey, $bundleOptionPostId, $bundleOptionTitle, $bundleOptionUid) as $candidateKey) {
            if (isset($catalog[$productId][$candidateKey]) && is_array($catalog[$productId][$candidateKey])) {
                return $catalog[$productId][$candidateKey];
            }
        }

        return null;
    }

    private function resolveRequestedBundleOptionMatch(Product $product, ?string $requestedKey, ?string $requestedTitle, ?string $requestedUid = null): ?array
    {
        $normalizedRequestedKey = trim((string) $requestedKey);
        $normalizedRequestedTitle = Str::squish((string) $requestedTitle);
        $normalizedRequestedUid = $this->normalizeBundleOptionUid($requestedUid);

        if ($normalizedRequestedKey === '' && $normalizedRequestedTitle === '' && $normalizedRequestedUid === null) {
            return null;
        }

        $hasBundleOptionUid = $this->hasProductLinksBundleOptionUid();
        $hasBundleOptionStatus = $this->hasProductLinksBundleOptionStatus();
        $bundleOptionUidSelectSql = $hasBundleOptionUid ? 'bundle_option_uid' : 'NULL as bundle_option_uid';
        $bundleOptionStatusSelectSql = $hasBundleOptionStatus ? 'bundle_option_status' : 'NULL as bundle_option_status';
        $bundleOptionUidGroupColumns = $hasBundleOptionUid
            ? ['bundle_option_uid', 'option_post_id', 'option_title']
            : ['option_post_id', 'option_title'];
        if ($hasBundleOptionStatus) {
            $bundleOptionUidGroupColumns[] = 'bundle_option_status';
        }

        $optionRows = DB::table('product_links')
            ->where('product_id', $product->id)
            ->where('link_type', 'bundle')
            ->selectRaw($bundleOptionUidSelectSql)
            ->selectRaw($bundleOptionStatusSelectSql)
            ->addSelect('option_post_id', 'option_title')
            ->selectRaw('MIN(position) as first_position')
            ->groupBy(...$bundleOptionUidGroupColumns)
            ->orderBy('first_position')
            ->get();

        if ($optionRows->isEmpty()) {
            return null;
        }

        foreach ($optionRows as $row) {
            $optionPostId = filled($row->option_post_id ?? null) ? (int) $row->option_post_id : null;
            $optionTitle = Str::squish((string) ($row->option_title ?? '')) ?: 'Mặc định';
            $optionUid = $this->normalizeBundleOptionUid($row->bundle_option_uid ?? null);
            $optionKey = $this->normalizeBundleOptionKey($optionPostId, $optionTitle);
            $optionKeyCandidates = $this->getBundleOptionKeyCandidates(null, $optionPostId, $optionTitle, $optionUid);
            $optionStatus = $this->isInternalBundleOptionStatus($row->bundle_option_status ?? null)
                ? self::BUNDLE_OPTION_STATUS_INTERNAL
                : 'visible';

            $matchesUid = $normalizedRequestedUid !== null && $optionUid !== null && $normalizedRequestedUid === $optionUid;
            $matchesKey = $normalizedRequestedKey !== ''
                && in_array($normalizedRequestedKey, $optionKeyCandidates, true);
            $matchesTitle = $normalizedRequestedTitle !== ''
                && $optionTitle === $normalizedRequestedTitle;

            if ($matchesUid || $matchesKey || $matchesTitle) {
                return [
                    'option_uid' => $optionUid,
                    'option_key' => $optionKey,
                    'option_post_id' => $optionPostId,
                    'option_title' => $optionTitle,
                    'option_status' => $optionStatus,
                    'matched' => true,
                ];
            }
        }

        $fallbackRow = $optionRows->first(fn ($row) => ! $this->isInternalBundleOptionStatus($row->bundle_option_status ?? null))
            ?: $optionRows->first();
        $fallbackPostId = filled($fallbackRow->option_post_id ?? null) ? (int) $fallbackRow->option_post_id : null;
        $fallbackTitle = Str::squish((string) ($fallbackRow->option_title ?? '')) ?: 'Mặc định';

        return [
            'option_uid' => $this->normalizeBundleOptionUid($fallbackRow->bundle_option_uid ?? null),
            'option_key' => $this->normalizeBundleOptionKey($fallbackPostId, $fallbackTitle),
            'option_post_id' => $fallbackPostId,
            'option_title' => $fallbackTitle,
            'option_status' => $this->isInternalBundleOptionStatus($fallbackRow->bundle_option_status ?? null)
                ? self::BUNDLE_OPTION_STATUS_INTERNAL
                : 'visible',
            'matched' => false,
        ];
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

    private function getOrderedCategoryIds(Category $category, $accountId, bool $includeLinkOnlyDescendants = false): array
    {
        $ids = [(int) $category->id];

        $children = Category::query()
            ->where('parent_id', $category->id)
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->when(!$includeLinkOnlyDescendants, fn ($query) => $query->publiclyListed())
            ->orderBy('order')
            ->orderBy('id')
            ->get(['id']);

        foreach ($children as $child) {
            $ids = array_merge($ids, $this->getOrderedCategoryIds($child, $accountId, $includeLinkOnlyDescendants));
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

        $hasBundleOptionUid = Schema::hasColumn('category_product', 'bundle_option_uid');
        $bundleOptionUidAssignmentSql = $hasBundleOptionUid ? " OR COALESCE(category_product.bundle_option_uid, '') <> ''" : '';
        $bundleOptionUidSelectSql = $hasBundleOptionUid ? "COALESCE(category_product.bundle_option_uid, '')" : "''";
        $bundleOptionUidGroupSql = $hasBundleOptionUid ? ', category_product.bundle_option_uid' : '';
        $bundleOptionAssignmentSql = "category_product.item_type = 'bundle_option'{$bundleOptionUidAssignmentSql} OR COALESCE(category_product.bundle_option_key, '') <> '' OR category_product.bundle_option_post_id IS NOT NULL OR COALESCE(category_product.bundle_option_title, '') <> ''";
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
            ->selectRaw("{$bundleOptionUidSelectSql} as bundle_option_uid")
            ->selectRaw("COALESCE(category_product.bundle_option_key, '') as bundle_option_key")
            ->selectRaw('category_product.bundle_option_post_id')
            ->selectRaw('category_product.bundle_option_title')
            ->selectRaw("MIN((CASE category_product.category_id {$caseSql} ELSE 999999 END) * 1000000 + COALESCE(category_product.sort_order, 999999)) as category_order_key")
            ->whereIn('category_product.category_id', $normalizedCategoryIds)
            ->where(function ($categoryQuery) {
                $categoryQuery
                    ->whereIn('category_product.item_type', ['product', 'bundle_option'])
                    ->orWhereNull('category_product.item_type');
            })
            ->when($this->hasProductLinksBundleOptionStatus(), function ($categoryQuery) use ($bundleOptionAssignmentSql, $hasBundleOptionUid) {
                $categoryQuery->where(function ($visibilityQuery) use ($bundleOptionAssignmentSql, $hasBundleOptionUid) {
                    $visibilityQuery
                        ->whereRaw("NOT ({$bundleOptionAssignmentSql})")
                        ->orWhereNotExists(function ($hiddenQuery) use ($hasBundleOptionUid) {
                            $hiddenQuery
                                ->selectRaw('1')
                                ->from('product_links as hidden_bundle_options')
                                ->whereColumn('hidden_bundle_options.product_id', 'category_product.product_id')
                                ->where('hidden_bundle_options.link_type', 'bundle')
                                ->where('hidden_bundle_options.bundle_option_status', self::BUNDLE_OPTION_STATUS_INTERNAL)
                                ->where(function ($matchQuery) use ($hasBundleOptionUid) {
                                    if ($hasBundleOptionUid) {
                                        $matchQuery->whereRaw("(COALESCE(category_product.bundle_option_uid, '') <> '' AND hidden_bundle_options.bundle_option_uid = category_product.bundle_option_uid)");
                                    }

                                    $matchQuery
                                        ->orWhereRaw('(category_product.bundle_option_post_id IS NOT NULL AND hidden_bundle_options.option_post_id = category_product.bundle_option_post_id)')
                                        ->orWhereRaw("(COALESCE(category_product.bundle_option_title, '') <> '' AND LOWER(TRIM(COALESCE(hidden_bundle_options.option_title, ''))) = LOWER(TRIM(COALESCE(category_product.bundle_option_title, ''))))");
                                });
                        });
                });
            })
            ->groupByRaw("{$resolvedProductIdSql}, {$itemTypeSql}{$bundleOptionUidGroupSql}, category_product.bundle_option_key, category_product.bundle_option_post_id, category_product.bundle_option_title");

        $query
            ->joinSub($subquery, $alias, function ($join) use ($alias) {
                $join->on("{$alias}.product_id", '=', 'products.id');
            })
            ->select('products.*')
            ->addSelect([
                "{$alias}.item_type as item_type",
                "{$alias}.bundle_option_uid as bundle_option_uid",
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

    private function extractBundleBowlCount(?string $value): ?int
    {
        $normalized = $this->normalizeSearchKeyword($value);

        return preg_match('/\b([0-9]+)\s*bat\b/', $normalized, $matches) === 1
            ? (int) $matches[1]
            : null;
    }

    private function mapProductImage($image): array
    {
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
    }

    private function mapProductReviewSummary(Product $product): array
    {
        $summary = $product->reviewSummary();

        return [
            'average_rating' => (float) $summary['average_rating'],
            'total_reviews' => (int) $summary['total_reviews'],
            'distribution' => $summary['distribution'],
        ];
    }

    private function filterDisplayProductImages($images): Collection
    {
        return collect($images)
            ->filter(fn ($image) => $image instanceof ProductImage && ! $image->isStaleTeamPhoto())
            ->values();
    }

    private function productHasLoadedImage(Product $product): bool
    {
        return $product->relationLoaded('images')
            && collect($product->images)->filter(fn ($image) => $image instanceof ProductImage)->isNotEmpty();
    }

    private function resolveVariantOverrideImages(Product $variant, ?Product $baseProduct = null): Collection
    {
        $variantImages = collect($variant->images ?? collect())
            ->filter(fn ($image) => $image instanceof ProductImage)
            ->values();

        if ($variantImages->isEmpty()) {
            return collect();
        }

        $displayImages = $this->filterDisplayProductImages($variantImages);
        if ($displayImages->isNotEmpty()) {
            return $displayImages;
        }

        return $baseProduct instanceof Product && $this->productHasLoadedImage($baseProduct)
            ? collect()
            : $variantImages;
    }

    private function sanitizeProductImageRelations(Product $product, bool $filterOwnImages = false): void
    {
        if ($filterOwnImages && $product->relationLoaded('images')) {
            $product->setRelation('images', $this->filterDisplayProductImages($product->images));
        }

        if (! $product->relationLoaded('variations')) {
            return;
        }

        $product->variations->each(function ($variation) use ($product): void {
            if (! $variation instanceof Product || ! $variation->relationLoaded('images')) {
                return;
            }

            $variation->setRelation('images', $this->resolveVariantOverrideImages($variation, $product));
        });
    }

    private function resolveBundleOptionGalleryImage(?Product $bundleProduct, ?string $optionTitle): ?array
    {
        if (!$bundleProduct || !$bundleProduct->relationLoaded('images') || $bundleProduct->images->isEmpty()) {
            return null;
        }

        $optionBowlCount = $this->extractBundleBowlCount($optionTitle);
        $optionText = $this->normalizeSearchKeyword($optionTitle);

        foreach ($bundleProduct->images as $image) {
            if ($image instanceof ProductImage && $image->isStaleTeamPhoto()) {
                continue;
            }

            $imageText = $this->normalizeSearchKeyword(implode(' ', array_filter([
                $image->file_name ?? null,
                $image->mediaAsset?->original_name ?? null,
                $image->image_url ?? null,
                $image->large_url ?? null,
            ])));

            if ($optionBowlCount !== null && $this->extractBundleBowlCount($imageText) === $optionBowlCount) {
                return $this->mapProductImage($image);
            }

            if (str_contains($optionText, 'than tai') && str_contains($imageText, 'than tai')) {
                return $this->mapProductImage($image);
            }
        }

        return null;
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
                    $product,
                ),
            ];
        })->all();
    }

    private function buildBundleOptionCatalogForItems($bundleItems, Collection $variantMap, Collection $optionPosts, ?Product $bundleProduct = null, bool $includeInternalOptions = false): array
    {
        $catalog = [];
        $catalogAliases = [];

        foreach ($bundleItems as $bundleItem) {
            if (!$bundleItem instanceof Product) {
                continue;
            }

            if (!$includeInternalOptions && $this->isInternalBundleOptionStatus($bundleItem->pivot?->bundle_option_status ?? null)) {
                continue;
            }

            $optionPostId = filled($bundleItem->pivot?->option_post_id ?? null)
                ? (int) $bundleItem->pivot->option_post_id
                : null;
            $optionTitle = Str::squish((string) ($bundleItem->pivot?->option_title ?? '')) ?: 'Mặc định';
            $optionUid = $this->normalizeBundleOptionUid($bundleItem->pivot?->bundle_option_uid ?? null);
            $optionKey = $this->normalizeBundleOptionKey($optionPostId, $optionTitle);
            $catalogKey = $optionUid !== null ? 'uid:' . $optionUid : $optionKey;
            $optionAliases = $this->getBundleOptionKeyCandidates(null, $optionPostId, $optionTitle, $optionUid);
            $optionPost = $optionPostId ? $optionPosts->get($optionPostId) : null;
            $optionStatus = $this->isInternalBundleOptionStatus($bundleItem->pivot?->bundle_option_status ?? null)
                ? self::BUNDLE_OPTION_STATUS_INTERNAL
                : 'visible';
            $optionVideoUrl = trim((string) ($bundleItem->pivot?->option_video_url ?? ''));
            $optionVideoSource = trim((string) ($bundleItem->pivot?->option_video_source ?? ''));
            $selectedVariant = $this->resolveBundleItemVariantFromMap($bundleItem, $variantMap);
            $quantity = max(1, (int) ($bundleItem->pivot?->quantity ?? 1));
            $currentUnitPrice = $this->resolveBundleItemCurrentUnitPrice($bundleItem, $selectedVariant);
            $baseUnitPrice = $this->resolveBundleItemBaseUnitPrice($bundleItem, $selectedVariant, $currentUnitPrice);

            if (!isset($catalog[$catalogKey])) {
                $displayImage = $this->mapBundleOptionImageUrl($bundleItem->pivot?->option_image_url ?? null)
                    ?? $this->resolveBundleOptionPrimaryImage($optionPost)
                    ?? $this->resolveBundleOptionGalleryImage($bundleProduct, $optionTitle);
                $displayName = $optionTitle !== ''
                    ? $optionTitle
                    : (Str::squish((string) ($optionPost?->title ?? '')) ?: $bundleItem->name);

                $catalog[$catalogKey] = [
                    'key' => $optionKey,
                    'bundle_option_uid' => $optionUid,
                    'name' => $displayName,
                    'title' => $optionTitle,
                    'bundle_option_title' => $optionTitle,
                    'bundle_option_post_id' => $optionPostId,
                    'bundle_option_post_title' => Str::squish((string) ($optionPost?->title ?? '')) ?: null,
                    'bundle_option_post_slug' => Str::squish((string) ($optionPost?->slug ?? '')) ?: null,
                    'bundle_option_status' => $optionStatus,
                    'primary_image' => $displayImage,
                    'main_image' => $this->extractImageUrl($displayImage),
                    'option_image_url' => $this->extractImageUrl($displayImage),
                    'option_video_url' => $optionVideoUrl !== '' ? $optionVideoUrl : null,
                    'option_video_source' => $optionVideoSource !== '' ? $optionVideoSource : null,
                    'video_url' => $optionVideoUrl !== '' ? $optionVideoUrl : null,
                    'video_urls' => $optionVideoUrl !== '' ? [$optionVideoUrl] : [],
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

            $catalogAliases[$catalogKey] = collect($catalogAliases[$catalogKey] ?? [])
                ->merge($optionAliases)
                ->push($catalogKey)
                ->push($optionKey)
                ->filter(fn ($key) => trim((string) $key) !== '')
                ->unique()
                ->values()
                ->all();

            if (!$catalog[$catalogKey]['primary_image']) {
                $displayImage = $this->mapBundleOptionImageUrl($bundleItem->pivot?->option_image_url ?? null)
                    ?? $this->resolveBundleOptionPrimaryImage($optionPost)
                    ?? $this->resolveBundleOptionGalleryImage($bundleProduct, $optionTitle);
                $catalog[$catalogKey]['primary_image'] = $displayImage;
                $catalog[$catalogKey]['main_image'] = $this->extractImageUrl($displayImage);
                $catalog[$catalogKey]['option_image_url'] = $this->extractImageUrl($displayImage);
            }

            if (empty($catalog[$catalogKey]['option_video_url']) && $optionVideoUrl !== '') {
                $catalog[$catalogKey]['option_video_url'] = $optionVideoUrl;
                $catalog[$catalogKey]['option_video_source'] = $optionVideoSource !== '' ? $optionVideoSource : null;
                $catalog[$catalogKey]['video_url'] = $optionVideoUrl;
                $catalog[$catalogKey]['video_urls'] = [$optionVideoUrl];
            }

            $catalog[$catalogKey]['current_price'] += $currentUnitPrice * $quantity;
            $catalog[$catalogKey]['price'] += $baseUnitPrice * $quantity;
            $catalog[$catalogKey]['items_count'] += $quantity;
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
            ->unique(fn (array $meta) => (string) ($meta['bundle_option_uid'] ?? $meta['key'] ?? $meta['bundle_option_title'] ?? ''))
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
            'images' => array_values(array_filter([$primaryImage])),
            'variations' => [],
            'item_type' => 'bundle_option',
            'name' => $optionMeta['name'] ?? ($bundleOptionTitle ?: ($product['name'] ?? '')),
            'price' => $totalPrice,
            'current_price' => $finalPrice,
            'special_price' => $totalPrice > $finalPrice ? $finalPrice : null,
            'primary_image' => $primaryImage,
            'main_image' => $mainImage,
            'bundle_option_uid' => $optionMeta['bundle_option_uid'] ?? null,
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
            'has_variants' => false,
            'variants_count' => 0,
            'default_variant_id' => null,
            'bundle_options' => [],
            'bundle_items' => [],
        ];
    }

    public function index(Request $request)
    {
        $timings = [];
        $stepStartedAt = microtime(true);
        $accountId = $this->getAccountId($request);
        $stepStartedAt = $this->markTiming($timings, 'account', $stepStartedAt);
        \Illuminate\Support\Facades\Log::info("Resolved Account ID: " . ($accountId ?? 'NULL'));

        $query = Product::query()
            ->select('products.*')
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true);
        $selectedCategoryIds = [];

        $typeInput = $request->query('types', $request->query('type'));
        $requestedTypes = collect(is_array($typeInput) ? $typeInput : explode(',', (string) $typeInput))
            ->flatMap(fn ($value) => explode(',', (string) $value))
            ->map(fn ($value) => Str::lower(Str::squish((string) $value)))
            ->filter(fn ($value) => in_array($value, ['simple', 'configurable', 'grouped', 'virtual', 'bundle', 'downloadable'], true))
            ->unique()
            ->values();

        if ($requestedTypes->isNotEmpty()) {
            $query->whereIn('products.type', $requestedTypes->all());
        }

        // Filter by category slug
        if ($request->filled('category')) {
            $cat = Category::where('slug', $request->category)
                ->when($accountId, fn($q) => $q->where('account_id', $accountId))
                ->first();
            if ($cat) {
                $selectedCategoryIds = $this->getOrderedCategoryIds($cat, $accountId, $cat->isLinkOnly());
            }
        }

        if ($request->filled('category_id')) {
            $cat = Category::query()
                ->when($accountId, fn ($categoryQuery) => $categoryQuery->where('account_id', $accountId))
                ->find($request->category_id);

            if ($cat) {
                $selectedCategoryIds = $this->getOrderedCategoryIds($cat, $accountId, $cat->isLinkOnly());
            }
        }
        $stepStartedAt = $this->markTiming($timings, 'category', $stepStartedAt);

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
        $stepStartedAt = $this->markTiming($timings, 'query_build', $stepStartedAt);

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
        $products = $finalQuery->with([
            'images' => function ($q) {
                $q->orderBy('is_primary', 'desc')->orderBy('sort_order');
            },
            'category:id,name,slug',
        ])
            ->paginate($perPage);
        $stepStartedAt = $this->markTiming($timings, 'products', $stepStartedAt);

        // Build parent_product_id map for all products in this page (for picker mode)
        $pageProductIds = $products->getCollection()->pluck('id')->all();
        $parentIdMap = [];
        $attrValuesMap = [];
        $variantMetaMap = [];
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

            $variantLinks = \Illuminate\Support\Facades\DB::table('product_links')
                ->whereIn('product_id', $pageProductIds)
                ->where('link_type', 'super_link')
                ->get(['product_id', 'linked_product_id', 'is_default']);
            foreach ($variantLinks as $link) {
                $productId = (int) $link->product_id;
                $variantMetaMap[$productId] ??= [
                    'ids' => [],
                    'default_variant_id' => null,
                ];
                $variantMetaMap[$productId]['ids'][(int) $link->linked_product_id] = true;

                if (filter_var($link->is_default, FILTER_VALIDATE_BOOLEAN)) {
                    $variantMetaMap[$productId]['default_variant_id'] = (int) $link->linked_product_id;
                }
            }
        }
        $stepStartedAt = $this->markTiming($timings, 'page_meta', $stepStartedAt);

        $products->getCollection()->transform(function ($product) {
            $itemType = $this->isBundleOptionAssignment(
                $product->item_type ?? null,
                $product->bundle_option_key ?? null,
                $product->bundle_option_post_id ?? null,
                $product->bundle_option_title ?? null,
                $product->bundle_option_uid ?? null
            ) ? 'bundle_option' : 'product';
            $bundleOptionUid = $itemType === 'bundle_option'
                ? $this->normalizeBundleOptionUid($product->bundle_option_uid ?? null)
                : null;
            $bundleOptionKey = $this->resolveAssignmentBundleOptionKey(
                $product->bundle_option_key ?? null,
                $product->bundle_option_post_id ?? null,
                $product->bundle_option_title ?? null
            );
            $bundleOptionTitle = $itemType === 'bundle_option'
                ? (Str::squish((string) ($product->bundle_option_title ?? '')) ?: null)
                : null;

            $product->setAttribute('item_type', $itemType);
            $product->setAttribute('bundle_option_uid', $bundleOptionUid);
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
                    'bundleItems' => function ($query) {
                        $query->where('status', true);
                        $this->applyVisibleBundleOptionConstraint($query);
                    },
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

            foreach ($bundleProducts as $bundleProduct) {
                foreach ($bundleProduct->bundleItems as $item) {
                    if ($item->pivot->price !== null) {
                        $item->price = $item->pivot->price;
                    }

                    if ($item->pivot->cost_price !== null) {
                        $item->cost_price = $item->pivot->cost_price;
                    }

                    $variantId = $item->pivot->variant_id;
                    if ($variantId && $variantMap->has((int) $variantId)) {
                        $variant = $variantMap->get((int) $variantId);

                        if ($item->pivot->price === null) {
                            $item->price = $variant->price;
                        }

                        if ($item->pivot->cost_price === null) {
                            $item->cost_price = $variant->cost_price;
                        }

                        $item->sku = $variant->sku;
                        $item->name = $variant->name;
                    }
                }
            }

            $bundleOptionCatalog = $this->buildBundleOptionCatalog($bundleProducts, $variantMap, $optionPosts);
        }
        $stepStartedAt = $this->markTiming($timings, 'bundle_options', $stepStartedAt);

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

        $stepStartedAt = $this->markTiming($timings, 'filters', $stepStartedAt);

        $responseData = $products->toArray();
        $responseData['data'] = collect($responseData['data'] ?? [])
            ->flatMap(function (array $product) use ($bundleOptionCatalog, $parentIdMap, $attrValuesMap, $variantMetaMap) {
                $productId = is_numeric($product['id'] ?? null) ? (int) $product['id'] : 0;
                $bundleOptionUid = $this->normalizeBundleOptionUid($product['bundle_option_uid'] ?? null);
                $bundleOptionKey = $this->resolveAssignmentBundleOptionKey(
                    $product['bundle_option_key'] ?? null,
                    $product['bundle_option_post_id'] ?? null,
                    $product['bundle_option_title'] ?? null
                );
                $itemType = $this->isBundleOptionAssignment(
                    $product['item_type'] ?? null,
                    $bundleOptionKey,
                    $product['bundle_option_post_id'] ?? null,
                    $product['bundle_option_title'] ?? null,
                    $bundleOptionUid
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
                        $product['bundle_option_title'] ?? null,
                        $bundleOptionUid
                    )
                    : null;

                $pid = is_numeric($product['id'] ?? null) ? (int) $product['id'] : 0;
                $enrichedParentId = $parentIdMap[$pid] ?? null;
                $enrichedAttrValues = $attrValuesMap[$pid] ?? [];
                $variantMeta = $variantMetaMap[$pid] ?? ['ids' => [], 'default_variant_id' => null];
                $variantsCount = count($variantMeta['ids'] ?? []);
                $defaultVariantId = $variantMeta['default_variant_id'] ?? null;
                $hasVariants = ($itemType !== 'bundle_option')
                    && (
                        ($product['type'] ?? null) === 'configurable'
                        || $variantsCount > 0
                    );
                $primaryImage = $product['primary_image'] ?? null;

                if ($itemType === 'bundle_option' && !is_array($optionMeta)) {
                    return [];
                }

                if (!is_array($optionMeta)) {
                    return [[
                        ...$product,
                        'images' => array_values(array_filter([$primaryImage])),
                        'variations' => [],
                        'name' => $itemType === 'bundle_option' && $bundleOptionTitle
                            ? $bundleOptionTitle
                            : ($product['name'] ?? null),
                        'item_type' => $itemType,
                        'bundle_option_uid' => $itemType === 'bundle_option' ? $bundleOptionUid : null,
                        'bundle_option_key' => $bundleOptionKey,
                        'bundle_option_post_id' => $itemType === 'bundle_option' ? ($product['bundle_option_post_id'] ?? null) : null,
                        'bundle_option_title' => $bundleOptionTitle,
                        'parent_product_id' => $enrichedParentId,
                        'attribute_values' => $enrichedAttrValues,
                        'has_variants' => $hasVariants,
                        'variants_count' => $variantsCount,
                        'default_variant_id' => $defaultVariantId,
                        'bundle_options' => [],
                        'bundle_items' => [],
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
        $responseData['perf_meta'] = [
            'products_count' => count($responseData['data']),
            'filters_count' => count($availableFilters),
            'bundle_option_products_count' => $bundleOptionProductIds->count(),
        ];
        $this->markTiming($timings, 'serialize', $stepStartedAt);

        return $this->timedJsonResponse($responseData, $timings);
    }

    public function show(Request $request, $slug)
    {
        try {
            $timings = [];
            $stepStartedAt = microtime(true);
            $accountId = $this->getAccountId($request);
            $stepStartedAt = $this->markTiming($timings, 'account', $stepStartedAt);
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
                // Load only base relations common to all product types.
                // Type-specific heavy relations are loaded conditionally below.
                ->with([
                    'images',
                    'category',
                    'attributeValues.attribute',
                ])
                ->firstOrFail();
            $stepStartedAt = $this->markTiming($timings, 'base_product', $stepStartedAt);

            // Conditionally load type-specific relations to avoid unnecessary DB queries.
            // This is the key optimization for bundle products: skip variations & superAttributes.
            if ($product->type === 'bundle') {
                $product->load([
                    'bundleItems' => function ($query) {
                        $query->where('products.status', true);
                        $this->applyVisibleBundleOptionConstraint($query);
                    },
                    'bundleItems.images',
                    'bundleItems.attributeValues.attribute',
                ]);
            } elseif ($product->type === 'grouped') {
                $product->load([
                    'groupedItems' => function ($query) {
                        $query->where('products.status', true);
                    },
                    'groupedItems.images',
                    'groupedItems.attributeValues.attribute',
                ]);
            } elseif ($product->type === 'configurable') {
                $product->load([
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
                        $q->where('status', true);
                    },
                    'variations.images',
                    'variations.attributeValues.attribute',
                ]);
            }
            $stepStartedAt = $this->markTiming($timings, 'type_relations', $stepStartedAt);
            // Note: relatedProducts are fetched separately via /related endpoint.

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
                $stepStartedAt = $this->markTiming($timings, 'bundle_variants_batch', $stepStartedAt);

                if (!empty($optionPostIds)) {
                    $bundleOptionPosts = Post::query()
                        ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
                        ->with('featuredMediaAsset')
                        ->whereIn('id', $optionPostIds)
                        ->get(['id', 'title', 'slug', 'featured_image', 'featured_media_asset_id'])
                        ->keyBy(fn (Post $post) => (int) $post->id);
                }
                $stepStartedAt = $this->markTiming($timings, 'bundle_option_posts', $stepStartedAt);

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
                        $variantImages = $this->resolveVariantOverrideImages($v, $item);
                        if ($variantImages->isNotEmpty()) {
                            $item->setRelation('images', $variantImages);
                        }

                        // Merge attributes
                        if ($v->attributeValues && $v->attributeValues->count() > 0) {
                            $item->setRelation('attributeValues', $v->attributeValues);
                        }
                    }
                }

                if ($product->type === 'bundle') {
                    // Cache the bundle option catalog for 60 seconds per product+account.
                    // The catalog computation (pricing, discounts, option grouping) is
                    // expensive and identical for all visitors viewing the same product.
                    $catalogCacheKey = 'bundle_catalog:' . ($accountId ?? 'all') . ':' . $product->id . ':' . ($product->updated_at?->timestamp ?? 0);
                    $bundleOptionCatalog = Cache::remember(
                        $catalogCacheKey,
                        60,
                        fn () => $this->buildBundleOptionCatalogForItems(
                            $product->bundleItems instanceof Collection ? $product->bundleItems : collect(),
                            $variantMap,
                            $bundleOptionPosts,
                            $product,
                        )
                    );
                }
                $stepStartedAt = $this->markTiming($timings, 'bundle_catalog', $stepStartedAt);
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

            // Cache all_attributes for 5 minutes - this list rarely changes and is fetched on every product page.
            $allProductAttributes = Cache::remember(
                'all_product_attributes:' . ($accountId ?? 'all'),
                300,
                fn () => Attribute::where('entity_type', 'product')
                    ->where('status', true)
                    ->ordered()
                    ->get(['id', 'name', 'code', 'frontend_type'])
            );
            $stepStartedAt = $this->markTiming($timings, 'attributes_cache', $stepStartedAt);
            
            $this->sanitizeProductImageRelations($product);
            $responseData = $product->toArray();
            $reviewSummary = $this->mapProductReviewSummary($product);
            $responseData['average_rating'] = $reviewSummary['average_rating'];
            $responseData['review_count'] = $reviewSummary['total_reviews'];
            $responseData['rating_distribution'] = $reviewSummary['distribution'];
            $responseData['review_summary'] = $reviewSummary;
            $responseData['video_urls'] = $product->video_urls ?: ($product->video_url ? [$product->video_url] : []);
            if (is_array($responseData['bundle_items'] ?? null)) {
                $responseData['bundle_items'] = collect($responseData['bundle_items'])
                    ->map(function (array $item) use ($bundleOptionCatalog, $bundleOptionPosts) {
                        $optionPostId = data_get($item, 'pivot.option_post_id');
                        $optionUid = $this->normalizeBundleOptionUid(data_get($item, 'pivot.bundle_option_uid'));
                        $optionTitle = data_get($item, 'pivot.option_title');
                        $optionKey = $this->normalizeBundleOptionKey($optionPostId, $optionTitle);
                        $catalogKey = $optionUid !== null ? 'uid:' . $optionUid : $optionKey;
                        $optionPost = filled($optionPostId) && is_numeric($optionPostId)
                            ? $bundleOptionPosts->get((int) $optionPostId)
                            : null;
                        $optionMeta = $bundleOptionCatalog[$catalogKey] ?? $bundleOptionCatalog[$optionKey] ?? null;
                        $item['option_key'] = $optionKey;
                        $item['option_uid'] = $optionUid;
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
            $this->markTiming($timings, 'serialize', $stepStartedAt);

            return $this->timedJsonResponse($responseData, $timings);
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

    public function bundleOptionDetail(Request $request, $slug)
    {
        try {
            $timings = [];
            $stepStartedAt = microtime(true);
            $accountId = $this->getAccountId($request);
            $stepStartedAt = $this->markTiming($timings, 'account', $stepStartedAt);

            $compactRequestedOption = trim((string) (
                $request->query('o')
                ?? $request->query('bo')
                ?? ''
            ));
            $requestedKey = trim((string) (
                $request->query('bundle_option_key')
                ?? $request->query('bk')
                ?? $request->query('option_key')
                ?? ''
            ));
            $requestedUid = $this->normalizeBundleOptionUid(
                $request->query('bundle_option_uid')
                ?? $request->query('option_uid')
                ?? ''
            );
            $requestedTitle = Str::squish((string) (
                $request->query('bundle_option')
                ?? $request->query('bundle_option_title')
                ?? $request->query('bn')
                ?? $request->query('option')
                ?? ''
            ));

            if ($compactRequestedOption !== '') {
                $compactIsUidKey = Str::startsWith($compactRequestedOption, 'uid:');
                $compactIsStructuredKey = $compactIsUidKey
                    || Str::startsWith($compactRequestedOption, ['post:', 'title:']);

                if ($requestedKey === '' && $compactIsStructuredKey) {
                    $requestedKey = $compactRequestedOption;
                }

                if ($requestedUid === null) {
                    $requestedUid = $compactIsUidKey
                        ? $this->normalizeBundleOptionUid(Str::after($compactRequestedOption, 'uid:'))
                        : ($compactIsStructuredKey ? null : $this->normalizeBundleOptionUid($compactRequestedOption));
                }

                if ($requestedKey === '' && $requestedUid === null && $requestedTitle === '') {
                    $requestedTitle = Str::squish($compactRequestedOption);
                }
            }

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
                ])
                ->firstOrFail();
            $stepStartedAt = $this->markTiming($timings, 'base_product', $stepStartedAt);

            if ($product->type !== 'bundle') {
                $this->sanitizeProductImageRelations($product);
                $responseData = $product->toArray();
                $reviewSummary = $this->mapProductReviewSummary($product);
                $responseData['average_rating'] = $reviewSummary['average_rating'];
                $responseData['review_count'] = $reviewSummary['total_reviews'];
                $responseData['rating_distribution'] = $reviewSummary['distribution'];
                $responseData['review_summary'] = $reviewSummary;
                $responseData['video_urls'] = $product->video_urls ?: ($product->video_url ? [$product->video_url] : []);
                $responseData['bundle_items'] = [];
                $responseData['bundle_options'] = [];
                $responseData['is_bundle_option_lite'] = false;
                $this->markTiming($timings, 'serialize', $stepStartedAt);

                return $this->timedJsonResponse($responseData, $timings);
            }

            $optionMatch = $this->resolveRequestedBundleOptionMatch($product, $requestedKey, $requestedTitle, $requestedUid);
            $includeInternalOption = (bool) ($optionMatch['matched'] ?? false)
                && $this->isInternalBundleOptionStatus($optionMatch['option_status'] ?? null);
            $stepStartedAt = $this->markTiming($timings, 'resolve_option', $stepStartedAt);

            $bundleItemsQuery = $product->bundleItems()
                ->where('products.status', true)
                ->with([
                    'images',
                    'attributeValues.attribute',
                ]);
            if (!$includeInternalOption) {
                $this->applyVisibleBundleOptionConstraint($bundleItemsQuery);
            }

            if ($optionMatch && filled($optionMatch['option_uid'] ?? null)) {
                $bundleItemsQuery->wherePivot('bundle_option_uid', $optionMatch['option_uid']);
            } elseif ($optionMatch && filled($optionMatch['option_post_id'] ?? null)) {
                $bundleItemsQuery->wherePivot('option_post_id', (int) $optionMatch['option_post_id']);
            } elseif ($optionMatch && filled($optionMatch['option_title'] ?? null)) {
                $bundleItemsQuery->wherePivot('option_title', $optionMatch['option_title']);
            } elseif ($requestedTitle !== '') {
                $bundleItemsQuery->wherePivot('option_title', $requestedTitle);
            }

            $selectedBundleItems = $bundleItemsQuery->get();
            $product->setRelation('bundleItems', $selectedBundleItems);
            $stepStartedAt = $this->markTiming($timings, 'selected_bundle_items', $stepStartedAt);

            $variantIds = $selectedBundleItems
                ->pluck('pivot.variant_id')
                ->filter(fn ($variantId) => filled($variantId))
                ->map(fn ($variantId) => (int) $variantId)
                ->unique()
                ->values();

            $variantMap = $variantIds->isNotEmpty()
                ? Product::query()
                    ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
                    ->whereIn('id', $variantIds->all())
                    ->with(['images', 'attributeValues.attribute'])
                    ->get()
                    ->keyBy(fn (Product $variant) => (int) $variant->id)
                : collect();
            $stepStartedAt = $this->markTiming($timings, 'variants_batch', $stepStartedAt);

            $optionPostIds = $selectedBundleItems
                ->pluck('pivot.option_post_id')
                ->filter(fn ($postId) => filled($postId))
                ->map(fn ($postId) => (int) $postId)
                ->unique()
                ->values();

            $bundleOptionPosts = $optionPostIds->isNotEmpty()
                ? Post::query()
                    ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
                    ->with('featuredMediaAsset')
                    ->whereIn('id', $optionPostIds->all())
                    ->get(['id', 'title', 'slug', 'featured_image', 'featured_media_asset_id'])
                    ->keyBy(fn (Post $post) => (int) $post->id)
                : collect();
            $stepStartedAt = $this->markTiming($timings, 'option_posts', $stepStartedAt);

            foreach ($selectedBundleItems as $item) {
                if ($item->pivot->price !== null) {
                    $item->price = $item->pivot->price;
                }

                if ($item->pivot->cost_price !== null) {
                    $item->cost_price = $item->pivot->cost_price;
                }

                $variantId = $item->pivot->variant_id;
                if ($variantId && $variantMap->has((int) $variantId)) {
                    $variant = $variantMap->get((int) $variantId);

                    if ($item->pivot->price === null) {
                        $item->price = $variant->price;
                    }

                    if ($item->pivot->cost_price === null) {
                        $item->cost_price = $variant->cost_price;
                    }

                    $item->sku = $variant->sku;
                    $item->name = $variant->name;

                    $variantImages = $this->resolveVariantOverrideImages($variant, $item);
                    if ($variantImages->isNotEmpty()) {
                        $item->setRelation('images', $variantImages);
                    }

                    if ($variant->attributeValues && $variant->attributeValues->count() > 0) {
                        $item->setRelation('attributeValues', $variant->attributeValues);
                    }
                }
            }

            $bundleOptionCatalog = $this->buildBundleOptionCatalogForItems(
                $selectedBundleItems instanceof Collection ? $selectedBundleItems : collect($selectedBundleItems),
                $variantMap,
                $bundleOptionPosts,
                $product,
                $includeInternalOption,
            );
            $stepStartedAt = $this->markTiming($timings, 'selected_catalog', $stepStartedAt);

            $this->sanitizeProductImageRelations($product);
            $responseData = $product->toArray();
            $reviewSummary = $this->mapProductReviewSummary($product);
            $responseData['average_rating'] = $reviewSummary['average_rating'];
            $responseData['review_count'] = $reviewSummary['total_reviews'];
            $responseData['rating_distribution'] = $reviewSummary['distribution'];
            $responseData['review_summary'] = $reviewSummary;
            $responseData['description'] = '';
            $responseData['video_urls'] = $product->video_urls ?: ($product->video_url ? [$product->video_url] : []);
            if (is_array($responseData['bundle_items'] ?? null)) {
                $responseData['bundle_items'] = collect($responseData['bundle_items'])
                    ->map(function (array $item) use ($bundleOptionCatalog, $bundleOptionPosts) {
                        $optionPostId = data_get($item, 'pivot.option_post_id');
                        $optionUid = $this->normalizeBundleOptionUid(data_get($item, 'pivot.bundle_option_uid'));
                        $optionTitle = data_get($item, 'pivot.option_title');
                        $optionKey = $this->normalizeBundleOptionKey($optionPostId, $optionTitle);
                        $catalogKey = $optionUid !== null ? 'uid:' . $optionUid : $optionKey;
                        $optionPost = filled($optionPostId) && is_numeric($optionPostId)
                            ? $bundleOptionPosts->get((int) $optionPostId)
                            : null;
                        $optionMeta = $bundleOptionCatalog[$catalogKey] ?? $bundleOptionCatalog[$optionKey] ?? null;
                        $item['option_key'] = $optionKey;
                        $item['option_uid'] = $optionUid;
                        $item['option_post_title'] = Str::squish((string) ($optionPost?->title ?? '')) ?: null;
                        $item['option_post_slug'] = Str::squish((string) ($optionPost?->slug ?? '')) ?: null;
                        $item['option_post_featured_image'] = $optionMeta['primary_image'] ?? $this->mapPostPrimaryImage($optionPost);

                        return $item;
                    })
                    ->values()
                    ->all();
            }
            $responseData['bundle_options'] = $this->uniqueBundleOptionCatalogValues($bundleOptionCatalog);
            $responseData['all_attributes'] = [];
            $responseData['is_bundle_option_lite'] = true;
            $responseData['requested_bundle_option_uid'] = $optionMatch['option_uid'] ?? $requestedUid;
            $responseData['requested_bundle_option_key'] = $optionMatch['option_key'] ?? $requestedKey;
            $responseData['requested_bundle_option_title'] = $optionMatch['option_title'] ?? $requestedTitle;
            $this->markTiming($timings, 'serialize', $stepStartedAt);

            return $this->timedJsonResponse($responseData, $timings);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("Error in ProductController@bundleOptionDetail for slug '{$slug}': " . $e->getMessage());

            if ($e instanceof \Illuminate\Database\Eloquent\ModelNotFoundException) {
                return response()->json(['message' => 'Product not found'], 404);
            }

            return response()->json([
                'message' => 'Internal server error',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function bundleItemsSummary(Request $request, $slug)
    {
        try {
            $accountId = $this->getAccountId($request);
            $requestedKey = trim((string) (
                $request->query('bundle_option_key')
                ?? $request->query('bk')
                ?? $request->query('option_key')
                ?? ''
            ));
            $requestedUid = $this->normalizeBundleOptionUid(
                $request->query('bundle_option_uid')
                ?? $request->query('option_uid')
                ?? ''
            );
            $requestedTitle = Str::squish((string) (
                $request->query('bundle_option')
                ?? $request->query('bundle_option_title')
                ?? $request->query('option')
                ?? ''
            ));

            $product = Product::query()
                ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
                ->where('status', true)
                ->with([
                    'bundleItems' => function ($query) {
                        $query->where('status', true);
                        $this->applyVisibleBundleOptionConstraint($query);
                    },
                ])
                ->where(function ($query) use ($slug) {
                    $query->where('slug', $slug);
                    if (is_numeric($slug)) {
                        $query->orWhere('id', (int) $slug);
                    }
                })
                ->firstOrFail();

            $bundleItems = $product->bundleItems instanceof Collection
                ? $product->bundleItems
                : collect();

            if ($requestedUid || $requestedKey !== '' || $requestedTitle !== '') {
                $bundleItems = $bundleItems->filter(function (Product $bundleItem) use ($requestedUid, $requestedKey, $requestedTitle) {
                    $optionPostId = data_get($bundleItem, 'pivot.option_post_id');
                    $optionTitle = Str::squish((string) data_get($bundleItem, 'pivot.option_title', ''));
                    $optionUid = $this->normalizeBundleOptionUid(data_get($bundleItem, 'pivot.bundle_option_uid'));
                    $optionKeys = $this->getBundleOptionKeyCandidates(null, $optionPostId, $optionTitle, $optionUid);

                    if ($requestedUid && $optionUid === $requestedUid) {
                        return true;
                    }

                    if ($requestedKey !== '' && in_array($requestedKey, $optionKeys, true)) {
                        return true;
                    }

                    return $requestedTitle !== ''
                        && Str::lower($optionTitle) === Str::lower($requestedTitle);
                })->values();
            }

            $variantIds = $bundleItems
                ->pluck('pivot.variant_id')
                ->filter(fn ($variantId) => filled($variantId))
                ->map(fn ($variantId) => (int) $variantId)
                ->unique()
                ->values();

            $variantMap = $variantIds->isNotEmpty()
                ? Product::query()
                    ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
                    ->whereIn('id', $variantIds->all())
                    ->get()
                    ->keyBy(fn (Product $variant) => (int) $variant->id)
                : collect();

            $items = $bundleItems
                ->map(function (Product $bundleItem) use ($variantMap) {
                    $selectedVariant = $this->resolveBundleItemVariantFromMap($bundleItem, $variantMap);
                    $displayProduct = $selectedVariant instanceof Product ? $selectedVariant : $bundleItem;
                    $optionPostId = data_get($bundleItem, 'pivot.option_post_id');
                    $optionTitle = Str::squish((string) data_get($bundleItem, 'pivot.option_title', '')) ?: 'Mặc định';
                    $optionUid = $this->normalizeBundleOptionUid(data_get($bundleItem, 'pivot.bundle_option_uid'));
                    $quantity = max(1, (int) (data_get($bundleItem, 'pivot.quantity') ?? 1));
                    $currentUnitPrice = $this->resolveBundleItemCurrentUnitPrice($bundleItem, $selectedVariant);
                    $baseUnitPrice = $this->resolveBundleItemBaseUnitPrice($bundleItem, $selectedVariant, $currentUnitPrice);

                    return [
                        'id' => $displayProduct->id,
                        'name' => $displayProduct->name,
                        'sku' => $displayProduct->sku,
                        'quantity' => $quantity,
                        'current_price' => $currentUnitPrice,
                        'price' => $baseUnitPrice,
                        'option_uid' => $optionUid,
                        'option_key' => $this->normalizeBundleOptionKey($optionPostId, $optionTitle),
                        'option_title' => $optionTitle,
                    ];
                })
                ->values()
                ->all();

            return response()->json(Utf8Sanitizer::normalize([
                'items' => $items,
            ]));
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("Error in ProductController@bundleItemsSummary for slug '{$slug}': " . $e->getMessage());

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
                'attributeValues.attribute:id,name,code,frontend_type',
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
                'attributeValues.attribute:id,name,code,frontend_type',
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
                'sku' => $product->sku,
                'type' => $product->type,
                'stock_quantity' => $product->stock_quantity,
                'price' => $product->price,
                'current_price' => $product->current_price,
                'main_image' => $product->main_image ?: ($primaryImage['url'] ?? null),
                'average_rating' => round($product->average_rating, 1),
                'review_count' => (int) $product->review_count,
                'primary_image' => $primaryImage,
                'images' => $images,
                'category' => $this->resolvePrimaryCategory($product),
                'attribute_values' => $product->relationLoaded('attributeValues')
                    ? $product->attributeValues->map(fn ($value) => [
                        'attribute_id' => $value->attribute_id,
                        'attribute_code' => $value->attribute?->code,
                        'attribute_name' => $value->attribute?->name,
                        'value' => $value->value,
                    ])->values()->all()
                    : [],
            ];
        })->values();
    }

    private function mapProductImages(Product $product)
    {
        return $product->images->map(function ($image) {
            return $this->mapProductImage($image);
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
