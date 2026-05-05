<?php

namespace App\Http\Controllers\StorefrontApi;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Support\Utf8Sanitizer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CategoryController extends Controller
{
    protected function getAccountId(Request $request)
    {
        $siteCode = $request->header('X-Site-Code');
        if (!$siteCode) return null;
        
        $account = \App\Models\Account::where('site_code', $siteCode)->first();
        return $account ? $account->id : null;
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

        $countMap = DB::table('category_product')
            ->join('products', 'products.id', '=', 'category_product.product_id')
            ->when($accountId, fn ($query) => $query->where('products.account_id', $accountId))
            ->whereIn('category_product.category_id', $categoryIds->all())
            ->whereIn('category_product.item_type', ['product', 'bundle_option'])
            ->where('products.status', true)
            ->whereNull('products.deleted_at')
            ->selectRaw('category_product.category_id, COUNT(*) as storefront_items_count')
            ->groupBy('category_product.category_id')
            ->get()
            ->mapWithKeys(fn ($row) => [(int) $row->category_id => (int) $row->storefront_items_count]);

        $normalizedCategories->each(function ($category) use ($countMap) {
            $category->setAttribute('products_count', (int) ($countMap->get((int) $category->id) ?? 0));
        });
    }

    public function index(Request $request)
    {
        $accountId = $this->getAccountId($request);

        $categories = Category::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true)
            ->orderBy('order', 'asc')
            ->orderBy('id', 'asc') // Stable sorting
            ->get();

        $this->applyStorefrontCategoryItemCounts($categories, $accountId);

        return response()->json(Utf8Sanitizer::normalize($categories->toArray()));
    }

    public function show(Request $request, $slug)
    {
        $accountId = $this->getAccountId($request);

        $category = Category::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('slug', $slug)
            ->with(['children' => function($q) {
                $q->where('status', true)->orderBy('order');
            }])
            ->firstOrFail();

        $this->applyStorefrontCategoryItemCounts(
            collect([$category])->merge($category->children),
            $accountId
        );

        return response()->json(Utf8Sanitizer::normalize($category->toArray()));
    }
}
