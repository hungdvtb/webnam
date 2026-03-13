<?php

namespace App\Http\Controllers\StorefrontApi;

use App\Http\Controllers\Controller;
use App\Models\Category;
use Illuminate\Http\Request;

class CategoryController extends Controller
{
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

        $categories = Category::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true)
            ->whereNull('parent_id') // Only show top-level categories in sidebar
            ->withCount(['products' => function ($q) {
                $q->where('status', true);
            }])
            ->orderBy('order', 'asc')
            ->orderBy('id', 'asc') // Stable sorting
            ->get();

        return response()->json($categories);
    }

    public function show(Request $request, $slug)
    {
        $accountId = $this->getAccountId($request);

        $category = Category::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('slug', $slug)
            ->firstOrFail();

        return response()->json($category);
    }
}
