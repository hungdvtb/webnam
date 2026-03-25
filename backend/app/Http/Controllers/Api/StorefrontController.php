<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\Category;
use App\Models\Banner;
use App\Models\Post;
use App\Models\ProductReview;
use App\Services\Leads\LeadCaptureService;
use Illuminate\Http\Request;

class StorefrontController extends Controller
{
    protected function mapStorefrontImages(Product $product): array
    {
        return $product->images->map(fn ($img) => [
            'id' => $img->id,
            'url' => $img->image_url,
            'path' => $img->image_url,
            'is_primary' => $img->is_primary,
        ])->values()->all();
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
                'linkedProducts' => fn($q) => $q->where('status', true)->with(['images', 'attributeValues.attribute']),
                'bundleItems' => fn($q) => $q->where('status', true)->with([
                    'images',
                    'category',
                    'attributeValues.attribute',
                    'superAttributes.options',
                    'variations' => fn($variantQuery) => $variantQuery
                        ->where('status', true)
                        ->with(['images', 'attributeValues.attribute']),
                ]),
                'groupedItems' => fn($q) => $q->where('status', true)->with(['images', 'category', 'attributeValues.attribute']),
            ]);

        // Try slug first, then id
        $product = $query->where('slug', $slugOrId)->first();
        if (!$product) {
            $product = $query->where('id', $slugOrId)->firstOrFail();
        }

        $rawAdditionalInfo = $product->additional_info;
        if (is_string($rawAdditionalInfo)) {
            $decodedAdditionalInfo = json_decode($rawAdditionalInfo, true);
            $rawAdditionalInfo = json_last_error() === JSON_ERROR_NONE ? $decodedAdditionalInfo : [];
        }

        $additionalInfoItems = collect(is_array($rawAdditionalInfo) ? $rawAdditionalInfo : [])
            ->map(function ($item) {
                if (is_object($item)) {
                    $item = (array) $item;
                }

                return is_array($item) ? $item : null;
            })
            ->filter()
            ->values();

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
            'description' => $product->description,
            'specifications' => $product->specifications,
            'additional_info' => $additionalInfoItems->map(function ($item) use ($linkedPosts) {
                $postId = filled($item['post_id'] ?? null) ? (int) $item['post_id'] : null;
                $linkedPost = $postId ? $linkedPosts->get($postId) : null;

                return [
                    'title' => trim((string) ($item['title'] ?? '')),
                    'post_id' => $postId,
                    'post_title' => $linkedPost?->title ?? trim((string) ($item['post_title'] ?? '')),
                    'post_slug' => $linkedPost?->slug,
                ];
            })->filter(fn ($item) => filled($item['title']) || filled($item['post_title']) || filled($item['post_id']))->values(),
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
                        'option_title' => $bundleItem->pivot->option_title,
                        'option_post_id' => $optionPostId,
                        'option_post_title' => $optionPost?->title,
                        'option_post_slug' => $optionPost?->slug,
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
            'raw_query' => 'nullable|string|max:2000',
            'discount' => 'nullable|numeric',
            'total' => 'nullable|numeric',
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


