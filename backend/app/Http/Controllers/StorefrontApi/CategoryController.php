<?php

namespace App\Http\Controllers\StorefrontApi;

use App\Http\Controllers\Controller;
use App\Models\Category;
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

    protected function applyStorefrontCategoryItemCounts($categories, $accountId = null, bool $includeLinkOnlyDescendants = false): void
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

        $categoryDescendantIdMap = $this->buildStorefrontCategoryDescendantIdMap($categoryIds->all(), $accountId, $includeLinkOnlyDescendants);
        $queryCategoryIds = collect($categoryDescendantIdMap)
            ->flatten()
            ->map(fn ($categoryId) => (int) $categoryId)
            ->filter()
            ->unique()
            ->values();

        $assignmentRows = DB::table('category_product')
            ->join('products', 'products.id', '=', 'category_product.product_id')
            ->leftJoin('product_links as super_links', function ($join) {
                $join->on('super_links.linked_product_id', '=', 'category_product.product_id')
                    ->where('super_links.link_type', '=', 'super_link');
            })
            ->when($accountId, fn ($query) => $query->where('products.account_id', $accountId))
            ->whereIn('category_product.category_id', $queryCategoryIds->all())
            ->where(function ($query) {
                $query
                    ->whereIn('category_product.item_type', ['product', 'bundle_option'])
                    ->orWhereNull('category_product.item_type');
            })
            ->where('products.status', true)
            ->whereNull('products.deleted_at')
            ->get([
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

        $itemKeysByCategory = $assignmentRows
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

        $normalizedCategories->each(function ($category) use ($categoryDescendantIdMap, $itemKeysByCategory) {
            $itemKeys = collect($categoryDescendantIdMap[(int) $category->id] ?? [(int) $category->id])
                ->flatMap(fn ($categoryId) => $itemKeysByCategory->get((int) $categoryId, collect()))
                ->unique();

            $category->setAttribute('products_count', $itemKeys->count());
        });
    }

    protected function buildStorefrontCategoryDescendantIdMap(array $categoryIds, $accountId = null, bool $includeLinkOnlyDescendants = false): array
    {
        $rootIds = collect($categoryIds)
            ->map(fn ($categoryId) => is_numeric($categoryId) ? (int) $categoryId : null)
            ->filter()
            ->unique()
            ->values();

        if ($rootIds->isEmpty()) {
            return [];
        }

        $allCategories = Category::query()
            ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
            ->where('status', true)
            ->when(!$includeLinkOnlyDescendants, fn ($query) => $query->publiclyListed())
            ->get(['id', 'parent_id']);

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

    public function index(Request $request)
    {
        $timings = [];
        $stepStartedAt = microtime(true);
        $accountId = $this->getAccountId($request);
        $stepStartedAt = $this->markTiming($timings, 'account', $stepStartedAt);

        $cacheKey = 'web_api_categories:index:' . ($accountId ?? 'all');
        $categories = Cache::remember($cacheKey, 60, function () use ($accountId) {
            $categories = Category::query()
                ->when($accountId, fn($q) => $q->where('account_id', $accountId))
                ->where('status', true)
                ->publiclyListed()
                ->orderBy('order', 'asc')
                ->orderBy('id', 'asc') // Stable sorting
                ->get();

            $this->applyStorefrontCategoryItemCounts($categories, $accountId);

            return $categories->toArray();
        });
        $this->markTiming($timings, 'categories', $stepStartedAt);

        return $this->timedJsonResponse($categories, $timings);
    }

    public function show(Request $request, $slug)
    {
        $timings = [];
        $stepStartedAt = microtime(true);
        $accountId = $this->getAccountId($request);
        $stepStartedAt = $this->markTiming($timings, 'account', $stepStartedAt);

        $cacheKey = 'web_api_categories:show:' . ($accountId ?? 'all') . ':' . $slug;
        $category = Cache::remember($cacheKey, 60, function () use ($accountId, $slug) {
            $category = Category::query()
                ->when($accountId, fn($q) => $q->where('account_id', $accountId))
                ->where('slug', $slug)
                ->with(['children' => function($q) {
                    $q->where('status', true)->publiclyListed()->orderBy('order');
                }])
                ->firstOrFail();

            $this->applyStorefrontCategoryItemCounts(
                collect([$category])->merge($category->children),
                $accountId,
                $category->isLinkOnly()
            );

            return $category->toArray();
        });
        $this->markTiming($timings, 'category', $stepStartedAt);

        return $this->timedJsonResponse($category, $timings);
    }
}
