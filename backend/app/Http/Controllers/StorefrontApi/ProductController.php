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
            ->where('status', true);

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
                    if (is_array($value)) {
                        $q->whereIn('value', $value);
                    } else {
                        $q->where('value', $value);
                    }
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
        $filterableAttributesQuery = \App\Models\Attribute::where('is_filterable_frontend', true)
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->with('options');

        if (isset($cat) && !empty($cat->filterable_attribute_ids)) {
            $filterableAttributesQuery->whereIn('id', $cat->filterable_attribute_ids);
        }

        $filterableAttributes = $filterableAttributesQuery->get();

        foreach ($filterableAttributes as $attr) {
            // Count products for each value of this attribute within the current search result
            $valueCounts = ProductAttributeValue::where('attribute_id', $attr->id)
                ->whereIn('product_id', (clone $filterQuery)->select('id'))
                ->selectRaw('value, count(*) as count')
                ->groupBy('value')
                ->get()
                ->pluck('count', 'value');

            if ($valueCounts->count() > 0) {
                $options = [];
                // If it's a select/multiselect, use predefined options but only those that have products
                if (in_array($attr->frontend_type, ['select', 'multiselect'])) {
                    foreach ($attr->options as $opt) {
                        if (isset($valueCounts[$opt->value])) {
                            $options[] = [
                                'label' => $opt->value,
                                'value' => $opt->value,
                                'count' => $valueCounts[$opt->value],
                                'swatch_value' => $opt->swatch_value
                            ];
                        }
                    }
                } else {
                    // For other types, just use the raw values
                    foreach ($valueCounts as $val => $count) {
                        $options[] = [
                            'label' => $val,
                            'value' => $val,
                            'count' => $count
                        ];
                    }
                }

                if (!empty($options)) {
                    $availableFilters[] = [
                        'id' => $attr->id,
                        'name' => $attr->name,
                        'code' => $attr->code,
                        'type' => $attr->frontend_type,
                        'options' => $options
                    ];
                }
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
        $accountId = $this->getAccountId($request);

        $product = Product::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true)
            ->where('slug', $slug)
            ->with(['images', 'category', 'attributeValues.attribute'])
            ->firstOrFail();

        return response()->json($product);
    }

    public function related(Request $request, $slug)
    {
        $accountId = $this->getAccountId($request);
        $product = Product::where('slug', $slug)
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->firstOrFail();

        $related = Product::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true)
            ->where('id', '!=', $product->id)
            ->where('category_id', $product->category_id)
            ->with(['images' => fn($q) => $q->orderBy('is_primary', 'desc')->limit(1)])
            ->inRandomOrder()
            ->limit(4)
            ->get();

        return response()->json($related);
    }
}
