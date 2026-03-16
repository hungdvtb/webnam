<?php

namespace App\Http\Controllers\StorefrontApi;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\Category;
use App\Models\Attribute;
use App\Models\ProductAttributeValue;
use Illuminate\Http\Request;

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

    /**
     * Get all child category IDs recursively
     */
    private function getAllChildCategoryIds($categoryId, $accountId)
    {
        $childIds = Category::where('parent_id', $categoryId)
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->pluck('id')
            ->toArray();
        
        $allIds = $childIds;
        foreach ($childIds as $id) {
            $allIds = array_merge($allIds, $this->getAllChildCategoryIds($id, $accountId));
        }
        
        return $allIds;
    }

    public function index(Request $request)
    {
        $accountId = $this->getAccountId($request);
        \Illuminate\Support\Facades\Log::info("Resolved Account ID: " . ($accountId ?? 'NULL'));

        $query = Product::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true)
            ->whereDoesntHave('parentConfigurable'); // Đảm bảo không hiển thị sản phẩm con (biến thể) ra danh sách chính

        // Filter by category slug
        if ($request->filled('category')) {
            $cat = Category::where('slug', $request->category)
                ->when($accountId, fn($q) => $q->where('account_id', $accountId))
                ->first();
            if ($cat) {
                $childIds = $this->getAllChildCategoryIds($cat->id, $accountId);
                $catIds = array_merge([$cat->id], $childIds);
                $query->whereIn('category_id', $catIds);
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
        switch ($sortKey) {
            case 'price_asc':
                $finalQuery->orderBy('price', 'asc')->orderBy('id', 'desc');
                break;
            case 'price_desc':
                $finalQuery->orderBy('price', 'desc')->orderBy('id', 'desc');
                break;
            case 'newest':
                $finalQuery->orderBy('created_at', 'desc')->orderBy('id', 'desc');
                break;
            case 'popular':
            default:
                $finalQuery->orderBy('is_featured', 'desc')->orderBy('created_at', 'desc');
                break;
        }

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
        $priceStats = (clone $filterQuery)->selectRaw('MIN(price) as min_price, MAX(price) as max_price')->getQuery()->first();
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
                ->where('slug', $slug)
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
                    'groupedItems.attributeValues.attribute'
                ])
                ->firstOrFail();

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
        $product = Product::where('slug', $slug)
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->firstOrFail();

        $limit = 8;
        
        // 1. Get explicitly linked related products first
        $explicitRelated = $product->relatedProducts()
            ->where('status', true)
            ->with(['images' => fn($q) => $q->orderBy('is_primary', 'desc')->limit(1)])
            ->get();
            
        $relatedIds = $explicitRelated->pluck('id')->push($product->id)->toArray();
        
        // 2. If we need more, fill with random products from the same category
        $fallback = [];
        if ($explicitRelated->count() < $limit) {
            $fallback = Product::query()
                ->when($accountId, fn($q) => $q->where('account_id', $accountId))
                ->where('status', true)
                ->whereDoesntHave('parentConfigurable')
                ->whereNotIn('id', $relatedIds)
                ->where('category_id', $product->category_id)
                ->with(['images' => fn($q) => $q->orderBy('is_primary', 'desc')->limit(1)])
                ->inRandomOrder()
                ->limit($limit - $explicitRelated->count())
                ->get();
        }

        // Combine and shuffle to keep it random
        $result = $explicitRelated->concat($fallback)->shuffle();

        return response()->json($result);
    }
}
