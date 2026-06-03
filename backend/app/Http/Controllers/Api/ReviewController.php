<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductReview;
use App\Models\ProductReviewLike;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Response;
use Illuminate\Validation\Rule;

class ReviewController extends Controller
{
    private const GUEST_RATE_SECONDS = 60;
    private const STATUS_VALUES = [
        ProductReview::STATUS_PENDING,
        ProductReview::STATUS_VISIBLE,
        ProductReview::STATUS_HIDDEN,
    ];
    private const SOURCE_VALUES = [
        ProductReview::SOURCE_CUSTOMER_WEB,
        ProductReview::SOURCE_ADMIN_MANUAL,
        ProductReview::SOURCE_ADMIN_IMPORT,
        ProductReview::SOURCE_ADMIN_SAMPLE,
    ];
    private const BULK_IMPORT_TEXT_MAX_CHARS = 10000000;
    private const BULK_IMPORT_FILE_MAX_KB = 51200;
    private const BULK_IMPORT_ROW_LIMIT = 50000;

    private array $bulkImportProductCache = [];

    public function index(Request $request, $productId)
    {
        $product = Product::query()->findOrFail($productId);
        $visitorHash = $this->visitorHash($request);

        $reviewsQuery = ProductReview::query()
            ->where('product_id', $product->id)
            ->topLevel()
            ->visible()
            ->whereBetween('rating', [1, 5])
            ->with(['visibleReplies' => function ($query) {
                $query->with('user')->withCount('likes')->oldest();
            }, 'user'])
            ->withCount('likes')
            ->latest();

        if ($request->filled('rating')) {
            $rating = (int) $request->query('rating');
            $reviewsQuery->whereBetween('rating', [max(1, $rating - 0.5), min(5, $rating + 0.49)]);
        }

        $reviews = $reviewsQuery
            ->paginate(min(max((int) $request->query('per_page', 10), 1), 10));

        $reviewIds = $reviews->getCollection()
            ->flatMap(function (ProductReview $review) {
                return collect([(int) $review->id])
                    ->merge($review->visibleReplies->pluck('id')->map(fn ($id) => (int) $id));
            })
            ->filter()
            ->unique()
            ->values();

        $likedReviewIds = $reviewIds->isEmpty()
            ? []
            : ProductReviewLike::query()
                ->whereIn('product_review_id', $reviewIds->all())
                ->where('customer_ip_hash', $visitorHash)
                ->pluck('product_review_id')
                ->mapWithKeys(fn ($id) => [(int) $id => true])
                ->all();

        $reviews->setCollection(
            $reviews->getCollection()
                ->map(fn (ProductReview $review) => $this->publicReviewPayload($review, $likedReviewIds))
        );

        $summary = $this->summaryForProduct($product);

        return response()->json([
            'summary' => $summary,
            'reviews' => $reviews->items(),
            'meta' => [
                'current_page' => $reviews->currentPage(),
                'last_page' => $reviews->lastPage(),
                'per_page' => $reviews->perPage(),
                'total' => $reviews->total(),
            ],
        ]);
    }

    public function store(Request $request, $productId)
    {
        $product = Product::query()->findOrFail($productId);
        $visitorHash = $this->visitorHash($request);
        $parentId = $request->integer('parent_id') ?: null;

        $rateKey = 'product-review-submit:' . $product->id . ':' . $visitorHash . ':' . ($parentId ?: 'review');
        if (!Cache::add($rateKey, true, now()->addSeconds(self::GUEST_RATE_SECONDS))) {
            return response()->json([
                'message' => 'Bạn gửi quá nhanh. Vui lòng thử lại sau ít phút.',
            ], 429);
        }

        $rules = [
            'parent_id' => [
                'nullable',
                'integer',
                Rule::exists('product_reviews', 'id')->where(function ($query) use ($product) {
                    $query->where('product_id', $product->id)->whereNull('parent_id');
                }),
            ],
            'customer_name' => 'required|string|max:80',
            'comment' => 'required|string|min:2|max:3000',
        ];

        if (!$parentId) {
            $rules['rating'] = 'required|numeric|min:1|max:5';
        }

        $validated = $request->validate($rules);
        $customerName = trim((string) ($validated['customer_name'] ?? ''));

        if ($customerName === '') {
            return response()->json([
                'message' => 'Vui lòng nhập tên của bạn.',
                'errors' => ['customer_name' => ['Vui lòng nhập tên của bạn.']],
            ], 422);
        }

        $review = ProductReview::create([
            'account_id' => $product->account_id,
            'product_id' => $product->id,
            'parent_id' => $parentId,
            'user_id' => auth()->id(),
            'author_type' => auth()->check() ? 'user' : 'guest',
            'source_type' => ProductReview::SOURCE_CUSTOMER_WEB,
            'customer_name' => $customerName,
            'is_anonymous' => false,
            'rating' => $parentId ? 0 : round((float) $validated['rating'], 1),
            'comment' => trim((string) $validated['comment']),
            'is_approved' => false,
            'status' => ProductReview::STATUS_PENDING,
            'customer_ip_hash' => $visitorHash,
            'customer_user_agent' => mb_substr((string) $request->userAgent(), 0, 255),
            'admin_seen_at' => null,
        ]);

        return response()->json([
            'message' => 'Cảm ơn bạn. Nội dung sẽ hiển thị sau khi được duyệt.',
            'review' => $this->adminReviewPayload($review->load(['product:id,name,sku,slug', 'parent:id,customer_name,comment'])),
            'summary' => $this->summaryForProduct($product),
        ], 201);
    }

