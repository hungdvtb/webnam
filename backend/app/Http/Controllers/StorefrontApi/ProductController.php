<?php

namespace App\Http\Controllers\StorefrontApi;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\Category;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    /**
     * Resolve account by X-Site-Code header
     */
    protected function getAccountId(Request $request)
    {
        $siteCode = $request->header('X-Site-Code');
        if (!$siteCode) return null;
        
        $account = \App\Models\Account::where('site_code', $siteCode)->first();
        return $account ? $account->id : null;
    }

    public function index(Request $request)
    {
        $accountId = $this->getAccountId($request);

        $query = Product::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true)
            ->with(['images' => function ($q) {
                $q->orderBy('is_primary', 'desc')->orderBy('sort_order');
            }, 'category:id,name,slug']);

        // Filter by category slug
        if ($request->filled('category')) {
            $cat = Category::where('slug', $request->category)
                ->when($accountId, fn($q) => $q->where('account_id', $accountId))
                ->first();
            if ($cat) {
                $catIds = Category::where('parent_id', $cat->id)->pluck('id')->push($cat->id);
                $query->whereIn('category_id', $catIds);
            }
        }

        // Search
        if ($request->filled('search')) {
            $s = $request->search;
            $query->where(function ($q) use ($s) {
                $q->where('name', 'like', "%{$s}%")
                  ->orWhere('sku', 'like', "%{$s}%");
            });
        }

        // Sort
        $sortMap = [
            'newest' => ['created_at', 'desc'],
            'price_asc' => ['price', 'asc'],
            'price_desc' => ['price', 'desc'],
            'popular' => ['is_featured', 'desc'],
        ];
        $sort = $sortMap[$request->get('sort', 'newest')] ?? ['created_at', 'desc'];
        $query->orderBy($sort[0], $sort[1]);

        $perPage = min((int) $request->get('per_page', 20), 60);
        $products = $query->paginate($perPage);

        return response()->json($products);
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
