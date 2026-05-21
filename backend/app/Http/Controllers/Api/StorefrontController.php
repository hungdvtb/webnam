<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\Category;
use App\Models\Banner;
use App\Models\Post;
use App\Models\ProductReview;
use App\Services\Leads\LeadCaptureService;
use App\Services\Analytics\SiteAnalyticsService;
use App\Services\Analytics\MetaConversionsApiService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class StorefrontController extends Controller
{
    protected function applyVisibleBundleOptionConstraint($query): void
    {
        if (!Schema::hasColumn('product_links', 'bundle_option_status')) {
            return;
        }

        $query->where(function ($visibleQuery) {
            $visibleQuery
                ->whereNull('product_links.bundle_option_status')
                ->orWhere('product_links.bundle_option_status', '<>', 'internal');
        });
    }

    protected function normalizeStorefrontBundleOptionKey($optionPostId, ?string $optionTitle): string
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

    protected function bundleOptionListKeys($optionPostId, ?string $optionTitle, ?string $optionKey = null): array
    {
        $title = Str::squish((string) $optionTitle);
        $keys = [
            trim((string) $optionKey),
            $this->normalizeStorefrontBundleOptionKey($optionPostId, $title),
            filled($optionPostId) && is_numeric($optionPostId) ? 'post:' . (int) $optionPostId : '',
            $title !== '' ? 'title:' . Str::lower($title) : '',
        ];

        return collect($keys)
            ->map(fn ($key) => trim((string) $key))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    protected function buildVisibleBundleOptionLookup($products): array
    {
        $productIds = collect($products)
            ->filter(function ($product) {
                return ($product->item_type ?? '') === 'bundle_option'
                    || trim((string) ($product->bundle_option_key ?? '')) !== ''
                    || filled($product->bundle_option_post_id ?? null)
                    || Str::squish((string) ($product->bundle_option_title ?? '')) !== '';
            })
            ->pluck('id')
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values();

        if ($productIds->isEmpty()) {
            return [];
        }

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
            ->get(['product_id', 'option_post_id', 'option_title']);

        $lookup = [];
        foreach ($rows as $row) {
            $productId = (int) $row->product_id;
            $lookup[$productId] ??= [];

            foreach ($this->bundleOptionListKeys($row->option_post_id ?? null, $row->option_title ?? null) as $key) {
                $lookup[$productId][$key] = true;
            }
        }

        return $lookup;
    }

    protected function isVisibleBundleOptionListProduct(Product $product, array $visibleBundleOptions): bool
    {
        $bundleOptionKey = trim((string) ($product->bundle_option_key ?? ''));
        $bundleOptionTitle = Str::squish((string) ($product->bundle_option_title ?? ''));
        $isBundleOption = ($product->item_type ?? '') === 'bundle_option'
            || $bundleOptionKey !== ''
            || filled($product->bundle_option_post_id ?? null)
            || $bundleOptionTitle !== '';

        if (!$isBundleOption) {
            return true;
        }

        $productId = (int) $product->id;
        if (empty($visibleBundleOptions[$productId])) {
            return false;
        }

        foreach ($this->bundleOptionListKeys($product->bundle_option_post_id ?? null, $bundleOptionTitle, $bundleOptionKey) as $key) {
            if (!empty($visibleBundleOptions[$productId][$key])) {
                return true;
            }
        }

        return false;
    }

    protected function getOrderedCategoryIds(Category $category, $accountId = null): array
    {
        $ids = [(int) $category->id];

        $children = Category::query()
            ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
            ->where('parent_id', $category->id)
            ->orderBy('order')
            ->orderBy('id')
            ->get(['id']);

        foreach ($children as $child) {
            $ids = array_merge($ids, $this->getOrderedCategoryIds($child, $accountId));
        }

        return $ids;
    }

    protected function joinCategoryOrdering(Builder $query, array $categoryIds, string $alias = 'category_sorting'): void
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

    protected function joinCategoryAssignments(Builder $query, array $categoryIds, string $alias = 'category_assignments'): void
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
            ->leftJoin('product_links as super_links', function ($join) {
                $join->on('super_links.linked_product_id', '=', 'category_product.product_id')
                    ->where('super_links.link_type', '=', 'super_link');
            })
            ->selectRaw("{$resolvedProductIdSql} as product_id")
            ->selectRaw("{$itemTypeSql} as item_type")
            ->selectRaw("COALESCE(category_product.bundle_option_key, '') as bundle_option_key")
            ->selectRaw('category_product.bundle_option_post_id')
            ->selectRaw('category_product.bundle_option_title')
            ->selectRaw("MIN((CASE category_product.category_id {$caseSql} ELSE 999999 END) * 1000000 + COALESCE(category_product.sort_order, 999999)) as category_order_key")
            ->whereIn('category_product.category_id', $normalizedCategoryIds)
            ->whereIn('category_product.item_type', ['product', 'bundle_option'])
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

    protected function applyStorefrontCategoryItemCounts($categories, $accountId = null): void
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

        $categoryDescendantIdMap = $this->buildStorefrontCategoryDescendantIdMap($categoryIds->all(), $accountId);
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
                'category_product.bundle_option_key',
                'category_product.bundle_option_post_id',
                'category_product.bundle_option_title',
                'super_links.product_id as parent_product_id',
            ]);

        $itemKeysByCategory = $assignmentRows
            ->groupBy(fn ($row) => (int) $row->category_id)
            ->map(function ($rows) {
                return $rows
                    ->map(function ($row) {
                        $bundleOptionKey = trim((string) ($row->bundle_option_key ?? ''));
                        $bundleOptionTitle = trim((string) ($row->bundle_option_title ?? ''));
                        $isBundleOption = (string) ($row->item_type ?? '') === 'bundle_option'
                            || $bundleOptionKey !== ''
                            || filled($row->bundle_option_post_id ?? null)
                            || $bundleOptionTitle !== '';
                        $productId = $isBundleOption
                            ? (int) $row->product_id
                            : (int) ($row->parent_product_id ?: $row->product_id);
                        $optionKey = $bundleOptionKey !== ''
                            ? $bundleOptionKey
                            : (filled($row->bundle_option_post_id ?? null)
                                ? 'post:' . (int) $row->bundle_option_post_id
                                : 'title:' . strtolower($bundleOptionTitle));

                        return $isBundleOption
                            ? "bundle_option:{$productId}:{$optionKey}"
                            : "product:{$productId}";
                    })
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

    protected function buildStorefrontCategoryDescendantIdMap(array $categoryIds, $accountId = null): array
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

    protected function normalizeStorefrontAdditionalInfoPayload($rawValue): array
    {
        if ($rawValue === null || $rawValue === '' || $rawValue === []) {
            return [];
        }

        if (is_string($rawValue)) {
            $decoded = json_decode($rawValue, true);
            $rawValue = json_last_error() === JSON_ERROR_NONE ? $decoded : [];
        }

        if (!is_array($rawValue)) {
            return [];
        }

        return collect($rawValue)
            ->map(function ($item) {
                if (is_object($item)) {
                    $item = (array) $item;
                }

                if (!is_array($item)) {
                    return null;
                }

                $postId = filled($item['post_id'] ?? null) && is_numeric($item['post_id'])
                    ? (int) $item['post_id']
                    : null;

                return [
                    'title' => trim((string) ($item['title'] ?? '')),
                    'display_text' => trim((string) ($item['display_text'] ?? '')),
                    'post_id' => $postId,
                    'post_title' => trim((string) ($item['post_title'] ?? '')),
                    'post_slug' => trim((string) ($item['post_slug'] ?? '')),
                ];
            })
            ->filter(fn ($item) => is_array($item) && !empty($item['post_id']))
            ->values()
            ->all();
    }

    protected function truncateAdditionalInfoDisplayText(string $value, int $maxLength = 72): string
    {
        $normalized = trim((string) preg_replace('/\s+/u', ' ', $value));

        if ($normalized === '') {
            return '';
        }

        if (mb_strlen($normalized) <= $maxLength) {
            return $normalized;
        }

        $truncated = trim(mb_substr($normalized, 0, max(1, $maxLength - 1)));
        $lastSpace = mb_strrpos($truncated, ' ');

        if ($lastSpace !== false && $lastSpace >= (int) floor($maxLength * 0.6)) {
            $truncated = trim(mb_substr($truncated, 0, $lastSpace));
        }

        return rtrim($truncated, " \t\n\r\0\x0B,.;:-") . '...';
    }

    protected function resolveAdditionalInfoDisplayText(array $item, ?Post $linkedPost): string
    {
        $manualDisplayText = trim((string) ($item['display_text'] ?? ''));

        if ($manualDisplayText !== '') {
            return $manualDisplayText;
        }

        $postTitle = trim((string) ($linkedPost?->title ?? ($item['post_title'] ?? '')));

        return $this->truncateAdditionalInfoDisplayText($postTitle);
    }

    protected function mapStorefrontImages(Product $product): array
    {
        return $product->images->map(fn ($img) => [
            'id' => $img->id,
            'url' => $img->large_url ?: $img->image_url,
            'path' => $img->large_url ?: $img->image_url,
            'image_url' => $img->image_url,
            'thumbnail_url' => $img->thumbnail_url,
            'medium_url' => $img->medium_url,
            'large_url' => $img->large_url,
            'width' => $img->width,
            'height' => $img->height,
            'srcset' => $img->srcset,
            'is_primary' => $img->is_primary,
        ])->values()->all();
    }

    protected function mapStorefrontImageUrl(?string $imageUrl): ?array
    {
        $normalizedImageUrl = trim((string) $imageUrl);

        if ($normalizedImageUrl === '') {
            return null;
        }

        return [
            'url' => $normalizedImageUrl,
            'path' => $normalizedImageUrl,
            'image_url' => $normalizedImageUrl,
            'thumbnail_url' => $normalizedImageUrl,
            'medium_url' => $normalizedImageUrl,
            'large_url' => $normalizedImageUrl,
            'is_primary' => true,
        ];
    }

    protected function collectBundleOptionImages($products): array
    {
        $productIds = collect($products)
            ->filter(function ($product) {
                $bundleOptionKey = trim((string) ($product->bundle_option_key ?? ''));
                $bundleOptionTitle = Str::squish((string) ($product->bundle_option_title ?? ''));

                return ($product->item_type ?? '') === 'bundle_option'
                    || $bundleOptionKey !== ''
                    || filled($product->bundle_option_post_id ?? null)
                    || $bundleOptionTitle !== '';
            })
            ->pluck('id')
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values();

        if ($productIds->isEmpty()) {
            return [];
        }

        return Product::query()
            ->whereIn('id', $productIds->all())
            ->with(['bundleItems' => function ($query) {
                $this->applyVisibleBundleOptionConstraint($query);
            }])
            ->get(['id'])
            ->mapWithKeys(function (Product $product) {
                $optionImages = [];

                foreach ($product->bundleItems as $bundleItem) {
                    $optionImage = trim((string) ($bundleItem->pivot?->option_image_url ?? ''));

                    if ($optionImage === '') {
                        continue;
                    }

                    $optionPostId = filled($bundleItem->pivot?->option_post_id ?? null)
                        ? (int) $bundleItem->pivot->option_post_id
                        : null;
                    $optionTitle = Str::squish((string) ($bundleItem->pivot?->option_title ?? ''));
                    $optionKey = $this->normalizeStorefrontBundleOptionKey($optionPostId, $optionTitle);

                    $optionImages[$optionKey] ??= $optionImage;

                    if ($optionTitle !== '') {
                        $optionImages['title:' . Str::lower($optionTitle)] ??= $optionImage;
                    }

                    if ($optionPostId) {
                        $optionImages['post:' . $optionPostId] ??= $optionImage;
                    }
                }

                return [(int) $product->id => $optionImages];
            })
            ->all();
    }

    protected function resolveBundleOptionImageFromMap(Product $product, array $bundleOptionImages): ?array
    {
        $productOptionImages = $bundleOptionImages[(int) $product->id] ?? [];

        if (!$productOptionImages) {
            return null;
        }

        $optionKey = trim((string) ($product->bundle_option_key ?? ''));
        $optionPostId = filled($product->bundle_option_post_id ?? null)
            ? (int) $product->bundle_option_post_id
            : null;
        $optionTitle = Str::squish((string) ($product->bundle_option_title ?? ''));

        $candidates = collect([
            $optionKey,
            $this->normalizeStorefrontBundleOptionKey($optionPostId, $optionTitle),
            $optionPostId ? 'post:' . $optionPostId : '',
            $optionTitle !== '' ? 'title:' . Str::lower($optionTitle) : '',
        ])
            ->map(fn ($key) => trim((string) $key))
            ->filter()
            ->unique();

        foreach ($candidates as $candidate) {
            if (!empty($productOptionImages[$candidate])) {
                return $this->mapStorefrontImageUrl($productOptionImages[$candidate]);
            }
        }

        return null;
    }

    protected function mapStorefrontAttributes(Product $product): array
    {
        return $product->attributeValues->map(fn ($av) => [
            'id' => $av->attribute_id,
            'name' => $av->attribute?->name,
            'code' => $av->attribute?->code,
            'value' => $av->value,
            'type' => $av->attribute?->frontend_type,
        ])->values()->all();
    }

    protected function mapStorefrontSuperAttributes(Product $product): array
    {
        return $product->superAttributes->map(fn ($sa) => [
            'id' => $sa->id,
            'name' => $sa->name,
            'code' => $sa->code,
            'type' => $sa->frontend_type,
            'options' => $sa->options->map(fn ($o) => [
                'id' => $o->id,
                'value' => $o->value,
                'swatch' => $o->swatch_value,
            ])->values()->all(),
        ])->values()->all();
    }

    protected function mapStorefrontVariant(Product $variant): array
    {
        return [
            'id' => $variant->id,
            'name' => $variant->name,
            'sku' => $variant->sku,
            'type' => $variant->type,
            'price' => $variant->price,
            'current_price' => $variant->current_price,
            'stock_quantity' => $variant->stock_quantity,
            'main_image' => $variant->main_image,
            'primary_image' => $variant->primary_image,
            'images' => $this->mapStorefrontImages($variant),
            'attributes' => collect($this->mapStorefrontAttributes($variant))
                ->map(fn ($attribute) => [
                    'id' => $attribute['id'],
                    'name' => $attribute['name'],
                    'code' => $attribute['code'],
                    'value' => $attribute['value'],
                    'type' => $attribute['type'],
                ])
                ->values()
                ->all(),
        ];
    }
    /**
     * GET /api/storefront/categories
     * Public: Danh mục dạng cây cho website
     */
    public function categories(Request $request)
    {
        $accountId = $request->header('X-Account-Id');

        $categories = Category::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true)
            ->orderBy('order')
            ->get(['id', 'name', 'slug', 'parent_id', 'description', 'order', 'logo_path']);

        $this->applyStorefrontCategoryItemCounts($categories, $accountId);

        // Build tree structure
        $tree = $this->buildCategoryTree($categories);

        return response()->json($tree);
    }

    /**
     * GET /api/storefront/products
     * Public: Danh sách sản phẩm phân trang, hỗ trợ filter
     */
    public function products(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        $selectedCategoryIds = [];

        $query = Product::query()
            ->select('products.*')
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true)
            ->with(['images' => function ($q) {
                $q->orderBy('is_primary', 'desc')->orderBy('sort_order');
            }, 'category:id,name,slug']);

        // Filter by category slug
        if ($request->filled('category')) {
            $cat = Category::query()
                ->when($accountId, fn ($categoryQuery) => $categoryQuery->where('account_id', $accountId))
                ->where('slug', $request->category)
                ->first();
            if ($cat) {
                $selectedCategoryIds = $this->getOrderedCategoryIds($cat, $accountId);
            }
        }

        // Filter by category_id
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
        } else {
            $query->whereDoesntHave('parentConfigurable');
        }

        // Search
        if ($request->filled('search')) {
            $s = $request->search;
            $query->where(function ($q) use ($s) {
                $q->where('name', 'like', "%{$s}%")
                  ->orWhere('sku', 'like', "%{$s}%");
            });
        }

        // Price range
        if ($request->filled('min_price')) $query->where('price', '>=', $request->min_price);
        if ($request->filled('max_price')) $query->where('price', '<=', $request->max_price);

        // Featured
        if ($request->has('featured')) $query->where('is_featured', true);

        // New arrivals
        if ($request->has('new')) $query->where('is_new', true);

        // Attribute filter: ?attr[1]=val1,val2&attr[3]=val3
        if ($request->filled('attr')) {
            foreach ($request->attr as $attrId => $values) {
                $vals = is_array($values) ? $values : explode(',', $values);
                $query->whereHas('attributeValues', function ($q) use ($attrId, $vals) {
                    $q->where('attribute_id', $attrId)->whereIn('value', $vals);
                });
            }
        }

        // Sort
        $sortMap = [
            'newest' => ['created_at', 'desc'],
            'price_asc' => ['price', 'asc'],
            'price_desc' => ['price', 'desc'],
            'name_asc' => ['name', 'asc'],
            'popular' => ['is_featured', 'desc'],
        ];
        $sort = $sortMap[$request->get('sort', 'newest')] ?? ['created_at', 'desc'];

        $sortKey = $request->get('sort', 'newest');
        $prioritizeCategoryOrder = !empty($selectedCategoryIds) && in_array($sortKey, ['newest', 'popular'], true);

        if ($prioritizeCategoryOrder) {
            $query->orderBy('category_order_key');
        }

        if (in_array($sortKey, ['newest', 'popular'], true)) {
            $query->orderBy('products.sort_order', 'asc');
        }

        $query->orderBy($sort[0], $sort[1]);

        if (!$prioritizeCategoryOrder && !empty($selectedCategoryIds)) {
            $query->orderBy('category_order_key');
        }

        $query->orderByDesc('products.id');

        $perPage = min((int) $request->get('per_page', 20), 60);
        $products = $query->paginate($perPage);
        $visibleBundleOptions = $this->buildVisibleBundleOptionLookup($products->getCollection());
        $products->setCollection(
            $products->getCollection()
                ->filter(fn (Product $product) => $this->isVisibleBundleOptionListProduct($product, $visibleBundleOptions))
                ->values()
        );

        $bundleOptionImages = $this->collectBundleOptionImages($products->getCollection());

        // Slim response: only essential fields
        $products->getCollection()->transform(function ($p) use ($bundleOptionImages) {
            $bundleOptionKey = trim((string) ($p->bundle_option_key ?? ''));
            $bundleOptionTitle = Str::squish((string) ($p->bundle_option_title ?? ''));
            $itemType = (
                ($p->item_type ?? '') === 'bundle_option'
                || $bundleOptionKey !== ''
                || filled($p->bundle_option_post_id ?? null)
                || $bundleOptionTitle !== ''
            ) ? 'bundle_option' : 'product';
            $bundleOptionImage = $itemType === 'bundle_option'
                ? $this->resolveBundleOptionImageFromMap($p, $bundleOptionImages)
                : null;
            $primaryImage = $bundleOptionImage ?: $p->primary_image;
            $mainImage = $bundleOptionImage['url'] ?? $p->main_image;

            return [
                'id' => $p->id,
                'name' => $p->name,
                'slug' => $p->slug,
                'sku' => $p->sku,
                'price' => $p->price,
                'current_price' => $p->current_price,
                'special_price' => $p->special_price,
                'main_image' => $mainImage,
                'category' => $p->category ? ['id' => $p->category->id, 'name' => $p->category->name, 'slug' => $p->category->slug] : null,
                'is_featured' => $p->is_featured,
                'is_new' => $p->is_new,
                'stock_quantity' => $p->stock_quantity,
                'average_rating' => round($p->average_rating, 1),
                'primary_image' => $primaryImage,
                'specifications' => $p->specifications,
                'item_type' => $itemType,
                'bundle_option_key' => $bundleOptionKey !== '' ? $bundleOptionKey : null,
                'bundle_option_post_id' => filled($p->bundle_option_post_id ?? null) ? (int) $p->bundle_option_post_id : null,
                'bundle_option_title' => $itemType === 'bundle_option' ? $bundleOptionTitle : null,
                'bundle_option_image_url' => $bundleOptionImage['url'] ?? null,
            ];
        });

        return response()->json($products);
    }

    /**
     * GET /api/storefront/products/{slug}
     * Public: Chi tiết sản phẩm theo slug hoặc id
     */
    public function productDetail(Request $request, $slugOrId)
    {
        $accountId = $request->header('X-Account-Id');

        $query = Product::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true)
            ->with([
                'images' => fn($q) => $q->orderBy('is_primary', 'desc')->orderBy('sort_order'),
                'category:id,name,slug',
                'attributeValues.attribute',
                'approvedReviews' => fn($q) => $q->latest()->limit(20),
                'superAttributes.options',
                'linkedProducts' => fn($q) => $q->where('status', true)->with(['images', 'attributeValues.attribute']),
                'bundleItems' => function ($q) {
                    $q->where('status', true);
                    $this->applyVisibleBundleOptionConstraint($q);
                    $q->with([
                        'images',
                        'category',
                        'attributeValues.attribute',
                        'superAttributes.options',
                        'variations' => fn($variantQuery) => $variantQuery
                            ->where('status', true)
                            ->with(['images', 'attributeValues.attribute']),
                    ]);
                },
                'groupedItems' => fn($q) => $q->where('status', true)->with(['images', 'category', 'attributeValues.attribute']),
            ]);

        // Try slug first, then id
        $product = $query->where('slug', $slugOrId)->first();
        if (!$product) {
            $product = $query->where('id', $slugOrId)->firstOrFail();
        }

        $additionalInfoItems = collect(
            $this->normalizeStorefrontAdditionalInfoPayload($product->additional_info)
        );

        $bundleOptionPostIds = $product->type === 'bundle'
            ? $product->bundleItems
                ->pluck('pivot.option_post_id')
                ->filter(fn ($postId) => filled($postId))
                ->map(fn ($postId) => (int) $postId)
                ->unique()
                ->values()
            : collect();

        $linkedPostIds = $additionalInfoItems
            ->pluck('post_id')
            ->filter(fn ($postId) => filled($postId))
            ->map(fn ($postId) => (int) $postId)
            ->merge($bundleOptionPostIds)
            ->unique()
            ->values();

        $linkedPosts = $linkedPostIds->isNotEmpty()
            ? Post::query()
                ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
                ->published()
                ->whereIn('id', $linkedPostIds)
                ->get(['id', 'title', 'slug'])
                ->keyBy('id')
            : collect();

        $variantProducts = $product->type === 'configurable'
            ? $product->linkedProducts
                ->filter(fn ($linkedProduct) => $linkedProduct->pivot?->link_type === 'super_link')
                ->values()
            : collect();

        return response()->json([
            'id' => $product->id,
            'name' => $product->name,
            'slug' => $product->slug,
            'sku' => $product->sku,
            'type' => $product->type,
            'price' => $product->price,
            'current_price' => $product->current_price,
            'special_price' => $product->special_price,
            'special_price_from' => $product->special_price_from,
            'special_price_to' => $product->special_price_to,
            'video_url' => $product->video_url,
            'video_urls' => $product->video_urls ?: ($product->video_url ? [$product->video_url] : []),
            'description' => $product->description,
            'specifications' => $product->specifications,
            'additional_info' => $additionalInfoItems->map(function ($item) use ($linkedPosts) {
                $postId = filled($item['post_id'] ?? null) ? (int) $item['post_id'] : null;
                $linkedPost = $postId ? $linkedPosts->get($postId) : null;

                if (!$linkedPost) {
                    return null;
                }

                $displayText = $this->resolveAdditionalInfoDisplayText($item, $linkedPost);
                if ($displayText === '') {
                    return null;
                }

                return [
                    'title' => trim((string) ($item['title'] ?? '')),
                    'display_text' => $displayText,
                    'post_id' => (int) $linkedPost->id,
                    'post_title' => trim((string) $linkedPost->title),
                    'post_slug' => trim((string) $linkedPost->slug),
                ];
            })->filter()->values(),
            'weight' => $product->weight,
            'stock_quantity' => $product->stock_quantity,
            'is_featured' => $product->is_featured,
            'meta_title' => $product->meta_title,
            'meta_description' => $product->meta_description,
            'average_rating' => round($product->average_rating, 1),
            'review_count' => $product->approvedReviews->count(),
            'category' => $product->category ? ['id' => $product->category->id, 'name' => $product->category->name, 'slug' => $product->category->slug] : null,
            'images' => $this->mapStorefrontImages($product),
            'attributes' => $this->mapStorefrontAttributes($product),
            'super_attributes' => $this->mapStorefrontSuperAttributes($product),
            'variants' => $variantProducts
                ->map(fn ($variant) => $this->mapStorefrontVariant($variant))
                ->values(),
            'reviews' => $product->approvedReviews->map(fn($r) => [
                'id' => $r->id,
                'customer_name' => $r->customer_name,
                'rating' => $r->rating,
                'comment' => $r->comment,
                'created_at' => $r->created_at->toDateString(),
            ]),
            'grouped_items' => $product->type === 'grouped' ? $product->groupedItems->map(fn($v) => [
                'id' => $v->id,
                'name' => $v->name,
                'sku' => $v->sku,
                'price' => $v->price,
                'current_price' => $v->current_price,
                'stock_quantity' => $v->stock_quantity,
                'quantity' => $v->pivot->quantity ?? 1,
                'is_required' => $v->pivot->is_required ?? false,
                'main_image' => $v->main_image,
                'primary_image' => $v->primary_image,
            ]) : [],
            'bundle_items' => $product->type === 'bundle'
                ? $product->bundleItems->map(function ($bundleItem) use ($linkedPosts) {
                    $selectedVariantId = $bundleItem->pivot->variant_id ? (int) $bundleItem->pivot->variant_id : null;
                    $optionPostId = filled($bundleItem->pivot->option_post_id ?? null) ? (int) $bundleItem->pivot->option_post_id : null;
                    $optionPost = $optionPostId ? $linkedPosts->get($optionPostId) : null;
                    $selectedVariant = $selectedVariantId
                        ? $bundleItem->variations->firstWhere('id', $selectedVariantId)
                        : null;

                    return [
                        'id' => $bundleItem->id,
                        'name' => $bundleItem->name,
                        'type' => $bundleItem->type,
                        'sku' => $bundleItem->sku,
                        'price' => $bundleItem->price,
                        'current_price' => $bundleItem->current_price,
                        'bundle_price' => $bundleItem->pivot->price !== null ? (float) $bundleItem->pivot->price : null,
                        'stock_quantity' => $bundleItem->stock_quantity,
                        'quantity' => $bundleItem->pivot->quantity ?? 1,
                        'is_required' => $bundleItem->pivot->is_required ?? false,
                        'option_key' => $this->normalizeStorefrontBundleOptionKey(
                            $optionPostId,
                            $bundleItem->pivot->option_title
                        ),
                        'option_title' => $bundleItem->pivot->option_title,
                        'option_post_id' => $optionPostId,
                        'option_post_title' => $optionPost?->title,
                        'option_post_slug' => $optionPost?->slug,
                        'option_image_url' => trim((string) ($bundleItem->pivot->option_image_url ?? '')) ?: null,
                        'option_image' => $this->mapStorefrontImageUrl($bundleItem->pivot->option_image_url ?? null),
                        'option_video_url' => $bundleItem->pivot->option_video_url,
                        'option_video_source' => $bundleItem->pivot->option_video_source,
                        'is_default' => $bundleItem->pivot->is_default ?? false,
                        'position' => $bundleItem->pivot->position ?? 0,
                        'selected_variant_id' => $selectedVariantId,
                        'selected_variant' => $selectedVariant ? $this->mapStorefrontVariant($selectedVariant) : null,
                        'main_image' => $selectedVariant?->main_image ?: $bundleItem->main_image,
                        'primary_image' => $selectedVariant?->primary_image ?: $bundleItem->primary_image,
                        'images' => $selectedVariant
                            ? $this->mapStorefrontImages($selectedVariant)
                            : $this->mapStorefrontImages($bundleItem),
                        'category' => $bundleItem->category ? ['id' => $bundleItem->category->id, 'name' => $bundleItem->category->name] : null,
                        'attributes' => $this->mapStorefrontAttributes($bundleItem),
                        'super_attributes' => $this->mapStorefrontSuperAttributes($bundleItem),
                        'variants' => $bundleItem->variations
                            ->map(fn ($variant) => $this->mapStorefrontVariant($variant))
                            ->values(),
                    ];
                })
                : [],
        ]);
    }

    /**
     * GET /api/storefront/products/{id}/related
     * Public: Sản phẩm liên quan
     */
    public function relatedProducts(Request $request, $idOrSlug)
    {
        $accountId = $request->header('X-Account-Id');
        $product = Product::query()
            ->when($accountId, fn($q) => $q->where('products.account_id', $accountId))
            ->with('categories:id')
            ->where(function ($query) use ($idOrSlug) {
                $query->where('products.slug', $idOrSlug);

                if (is_numeric($idOrSlug)) {
                    $query->orWhere('products.id', (int) $idOrSlug);
                }
            })
            ->firstOrFail();
        
        $limit = 8;
        
        $explicitRelated = $product->relatedProducts()
            ->when($accountId, fn($q) => $q->where('products.account_id', $accountId))
            ->where('products.status', true)
            ->with(['images' => fn($q) => $q->orderBy('is_primary', 'desc')->orderBy('sort_order')])
            ->get();

        if ($explicitRelated->isNotEmpty()) {
            $result = $explicitRelated->map(fn($p) => [
                'id' => $p->id,
                'name' => $p->name,
                'slug' => $p->slug,
                'price' => $p->price,
                'current_price' => $p->current_price,
                'main_image' => $p->main_image,
                'average_rating' => round($p->average_rating, 1),
                'primary_image' => $p->primary_image,
            ])->values();

            return response()->json($result);
        }

        $categoryIds = collect([$product->category_id])
            ->merge($product->categories->pluck('id'))
            ->filter()
            ->map(fn ($categoryId) => (int) $categoryId)
            ->unique()
            ->values();

        if ($categoryIds->isEmpty()) {
            return response()->json([]);
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
            ->with(['images' => fn($q) => $q->orderBy('is_primary', 'desc')->orderBy('sort_order')])
            ->inRandomOrder()
            ->limit($limit)
            ->get();

        $result = $fallback->map(fn($p) => [
            'id' => $p->id,
            'name' => $p->name,
            'slug' => $p->slug,
            'price' => $p->price,
            'current_price' => $p->current_price,
            'main_image' => $p->main_image,
            'average_rating' => round($p->average_rating, 1),
            'primary_image' => $p->primary_image,
        ])->values();

        return response()->json($result);
    }

    /**
     * GET /api/storefront/homepage
     * Homepage aggregate: banners + featured + new + categories
     */
    public function homepage(Request $request)
    {
        $accountId = $request->header('X-Account-Id');

        // Banners
        $banners = Banner::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->get();

        $featured = Product::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true)
            ->whereDoesntHave('parentConfigurable')
            ->where('is_featured', true)
            ->with(['images' => fn($q) => $q->orderBy('is_primary', 'desc')])
            ->latest()
            ->limit(12)
            ->get()
            ->map(fn($p) => [
                'id' => $p->id, 'name' => $p->name, 'slug' => $p->slug,
                'price' => $p->price, 'current_price' => $p->current_price,
                'main_image' => $p->main_image, 'is_new' => $p->is_new,
                'primary_image' => $p->primary_image,
            ]);

        $newArrivals = Product::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true)
            ->whereDoesntHave('parentConfigurable')
            ->with(['images' => fn($q) => $q->orderBy('is_primary', 'desc')])
            ->latest()
            ->limit(12)
            ->get()
            ->map(fn($p) => [
                'id' => $p->id, 'name' => $p->name, 'slug' => $p->slug,
                'price' => $p->price, 'current_price' => $p->current_price,
                'main_image' => $p->main_image, 'is_new' => $p->is_new,
                'primary_image' => $p->primary_image,
            ]);

        // Top categories
        $categories = Category::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true)
            ->whereNull('parent_id')
            ->orderBy('order')
            ->get(['id', 'name', 'slug', 'description', 'logo_path']);

        $this->applyStorefrontCategoryItemCounts($categories, $accountId);

        // Recent reviews
        $reviews = ProductReview::query()
            ->where('is_approved', true)
            ->with('product:id,name,slug')
            ->latest()
            ->limit(6)
            ->get()
            ->map(fn($r) => [
                'id' => $r->id,
                'customer_name' => $r->customer_name,
                'rating' => $r->rating,
                'comment' => $r->comment,
                'product' => $r->product ? ['name' => $r->product->name, 'slug' => $r->product->slug] : null,
            ]);

        return response()->json([
            'banners' => $banners,
            'featured_products' => $featured,
            'new_arrivals' => $newArrivals,
            'categories' => $categories,
            'reviews' => $reviews,
        ]);
    }

    /**
     * POST /api/storefront/order
     * Public: Đặt hàng từ website
     */
    public function placeOrder(Request $request)
    {
        $request->validate([
            'customer_name' => 'required|string|max:255',
            'phone' => 'required|string|max:20',
            'address' => 'required|string|max:1000',
            'address_detail' => 'nullable|string|max:1000',
            'district' => 'nullable|string|max:255',
            'ward' => 'nullable|string|max:255',
            'email' => 'nullable|email|max:255',
            'notes' => 'nullable|string|max:2000',
            'source' => 'nullable|string|max:50',
            'payment_method' => 'nullable|string|max:50',
            'draft_token' => 'nullable|string|max:120',
            'draft_lead_id' => 'nullable|integer',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:products,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.options' => 'nullable|array',
            'items.*.sub_items' => 'nullable|array',
            'items.*.product_url' => 'nullable|string|max:2000',
            'items.*.product_slug' => 'nullable|string|max:255',
            'items.*.product_name' => 'nullable|string|max:255',
            'items.*.product_sku' => 'nullable|string|max:120',
            'landing_url' => 'nullable|string|max:2000',
            'current_url' => 'nullable|string|max:2000',
            'referrer' => 'nullable|string|max:2000',
            'utm_source' => 'nullable|string|max:255',
            'utm_medium' => 'nullable|string|max:255',
            'utm_campaign' => 'nullable|string|max:255',
            'utm_content' => 'nullable|string|max:255',
            'utm_term' => 'nullable|string|max:255',
            'fbclid' => 'nullable|string|max:255',
            'gclid' => 'nullable|string|max:255',
            'ttclid' => 'nullable|string|max:255',
            'raw_query' => 'nullable|string|max:2000',
            'meta_event_id' => 'nullable|string|max:255',
            '_fbp' => 'nullable|string|max:255',
            '_fbc' => 'nullable|string|max:255',
            'fbp' => 'nullable|string|max:255',
            'fbc' => 'nullable|string|max:255',
        ]);

        $lead = app(LeadCaptureService::class)->createWebsiteOrderLead($request);
        app(SiteAnalyticsService::class)->recordOrderPlaced($request, $lead);
        app(MetaConversionsApiService::class)->sendPurchaseFromLead($request, $lead);

        return response()->json([
            'success' => true,
            'order_number' => $lead->lead_number,
            'lead_number' => $lead->lead_number,
            'lead_id' => $lead->id,
            'message' => '??t h?ng th?nh c?ng! ??n ?? ???c ??a v?o b?ng x? l? lead, ch?ng t?i s? li?n h? b?n s?m nh?t.',
        ], 201);
    }

    /**
     * POST /api/storefront/order-draft
     * Public: Tu dong luu lead nhap tu trang checkout
     */
    public function saveOrderDraft(Request $request)
    {
        $request->validate([
            'customer_name' => 'nullable|string|max:255',
            'phone' => ['required', 'string', 'max:20', 'regex:/^(0)[0-9]{9}$/'],
            'address' => 'nullable|string|max:1000',
            'address_detail' => 'nullable|string|max:1000',
            'province' => 'nullable|string|max:255',
            'district' => 'nullable|string|max:255',
            'ward' => 'nullable|string|max:255',
            'email' => 'nullable|email|max:255',
            'notes' => 'nullable|string|max:2000',
            'source' => 'nullable|string|max:50',
            'payment_method' => 'nullable|string|max:50',
            'draft_token' => 'required|string|max:120',
            'draft_lead_id' => 'nullable|integer',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'nullable|integer',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.options' => 'nullable|array',
            'items.*.sub_items' => 'nullable|array',
            'items.*.product_url' => 'nullable|string|max:2000',
            'items.*.product_slug' => 'nullable|string|max:255',
            'items.*.product_name' => 'nullable|string|max:255',
            'items.*.product_sku' => 'nullable|string|max:120',
            'landing_url' => 'nullable|string|max:2000',
            'current_url' => 'nullable|string|max:2000',
            'referrer' => 'nullable|string|max:2000',
            'utm_source' => 'nullable|string|max:255',
            'utm_medium' => 'nullable|string|max:255',
            'utm_campaign' => 'nullable|string|max:255',
            'utm_content' => 'nullable|string|max:255',
            'utm_term' => 'nullable|string|max:255',
            'fbclid' => 'nullable|string|max:255',
            'gclid' => 'nullable|string|max:255',
            'ttclid' => 'nullable|string|max:255',
            'raw_query' => 'nullable|string|max:2000',
            'discount' => 'nullable|numeric',
            'total' => 'nullable|numeric',
            'meta_event_id' => 'nullable|string|max:255',
            '_fbp' => 'nullable|string|max:255',
            '_fbc' => 'nullable|string|max:255',
            'fbp' => 'nullable|string|max:255',
            'fbc' => 'nullable|string|max:255',
        ]);

        $lead = app(LeadCaptureService::class)->createWebsiteOrderDraft($request);

        return response()->json([
            'success' => true,
            'lead_number' => $lead->lead_number,
            'lead_id' => $lead->id,
            'draft_token' => $lead->draft_token,
            'is_draft' => (bool) $lead->is_draft,
            'message' => 'Lead nhap da duoc luu.',
        ], 201);
    }
    /**
     * POST /api/storefront/lead
     * Public: Gửi yêu cầu tư vấn
     */
    public function submitLead(Request $request)
    {
        $request->validate([
            'customer_name' => 'required|string|max:255',
            'phone' => 'required|string|max:20',
            'email' => 'nullable|email|max:255',
            'product_id' => 'nullable|exists:products,id',
            'product_name' => 'nullable|string|max:255',
            'message' => 'nullable|string|max:2000',
            'source' => 'nullable|string|max:50',
            'landing_url' => 'nullable|string|max:2000',
            'current_url' => 'nullable|string|max:2000',
            'referrer' => 'nullable|string|max:2000',
            'utm_source' => 'nullable|string|max:255',
            'utm_medium' => 'nullable|string|max:255',
            'utm_campaign' => 'nullable|string|max:255',
            'utm_content' => 'nullable|string|max:255',
            'utm_term' => 'nullable|string|max:255',
            'fbclid' => 'nullable|string|max:255',
            'gclid' => 'nullable|string|max:255',
            'ttclid' => 'nullable|string|max:255',
            'raw_query' => 'nullable|string|max:2000',
            'meta_event_id' => 'nullable|string|max:255',
            '_fbp' => 'nullable|string|max:255',
            '_fbc' => 'nullable|string|max:255',
            'fbp' => 'nullable|string|max:255',
            'fbc' => 'nullable|string|max:255',
        ]);

        if (!$request->filled('product_name') && $request->filled('product_id')) {
            $request->merge([
                'product_name' => Product::find($request->product_id)?->name,
            ]);
        }

        $lead = app(LeadCaptureService::class)->createGenericLead($request);
        app(MetaConversionsApiService::class)->sendLeadFromLead($request, $lead);

        return response()->json([
            'success' => true,
            'message' => 'C?m on b?n! Ch�ng t�i s? li�n h? tu v?n trong th?i gian s?m nh?t.',
        ], 201);
    }
    /**
     * Build category tree from flat collection
     */
    private function buildCategoryTree($categories, $parentId = null)
    {
        $tree = [];
        // Extract items for this parent
        $items = [];
        foreach ($categories as $cat) {
            if ($cat->parent_id == $parentId) {
                $items[] = $cat;
            }
        }

        // Sort by order 
        usort($items, function($a, $b) {
            return ($a->order ?? 0) <=> ($b->order ?? 0);
        });

        foreach ($items as $cat) {
            $children = $this->buildCategoryTree($categories, $cat->id);
            $node = [
                'id' => $cat->id,
                'name' => $cat->name,
                'slug' => $cat->slug,
                'description' => $cat->description,
                'logo_path' => $cat->logo_path,
                'products_count' => $cat->products_count,
                'children' => $children,
            ];
            $tree[] = $node;
        }
        return $tree;
    }
}