    public function like(Request $request, $id)
    {
        $review = ProductReview::query()
            ->visible()
            ->whereKey($id)
            ->firstOrFail();

        $visitorHash = $this->visitorHash($request);
        $agentHash = hash('sha256', (string) $request->userAgent());

        $created = false;
        DB::transaction(function () use ($review, $visitorHash, $agentHash, &$created) {
            $like = ProductReviewLike::firstOrCreate([
                'product_review_id' => $review->id,
                'customer_ip_hash' => $visitorHash,
            ], [
                'account_id' => $review->account_id,
                'customer_user_agent_hash' => $agentHash,
            ]);

            $created = $like->wasRecentlyCreated;

            if ($created) {
                $review->increment('helpful_count');
            }
        });

        $review->refresh();

        return response()->json([
            'liked' => true,
            'changed' => $created,
            'helpful_count' => (int) $review->helpful_count,
        ]);
    }

    public function adminIndex(Request $request)
    {
        $query = ProductReview::query()
            ->with(['product:id,name,sku,slug', 'parent:id,customer_name,comment', 'user:id,name'])
            ->withCount('replies');

        if ($request->filled('search')) {
            $keyword = trim((string) $request->query('search'));
            $query->where(function ($searchQuery) use ($keyword) {
                $searchQuery
                    ->where('customer_name', 'like', "%{$keyword}%")
                    ->orWhere('comment', 'like', "%{$keyword}%")
                    ->orWhereHas('product', function ($productQuery) use ($keyword) {
                        $productQuery
                            ->where('name', 'like', "%{$keyword}%")
                            ->orWhere('sku', 'like', "%{$keyword}%");
                    });
            });
        }

        if ($request->filled('product_id')) {
            $query->where('product_id', (int) $request->query('product_id'));
        }

        if ($request->filled('product')) {
            $keyword = trim((string) $request->query('product'));
            $query->whereHas('product', function ($productQuery) use ($keyword) {
                $productQuery
                    ->where('name', 'like', "%{$keyword}%")
                    ->orWhere('sku', 'like', "%{$keyword}%");
            });
        }

        if ($request->filled('rating')) {
            $rating = (int) $request->query('rating');
            $query->topLevel()->whereBetween('rating', [max(1, $rating - 0.5), min(5, $rating + 0.49)]);
        }

        if ($request->filled('status')) {
            $status = trim((string) $request->query('status'));
            if (in_array($status, self::STATUS_VALUES, true)) {
                $query->where('status', $status);
            }
        }

        if ($request->filled('source_type')) {
            $sourceType = trim((string) $request->query('source_type'));
            if (in_array($sourceType, self::SOURCE_VALUES, true)) {
                $query->where('source_type', $sourceType);
            }
        }

        if ($request->boolean('unread_only')) {
            $query->whereNull('admin_seen_at');
        }

        if ($request->filled('created_from')) {
            $query->whereDate('created_at', '>=', $request->query('created_from'));
        }

        if ($request->filled('created_to')) {
            $query->whereDate('created_at', '<=', $request->query('created_to'));
        }

        if ($request->query('type') === 'reply') {
            $query->whereNotNull('parent_id');
        } elseif ($request->query('type') === 'review') {
            $query->whereNull('parent_id');
        }

        $reviews = $query
            ->latest()
            ->paginate((int) $request->query('per_page', 20))
            ->through(fn (ProductReview $review) => $this->adminReviewPayload($review));

        return response()->json(array_merge($reviews->toArray(), [
            'unread_summary' => $this->reviewUnreadSummary(),
        ]));
    }

    public function adminUnreadSummary()
    {
        return response()->json($this->reviewUnreadSummary());
    }

    public function adminMarkSeen()
    {
        ProductReview::query()
            ->whereNull('admin_seen_at')
            ->update(['admin_seen_at' => now()]);

        return response()->json([
            'message' => 'Đã đánh dấu đã xem.',
            ...$this->reviewUnreadSummary(),
        ]);
    }

