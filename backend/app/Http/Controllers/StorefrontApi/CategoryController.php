<?php

namespace App\Http\Controllers\StorefrontApi;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Models\PublicCategoryNode;
use App\Support\StorefrontDomainScope;
use App\Support\Utf8Sanitizer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class CategoryController extends Controller
{
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

        $serverTiming = collect($timings)
            ->map(fn ($duration, $name) => sprintf('%s;dur=%s', preg_replace('/[^a-zA-Z0-9_-]/', '_', $name), $duration))
            ->implode(', ');

        return response()
            ->json($normalizedPayload)
            ->header('Server-Timing', $serverTiming)
            ->header('X-Webgom-Timing', json_encode($timings, JSON_UNESCAPED_SLASHES));
    }

    protected function getAccountId(Request $request)
    {
        $siteCode = $request->header('X-Site-Code');
        if (!$siteCode) return null;
        
        $account = \App\Models\Account::where('site_code', $siteCode)->first();
        return $account ? $account->id : null;
    }

    private function normalizeBundleOptionUid($value): string
    {
        $uid = trim((string) $value);

        return preg_match('/^[A-Za-z0-9:_-]{1,64}$/', $uid) === 1 ? $uid : '';
    }

    private function bundleOptionAssignmentKeys(object $row): array
    {
        $uid = $this->normalizeBundleOptionUid($row->bundle_option_uid ?? null);
        $title = trim((string) ($row->bundle_option_title ?? ''));
        $key = trim((string) ($row->bundle_option_key ?? ''));
        $keys = [];

        if ($uid !== '') {
            $keys[] = 'uid:' . $uid;
            $keys[] = $uid;
        }

        if ($key !== '') {
            $keys[] = $key;
        }

        if (filled($row->bundle_option_post_id ?? null)) {
            $keys[] = 'post:' . (int) $row->bundle_option_post_id;
        }

        if ($title !== '') {
            $keys[] = 'title:' . strtolower($title);
        }

        return collect($keys)
            ->filter(fn ($candidate) => trim((string) $candidate) !== '')
            ->unique()
            ->values()
            ->all();
    }

    private function buildVisibleBundleOptionLookup($assignmentRows): array
    {
        $productIds = collect($assignmentRows)
            ->filter(function ($row) {
                return (string) ($row->item_type ?? '') === 'bundle_option'
                    || trim((string) ($row->bundle_option_uid ?? '')) !== ''
                    || trim((string) ($row->bundle_option_key ?? '')) !== ''
                    || filled($row->bundle_option_post_id ?? null)
                    || trim((string) ($row->bundle_option_title ?? '')) !== '';
            })
            ->pluck('product_id')
            ->map(fn ($productId) => is_numeric($productId) ? (int) $productId : null)
            ->filter()
            ->unique()
            ->values();

        if ($productIds->isEmpty()) {
            return [];
        }

        $hasUidColumn = Schema::hasColumn('product_links', 'bundle_option_uid');
        $rows = DB::table('product_links')
            ->where('link_type', 'bundle')
            ->whereIn('product_id', $productIds->all())
            ->when(Schema::hasColumn('product_links', 'bundle_option_status'), function ($query) {
                $query->where(function ($visibleQuery) {
                    $visibleQuery
                        ->whereNull('bundle_option_status')
                        ->orWhere('bundle_option_status', '<>', 'internal');
                });
            })
            ->select('product_id', 'option_post_id', 'option_title')
            ->selectRaw($hasUidColumn ? 'bundle_option_uid' : 'NULL as bundle_option_uid')
            ->get();

        $lookup = [];
        foreach ($rows as $row) {
            $productId = (int) $row->product_id;
            $lookup[$productId] ??= [];

            foreach ($this->bundleOptionAssignmentKeys((object) [
                'bundle_option_uid' => $row->bundle_option_uid ?? null,
                'bundle_option_key' => null,
                'bundle_option_post_id' => $row->option_post_id ?? null,
                'bundle_option_title' => $row->option_title ?? null,
            ]) as $key) {
                $lookup[$productId][$key] = true;
            }
        }

        return $lookup;
    }

    private function isVisibleBundleOptionAssignment(object $row, array $visibleBundleOptionsByProduct): bool
    {
        $productId = (int) ($row->product_id ?? 0);
        if ($productId <= 0 || empty($visibleBundleOptionsByProduct[$productId])) {
            return false;
        }

        foreach ($this->bundleOptionAssignmentKeys($row) as $key) {
            if (!empty($visibleBundleOptionsByProduct[$productId][$key])) {
                return true;
            }
        }

        return false;
    }

    protected function applyStorefrontCategoryItemCounts($categories, $accountId = null, bool $includeLinkOnlyDescendants = false, ?array $storeIds = null, ?array $accountIds = null): void
    {
        $normalizedCategories = collect($categories)->filter();
        $categoryIds = $normalizedCategories
            ->pluck('id')
            ->map(fn ($categoryId) => is_numeric($categoryId) ? (int) $categoryId : null)
            ->filter()
            ->unique()
            ->values();

        if ($categoryIds->isEmpty()) {
            return;
        }

        $categoryDescendantIdMap = $this->buildStorefrontCategoryDescendantIdMap($categoryIds->all(), $accountId, $includeLinkOnlyDescendants, $storeIds, $accountIds);
        $queryCategoryIds = collect($categoryDescendantIdMap)
            ->flatten()
            ->map(fn ($categoryId) => (int) $categoryId)
            ->filter()
            ->unique()
            ->values();

        $itemKeysByCategory = $this->buildStorefrontItemKeysByCategory(
            $queryCategoryIds->all(),
            $accountId,
            $storeIds,
            $accountIds
        );

        $normalizedCategories->each(function ($category) use ($categoryDescendantIdMap, $itemKeysByCategory) {
            $itemKeys = collect($categoryDescendantIdMap[(int) $category->id] ?? [(int) $category->id])
                ->flatMap(fn ($categoryId) => $itemKeysByCategory->get((int) $categoryId, collect()))
                ->unique();

            $category->setAttribute('products_count', $itemKeys->count());
        });
    }

    private function buildStorefrontItemKeysByCategory(array $categoryIds, $accountId = null, ?array $storeIds = null, ?array $accountIds = null)
    {
        $normalizedCategoryIds = collect($categoryIds)
            ->map(fn ($categoryId) => is_numeric($categoryId) ? (int) $categoryId : null)
            ->filter()
            ->unique()
            ->values();

        if ($normalizedCategoryIds->isEmpty()) {
            return collect();
        }

        $assignmentRows = DB::table('category_product')
            ->join('products', 'products.id', '=', 'category_product.product_id')
            ->leftJoin('product_links as super_links', function ($join) {
                $join->on('super_links.linked_product_id', '=', 'category_product.product_id')
                    ->where('super_links.link_type', '=', 'super_link');
            })
            ->when($storeIds !== null, fn ($query) => $query->whereIn('products.store_id', $storeIds))
            ->whereIn('category_product.category_id', $normalizedCategoryIds->all())
            ->where(function ($query) {
                $query
                    ->whereIn('category_product.item_type', ['product', 'bundle_option'])
                    ->orWhereNull('category_product.item_type');
            })
            ->where('products.status', true)
            ->whereNull('products.deleted_at');

        StorefrontDomainScope::applyAccountScope($assignmentRows, $accountId, $accountIds, 'products.account_id');

        $assignmentRows = $assignmentRows->get([
            'category_product.category_id',
            'category_product.product_id',
            'category_product.item_type',
            'category_product.bundle_option_uid',
            'category_product.bundle_option_key',
            'category_product.bundle_option_post_id',
            'category_product.bundle_option_title',
            'super_links.product_id as parent_product_id',
        ]);

        $visibleBundleOptionsByProduct = $this->buildVisibleBundleOptionLookup($assignmentRows);

        return $assignmentRows
            ->groupBy(fn ($row) => (int) $row->category_id)
            ->map(function ($rows) use ($visibleBundleOptionsByProduct) {
                return $rows
                    ->map(function ($row) use ($visibleBundleOptionsByProduct) {
                        $bundleOptionKey = trim((string) ($row->bundle_option_key ?? ''));
                        $bundleOptionTitle = trim((string) ($row->bundle_option_title ?? ''));
                        $bundleOptionUid = trim((string) ($row->bundle_option_uid ?? ''));
                        $isBundleOption = (string) ($row->item_type ?? '') === 'bundle_option'
                            || $bundleOptionUid !== ''
                            || $bundleOptionKey !== ''
                            || filled($row->bundle_option_post_id ?? null)
                            || $bundleOptionTitle !== '';

                        if ($isBundleOption && !$this->isVisibleBundleOptionAssignment($row, $visibleBundleOptionsByProduct)) {
                            return null;
                        }

                        $productId = $isBundleOption
                            ? (int) $row->product_id
                            : (int) ($row->parent_product_id ?: $row->product_id);
                        $optionKey = $bundleOptionUid !== ''
                            ? 'uid:' . $bundleOptionUid
                            : ($bundleOptionKey !== ''
                                ? $bundleOptionKey
                                : (filled($row->bundle_option_post_id ?? null)
                                    ? 'post:' . (int) $row->bundle_option_post_id
                                    : 'title:' . strtolower($bundleOptionTitle)));

                        return $isBundleOption
                            ? "bundle_option:{$productId}:{$optionKey}"
                            : "product:{$productId}";
                    })
                    ->filter()
                    ->unique()
                    ->values();
            });
    }

    protected function buildStorefrontCategoryDescendantIdMap(array $categoryIds, $accountId = null, bool $includeLinkOnlyDescendants = false, ?array $storeIds = null, ?array $accountIds = null): array
    {
        $rootIds = collect($categoryIds)
            ->map(fn ($categoryId) => is_numeric($categoryId) ? (int) $categoryId : null)
            ->filter()
            ->unique()
            ->values();

        if ($rootIds->isEmpty()) {
            return [];
        }

        $allCategoriesQuery = Category::withoutGlobalScope('account_id')
            ->where('status', true)
            ->when(!$includeLinkOnlyDescendants, fn ($query) => $query->publiclyListed());
        StorefrontDomainScope::applyAccountScope($allCategoriesQuery, $accountId, $accountIds, 'categories.account_id');
        StorefrontDomainScope::applyStoreScope($allCategoriesQuery, $storeIds, 'categories.store_id');
        $allCategories = $allCategoriesQuery->get(['id', 'parent_id']);

        $childrenByParent = $allCategories->groupBy(fn ($category) => (int) ($category->parent_id ?? 0));
        $collectDescendants = function (int $categoryId) use (&$collectDescendants, $childrenByParent): array {
            $ids = [$categoryId];

            foreach ($childrenByParent->get($categoryId, collect()) as $child) {
                $ids = array_merge($ids, $collectDescendants((int) $child->id));
            }

            return array_values(array_unique($ids));
        };

        return $rootIds
            ->mapWithKeys(fn ($categoryId) => [$categoryId => $collectDescendants($categoryId)])
            ->all();
    }

    private function publicCategoryTreePayload(Request $request, $accountId = null, ?array $storeIds = null, ?array $accountIds = null): ?array
    {
        if (!Schema::hasTable('public_category_nodes') || !Schema::hasTable('public_category_node_categories')) {
            return null;
        }

        $domain = StorefrontDomainScope::resolvePublicDomainForRequest($request);
        if (!$domain) {
            return null;
        }

        $nodes = PublicCategoryNode::query()
            ->with(['categories' => function ($query) {
                $query->withoutGlobalScope('account_id')
                    ->select('categories.id', 'categories.account_id', 'categories.store_id', 'categories.parent_id', 'categories.name', 'categories.slug', 'categories.visibility', 'categories.logo_path', 'categories.banner_path');
            }])
            ->where('site_domain_id', $domain->id)
            ->where('status', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        if ($nodes->isEmpty()) {
            return null;
        }

        $nodesById = $nodes->keyBy(fn (PublicCategoryNode $node) => (int) $node->id);
        $childrenByParent = $nodes->groupBy(fn (PublicCategoryNode $node) => (int) ($node->parent_id ?? 0));
        $directCategoryIdsByNode = $nodes->mapWithKeys(fn (PublicCategoryNode $node) => [
            (int) $node->id => $node->categories
                ->pluck('id')
                ->map(fn ($categoryId) => (int) $categoryId)
                ->values()
                ->all(),
        ])->all();

        $sourceCategoryIds = collect($directCategoryIdsByNode)
            ->flatten()
            ->map(fn ($categoryId) => (int) $categoryId)
            ->filter()
            ->unique()
            ->values()
            ->all();

        $categoryDescendantIdMap = $this->buildStorefrontCategoryDescendantIdMap(
            $sourceCategoryIds,
            $accountId,
            true,
            $storeIds,
            $accountIds
        );
        $queryCategoryIds = collect($categoryDescendantIdMap)
            ->flatten()
            ->map(fn ($categoryId) => (int) $categoryId)
            ->filter()
            ->unique()
            ->values()
            ->all();
        $itemKeysByCategory = $this->buildStorefrontItemKeysByCategory($queryCategoryIds, $accountId, $storeIds, $accountIds);

        $collectPublicNodeIds = function (int $nodeId) use (&$collectPublicNodeIds, $childrenByParent): array {
            $ids = [$nodeId];

            foreach ($childrenByParent->get($nodeId, collect()) as $child) {
                $ids = array_merge($ids, $collectPublicNodeIds((int) $child->id));
            }

            return array_values(array_unique($ids));
        };

        $effectiveCategoryIdsByNode = [];
        $productCountsByNode = [];

        foreach ($nodes as $node) {
            $nodeIds = $collectPublicNodeIds((int) $node->id);
            $nodeSourceCategoryIds = collect($nodeIds)
                ->flatMap(fn ($nodeId) => $directCategoryIdsByNode[(int) $nodeId] ?? [])
                ->map(fn ($categoryId) => (int) $categoryId)
                ->filter()
                ->unique()
                ->values()
                ->all();

            $effectiveCategoryIdsByNode[(int) $node->id] = $nodeSourceCategoryIds;
            $productCountsByNode[(int) $node->id] = collect($nodeSourceCategoryIds)
                ->flatMap(fn ($categoryId) => $categoryDescendantIdMap[(int) $categoryId] ?? [(int) $categoryId])
                ->flatMap(fn ($categoryId) => $itemKeysByCategory->get((int) $categoryId, collect()))
                ->unique()
                ->count();
        }

        $buildPayload = function (PublicCategoryNode $node) use (&$buildPayload, $childrenByParent, $directCategoryIdsByNode, $effectiveCategoryIdsByNode, $productCountsByNode): array {
            $firstSourceCategory = $node->categories->first();

            return [
                'id' => 'public-' . (int) $node->id,
                'public_category_node_id' => (int) $node->id,
                'is_public_node' => true,
                'name' => $node->title,
                'title' => $node->title,
                'slug' => $node->slug,
                'parent_id' => $node->parent_id ? 'public-' . (int) $node->parent_id : null,
                'status' => (bool) $node->status,
                'order' => (int) $node->sort_order,
                'sort_order' => (int) $node->sort_order,
                'visibility' => Category::VISIBILITY_PUBLIC,
                'source_category_ids' => $directCategoryIdsByNode[(int) $node->id] ?? [],
                'effective_category_ids' => $effectiveCategoryIdsByNode[(int) $node->id] ?? [],
                'products_count' => $productCountsByNode[(int) $node->id] ?? 0,
                'logo_path' => $firstSourceCategory?->logo_path,
                'banner_path' => $firstSourceCategory?->banner_path,
                'children' => $childrenByParent
                    ->get((int) $node->id, collect())
                    ->map(fn (PublicCategoryNode $child) => $buildPayload($child))
                    ->values()
                    ->all(),
            ];
        };

        $rootPayload = $childrenByParent
            ->get(0, collect())
            ->map(fn (PublicCategoryNode $node) => $buildPayload($node))
            ->values()
            ->all();
        $flatPayload = [];
        $flattenPayload = function (array $items) use (&$flattenPayload, &$flatPayload): void {
            foreach ($items as $item) {
                $children = $item['children'] ?? [];
                $flatPayload[] = $item;
                $flattenPayload($children);
            }
        };
        $flattenPayload($rootPayload);

        return [
            'nodes' => $nodesById,
            'payload' => $flatPayload,
            'tree_payload' => $rootPayload,
        ];
    }

    private function publicCategoryNodePayloadForSlug(Request $request, string $slug, $accountId = null, ?array $storeIds = null, ?array $accountIds = null): ?array
    {
        $tree = $this->publicCategoryTreePayload($request, $accountId, $storeIds, $accountIds);
        if (!$tree) {
            return null;
        }

        $findBySlug = function (array $nodes) use (&$findBySlug, $slug): ?array {
            foreach ($nodes as $node) {
                if (($node['slug'] ?? null) === $slug) {
                    return $node;
                }

                $match = $findBySlug($node['children'] ?? []);
                if ($match) {
                    return $match;
                }
            }

            return null;
        };

        return $findBySlug($tree['payload']);
    }

    public function index(Request $request)
    {
        $timings = [];
        $stepStartedAt = microtime(true);
        $accountId = $this->getAccountId($request);
        $accountIds = StorefrontDomainScope::resolveAccountIds($request, $accountId);
        $storeIds = StorefrontDomainScope::resolveStoreIds($request, $accountId, $accountIds);
        $stepStartedAt = $this->markTiming($timings, 'account', $stepStartedAt);

        $cacheKey = 'web_api_categories:index:' . ($accountId ?? 'all') . ':' . StorefrontDomainScope::cacheSegment($request, $storeIds, $accountIds);
        $categories = Cache::remember($cacheKey, 60, function () use ($request, $accountId, $storeIds, $accountIds) {
            $publicTree = $this->publicCategoryTreePayload($request, $accountId, $storeIds, $accountIds);
            if ($publicTree) {
                return $publicTree['payload'];
            }

            $categoryQuery = Category::withoutGlobalScope('account_id')
                ->where('status', true)
                ->publiclyListed()
                ->orderBy('account_id', 'asc')
                ->orderBy('order', 'asc')
                ->orderBy('id', 'asc'); // Stable sorting
            StorefrontDomainScope::applyAccountScope($categoryQuery, $accountId, $accountIds, 'categories.account_id');
            StorefrontDomainScope::applyStoreScope($categoryQuery, $storeIds, 'categories.store_id');
            $categories = $categoryQuery->get();

            $this->applyStorefrontCategoryItemCounts($categories, $accountId, false, $storeIds, $accountIds);

            return $categories
                ->values()
                ->map(function (Category $category, int $index) {
                    $payload = $category->toArray();
                    $payload['sort_order'] = $index;
                    $payload['public_sort_order'] = $index;

                    return $payload;
                })
                ->all();
        });
        $this->markTiming($timings, 'categories', $stepStartedAt);

        return $this->timedJsonResponse($categories, $timings);
    }

    public function show(Request $request, $slug)
    {
        $timings = [];
        $stepStartedAt = microtime(true);
        $accountId = $this->getAccountId($request);
        $accountIds = StorefrontDomainScope::resolveAccountIds($request, $accountId);
        $storeIds = StorefrontDomainScope::resolveStoreIds($request, $accountId, $accountIds);
        $stepStartedAt = $this->markTiming($timings, 'account', $stepStartedAt);

        $cacheKey = 'web_api_categories:show:' . ($accountId ?? 'all') . ':' . StorefrontDomainScope::cacheSegment($request, $storeIds, $accountIds) . ':' . $slug;
        $category = Cache::remember($cacheKey, 60, function () use ($request, $accountId, $storeIds, $accountIds, $slug) {
            $publicNode = $this->publicCategoryNodePayloadForSlug($request, $slug, $accountId, $storeIds, $accountIds);
            if ($publicNode) {
                return $publicNode;
            }

            $categoryQuery = Category::withoutGlobalScope('account_id')
                ->where('slug', $slug)
                ->with(['children' => function($q) use ($accountId, $accountIds, $storeIds) {
                    $q->withoutGlobalScope('account_id');
                    $q->where('status', true)->publiclyListed()->orderBy('order');
                    StorefrontDomainScope::applyAccountScope($q, $accountId, $accountIds, 'categories.account_id');
                    StorefrontDomainScope::applyStoreScope($q, $storeIds, 'categories.store_id');
                }]);
            StorefrontDomainScope::applyAccountScope($categoryQuery, $accountId, $accountIds, 'categories.account_id');
            StorefrontDomainScope::applyStoreScope($categoryQuery, $storeIds, 'categories.store_id');
            $category = $categoryQuery->firstOrFail();

            $this->applyStorefrontCategoryItemCounts(
                collect([$category])->merge($category->children),
                $accountId,
                $category->isLinkOnly(),
                $storeIds,
                $accountIds
            );

            return $category->toArray();
        });
        $this->markTiming($timings, 'category', $stepStartedAt);

        return $this->timedJsonResponse($category, $timings);
    }
}
