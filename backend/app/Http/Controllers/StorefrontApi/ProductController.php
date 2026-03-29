<?php

namespace App\Http\Controllers\StorefrontApi;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\Category;
use App\Models\Attribute;
use App\Models\ProductAttributeValue;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ProductController extends Controller
{
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
            ->whereIn('category_id', $normalizedCategoryIds)
            ->groupBy('product_id');

        $query
            ->leftJoinSub($subquery, $alias, function ($join) use ($alias) {
                $join->on("{$alias}.product_id", '=', 'products.id');
            })
            ->select('products.*');
    }

    public function index(Request $request)
    {
        $accountId = $this->getAccountId($request);
        \Illuminate\Support\Facades\Log::info("Resolved Account ID: " . ($accountId ?? 'NULL'));

        $query = Product::query()
            ->select('products.*')
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true)
            ->when(!$request->boolean('allow_variants'), function($q) {
                $q->whereDoesntHave('parentConfigurable'); // Hide variants by default
            });
        $selectedCategoryIds = [];

        // Filter by category slug
        if ($request->filled('category')) {
            $cat = Category::where('slug', $request->category)
                ->when($accountId, fn($q) => $q->where('account_id', $accountId))
                ->first();
            if ($cat) {
                $selectedCategoryIds = $this->getOrderedCategoryIds($cat, $accountId);
                $query->whereHas('categories', function ($categoryQuery) use ($selectedCategoryIds) {
                    $categoryQuery->whereIn('categories.id', $selectedCategoryIds);
                });
            }
        }

        // Search
        if ($request->filled('search')) {
            $s = $request->search;
            \Illuminate\Support\Facades\Log::info("Product search keyword: '{$s}'");
            $query->where(function ($q) use ($s) {
                $q->where('name', 'ilike', "%{$s}%")
                  ->orWhere('sku', 'ilike', "%{$s}%")
                  ->orWhere('description', 'ilike', "%{$s}%");
            });
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

        if (!empty($selectedCategoryIds)) {
            $this->joinCategoryOrdering($finalQuery, $selectedCategoryIds);
        }

        $prioritizeCategoryOrder = !empty($selectedCategoryIds) && in_array($sortKey, ['popular', 'newest'], true);

        if ($prioritizeCategoryOrder) {
            $finalQuery->orderBy('category_sorting.category_order_key');
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
            $finalQuery->orderBy('category_sorting.category_order_key');
        }

        $finalQuery->orderBy('id', 'desc');

        $perPage = min((int) $request->get('per_page', 24), 60);
        $products = $finalQuery->with(['images' => function ($q) {
                $q->orderBy('is_primary', 'desc')->orderBy('sort_order');
            }, 'category:id,name,slug'])
            ->paginate($perPage);

        // Calculate available filters
        $availableFilters = [];
        
        $filterableAttributesQuery = \App\Models\Attribute::where('status', true)
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
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
                ->whereIn('product_id', (clone $filterQuery)->select('id'))
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
        $responseData['available_filters'] = $availableFilters;

        return response()->json($responseData);
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
                        // Use a safe way to order by pivot
                        $q->withPivot('position')->orderBy('product_super_attributes.position', 'asc');
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

            // Enrich bundle items with variant data if variant_id is present
            if (($product->type === 'bundle' || $product->type === 'grouped') && $product->bundleItems) {
                // Collect all variant IDs to fetch them in one query
                $variantIds = $product->bundleItems->pluck('pivot.variant_id')->filter()->unique()->toArray();
                
                $variants = [];
                if (!empty($variantIds)) {
                    $variants = Product::whereIn('id', $variantIds)
                        ->with(['images', 'attributeValues.attribute'])
                        ->get()
                        ->keyBy('id');
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
                    if ($vId && isset($variants[$vId])) {
                        $v = $variants[$vId];
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
                ->orderBy('id', 'asc') 
                ->get(['id', 'name', 'code', 'frontend_type']);
            
            $responseData = $product->toArray();
            $responseData['all_attributes'] = $allProductAttributes;

            return response()->json($responseData);
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
            ->with('categories:id')
            ->where(function ($q) use ($slug) {
                $q->where('slug', $slug);
                if (is_numeric($slug)) {
                    $q->orWhere('id', (int) $slug);
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
            return response()->json($this->formatRelatedProductsResponse($explicitRelated));
        }

        $categoryIds = collect([$product->category_id])
            ->merge($product->categories->pluck('id'))
            ->filter()
            ->map(fn ($id) => (int) $id)
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

        return response()->json($this->formatRelatedProductsResponse($fallback));
    }

    private function formatRelatedProductsResponse($products)
    {
        return $products->map(fn ($product) => [
            'id' => $product->id,
            'name' => $product->name,
            'slug' => $product->slug,
            'price' => $product->price,
            'current_price' => $product->current_price,
            'main_image' => $product->main_image,
            'average_rating' => round($product->average_rating, 1),
            'primary_image' => $product->primary_image,
        ])->values();
    }
}