    public function adminSeedSample(Request $request)
    {
        if (! app()->environment(['local', 'testing', 'staging', 'development'])) {
            return response()->json([
                'message' => 'Tính năng tạo bình luận ảo/test chỉ được phép chạy ở local/staging/testing.',
            ], 403);
        }

        $validated = $request->validate([
            'min' => 'nullable|integer|min:1|max:100',
            'max' => 'nullable|integer|min:1|max:100',
            'years' => 'nullable|integer|min:1|max:10',
            'status' => ['nullable', Rule::in(self::STATUS_VALUES)],
            'replace' => 'nullable|boolean',
            'all_products' => 'nullable|boolean',
        ]);

        $min = (int) ($validated['min'] ?? 70);
        $max = max($min, (int) ($validated['max'] ?? 100));
        $status = $validated['status'] ?? ProductReview::STATUS_VISIBLE;

        $parameters = [
            '--min' => $min,
            '--max' => $max,
            '--years' => (int) ($validated['years'] ?? 4),
            '--status' => $status,
        ];

        if ($request->boolean('replace', true)) {
            $parameters['--replace'] = true;
        }

        if ($request->boolean('all_products')) {
            $parameters['--all-products'] = true;
        }

        $exitCode = Artisan::call('reviews:seed-sample', $parameters);
        $output = trim(Artisan::output());

        if ($exitCode !== 0) {
            return response()->json([
                'message' => 'Không thể tạo bình luận ảo/test.',
                'output' => $output,
            ], 500);
        }

        return response()->json([
            'message' => 'Đã tạo bình luận ảo/test cho sản phẩm.',
            'summary' => $this->sampleReviewSummary(),
            'output' => $output,
        ]);
    }

    public function adminStore(Request $request)
    {
        $validated = $this->validateAdminPayload($request);
        $product = Product::query()->findOrFail((int) $validated['product_id']);
        $parentId = $validated['parent_id'] ?? null;
        $status = $validated['status'] ?? ProductReview::STATUS_VISIBLE;

        if ($parentId) {
            ProductReview::query()
                ->where('product_id', $product->id)
                ->whereNull('parent_id')
                ->findOrFail((int) $parentId);
        }

        $review = ProductReview::create([
            'account_id' => $product->account_id,
            'product_id' => $product->id,
            'parent_id' => $parentId,
            'user_id' => auth()->id(),
            'author_type' => $parentId ? 'admin' : ($validated['author_type'] ?? 'guest'),
            'source_type' => ProductReview::SOURCE_ADMIN_MANUAL,
            'customer_name' => $this->adminCustomerName($validated),
            'is_anonymous' => (bool) ($validated['is_anonymous'] ?? false),
            'rating' => $parentId ? 0 : round((float) ($validated['rating'] ?? 5), 1),
            'comment' => trim((string) $validated['comment']),
            'status' => $status,
            'is_approved' => $status === ProductReview::STATUS_VISIBLE,
            'created_at' => $validated['created_at'] ?? now(),
            'admin_seen_at' => now(),
        ]);

        return response()->json([
            'message' => 'Đã tạo đánh giá/bình luận.',
            'review' => $this->adminReviewPayload($review->load(['product:id,name,sku,slug', 'parent:id,customer_name,comment'])),
        ], 201);
    }

