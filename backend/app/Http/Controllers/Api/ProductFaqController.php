<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductFaq;
use App\Services\MediaService;
use App\Services\ProductFaqRelatedArticleService;
use App\Support\BlogContentHtmlNormalizer;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ProductFaqController extends Controller
{
    private const STATUS_VALUES = [
        ProductFaq::STATUS_VISIBLE,
        ProductFaq::STATUS_HIDDEN,
    ];

    private const TARGET_SELECT_KEYS = [
        'product_id',
        'product_ids',
        'category_ids',
        'product_group_ids',
        'bundle_product_ids',
        'apply_all_products',
    ];

    public function __construct(
        protected MediaService $mediaService,
        protected ProductFaqRelatedArticleService $relatedArticleService
    ) {
    }

    public function index(Request $request, $productId)
    {
        $product = Product::query()->findOrFail($productId);
        $faqs = $this->faqsForProduct($product, false);

        return response()->json([
            'count' => $faqs->count(),
            'items' => $faqs->map(fn (ProductFaq $faq) => $this->publicPayload($faq))->values(),
        ]);
    }

    public function adminIndex(Request $request)
    {
        $productId = (int) $request->query('product_id', 0);

        if ($productId <= 0) {
            return response()->json([
                'product' => null,
                'data' => [],
                'total' => 0,
            ]);
        }

        $product = Product::query()
            ->select(['id', 'account_id', 'name', 'sku', 'slug', 'type', 'status'])
            ->findOrFail($productId);
        $faqs = $this->faqsForProduct($product, true);

        return response()->json([
            'product' => $this->productPayload($product),
            'data' => $faqs->map(fn (ProductFaq $faq) => $this->adminPayload($faq))->values(),
            'total' => $faqs->count(),
        ]);
    }

    public function adminProducts(Request $request)
    {
        $filter = in_array($request->query('faq_filter'), ['with', 'without'], true)
            ? $request->query('faq_filter')
            : 'all';
        $perPage = min(max((int) $request->query('per_page', 30), 1), 100);
        $search = trim((string) $request->query('search', ''));

        $query = Product::query()
            ->select(['products.id', 'products.account_id', 'products.name', 'products.sku', 'products.slug', 'products.type', 'products.status'])
            ->whereDoesntHave('parentConfigurable');

        $faqCountExpression = $this->attachFaqCountSubqueries($query);

        if ($search !== '') {
            $like = '%' . Str::lower($search) . '%';
            $query->where(function ($searchQuery) use ($like) {
                $searchQuery
                    ->whereRaw('LOWER(COALESCE(products.name, \'\')) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(COALESCE(products.sku, \'\')) LIKE ?', [$like]);
            });
        }

        if ($filter === 'with') {
            $query->whereRaw("{$faqCountExpression} > 0");
        } elseif ($filter === 'without') {
            $query->whereRaw("{$faqCountExpression} = 0");
        }

        if ($filter === 'with') {
            $query->orderByRaw("{$faqCountExpression} DESC");
        }

        $query
            ->orderBy('products.name')
            ->orderBy('products.id');

        $paginated = $query->paginate($perPage);
        $paginated->setCollection(
            $paginated->getCollection()->map(fn (Product $product) => $this->productPayload($product))
        );

        return response()->json($paginated);
    }

    public function adminResolveTargets(Request $request)
    {
        $products = $this->resolveTargetProductsFromRequest($request, null, false);

        return response()->json([
            'total' => $products->count(),
            'data' => $products->map(fn (Product $product) => $this->productPayload($product))->values(),
        ]);
    }

    public function adminPreviewArticleLink(Request $request)
    {
        $validated = $request->validate([
            'url' => ['required', 'string', 'max:2048'],
        ]);
        $accountId = $this->resolveTargetAccountId();

        if (!$accountId) {
            throw ValidationException::withMessages([
                'url' => ['Chưa xác định được website để kiểm tra link.'],
            ]);
        }

        return response()->json([
            'article' => $this->relatedArticleService->previewManualUrl(
                $accountId,
                $validated['url']
            ),
        ]);
    }

    public function adminStore(Request $request)
    {
        $validated = $this->validatePayload($request);
        $targetProducts = $this->resolveTargetProductsFromRequest($request, null, true);
        $primaryProduct = $this->primaryProductFromTargets($targetProducts, $validated['product_id'] ?? null);
        $question = trim((string) $validated['question']);

        $this->assertQuestionIsUniqueForTargets($question, (int) $primaryProduct->account_id, $targetProducts->pluck('id')->all());

        $faq = DB::transaction(function () use ($request, $validated, $targetProducts, $primaryProduct, $question) {
            $faq = ProductFaq::query()->create([
                'account_id' => $primaryProduct->account_id,
                'product_id' => $primaryProduct->id,
                'question' => $question,
                'answer' => trim((string) $validated['answer']),
                'images' => $this->resolveImagesFromRequest($request),
                'youtube_url' => $this->cleanYoutubeUrl($validated['youtube_url'] ?? null),
                'sort_order' => array_key_exists('sort_order', $validated)
                    ? max(0, (int) $validated['sort_order'])
                    : $this->nextSortOrder($primaryProduct->id),
                'status' => $validated['status'] ?? ProductFaq::STATUS_VISIBLE,
            ]);

            $this->syncFaqProducts($faq, $targetProducts);
            $this->relatedArticleService->sync(
                $faq,
                $validated['related_articles'] ?? []
            );

            return $faq;
        });

        return response()->json([
            'message' => 'Đã tạo hỏi đáp khách hàng.',
            'faq' => $this->adminPayload($this->loadAdminFaqRelations($faq)),
        ], 201);
    }

    public function adminUpdate(Request $request, $id)
    {
        $faq = ProductFaq::query()->findOrFail($id);
        $validated = $this->validatePayload($request, $faq);
        $targetProducts = $this->requestHasTargetSelection($request)
            ? $this->resolveTargetProductsFromRequest($request, $faq, true)
            : $this->currentFaqProducts($faq);
        $primaryProduct = $this->primaryProductFromTargets($targetProducts, $validated['product_id'] ?? $faq->product_id);
        $question = trim((string) ($validated['question'] ?? $faq->question));

        $this->assertQuestionIsUniqueForTargets(
            $question,
            (int) $primaryProduct->account_id,
            $targetProducts->pluck('id')->all(),
            (int) $faq->id
        );

        DB::transaction(function () use ($request, $validated, $faq, $targetProducts, $primaryProduct, $question) {
            $faq->product_id = $primaryProduct->id;
            $faq->account_id = $primaryProduct->account_id;
            $faq->fill([
                'question' => $question,
                'answer' => trim((string) ($validated['answer'] ?? $faq->answer)),
                'images' => $this->resolveImagesFromRequest($request, $faq),
                'youtube_url' => $this->cleanYoutubeUrl($validated['youtube_url'] ?? $faq->youtube_url),
                'sort_order' => array_key_exists('sort_order', $validated)
                    ? max(0, (int) $validated['sort_order'])
                    : $faq->sort_order,
                'status' => $validated['status'] ?? $faq->status,
            ]);
            $faq->save();

            $this->syncFaqProducts($faq, $targetProducts);

            if (array_key_exists('related_articles', $validated)) {
                $this->relatedArticleService->sync($faq, $validated['related_articles']);
            }
        });

        return response()->json([
            'message' => 'Đã cập nhật hỏi đáp khách hàng cho các sản phẩm đã áp dụng.',
            'faq' => $this->adminPayload($this->loadAdminFaqRelations($faq->refresh())),
        ]);
    }

    public function adminDestroy($id)
    {
        ProductFaq::query()->findOrFail($id)->delete();

        return response()->json(['message' => 'Đã xóa hỏi đáp khách hàng.']);
    }

    public function adminReorder(Request $request)
    {
        $validated = $request->validate([
            'product_id' => ['required', 'integer', 'exists:products,id'],
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'distinct', 'exists:product_faqs,id'],
        ]);

        $product = Product::query()->findOrFail((int) $validated['product_id']);
        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->values();
        $displayedIds = $this->faqsForProduct($product, true)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->sort()
            ->values()
            ->all();

        if ($ids->sort()->values()->all() !== $displayedIds) {
            return response()->json([
                'message' => 'Danh sách sắp xếp chưa khớp với FAQ của sản phẩm đã chọn.',
            ], 422);
        }

        DB::transaction(function () use ($ids) {
            $ids->each(function (int $id, int $index) {
                ProductFaq::query()
                    ->whereKey($id)
                    ->update(['sort_order' => $index + 1]);
            });
        });

        $faqs = $this->faqsForProduct($product, true);

        return response()->json([
            'message' => 'Đã cập nhật thứ tự hỏi đáp.',
            'data' => $faqs->map(fn (ProductFaq $faq) => $this->adminPayload($faq))->values(),
        ]);
    }

    private function validatePayload(Request $request, ?ProductFaq $faq = null): array
    {
        if (is_string($request->input('related_articles'))) {
            $decoded = json_decode($request->input('related_articles'), true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                $request->merge(['related_articles' => $decoded]);
            }
        }

        $validated = $request->validate([
            'product_id' => ['nullable', 'integer', 'exists:products,id'],
            'product_ids' => ['nullable', 'array'],
            'product_ids.*' => ['integer', 'distinct', 'exists:products,id'],
            'category_ids' => ['nullable', 'array'],
            'category_ids.*' => ['integer', 'distinct', 'exists:categories,id'],
            'product_group_ids' => ['nullable', 'array'],
            'product_group_ids.*' => ['integer', 'distinct', 'exists:product_groups,id'],
            'bundle_product_ids' => ['nullable', 'array'],
            'bundle_product_ids.*' => ['integer', 'distinct', 'exists:products,id'],
            'apply_all_products' => ['nullable', 'boolean'],
            'question' => [$faq ? 'sometimes' : 'required', 'string', 'min:2', 'max:1000'],
            'answer' => [$faq ? 'sometimes' : 'required', 'string', 'min:2', 'max:60000'],
            'youtube_url' => ['nullable', 'string', 'max:2048'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:999999'],
            'status' => ['nullable', Rule::in(self::STATUS_VALUES)],
            'existing_images' => ['nullable'],
            'image' => ['nullable', 'file', 'mimes:jpeg,png,jpg,gif,webp,avif,svg', 'max:10240'],
            'images' => ['nullable', 'array'],
            'images.*' => ['file', 'mimes:jpeg,png,jpg,gif,webp,avif,svg', 'max:10240'],
            'related_articles' => ['nullable', 'array', 'max:50'],
            'related_articles.*.source' => ['nullable', Rule::in(['post', 'manual'])],
            'related_articles.*.post_id' => ['nullable', 'integer'],
            'related_articles.*.url' => ['nullable', 'string', 'max:2048'],
            'related_articles.*.title' => ['nullable', 'string', 'max:255'],
            'related_articles.*.excerpt' => ['nullable', 'string', 'max:1000'],
            'related_articles.*.image' => ['nullable', 'string', 'max:2048'],
            'related_articles.*.image_url' => ['nullable', 'string', 'max:2048'],
        ]);

        if (array_key_exists('answer', $validated)) {
            $validated['answer'] = $this->normalizeAnswerForStorage((string) $validated['answer']);
            if (!$this->answerHasVisibleContent($validated['answer'])) {
                throw ValidationException::withMessages([
                    'answer' => ['Nhap cau tra loi cua shop truoc khi luu.'],
                ]);
            }
        }

        return $validated;
    }

    private function normalizeAnswerForStorage(string $answer): string
    {
        $answer = trim($answer);
        if ($answer === '') {
            return '';
        }

        if (preg_match('/<\/?[a-z][\s\S]*>/i', $answer) !== 1) {
            return $answer;
        }

        return BlogContentHtmlNormalizer::normalize($answer);
    }

    private function answerHasVisibleContent(string $answer): bool
    {
        $text = Str::of(html_entity_decode(strip_tags($answer), ENT_QUOTES | ENT_HTML5, 'UTF-8'))
            ->squish()
            ->value();

        if (mb_strlen($text) >= 2) {
            return true;
        }

        return preg_match('/<(img|iframe|video|source)\b/i', $answer) === 1;
    }

    private function attachFaqCountSubqueries($query): string
    {
        if (!$this->faqAssignmentsTableExists()) {
            $legacyCounts = DB::table('product_faqs')
                ->select('product_id', DB::raw('COUNT(*) AS legacy_faq_count'))
                ->groupBy('product_id');

            $query
                ->leftJoinSub($legacyCounts, 'legacy_faq_counts', function ($join) {
                    $join->on('legacy_faq_counts.product_id', '=', 'products.id');
                })
                ->selectRaw('COALESCE(legacy_faq_counts.legacy_faq_count, 0) AS faq_count');

            return 'COALESCE(legacy_faq_counts.legacy_faq_count, 0)';
        }

        $pivotCounts = DB::table('product_faq_product')
            ->select('product_id', DB::raw('COUNT(DISTINCT product_faq_id) AS pivot_faq_count'))
            ->groupBy('product_id');
        $legacyCounts = DB::table('product_faqs')
            ->select('product_id', DB::raw('COUNT(*) AS legacy_faq_count'))
            ->whereNotExists(function ($subQuery) {
                $subQuery
                    ->selectRaw('1')
                    ->from('product_faq_product')
                    ->whereColumn('product_faq_product.product_faq_id', 'product_faqs.id');
            })
            ->groupBy('product_id');

        $query
            ->leftJoinSub($pivotCounts, 'faq_counts', function ($join) {
                $join->on('faq_counts.product_id', '=', 'products.id');
            })
            ->leftJoinSub($legacyCounts, 'legacy_faq_counts', function ($join) {
                $join->on('legacy_faq_counts.product_id', '=', 'products.id');
            })
            ->selectRaw('(COALESCE(faq_counts.pivot_faq_count, 0) + COALESCE(legacy_faq_counts.legacy_faq_count, 0)) AS faq_count');

        return '(COALESCE(faq_counts.pivot_faq_count, 0) + COALESCE(legacy_faq_counts.legacy_faq_count, 0))';
    }

    private function faqsForProduct(Product $product, bool $admin): Collection
    {
        $lookupProductIds = $this->faqLookupProductIds($product);
        $query = ProductFaq::query()
            ->where('account_id', $product->account_id)
            ->where(function ($faqQuery) use ($lookupProductIds) {
                if ($this->faqAssignmentsTableExists()) {
                    $faqQuery
                        ->whereIn('id', function ($subQuery) use ($lookupProductIds) {
                            $subQuery
                                ->select('product_faq_id')
                                ->from('product_faq_product')
                                ->whereIn('product_id', $lookupProductIds);
                        })
                        ->orWhere(function ($legacyQuery) use ($lookupProductIds) {
                            $legacyQuery
                                ->whereIn('product_id', $lookupProductIds)
                                ->whereNotExists(function ($subQuery) {
                                    $subQuery
                                        ->selectRaw('1')
                                        ->from('product_faq_product')
                                        ->whereColumn('product_faq_product.product_faq_id', 'product_faqs.id');
                                });
                        });

                    return;
                }

                $faqQuery->whereIn('product_id', $lookupProductIds);
            });

        if ($admin) {
            $query->with($this->adminFaqRelations());
        } else {
            $query->visible();
            if ($this->relatedArticleService->tableExists()) {
                $query->with('relatedArticles.post.featuredMediaAsset');
            }
        }

        return $query->ordered()->get()->unique('id')->values();
    }

    private function requestHasTargetSelection(Request $request): bool
    {
        foreach (self::TARGET_SELECT_KEYS as $key) {
            if ($request->exists($key)) {
                return true;
            }
        }

        return false;
    }

    private function resolveTargetProductsFromRequest(Request $request, ?ProductFaq $faq = null, bool $requireTargets = false): Collection
    {
        $directProductIds = collect($this->intArrayFromRequest($request, 'product_ids'));
        $primaryProductId = $request->input('product_id');
        if (is_numeric($primaryProductId) && (int) $primaryProductId > 0) {
            $directProductIds->push((int) $primaryProductId);
        }

        $categoryIds = collect($this->intArrayFromRequest($request, 'category_ids'));
        $productGroupIds = collect($this->intArrayFromRequest($request, 'product_group_ids'));
        $bundleProductIds = collect($this->intArrayFromRequest($request, 'bundle_product_ids'));
        $accountId = $this->resolveTargetAccountId(
            $directProductIds->merge($bundleProductIds)->all(),
            $categoryIds->all(),
            $productGroupIds->all()
        );

        if ($request->boolean('apply_all_products')) {
            if (!$accountId) {
                throw ValidationException::withMessages([
                    'apply_all_products' => ['Chưa xác định được tài khoản để áp dụng FAQ cho tất cả sản phẩm.'],
                ]);
            }

            return Product::query()
                ->select(['id', 'account_id', 'name', 'sku', 'slug', 'type', 'status'])
                ->where('account_id', $accountId)
                ->whereDoesntHave('parentConfigurable')
                ->orderBy('name')
                ->orderBy('id')
                ->get()
                ->pipe(fn (Collection $products) => $this->withoutCompositeChildren($products));
        }

        $targetIds = collect();
        $targetIds = $targetIds->merge($directProductIds);

        if ($categoryIds->isNotEmpty()) {
            $targetIds = $targetIds->merge($this->productIdsForCategories($categoryIds->all(), $accountId));
        }

        if ($productGroupIds->isNotEmpty()) {
            $targetIds = $targetIds->merge($this->productIdsForProductGroups($productGroupIds->all(), $accountId));
        }

        if ($bundleProductIds->isNotEmpty()) {
            $targetIds = $targetIds->merge($this->productIdsForBundleProducts($bundleProductIds->all(), $accountId));
        }

        if ($targetIds->isEmpty() && $faq) {
            $targetIds = $this->currentFaqProducts($faq)->pluck('id');
        }

        $products = Product::query()
            ->select(['id', 'account_id', 'name', 'sku', 'slug', 'type', 'status'])
            ->whereIn('id', $targetIds->filter()->unique()->values()->all())
            ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
            ->whereDoesntHave('parentConfigurable')
            ->orderBy('name')
            ->orderBy('id')
            ->get()
            ->pipe(fn (Collection $products) => $this->withoutCompositeChildren($products));

        if ($requireTargets && $products->isEmpty()) {
            throw ValidationException::withMessages([
                'product_ids' => ['Chọn ít nhất một sản phẩm để áp dụng FAQ.'],
            ]);
        }

        return $products;
    }

    private function primaryProductFromTargets(Collection $targetProducts, $preferredProductId = null): Product
    {
        if ($targetProducts->isEmpty()) {
            throw ValidationException::withMessages([
                'product_ids' => ['Chọn ít nhất một sản phẩm để áp dụng FAQ.'],
            ]);
        }

        if (is_numeric($preferredProductId)) {
            $preferred = $targetProducts->firstWhere('id', (int) $preferredProductId);
            if ($preferred instanceof Product) {
                return $preferred;
            }
        }

        return $targetProducts->first();
    }

    private function resolveTargetAccountId(array $productIds = [], array $categoryIds = [], array $productGroupIds = []): ?int
    {
        $productId = collect($productIds)
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->first();

        if ($productId) {
            $accountId = Product::query()->whereKey($productId)->value('account_id');
            if ($accountId) {
                return (int) $accountId;
            }
        }

        $categoryId = collect($categoryIds)
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->first();

        if ($categoryId) {
            $accountId = Category::query()->whereKey($categoryId)->value('account_id');
            if ($accountId) {
                return (int) $accountId;
            }
        }

        if ($productGroupIds !== [] && Schema::hasColumn('product_groups', 'account_id')) {
            $accountId = DB::table('product_groups')
                ->whereIn('id', collect($productGroupIds)->map(fn ($id) => (int) $id)->filter()->all())
                ->value('account_id');
            if ($accountId) {
                return (int) $accountId;
            }
        }

        $headerAccountId = request()->header('X-Account-Id');
        if (is_numeric($headerAccountId) && (int) $headerAccountId > 0) {
            return (int) $headerAccountId;
        }

        if (auth()->check()) {
            $accountId = auth()->user()->accounts()->value('accounts.id');
            if ($accountId) {
                return (int) $accountId;
            }
        }

        return null;
    }

    private function productIdsForCategories(array $categoryIds, ?int $accountId): array
    {
        return Product::query()
            ->where(function ($query) use ($categoryIds) {
                $query
                    ->whereIn('category_id', $categoryIds)
                    ->orWhereIn('id', function ($subQuery) use ($categoryIds) {
                        $subQuery
                            ->select('product_id')
                            ->from('category_product')
                            ->whereIn('category_id', $categoryIds);
                    });
            })
            ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
            ->whereDoesntHave('parentConfigurable')
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function productIdsForProductGroups(array $productGroupIds, ?int $accountId): array
    {
        if ($productGroupIds === []) {
            return [];
        }

        return Product::query()
            ->whereIn('id', function ($subQuery) use ($productGroupIds) {
                $subQuery
                    ->select('product_id')
                    ->from('product_group_items')
                    ->whereIn('product_group_id', $productGroupIds);
            })
            ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
            ->whereDoesntHave('parentConfigurable')
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function productIdsForBundleProducts(array $bundleProductIds, ?int $accountId): array
    {
        if ($bundleProductIds === []) {
            return [];
        }

        return Product::query()
            ->whereIn('id', collect($bundleProductIds)->map(fn ($id) => (int) $id)->filter()->unique()->values()->all())
            ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
            ->whereDoesntHave('parentConfigurable')
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function currentFaqProducts(ProductFaq $faq): Collection
    {
        if ($this->faqAssignmentsTableExists()) {
            $productIds = DB::table('product_faq_product')
                ->where('product_faq_id', $faq->id)
                ->pluck('product_id')
                ->map(fn ($id) => (int) $id)
                ->all();

            if ($productIds !== []) {
                $products = Product::query()
                    ->select(['id', 'account_id', 'name', 'sku', 'slug', 'type', 'status'])
                    ->whereIn('id', $productIds)
                    ->where('account_id', $faq->account_id)
                    ->whereDoesntHave('parentConfigurable')
                    ->orderBy('name')
                    ->orderBy('id')
                    ->get();

                return $this->withoutCompositeChildren($products);
            }
        }

        return Product::query()
            ->select(['id', 'account_id', 'name', 'sku', 'slug', 'type', 'status'])
            ->whereKey($faq->product_id)
            ->whereDoesntHave('parentConfigurable')
            ->get();
    }

    private function withoutCompositeChildren(Collection $products): Collection
    {
        $products = $products
            ->filter(fn ($product) => $product instanceof Product)
            ->values();
        $parentIds = $products
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values()
            ->all();

        if ($parentIds === []) {
            return $products;
        }

        $childIds = DB::table('product_links')
            ->whereIn('product_id', $parentIds)
            ->whereIn('link_type', ['bundle', 'grouped', 'super_link'])
            ->get(['linked_product_id', 'variant_id'])
            ->flatMap(fn ($link) => [(int) $link->linked_product_id, (int) $link->variant_id])
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->flip();

        if ($childIds->isEmpty()) {
            return $products;
        }

        return $products
            ->reject(fn (Product $product) => $childIds->has((int) $product->id))
            ->values();
    }

    private function syncFaqProducts(ProductFaq $faq, Collection $products): void
    {
        if (!$this->faqAssignmentsTableExists()) {
            return;
        }

        $rows = $products
            ->filter(fn (Product $product) => (int) $product->account_id === (int) $faq->account_id)
            ->unique('id')
            ->map(fn (Product $product) => [
                'account_id' => $faq->account_id,
                'product_faq_id' => $faq->id,
                'product_id' => $product->id,
                'created_at' => now(),
                'updated_at' => now(),
            ])
            ->values()
            ->all();

        DB::table('product_faq_product')
            ->where('product_faq_id', $faq->id)
            ->delete();

        if ($rows !== []) {
            DB::table('product_faq_product')->insertOrIgnore($rows);
        }
    }

    private function assertQuestionIsUniqueForTargets(string $question, int $accountId, array $productIds, ?int $exceptFaqId = null): void
    {
        $normalizedQuestion = $this->normalizeQuestion($question);
        if ($normalizedQuestion === '') {
            return;
        }

        $faqIds = $this->faqIdsForProductIds($productIds);
        if ($faqIds === []) {
            return;
        }

        $duplicates = ProductFaq::query()
            ->where('account_id', $accountId)
            ->whereIn('id', $faqIds)
            ->when($exceptFaqId, fn ($query) => $query->whereKeyNot($exceptFaqId))
            ->get(['id', 'question'])
            ->filter(fn (ProductFaq $faq) => $this->normalizeQuestion((string) $faq->question) === $normalizedQuestion);

        if ($duplicates->isNotEmpty()) {
            throw ValidationException::withMessages([
                'question' => ['Câu hỏi này đã tồn tại trong một sản phẩm đã chọn. Hãy sửa FAQ dùng chung hiện có hoặc đổi nội dung câu hỏi.'],
            ]);
        }
    }

    private function faqIdsForProductIds(array $productIds): array
    {
        $productIds = collect($productIds)
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if ($productIds === []) {
            return [];
        }

        $ids = collect();
        if ($this->faqAssignmentsTableExists()) {
            $ids = $ids->merge(
                DB::table('product_faq_product')
                    ->whereIn('product_id', $productIds)
                    ->pluck('product_faq_id')
            );
        }

        $legacyQuery = ProductFaq::query()->whereIn('product_id', $productIds);
        if ($this->faqAssignmentsTableExists()) {
            $legacyQuery->whereNotExists(function ($subQuery) {
                $subQuery
                    ->selectRaw('1')
                    ->from('product_faq_product')
                    ->whereColumn('product_faq_product.product_faq_id', 'product_faqs.id');
            });
        }

        return $ids
            ->merge($legacyQuery->pluck('id'))
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();
    }

    private function normalizeQuestion(string $question): string
    {
        return Str::of($question)
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', ' ')
            ->squish()
            ->value();
    }

    private function intArrayFromRequest(Request $request, string $key): array
    {
        $value = $request->input($key, []);

        if (is_string($value)) {
            $decoded = json_decode($value, true);
            $value = json_last_error() === JSON_ERROR_NONE ? $decoded : explode(',', $value);
        }

        if (!is_array($value)) {
            return [];
        }

        return collect($value)
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter(fn (?int $id) => $id !== null && $id > 0)
            ->unique()
            ->values()
            ->all();
    }

    private function resolveImagesFromRequest(Request $request, ?ProductFaq $faq = null): array
    {
        $images = $request->has('existing_images')
            ? $this->normalizeExistingImages($request->input('existing_images'))
            : $this->normalizeExistingImages($faq?->images ?? []);

        $files = [];
        if ($request->hasFile('image')) {
            $files[] = $request->file('image');
        }
        if ($request->hasFile('images')) {
            $files = array_merge($files, $request->file('images'));
        }

        if (!empty($files)) {
            $assets = $this->mediaService->uploadImages($files, [
                'collection' => 'product-faqs',
                'source' => 'product-faq-admin',
            ]);

            foreach ($assets as $asset) {
                $payload = $this->mediaService->buildAssetPayload($asset);
                if ($payload) {
                    $images[] = $payload;
                }
            }
        }

        return collect($images)
            ->map(fn ($image) => $this->sanitizeImagePayload($image))
            ->filter()
            ->values()
            ->all();
    }

    private function normalizeExistingImages($value): array
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            $value = json_last_error() === JSON_ERROR_NONE ? $decoded : [];
        }

        if (!is_array($value)) {
            return [];
        }

        return collect($value)
            ->map(fn ($image) => $this->sanitizeImagePayload($image))
            ->filter()
            ->values()
            ->all();
    }

    private function sanitizeImagePayload($image): ?array
    {
        if (is_string($image)) {
            $image = ['url' => trim($image)];
        }

        if (!is_array($image)) {
            return null;
        }

        $payload = [];
        foreach ([
            'id',
            'public_id',
            'url',
            'image_url',
            'thumbnail_url',
            'medium_url',
            'large_url',
            'original_url',
            'width',
            'height',
            'srcset',
        ] as $key) {
            if (array_key_exists($key, $image) && $image[$key] !== null && $image[$key] !== '') {
                $payload[$key] = $image[$key];
            }
        }

        return isset($payload['url']) || isset($payload['image_url']) || isset($payload['large_url'])
            ? $payload
            : null;
    }

    private function cleanYoutubeUrl(?string $value): ?string
    {
        $url = trim((string) $value);

        return $url !== '' ? $url : null;
    }

    private function nextSortOrder(int $productId): int
    {
        $faqIds = $this->faqIdsForProductIds([$productId]);

        if ($faqIds === []) {
            return 1;
        }

        return ((int) ProductFaq::query()
            ->whereIn('id', $faqIds)
            ->max('sort_order')) + 1;
    }

    private function faqLookupProductIds(Product $product): array
    {
        $ids = collect([(int) $product->id]);

        $childLinks = DB::table('product_links')
            ->where('product_id', $product->id)
            ->whereIn('link_type', ['bundle', 'grouped', 'super_link'])
            ->get(['linked_product_id', 'variant_id']);

        $parentLinks = DB::table('product_links')
            ->where(function ($query) use ($product) {
                $query->where('linked_product_id', $product->id)
                    ->orWhere('variant_id', $product->id);
            })
            ->whereIn('link_type', ['bundle', 'grouped', 'super_link'])
            ->pluck('product_id');

        return $ids
            ->merge($childLinks->pluck('linked_product_id'))
            ->merge($childLinks->pluck('variant_id'))
            ->merge($parentLinks)
            ->filter()
            ->map(fn ($id) => (int) $id)
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values()
            ->all();
    }

    private function loadAdminFaqRelations(ProductFaq $faq): ProductFaq
    {
        return $faq->load($this->adminFaqRelations());
    }

    private function adminFaqRelations(): array
    {
        $relations = [
            'product:id,account_id,name,sku,slug,type,status',
        ];

        if ($this->faqAssignmentsTableExists()) {
            $relations[] = 'appliedProducts:id,account_id,name,sku,slug,type,status';
        }
        if ($this->relatedArticleService->tableExists()) {
            $relations[] = 'relatedArticles.post.featuredMediaAsset';
        }

        return $relations;
    }

    private function faqAssignmentsTableExists(): bool
    {
        return Schema::hasTable('product_faq_product');
    }

    private function publicPayload(ProductFaq $faq): array
    {
        return [
            'id' => (int) $faq->id,
            'question' => $faq->question,
            'answer' => $faq->answer,
            'images' => $this->normalizeExistingImages($faq->images ?? []),
            'youtube_url' => $faq->youtube_url,
            'video_url' => $faq->youtube_url,
            'status' => $faq->status ?: ProductFaq::STATUS_VISIBLE,
            'sort_order' => (int) $faq->sort_order,
            'related_articles' => $this->relatedArticleService->publicPayload($faq),
        ];
    }

    private function adminPayload(ProductFaq $faq): array
    {
        $appliedProducts = $faq->relationLoaded('appliedProducts')
            && $faq->appliedProducts->isNotEmpty()
            ? $this->withoutCompositeChildren($faq->appliedProducts)
            : $this->currentFaqProducts($faq);

        return [
            ...$this->publicPayload($faq),
            'product_id' => (int) $faq->product_id,
            'created_at' => optional($faq->created_at)->toIso8601String(),
            'updated_at' => optional($faq->updated_at)->toIso8601String(),
            'product' => $faq->relationLoaded('product') && $faq->product
                ? $this->productPayload($faq->product)
                : null,
            'applied_product_ids' => $appliedProducts->pluck('id')->map(fn ($id) => (int) $id)->values()->all(),
            'applied_products' => $appliedProducts->map(fn (Product $product) => $this->productPayload($product))->values(),
            'applied_count' => $appliedProducts->count(),
            'is_shared' => $appliedProducts->count() > 1,
            'related_articles' => $this->relatedArticleService->adminPayload($faq),
        ];
    }

    private function productPayload(Product $product): array
    {
        return [
            'id' => (int) $product->id,
            'name' => $product->name,
            'sku' => $product->sku,
            'slug' => $product->slug,
            'type' => $product->type,
            'status' => $product->status,
            'faq_count' => (int) ($product->faq_count ?? 0),
        ];
    }
}
