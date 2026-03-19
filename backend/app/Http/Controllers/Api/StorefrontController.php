<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\Category;
use App\Models\Banner;
use App\Models\ProductReview;
use App\Services\Leads\LeadCaptureService;
use Illuminate\Http\Request;

class StorefrontController extends Controller
{
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
            ->withCount(['products' => function ($q) {
                $q->where('status', true)->whereDoesntHave('parentConfigurable');
            }])
            ->orderBy('order')
            ->get(['id', 'name', 'slug', 'parent_id', 'description', 'order']);

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

        $query = Product::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->where('status', true)
            ->whereDoesntHave('parentConfigurable')
            ->with(['images' => function ($q) {
                $q->orderBy('is_primary', 'desc')->orderBy('sort_order');
            }, 'category:id,name,slug']);

        // Filter by category slug
        if ($request->filled('category')) {
            $cat = Category::where('slug', $request->category)->first();
            if ($cat) {
                // Include child categories
                $catIds = Category::where('parent_id', $cat->id)->pluck('id')->push($cat->id);
                $query->whereIn('category_id', $catIds);
            }
        }

        // Filter by category_id
        if ($request->filled('category_id')) {
            $catIds = Category::where('parent_id', $request->category_id)->pluck('id')->push((int) $request->category_id);
            $query->whereIn('category_id', $catIds);
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
        $query->orderBy($sort[0], $sort[1]);

        $perPage = min((int) $request->get('per_page', 20), 60);
        $products = $query->paginate($perPage);

        // Slim response: only essential fields
        $products->getCollection()->transform(function ($p) {
            return [
                'id' => $p->id,
                'name' => $p->name,
                'slug' => $p->slug,
                'sku' => $p->sku,
                'price' => $p->price,
                'current_price' => $p->current_price,
                'special_price' => $p->special_price,
                'main_image' => $p->main_image,
                'category' => $p->category ? ['id' => $p->category->id, 'name' => $p->category->name, 'slug' => $p->category->slug] : null,
                'is_featured' => $p->is_featured,
                'is_new' => $p->is_new,
                'stock_quantity' => $p->stock_quantity,
                'average_rating' => round($p->average_rating, 1),
                'primary_image' => $p->primary_image,
                'specifications' => $p->specifications,
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
                'linkedProducts' => fn($q) => $q->where('status', true)->with('images'),
                'bundleItems' => fn($q) => $q->where('status', true)->with(['images', 'category', 'attributeValues.attribute']),
                'groupedItems' => fn($q) => $q->where('status', true)->with(['images', 'category', 'attributeValues.attribute']),
            ]);

        // Try slug first, then id
        $product = $query->where('slug', $slugOrId)->first();
        if (!$product) {
            $product = $query->where('id', $slugOrId)->firstOrFail();
        }

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
            'description' => $product->description,
            'specifications' => $product->specifications,
            'weight' => $product->weight,
            'stock_quantity' => $product->stock_quantity,
            'is_featured' => $product->is_featured,
            'meta_title' => $product->meta_title,
            'meta_description' => $product->meta_description,
            'average_rating' => round($product->average_rating, 1),
            'review_count' => $product->approvedReviews->count(),
            'category' => $product->category ? ['id' => $product->category->id, 'name' => $product->category->name, 'slug' => $product->category->slug] : null,
            'images' => $product->images->map(fn($img) => [
                'id' => $img->id,
                'url' => $img->image_url,
                'path' => $img->image_url,
                'is_primary' => $img->is_primary,
            ]),
            'attributes' => $product->attributeValues->map(fn($av) => [
                'id' => $av->attribute_id,
                'name' => $av->attribute?->name,
                'code' => $av->attribute?->code,
                'value' => $av->value,
                'type' => $av->attribute?->frontend_type,
            ]),
            'super_attributes' => $product->superAttributes->map(fn($sa) => [
                'id' => $sa->id,
                'name' => $sa->name,
                'code' => $sa->code,
                'type' => $sa->frontend_type,
                'options' => $sa->options->map(fn($o) => ['id' => $o->id, 'value' => $o->value, 'swatch' => $o->swatch_value]),
            ]),
            'variants' => $product->linkedProducts->map(fn($v) => [
                'id' => $v->id,
                'name' => $v->name,
                'sku' => $v->sku,
                'price' => $v->price,
                'current_price' => $v->current_price,
                'stock_quantity' => $v->stock_quantity,
                'main_image' => $v->main_image,
                'primary_image' => $v->primary_image,
                'attributes' => $v->attributeValues->map(fn($av) => ['id' => $av->attribute_id, 'value' => $av->value]),
            ]),
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
            'bundle_items' => $product->type === 'bundle' ? $product->bundleItems->map(fn($v) => [
                'id' => $v->id,
                'name' => $v->name,
                'sku' => $v->sku,
                'price' => $v->price,
                'current_price' => $v->current_price,
                'stock_quantity' => $v->stock_quantity,
                'quantity' => $v->pivot->quantity ?? 1,
                'is_required' => $v->pivot->is_required ?? false,
                'option_title' => $v->pivot->option_title,
                'is_default' => $v->pivot->is_default ?? false,
                'position' => $v->pivot->position ?? 0,
                'main_image' => $v->main_image,
                'primary_image' => $v->primary_image,
                'category' => $v->category ? ['id' => $v->category->id, 'name' => $v->category->name] : null,
            ]) : [],
        ]);
    }

    /**
     * GET /api/storefront/products/{id}/related
     * Public: Sản phẩm liên quan
     */
    public function relatedProducts(Request $request, $id)
    {
        $product = Product::findOrFail($id);
        $accountId = $request->header('X-Account-Id');
        
        $limit = 8;
        
        // 1. Get explicitly linked related products first
        $explicitRelated = $product->relatedProducts()
            ->where('status', true)
            ->with(['images' => fn($q) => $q->orderBy('is_primary', 'desc')])
            ->get();
            
        $relatedIds = $explicitRelated->pluck('id')->push($product->id)->toArray();
        
        // 2. If we need more, fill with random products from the same category
        $fallback = collect([]);
        if ($explicitRelated->count() < $limit) {
            $fallback = Product::query()
                ->when($accountId, fn($q) => $q->where('account_id', $accountId))
                ->where('status', true)
                ->whereDoesntHave('parentConfigurable')
                ->whereNotIn('id', $relatedIds)
                ->where('category_id', $product->category_id)
                ->with(['images' => fn($q) => $q->orderBy('is_primary', 'desc')])
                ->inRandomOrder()
                ->limit($limit - $explicitRelated->count())
                ->get();
        }

        $result = $explicitRelated->concat($fallback)->shuffle()->map(fn($p) => [
            'id' => $p->id,
            'name' => $p->name,
            'slug' => $p->slug,
            'price' => $p->price,
            'current_price' => $p->current_price,
            'main_image' => $p->main_image,
            'average_rating' => round($p->average_rating, 1),
            'primary_image' => $p->primary_image,
        ]);

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
            ->withCount(['products' => fn($q) => $q->where('status', true)])
            ->orderBy('order')
            ->get(['id', 'name', 'slug', 'description']);

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
            'district' => 'nullable|string|max:255',
            'ward' => 'nullable|string|max:255',
            'email' => 'nullable|email|max:255',
            'notes' => 'nullable|string|max:2000',
            'source' => 'nullable|string|max:50',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:products,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.options' => 'nullable|array',
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
            'raw_query' => 'nullable|string|max:2000',
        ]);

        $lead = app(LeadCaptureService::class)->createWebsiteOrderLead($request);

        return response()->json([
            'success' => true,
            'order_number' => $lead->lead_number,
            'lead_number' => $lead->lead_number,
            'lead_id' => $lead->id,
            'message' => '??t h?ng th?nh c?ng! ??n ?? ???c ??a v?o b?ng x? l? lead, ch?ng t?i s? li?n h? b?n s?m nh?t.',
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
            'raw_query' => 'nullable|string|max:2000',
        ]);

        if (!$request->filled('product_name') && $request->filled('product_id')) {
            $request->merge([
                'product_name' => Product::find($request->product_id)?->name,
            ]);
        }

        app(LeadCaptureService::class)->createGenericLead($request);

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
                'products_count' => $cat->products_count,
                'children' => $children,
            ];
            $tree[] = $node;
        }
        return $tree;
    }
}