    public function adminBulkImport(Request $request)
    {
        @set_time_limit(300);

        $validated = $request->validate([
            'payload' => ['nullable', 'string', 'max:' . self::BULK_IMPORT_TEXT_MAX_CHARS, 'required_without:import_file'],
            'import_file' => ['nullable', 'file', 'max:' . self::BULK_IMPORT_FILE_MAX_KB, 'required_without:payload'],
            'mode' => ['nullable', Rule::in(['append', 'replace'])],
            'default_status' => ['nullable', Rule::in([
                ProductReview::STATUS_PENDING,
                ProductReview::STATUS_VISIBLE,
                ProductReview::STATUS_HIDDEN,
            ])],
        ]);

        [$payload, $payloadError] = $this->bulkImportPayloadFromRequest($request, $validated);
        if ($payloadError) {
            return response()->json([
                'message' => $payloadError,
            ], 422);
        }

        [$rows, $parseError] = $this->decodeBulkImportPayload($payload);
        if ($parseError) {
            return response()->json([
                'message' => $parseError,
            ], 422);
        }

        if (count($rows) > self::BULK_IMPORT_ROW_LIMIT) {
            return response()->json([
                'message' => 'Mỗi lần chỉ nên nhập tối đa ' . self::BULK_IMPORT_ROW_LIMIT . ' đánh giá.',
            ], 422);
        }

        $defaultStatus = $validated['default_status'] ?? ProductReview::STATUS_PENDING;
        $mode = $validated['mode'] ?? 'append';
        $resolvedRows = collect($rows)->map(function ($row) {
            return [
                'row' => $row,
                'product' => is_array($row) ? $this->resolveBulkImportProduct($row) : null,
            ];
        })->all();
        $result = [
            'created_reviews' => 0,
            'created_replies' => 0,
            'replaced_products' => 0,
            'deleted_existing' => 0,
            'skipped' => 0,
            'errors' => [],
        ];

        DB::transaction(function () use ($resolvedRows, $defaultStatus, $mode, &$result) {
            if ($mode === 'replace') {
                $productIds = collect($resolvedRows)
                    ->pluck('product.id')
                    ->filter()
                    ->unique()
                    ->values();

                if ($productIds->isNotEmpty()) {
                    $replaceReviewIds = ProductReview::query()
                        ->whereIn('product_id', $productIds)
                        ->whereNull('parent_id')
                        ->whereIn('source_type', [
                            ProductReview::SOURCE_ADMIN_MANUAL,
                            ProductReview::SOURCE_ADMIN_IMPORT,
                            ProductReview::SOURCE_ADMIN_SAMPLE,
                        ])
                        ->pluck('id');

                    $result['replaced_products'] = $productIds->count();
                    $result['deleted_existing'] = $replaceReviewIds->count();

                    if ($replaceReviewIds->isNotEmpty()) {
                        ProductReview::query()
                            ->whereIn('id', $replaceReviewIds)
                            ->delete();
                    }
                }
            }

            foreach ($resolvedRows as $index => $resolvedRow) {
                $row = $resolvedRow['row'];
                $line = $index + 1;
                if (!is_array($row)) {
                    $result['skipped']++;
                    $result['errors'][] = "DÃ²ng {$line}: dá»¯ liá»‡u khÃ´ng Ä‘Ãºng Ä‘á»‹nh dáº¡ng.";
                    continue;
                }

                $product = $resolvedRow['product'];
                if (!$product) {
                    $result['skipped']++;
                    $result['errors'][] = "DÃ²ng {$line}: khÃ´ng tÃ¬m tháº¥y sáº£n pháº©m theo product_id/sku/slug/product_name.";
                    continue;
                }

                $comment = $this->stringValue($row, ['comment', 'content', 'body']);
                if (mb_strlen($comment) < 2 || mb_strlen($comment) > 3000) {
                    $result['skipped']++;
                    $result['errors'][] = "DÃ²ng {$line}: ná»™i dung Ä‘Ã¡nh giÃ¡ pháº£i tá»« 2 Ä‘áº¿n 3000 kÃ½ tá»±.";
                    continue;
                }

                $rating = round((float) ($row['rating'] ?? $row['stars'] ?? 5), 1);
                if ($rating < 1 || $rating > 5) {
                    $result['skipped']++;
                    $result['errors'][] = "DÃ²ng {$line}: sá»‘ sao pháº£i tá»« 1 Ä‘áº¿n 5.";
                    continue;
                }

                $createdAt = $this->parseBulkDate($row['created_at'] ?? $row['date'] ?? null);
                if (!$createdAt) {
                    $result['skipped']++;
                    $result['errors'][] = "DÃ²ng {$line}: thá»i gian khÃ´ng há»£p lá»‡.";
                    continue;
                }

                $rowStatus = $this->bulkStatus($row, $defaultStatus);

                $review = ProductReview::create([
                    'account_id' => $product->account_id,
                    'product_id' => $product->id,
                    'parent_id' => null,
                    'user_id' => auth()->id(),
                    'author_type' => 'guest',
                    'source_type' => ProductReview::SOURCE_ADMIN_IMPORT,
                    'customer_name' => $this->bulkCustomerName($row),
                    'is_anonymous' => false,
                    'rating' => $rating,
                    'comment' => $comment,
                    'status' => $rowStatus,
                    'is_approved' => $rowStatus === ProductReview::STATUS_VISIBLE,
                    'created_at' => $createdAt,
                    'admin_seen_at' => now(),
                ]);

                $result['created_reviews']++;

                foreach ($this->normalizeBulkReplies($row) as $replyIndex => $replyRow) {
                    $replyComment = $this->stringValue($replyRow, ['comment', 'content', 'body', 'reply']);
                    if (mb_strlen($replyComment) < 2 || mb_strlen($replyComment) > 3000) {
                        $result['skipped']++;
                        $replyLine = $replyIndex + 1;
                        $result['errors'][] = "DÃ²ng {$line}, pháº£n há»“i {$replyLine}: ná»™i dung pháº£i tá»« 2 Ä‘áº¿n 3000 kÃ½ tá»±.";
                        continue;
                    }

                    $replyCreatedAt = $this->parseBulkDate(
                        $replyRow['created_at'] ?? $replyRow['date'] ?? null,
                        $createdAt->copy()->addMinutes(5 + $replyIndex)
                    );
                    $replyStatus = $this->bulkStatus($replyRow, $rowStatus);

                    ProductReview::create([
                        'account_id' => $product->account_id,
                        'product_id' => $product->id,
                        'parent_id' => $review->id,
                        'user_id' => auth()->id(),
                        'author_type' => 'admin',
                        'source_type' => ProductReview::SOURCE_ADMIN_IMPORT,
                        'customer_name' => $this->stringValue($replyRow, ['customer_name', 'admin_name', 'name']) ?: 'Quáº£n trá»‹ viÃªn',
                        'is_anonymous' => false,
                        'rating' => 0,
                        'comment' => $replyComment,
                        'status' => $replyStatus,
                        'is_approved' => $replyStatus === ProductReview::STATUS_VISIBLE,
                        'created_at' => $replyCreatedAt,
                        'admin_seen_at' => now(),
                    ]);

                    $result['created_replies']++;
                }
            }
        });

        return response()->json([
            'message' => 'ÄÃ£ nháº­p dá»¯ liá»‡u Ä‘Ã¡nh giÃ¡ hÃ ng loáº¡t.',
            'result' => $result,
        ], 201);
    }

