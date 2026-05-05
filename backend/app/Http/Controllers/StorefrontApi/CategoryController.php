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

        $assignmentRows = DB::table('category_product')
            ->join('products', 'products.id', '=', 'category_product.product_id')
            ->leftJoin('product_links as super_links', function ($join) {
                $join->on('super_links.linked_product_id', '=', 'category_product.product_id')
                    ->where('super_links.link_type', '=', 'super_link');
            })
            ->when($accountId, fn ($query) => $query->where('products.account_id', $accountId))
            ->whereIn('category_product.category_id', $categoryIds->all())
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

        $countMap = $assignmentRows
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
                    ->count();
            });

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