    public function adminExport(Request $request)
    {
        $validated = $request->validate([
            'product_ids' => 'nullable',
            'product_ids.*' => 'integer',
            'source_scope' => ['nullable', Rule::in(['admin_created', 'all', 'customer_web'])],
            'status' => ['nullable', Rule::in(self::STATUS_VALUES)],
        ]);

        $productIds = $this->normalizeIdList($request->query('product_ids', $request->input('product_ids', [])));
        $sourceScope = $validated['source_scope'] ?? $request->query('source_scope', 'admin_created');
        $status = $validated['status'] ?? $request->query('status');

        $query = ProductReview::query()
            ->topLevel()
            ->with(['product:id,name,sku,slug', 'replies' => function ($replyQuery) {
                $replyQuery->oldest();
            }])
            ->latest();

        if (!empty($productIds)) {
            $query->whereIn('product_id', $productIds);
        }

        if ($sourceScope === 'admin_created') {
            $query->whereIn('source_type', [
                ProductReview::SOURCE_ADMIN_MANUAL,
                ProductReview::SOURCE_ADMIN_IMPORT,
                ProductReview::SOURCE_ADMIN_SAMPLE,
            ]);
        } elseif ($sourceScope === 'customer_web') {
            $query->where('source_type', ProductReview::SOURCE_CUSTOMER_WEB);
        }

        if ($status) {
            $query->where('status', $status);
        }

        $rows = $query
            ->get()
            ->map(fn (ProductReview $review) => $this->exportReviewPayload($review))
            ->values()
            ->all();

        $filename = 'product-reviews-' . now()->format('Ymd-His') . '.json';
        $json = json_encode($rows, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        return Response::make($json ?: '[]', 200, [
            'Content-Type' => 'application/json; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
        ]);
    }

    public function adminShow($id)
    {
        $review = ProductReview::query()
            ->with(['product:id,name,sku,slug', 'parent:id,customer_name,comment', 'user:id,name'])
            ->findOrFail($id);

        return response()->json($this->adminReviewPayload($review));
    }

    public function adminUpdate(Request $request, $id)
    {
        $review = ProductReview::query()->findOrFail($id);
        $validated = $this->validateAdminPayload($request, $review);
        $status = $validated['status'] ?? $review->status ?? ProductReview::STATUS_PENDING;
        $productId = (int) ($validated['product_id'] ?? $review->product_id);

        if ($productId !== (int) $review->product_id) {
            $product = Product::query()->findOrFail($productId);
            $review->product_id = $product->id;
            $review->account_id = $product->account_id;
        }

        $parentId = $validated['parent_id'] ?? $review->parent_id;
        if ($parentId) {
            ProductReview::query()
                ->where('product_id', $review->product_id)
                ->whereNull('parent_id')
                ->whereKeyNot($review->id)
                ->findOrFail((int) $parentId);
        }

        $review->fill([
            'parent_id' => $parentId,
            'author_type' => $validated['author_type'] ?? $review->author_type,
            'customer_name' => $this->adminCustomerName($validated, $review),
            'is_anonymous' => (bool) ($validated['is_anonymous'] ?? $review->is_anonymous),
            'rating' => $parentId ? 0 : round((float) ($validated['rating'] ?? $review->rating ?: 5), 1),
            'comment' => trim((string) ($validated['comment'] ?? $review->comment)),
            'status' => $status,
            'is_approved' => $status === ProductReview::STATUS_VISIBLE,
        ]);

        if (array_key_exists('created_at', $validated)) {
            $review->created_at = $validated['created_at'];
        }

        $review->save();

        return response()->json([
            'message' => 'Đã cập nhật đánh giá/bình luận.',
            'review' => $this->adminReviewPayload($review->load(['product:id,name,sku,slug', 'parent:id,customer_name,comment'])),
        ]);
    }

    public function adminDestroy($id)
    {
        ProductReview::query()->findOrFail($id)->delete();

        return response()->json(['message' => 'Đã xóa đánh giá/bình luận.']);
    }

    public function approve($id)
    {
        return $this->setStatus($id, ProductReview::STATUS_VISIBLE);
    }

    public function hide($id)
    {
        return $this->setStatus($id, ProductReview::STATUS_HIDDEN);
    }

    private function setStatus($id, string $status)
    {
        $review = ProductReview::query()->findOrFail($id);
        $review->update([
            'status' => $status,
            'is_approved' => $status === ProductReview::STATUS_VISIBLE,
        ]);

        return response()->json([
            'message' => 'Đã cập nhật trạng thái.',
            'review' => $this->adminReviewPayload($review->load(['product:id,name,sku,slug', 'parent:id,customer_name,comment'])),
        ]);
    }

    private function validateAdminPayload(Request $request, ?ProductReview $review = null): array
    {
        $parentId = $request->integer('parent_id') ?: ($review?->parent_id ?: null);

        $rules = [
            'product_id' => [$review ? 'sometimes' : 'required', 'integer', 'exists:products,id'],
            'parent_id' => 'nullable|integer|exists:product_reviews,id',
            'author_type' => 'nullable|string|in:guest,user,admin',
            'customer_name' => 'nullable|string|max:80',
            'is_anonymous' => 'nullable|boolean',
            'comment' => [$review ? 'sometimes' : 'required', 'string', 'min:2', 'max:3000'],
            'status' => ['nullable', Rule::in(self::STATUS_VALUES)],
            'created_at' => 'nullable|date',
        ];

        if (!$parentId) {
            $rules['rating'] = [$review ? 'sometimes' : 'required', 'numeric', 'min:1', 'max:5'];
        } else {
            $rules['rating'] = 'nullable|numeric|min:1|max:5';
        }

        return $request->validate($rules);
    }

    private function bulkImportPayloadFromRequest(Request $request, array $validated): array
    {
        $file = $request->file('import_file');
        if ($file) {
            if (!$file->isValid()) {
                return ['', 'File JSON upload không hợp lệ.'];
            }

            $contents = @file_get_contents($file->getRealPath());
            if ($contents === false || trim((string) $contents) === '') {
                return ['', 'File JSON đang trống hoặc không đọc được.'];
            }

            return [(string) $contents, null];
        }

        return [(string) ($validated['payload'] ?? ''), null];
    }

    private function decodeBulkImportPayload(string $payload): array
    {
        $payload = trim($payload);
        $payload = preg_replace('/^\xEF\xBB\xBF/', '', $payload) ?? $payload;
        $payload = preg_replace('/^```(?:json)?\s*/i', '', $payload) ?? $payload;
        $payload = preg_replace('/\s*```$/', '', $payload) ?? $payload;

        $decoded = json_decode($payload, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return [[], 'JSON khÃ´ng há»£p lá»‡: ' . json_last_error_msg()];
        }

        if (is_array($decoded) && isset($decoded['reviews']) && is_array($decoded['reviews'])) {
            $decoded = $decoded['reviews'];
        } elseif (is_array($decoded) && isset($decoded['items']) && is_array($decoded['items'])) {
            $decoded = $decoded['items'];
        }

        if (!is_array($decoded) || !$this->isListArray($decoded)) {
            return [[], 'JSON cáº§n lÃ  máº£ng Ä‘Ã¡nh giÃ¡, hoáº·c object cÃ³ khá»³a reviews/items.'];
        }

        if (count($decoded) === 0) {
            return [[], 'Danh sÃ¡ch Ä‘Ã¡nh giÃ¡ Ä‘ang trá»‘ng.'];
        }

        return [$decoded, null];
    }

    private function isListArray(array $value): bool
    {
        if ($value === []) {
            return true;
        }

        return array_keys($value) === range(0, count($value) - 1);
    }

    private function resolveBulkImportProduct(array $row): ?Product
    {
        $productId = $this->stringValue($row, ['product_id']);
        if ($productId !== '' && ctype_digit($productId)) {
            $product = $this->cachedBulkImportProduct('id', $productId, fn () => Product::query()->find((int) $productId));
            if ($product) {
                return $product;
            }
        }

        $sku = $this->stringValue($row, ['sku', 'product_sku']);
        if ($sku !== '') {
            $product = $this->cachedBulkImportProduct('sku', $sku, fn () => Product::query()->where('sku', $sku)->first());
            if ($product) {
                return $product;
            }
        }

        $slug = $this->stringValue($row, ['slug', 'product_slug']);
        if ($slug !== '') {
            $product = $this->cachedBulkImportProduct('slug', $slug, fn () => Product::query()->where('slug', $slug)->first());
            if ($product) {
                return $product;
            }
        }

        $name = $this->stringValue($row, ['product_name', 'name']);
        if ($name !== '') {
            return $this->cachedBulkImportProduct('name', $name, fn () => Product::query()
                ->where(function ($query) use ($name) {
                    $query
                        ->where('name', $name)
                        ->orWhere('name', 'like', "%{$name}%");
                })
                ->first());
        }

        return null;
    }

    private function cachedBulkImportProduct(string $bucket, string $key, callable $lookup): ?Product
    {
        $cacheKey = mb_strtolower(trim($key));
        if ($cacheKey === '') {
            return null;
        }

        if (array_key_exists($cacheKey, $this->bulkImportProductCache[$bucket] ?? [])) {
            $cached = $this->bulkImportProductCache[$bucket][$cacheKey];

            return $cached instanceof Product ? $cached : null;
        }

        $product = $lookup();
        $this->bulkImportProductCache[$bucket][$cacheKey] = $product instanceof Product ? $product : false;

        return $product instanceof Product ? $product : null;
    }

    private function normalizeBulkReplies(array $row): array
    {
        $replies = $row['replies'] ?? $row['admin_replies'] ?? $row['responses'] ?? [];
        if (is_string($replies) && trim($replies) !== '') {
            return [['comment' => $replies]];
        }

        if (!is_array($replies)) {
            return [];
        }

        if (!$this->isListArray($replies)) {
            return [$replies];
        }

        return collect($replies)
            ->map(fn ($reply) => is_string($reply) ? ['comment' => $reply] : $reply)
            ->filter(fn ($reply) => is_array($reply))
            ->values()
            ->all();
    }

    private function bulkStatus(array $row, string $defaultStatus): string
    {
        $status = $this->stringValue($row, ['status', 'review_status']);

        return in_array($status, self::STATUS_VALUES, true) ? $status : $defaultStatus;
    }

    private function stringValue(array $row, array $keys): string
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $row) && $row[$key] !== null) {
                return trim((string) $row[$key]);
            }
        }

        return '';
    }

    private function bulkCustomerName(array $row): ?string
    {
        $name = $this->stringValue($row, ['customer_name', 'author_name', 'reviewer_name']);

        return $name !== '' ? $name : 'KhÃ¡ch hÃ ng';
    }

    private function parseBulkDate($value, ?Carbon $fallback = null): ?Carbon
    {
        if ($value === null || trim((string) $value) === '') {
            return $fallback ?: now();
        }

        try {
            return Carbon::parse($value);
        } catch (\Throwable) {
            return $fallback;
        }
    }

    private function normalizeIdList($value): array
    {
        if (is_string($value)) {
            $value = preg_split('/[\s,]+/', $value) ?: [];
        }

        if (!is_array($value)) {
            return [];
        }

        return collect($value)
            ->flatten()
            ->map(fn ($item) => (int) $item)
            ->filter(fn ($item) => $item > 0)
            ->unique()
            ->values()
            ->all();
    }

    private function exportReviewPayload(ProductReview $review): array
    {
        $product = $review->product;
        $payload = [
            'sku' => $product?->sku,
            'product_name' => $product?->name,
            'product_slug' => $product?->slug,
            'customer_name' => $this->maskPhoneNumbers($review->customer_name),
            'rating' => $this->reviewRating($review),
            'comment' => $this->maskPhoneNumbers($review->comment),
            'status' => $review->status ?: ProductReview::STATUS_PENDING,
            'created_at' => optional($review->created_at)->format('Y-m-d H:i:s'),
        ];

        $replies = $review->replies
            ->map(fn (ProductReview $reply) => [
                'admin_name' => $this->maskPhoneNumbers($reply->customer_name ?: 'Gốm Đại Thành'),
                'comment' => $this->maskPhoneNumbers($reply->comment),
                'status' => $reply->status ?: ($review->status ?: ProductReview::STATUS_PENDING),
                'created_at' => optional($reply->created_at)->format('Y-m-d H:i:s'),
            ])
            ->values()
            ->all();

        if (!empty($replies)) {
            $payload['replies'] = $replies;
        }

        return array_filter($payload, fn ($value) => $value !== null && $value !== '');
    }

    private function reviewUnreadSummary(): array
    {
        $summary = ProductReview::query()
            ->whereNull('admin_seen_at')
            ->selectRaw('COUNT(*) as total')
            ->selectRaw('SUM(CASE WHEN parent_id IS NULL THEN 1 ELSE 0 END) as reviews')
            ->selectRaw('SUM(CASE WHEN parent_id IS NOT NULL THEN 1 ELSE 0 END) as replies')
            ->first();

        return [
            'total' => (int) ($summary->total ?? 0),
            'reviews' => (int) ($summary->reviews ?? 0),
            'replies' => (int) ($summary->replies ?? 0),
        ];
    }

    private function sampleReviewSummary(): array
    {
        $baseQuery = ProductReview::query()
            ->where('source_type', ProductReview::SOURCE_ADMIN_SAMPLE);
        $topLevelQuery = (clone $baseQuery)->whereNull('parent_id');

        return [
            'products' => (clone $topLevelQuery)->distinct('product_id')->count('product_id'),
            'reviews' => (clone $topLevelQuery)->count(),
            'visible_reviews' => (clone $topLevelQuery)->visible()->count(),
            'replies' => (clone $baseQuery)->whereNotNull('parent_id')->count(),
        ];
    }

    private function sourceLabel(?string $sourceType): string
    {
        return match ($sourceType) {
            ProductReview::SOURCE_ADMIN_MANUAL => 'Mẫu admin',
            ProductReview::SOURCE_ADMIN_IMPORT => 'Import JSON',
            ProductReview::SOURCE_ADMIN_SAMPLE => 'Bình luận ảo/test',
            ProductReview::SOURCE_CUSTOMER_WEB => 'Khách gửi từ website',
            default => 'Không rõ nguồn',
        };
    }

    private function reviewRating(ProductReview $review): float
    {
        return round(max(0, min(5, (float) $review->rating)), 1);
    }

    private function maskPhoneNumbers(?string $value): ?string
    {
        if ($value === null || $value === '') {
            return $value;
        }

        return preg_replace_callback('/(?<!\d)(\+?84|0)\d{8,10}(?!\d)/', function (array $matches) {
            $digits = preg_replace('/\D+/', '', $matches[0]);
            if (strlen($digits) < 9) {
                return $matches[0];
            }

            $hiddenLength = max(3, strlen($digits) - 6);

            return substr($digits, 0, 3) . str_repeat('*', $hiddenLength) . substr($digits, -3);
        }, $value);
    }

    private function adminCustomerName(array $validated, ?ProductReview $review = null): ?string
    {
        if ((bool) ($validated['is_anonymous'] ?? $review?->is_anonymous ?? false)) {
            return null;
        }

        $name = trim((string) ($validated['customer_name'] ?? $review?->customer_name ?? ''));

        return $name !== '' ? $name : 'Khách hàng';
    }

    private function summaryForProduct(Product $product): array
    {
        return $product->reviewSummary();
    }

    private function publicReviewPayload(ProductReview $review, array $likedReviewIds): array
    {
        if (!$review->isReply()) {
            $review->loadMissing(['visibleReplies' => function ($query) {
                $query->with('user')->withCount('likes')->oldest();
            }]);
        }

        $likesCount = (int) ($review->likes_count ?? $review->likes()->count());

        return [
            'id' => (int) $review->id,
            'parent_id' => $review->parent_id ? (int) $review->parent_id : null,
            'author_type' => $review->author_type ?: 'guest',
            'customer_name' => $this->maskPhoneNumbers($this->displayName($review)),
            'is_anonymous' => (bool) $review->is_anonymous,
            'rating' => $review->isReply() ? null : $this->reviewRating($review),
            'comment' => $this->maskPhoneNumbers($review->comment),
            'helpful_count' => (int) $review->helpful_count,
            'likes_count' => $likesCount,
            'is_liked' => isset($likedReviewIds[(int) $review->id]),
            'created_at' => optional($review->created_at)->toIso8601String(),
            'is_admin_reply' => $review->author_type === 'admin',
            'replies' => ($review->isReply() ? collect() : $review->visibleReplies)
                ->map(fn (ProductReview $reply) => $this->publicReviewPayload($reply, $likedReviewIds))
                ->values(),
        ];
    }

    private function adminReviewPayload(ProductReview $review): array
    {
        return [
            'id' => (int) $review->id,
            'product_id' => (int) $review->product_id,
            'parent_id' => $review->parent_id ? (int) $review->parent_id : null,
            'author_type' => $review->author_type ?: 'guest',
            'source_type' => $review->source_type ?: ProductReview::SOURCE_CUSTOMER_WEB,
            'source_label' => $this->sourceLabel($review->source_type),
            'is_unread' => $review->admin_seen_at === null,
            'customer_name' => $this->maskPhoneNumbers($review->customer_name),
            'display_name' => $this->maskPhoneNumbers($this->displayName($review)),
            'is_anonymous' => (bool) $review->is_anonymous,
            'rating' => $review->isReply() ? null : $this->reviewRating($review),
            'comment' => $this->maskPhoneNumbers($review->comment),
            'status' => $review->status ?: ($review->is_approved ? ProductReview::STATUS_VISIBLE : ProductReview::STATUS_PENDING),
            'is_approved' => (bool) $review->is_approved,
            'helpful_count' => (int) $review->helpful_count,
            'created_at' => optional($review->created_at)->toIso8601String(),
            'updated_at' => optional($review->updated_at)->toIso8601String(),
            'replies_count' => (int) ($review->replies_count ?? 0),
            'product' => $review->relationLoaded('product') && $review->product ? [
                'id' => (int) $review->product->id,
                'name' => $review->product->name,
                'sku' => $review->product->sku,
                'slug' => $review->product->slug,
            ] : null,
            'parent' => $review->relationLoaded('parent') && $review->parent ? [
                'id' => (int) $review->parent->id,
                'customer_name' => $this->maskPhoneNumbers($this->displayName($review->parent)),
                'comment' => $this->maskPhoneNumbers($review->parent->comment),
            ] : null,
        ];
    }

    private function displayName(ProductReview $review): string
    {
        if ($review->is_anonymous) {
            return 'Ẩn danh';
        }

        $name = trim((string) $review->customer_name);
        if ($name !== '') {
            return $name;
        }

        if ($review->user?->name) {
            return $review->user->name;
        }

        return $review->author_type === 'admin' ? 'Quản trị viên' : 'Khách hàng';
    }

    private function visitorHash(Request $request): string
    {
        $ip = (string) $request->ip();
        $agent = mb_substr((string) $request->userAgent(), 0, 160);
        $secret = (string) config('app.key', 'product-review-secret');

        return hash_hmac('sha256', "{$ip}|{$agent}", $secret);
    }
}
