<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\BlogCategory;
use App\Models\Post;
use App\Models\PostSeoKeyword;
use App\Services\BlogBundleService;
use App\Services\BlogMediaGallerySupport;
use App\Services\BlogSystemPostService;
use DOMDocument;
use DOMXPath;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Throwable;
use ZipArchive;

class BlogController extends Controller
{
    private const MEDIA_GALLERY_BLOCK_CLASS = 'ql-bdt-media-gallery';
    private const MEDIA_GALLERY_PAYLOAD_ATTRIBUTE = 'data-gallery-payload';
    private const YOUTUBE_VIDEO_ID_PATTERN = '/^[a-zA-Z0-9_-]{6,}$/';

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $baseQuery = Post::query();
        $accountId = $this->applyAccountScope($baseQuery, $request);

        $query = clone $baseQuery;

        if ($this->hasBlogCategorySupport()) {
            $query->with(['category:id,account_id,name,slug,sort_order']);
        }

        // Public visitors only see visible non-system posts.
        if (!$request->user()) {
            $query->published();

            if ($this->hasSystemPostSupport()) {
                $query->where(function (Builder $publicQuery) {
                    $publicQuery->whereNull('is_system')
                        ->orWhere('is_system', false);
                });
            }
        }

        $search = trim((string) $request->query('search', ''));
        if ($search !== '') {
            $this->applySearchFilter($query, $search);
        }

        $seoKeyword = trim((string) $request->query('seo_keyword', ''));
        if ($seoKeyword !== '') {
            $query->where('seo_keyword', $seoKeyword);
        }

        if ($this->hasBlogCategorySupport()) {
            $categoryFilter = $request->query('category_id');
            if ($categoryFilter !== null && $categoryFilter !== '' && $categoryFilter !== 'all') {
                $categoryFilter = trim((string) $categoryFilter);

                if (in_array(Str::lower($categoryFilter), ['uncategorized', 'none', 'null'], true)) {
                    $query->whereNull('blog_category_id');
                } elseif (is_numeric($categoryFilter)) {
                    $query->where('blog_category_id', (int) $categoryFilter);
                } else {
                    $query->whereHas('category', function (Builder $categoryQuery) use ($categoryFilter) {
                        $categoryQuery->where('slug', $categoryFilter);
                    });
                }
            }

            $categorySlug = trim((string) $request->query('category_slug', ''));
            if ($categorySlug !== '') {
                $query->whereHas('category', function (Builder $categoryQuery) use ($categorySlug) {
                    $categoryQuery->where('slug', $categorySlug);
                });
            }
        }

        $statusFilter = $request->query('is_published');
        if ($statusFilter !== null && $statusFilter !== '' && $statusFilter !== 'all') {
            $query->where('is_published', $this->normalizeFlag($statusFilter));
        }

        $starFilter = $request->query('is_starred');
        if ($starFilter !== null && $starFilter !== '' && $starFilter !== 'all') {
            $query->where('is_starred', $this->normalizeFlag($starFilter));
        }

        if ($this->hasSystemPostSupport()) {
            $systemFilter = $request->query('is_system');
            if ($systemFilter !== null && $systemFilter !== '' && $systemFilter !== 'all') {
                $query->where('is_system', $this->normalizeFlag($systemFilter));
            }
        }

        $defaultPerPage = $request->user() ? 200 : 9;
        $perPage = min(max((int) $request->query('per_page', $defaultPerPage), 1), 1000);

        if ($this->hasSystemPostSupport()) {
            $query->orderByDesc('is_system');
        }

        $posts = $query
            ->orderBy('sort_order')
            ->orderByDesc('created_at')
            ->paginate($perPage);

        $payload = $posts->toArray();
        $payload['seo_keywords'] = $this->seoKeywordCollection($accountId, $baseQuery);
        $payload['categories'] = $this->blogCategoryCollection($accountId, $baseQuery);

        return response()->json($payload);
    }

    /**
     * List managed SEO keywords for current account.
     */
    public function seoKeywords(Request $request)
    {
        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        return response()->json([
            'data' => $this->seoKeywordCollection($accountId),
        ]);
    }

    /**
     * Create a new managed SEO keyword.
     */
    public function storeSeoKeyword(Request $request)
    {
        $validated = $request->validate([
            'keyword' => 'required|string|max:255',
        ]);

        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        if (!$this->hasSeoKeywordTable()) {
            return response()->json(['error' => 'SEO keyword storage is not ready. Please run migrations.'], 503);
        }

        $keyword = $this->normalizeKeyword($validated['keyword'] ?? null);
        if ($keyword === null) {
            return response()->json(['error' => 'Keyword is required'], 422);
        }

        $record = PostSeoKeyword::firstOrCreate([
            'account_id' => $accountId,
            'keyword' => $keyword,
        ]);

        return response()->json([
            'id' => (int) $record->id,
            'keyword' => $record->keyword,
        ], $record->wasRecentlyCreated ? 201 : 200);
    }

    /**
     * Update an existing managed SEO keyword.
     */
    public function updateSeoKeyword(Request $request, int $id)
    {
        $validated = $request->validate([
            'keyword' => 'required|string|max:255',
        ]);

        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        if (!$this->hasSeoKeywordTable()) {
            return response()->json(['error' => 'SEO keyword storage is not ready. Please run migrations.'], 503);
        }

        $keyword = $this->normalizeKeyword($validated['keyword'] ?? null);
        if ($keyword === null) {
            return response()->json(['error' => 'Keyword is required'], 422);
        }

        $record = PostSeoKeyword::where('account_id', $accountId)->whereKey($id)->firstOrFail();
        $oldKeyword = $record->keyword;

        $duplicateExists = PostSeoKeyword::where('account_id', $accountId)
            ->where('keyword', $keyword)
            ->where('id', '<>', $record->id)
            ->exists();

        if ($duplicateExists) {
            return response()->json(['error' => 'Keyword already exists.'], 422);
        }

        DB::transaction(function () use ($accountId, $record, $oldKeyword, $keyword) {
            $record->update(['keyword' => $keyword]);

            if ($oldKeyword !== $keyword) {
                Post::where('account_id', $accountId)
                    ->where('seo_keyword', $oldKeyword)
                    ->update(['seo_keyword' => $keyword]);
            }
        });

        return response()->json([
            'id' => (int) $record->id,
            'keyword' => $record->keyword,
        ]);
    }

    /**
     * Delete a managed SEO keyword and clear it from related posts.
     */
    public function destroySeoKeyword(Request $request, int $id)
    {
        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        if (!$this->hasSeoKeywordTable()) {
            return response()->json(['error' => 'SEO keyword storage is not ready. Please run migrations.'], 503);
        }

        $record = PostSeoKeyword::where('account_id', $accountId)->whereKey($id)->firstOrFail();
        $keyword = $record->keyword;

        DB::transaction(function () use ($accountId, $record, $keyword) {
            $record->delete();

            Post::where('account_id', $accountId)
                ->where('seo_keyword', $keyword)
                ->update(['seo_keyword' => null]);
        });

        return response()->json([
            'message' => 'SEO keyword deleted successfully.',
        ]);
    }

    /**
     * Bulk assign or clear SEO keyword on selected posts.
     */
    public function bulkSeoKeyword(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
            'operation' => 'required|string|in:assign,clear',
            'seo_keyword' => 'nullable|string|max:255',
        ]);

        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        $ids = array_values(array_unique(array_map('intval', $validated['ids'])));
        $operation = (string) $validated['operation'];
        $keyword = $this->normalizeKeyword($validated['seo_keyword'] ?? null);

        if ($operation === 'assign' && $keyword === null) {
            return response()->json(['error' => 'seo_keyword is required for assign operation'], 422);
        }

        $existingIds = Post::where('account_id', $accountId)
            ->whereIn('id', $ids)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $invalidIds = array_values(array_diff($ids, $existingIds));
        if (!empty($invalidIds)) {
            return response()->json([
                'error' => 'Some post IDs are invalid for this account.',
                'invalid_ids' => $invalidIds,
            ], 422);
        }

        DB::transaction(function () use ($accountId, $ids, $operation, $keyword) {
            if ($operation === 'assign') {
                Post::where('account_id', $accountId)
                    ->whereIn('id', $ids)
                    ->update(['seo_keyword' => $keyword]);
                $this->ensureSeoKeywordExists($accountId, $keyword);
                return;
            }

            Post::where('account_id', $accountId)
                ->whereIn('id', $ids)
                ->update(['seo_keyword' => null]);
        });

        return response()->json([
            'message' => $operation === 'assign'
                ? 'SEO keyword assigned successfully.'
                : 'SEO keyword removed successfully.',
            'updated_count' => count($ids),
            'operation' => $operation,
            'seo_keyword' => $operation === 'assign' ? $keyword : null,
        ]);
    }

    /**
     * List blog categories for current account.
     */
    public function categories(Request $request)
    {
        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        if (!$this->hasBlogCategorySupport()) {
            return response()->json(['data' => []]);
        }

        return response()->json([
            'data' => $this->blogCategoryCollection($accountId),
        ]);
    }

    /**
     * Create a new blog category.
     */
    public function storeCategory(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'slug' => 'nullable|string|max:255',
            'sort_order' => 'nullable|integer|min:1',
        ]);

        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        if (!$this->hasBlogCategorySupport()) {
            return response()->json(['error' => 'Blog category storage is not ready. Please run migrations.'], 503);
        }

        $name = trim((string) $validated['name']);
        $slugSource = trim((string) ($validated['slug'] ?? '')) ?: $name;
        $sortOrder = (int) ($validated['sort_order'] ?? $this->nextCategorySortOrder($accountId));

        $category = BlogCategory::create([
            'account_id' => $accountId,
            'name' => $name,
            'slug' => $this->buildUniqueCategorySlug($slugSource, $accountId),
            'sort_order' => max($sortOrder, 1),
        ]);

        return response()->json([
            'id' => (int) $category->id,
            'name' => $category->name,
            'slug' => $category->slug,
            'sort_order' => (int) $category->sort_order,
        ], 201);
    }

    /**
     * Update a blog category.
     */
    public function updateCategory(Request $request, int $id)
    {
        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'slug' => 'nullable|string|max:255',
            'sort_order' => 'nullable|integer|min:1',
        ]);

        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        if (!$this->hasBlogCategorySupport()) {
            return response()->json(['error' => 'Blog category storage is not ready. Please run migrations.'], 503);
        }

        $category = BlogCategory::where('account_id', $accountId)->whereKey($id)->firstOrFail();

        $updates = [];

        if (array_key_exists('name', $validated)) {
            $updates['name'] = trim((string) $validated['name']);
        }

        if (array_key_exists('sort_order', $validated) && $validated['sort_order'] !== null) {
            $updates['sort_order'] = max((int) $validated['sort_order'], 1);
        }

        if (array_key_exists('slug', $validated) || array_key_exists('name', $validated)) {
            $slugSource = trim((string) ($validated['slug'] ?? ''));
            if ($slugSource === '') {
                $slugSource = (string) ($updates['name'] ?? $category->name);
            }

            $updates['slug'] = $this->buildUniqueCategorySlug($slugSource, $accountId, $category->id);
        }

        if (!empty($updates)) {
            $category->update($updates);
        }

        return response()->json([
            'id' => (int) $category->id,
            'name' => $category->name,
            'slug' => $category->slug,
            'sort_order' => (int) $category->sort_order,
        ]);
    }

    /**
     * Delete a blog category.
     */
    public function destroyCategory(Request $request, int $id)
    {
        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        if (!$this->hasBlogCategorySupport()) {
            return response()->json(['error' => 'Blog category storage is not ready. Please run migrations.'], 503);
        }

        $category = BlogCategory::where('account_id', $accountId)->whereKey($id)->firstOrFail();
        $category->delete();
        $this->resequenceCategorySortOrders($accountId);

        return response()->json(['message' => 'Category deleted successfully']);
    }

    /**
     * Reorder categories in admin.
     */
    public function reorderCategories(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
        ]);

        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        if (!$this->hasBlogCategorySupport()) {
            return response()->json(['error' => 'Blog category storage is not ready. Please run migrations.'], 503);
        }

        $providedIds = array_values(array_unique(array_map('intval', $validated['ids'])));

        $currentIds = BlogCategory::where('account_id', $accountId)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $invalidIds = array_values(array_diff($providedIds, $currentIds));
        if (!empty($invalidIds)) {
            return response()->json([
                'error' => 'Some category IDs are invalid for this account.',
                'invalid_ids' => $invalidIds,
            ], 422);
        }

        $remainingIds = array_values(array_diff($currentIds, $providedIds));
        $finalOrder = array_merge($providedIds, $remainingIds);

        DB::transaction(function () use ($accountId, $finalOrder) {
            foreach ($finalOrder as $index => $categoryId) {
                BlogCategory::where('account_id', $accountId)
                    ->whereKey($categoryId)
                    ->update(['sort_order' => $index + 1]);
            }
        });

        return response()->json(['message' => 'Categories reordered successfully']);
    }

    /**
     * Bulk assign or clear category for selected posts.
     */
    public function bulkCategory(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
            'operation' => 'required|string|in:assign,clear',
            'blog_category_id' => 'nullable|integer',
        ]);

        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        if (!$this->hasBlogCategorySupport()) {
            return response()->json(['error' => 'Blog category storage is not ready. Please run migrations.'], 503);
        }

        $ids = array_values(array_unique(array_map('intval', $validated['ids'])));
        $operation = (string) $validated['operation'];
        $categoryId = $validated['blog_category_id'] ?? null;

        if ($operation === 'assign' && $categoryId === null) {
            return response()->json(['error' => 'blog_category_id is required for assign operation'], 422);
        }

        $existingPostIds = Post::where('account_id', $accountId)
            ->whereIn('id', $ids)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $invalidIds = array_values(array_diff($ids, $existingPostIds));
        if (!empty($invalidIds)) {
            return response()->json([
                'error' => 'Some post IDs are invalid for this account.',
                'invalid_ids' => $invalidIds,
            ], 422);
        }

        $category = null;
        if ($operation === 'assign') {
            $category = BlogCategory::where('account_id', $accountId)->whereKey((int) $categoryId)->first();
            if (!$category) {
                return response()->json(['error' => 'Category not found for this account.'], 422);
            }
        }

        Post::where('account_id', $accountId)
            ->whereIn('id', $ids)
            ->update([
                'blog_category_id' => $operation === 'assign' ? (int) $category->id : null,
            ]);

        return response()->json([
            'message' => $operation === 'assign'
                ? 'Category assigned successfully.'
                : 'Category removed successfully.',
            'updated_count' => count($ids),
            'operation' => $operation,
            'blog_category_id' => $operation === 'assign' ? (int) $category->id : null,
        ]);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'title' => 'required|string|max:255',
            'slug' => 'nullable|string|max:255',
            'blog_category_id' => 'nullable|integer',
            'seo_keyword' => 'nullable|string|max:255',
            'content' => 'required|string',
            'excerpt' => 'nullable|string',
            'featured_image' => 'nullable|string|max:2048',
            'is_published' => 'sometimes|boolean',
            'is_starred' => 'sometimes|boolean',
            'sort_order' => 'nullable|integer|min:1',
            'published_at' => 'nullable|date',
        ]);

        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        $validated['account_id'] = $accountId;
        $validated['blog_category_id'] = $this->resolveCategoryIdForAccount(
            $accountId,
            $validated['blog_category_id'] ?? null
        );
        $validated['seo_keyword'] = $this->normalizeKeyword($validated['seo_keyword'] ?? null);
        $validated['content'] = BlogMediaGallerySupport::normalizeHtml((string) ($validated['content'] ?? ''));
        $validated['is_published'] = array_key_exists('is_published', $validated)
            ? (bool) $validated['is_published']
            : true;
        $validated['is_starred'] = array_key_exists('is_starred', $validated)
            ? (bool) $validated['is_starred']
            : false;
        $validated['sort_order'] = $validated['sort_order'] ?? $this->nextSortOrder($accountId);
        $validated['slug'] = $this->buildUniqueSlug(
            $validated['slug'] ?? $validated['title'],
            $accountId
        );
        if ($this->hasSystemPostSupport()) {
            $validated['is_system'] = false;
        }

        $post = Post::create($validated)->load('category');
        $this->ensureSeoKeywordExists($accountId, $validated['seo_keyword']);

        return response()->json($post, 201);
    }

    /**
     * Display the specified resource.
     */
    public function show(Request $request, $id)
    {
        $query = Post::query()->with(['category:id,account_id,name,slug,sort_order']);
        $this->applyAccountScope($query, $request);

        if (!$request->user()) {
            $query->published();
        }

        $post = $query
            ->where(function (Builder $subQuery) use ($id) {
                $subQuery->where('slug', $id);

                if (is_numeric($id)) {
                    $subQuery->orWhere('id', (int) $id);
                }
            })
            ->firstOrFail();

        return response()->json($post);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, $id)
    {
        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        $post = Post::where('account_id', $accountId)->whereKey($id)->firstOrFail();

        $validated = $request->validate([
            'title' => 'sometimes|required|string|max:255',
            'slug' => 'nullable|string|max:255',
            'blog_category_id' => 'nullable|integer',
            'seo_keyword' => 'nullable|string|max:255',
            'content' => 'sometimes|required|string',
            'excerpt' => 'nullable|string',
            'featured_image' => 'nullable|string|max:2048',
            'is_published' => 'sometimes|boolean',
            'is_starred' => 'sometimes|boolean',
            'sort_order' => 'nullable|integer|min:1',
            'published_at' => 'nullable|date',
        ]);

        if (array_key_exists('seo_keyword', $validated)) {
            $validated['seo_keyword'] = $this->normalizeKeyword($validated['seo_keyword']);
            $this->ensureSeoKeywordExists($accountId, $validated['seo_keyword']);
        }

        if (array_key_exists('content', $validated)) {
            $validated['content'] = BlogMediaGallerySupport::normalizeHtml((string) $validated['content']);
        }

        if (array_key_exists('blog_category_id', $validated)) {
            $validated['blog_category_id'] = $this->resolveCategoryIdForAccount(
                $accountId,
                $validated['blog_category_id']
            );
        }

        if ($post->is_system) {
            unset($validated['title'], $validated['slug']);
        }

        if (array_key_exists('slug', $validated) && $validated['slug'] !== null && $validated['slug'] !== '') {
            $validated['slug'] = $this->buildUniqueSlug($validated['slug'], $accountId, $post->id);
        }

        $post->update($validated);

        return response()->json($post->load('category'));
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Request $request, $id)
    {
        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        $post = Post::where('account_id', $accountId)->whereKey($id)->firstOrFail();
        if ($post->is_system) {
            return response()->json(['error' => 'System posts cannot be deleted.'], 422);
        }
        $post->delete();

        return response()->json(['message' => 'Post deleted successfully']);
    }

    /**
     * Reorder posts directly from admin table drag-and-drop.
     */
    public function reorder(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
        ]);

        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        $providedIds = array_values(array_unique(array_map('intval', $validated['ids'])));

        $currentPostsQuery = Post::where('account_id', $accountId);
        if ($this->hasSystemPostSupport()) {
            $currentPostsQuery->orderByDesc('is_system');
        }

        $currentPosts = $currentPostsQuery
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get($this->hasSystemPostSupport() ? ['id', 'is_system'] : ['id']);

        $currentIds = $currentPosts
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $systemIdMap = $this->hasSystemPostSupport()
            ? $currentPosts
                ->mapWithKeys(fn ($post) => [(int) $post->id => (bool) $post->is_system])
                ->all()
            : [];

        $invalidIds = array_values(array_diff($providedIds, $currentIds));
        if (!empty($invalidIds)) {
            return response()->json([
                'error' => 'Some post IDs are invalid for this account.',
                'invalid_ids' => $invalidIds,
            ], 422);
        }

        $providedSystemIds = array_values(array_filter(
            $providedIds,
            fn (int $postId) => $systemIdMap[$postId] ?? false
        ));
        $providedRegularIds = array_values(array_filter(
            $providedIds,
            fn (int $postId) => !($systemIdMap[$postId] ?? false)
        ));

        $remainingSystemIds = array_values(array_filter(
            $currentIds,
            fn (int $postId) => ($systemIdMap[$postId] ?? false) && !in_array($postId, $providedSystemIds, true)
        ));
        $remainingRegularIds = array_values(array_filter(
            $currentIds,
            fn (int $postId) => !($systemIdMap[$postId] ?? false) && !in_array($postId, $providedRegularIds, true)
        ));

        $finalOrder = array_merge(
            $providedSystemIds,
            $remainingSystemIds,
            $providedRegularIds,
            $remainingRegularIds
        );

        DB::transaction(function () use ($finalOrder) {
            foreach ($finalOrder as $index => $postId) {
                Post::whereKey($postId)->update(['sort_order' => $index + 1]);
            }
        });

        return response()->json(['message' => 'Posts reordered successfully']);
    }

    public function exportBundle(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'nullable|array',
            'ids.*' => 'integer',
        ]);

        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        $ids = array_values(array_unique(array_map('intval', $validated['ids'] ?? [])));
        $query = Post::query()
            ->with(['category:id,account_id,name,slug,sort_order'])
            ->where('account_id', $accountId);

        if (!empty($ids)) {
            $query->whereIn('id', $ids);
        }

        if ($this->hasSystemPostSupport()) {
            $query->orderByDesc('is_system');
        }

        $posts = $query
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        if ($posts->isEmpty()) {
            return response()->json(['error' => 'No posts found for export.'], 422);
        }

        try {
            $bundle = app(BlogBundleService::class)->export($accountId, $posts->all());
            return response()->download($bundle['path'], $bundle['filename'])->deleteFileAfterSend(true);
        } catch (ValidationException $exception) {
            $errors = $this->flattenValidationErrors($exception);
            return response()->json([
                'error' => $errors[0] ?? 'Blog export failed.',
                'errors' => $errors,
            ], 422);
        } catch (Throwable $exception) {
            return response()->json([
                'error' => 'Blog export failed.',
                'detail' => $exception->getMessage(),
            ], 500);
        }
    }

    public function importBundle(Request $request)
    {
        $validated = $request->validate([
            'file' => 'required|file|mimes:zip|max:102400',
        ]);

        $accountId = $this->resolveBlogAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        try {
            $result = app(BlogBundleService::class)->import($accountId, $validated['file']);

            return response()->json([
                'message' => 'Import completed.',
                'total_rows' => $result['total_rows'] ?? 0,
                'created' => $result['created'] ?? 0,
                'updated' => $result['updated'] ?? 0,
                'categories_created' => $result['categories_created'] ?? 0,
                'assets_imported' => $result['assets_imported'] ?? 0,
                'errors' => $result['errors'] ?? [],
            ], 201);
        } catch (ValidationException $exception) {
            $errors = $this->flattenValidationErrors($exception);
            return response()->json([
                'error' => $errors[0] ?? 'Import failed.',
                'errors' => $errors,
            ], 422);
        } catch (Throwable $exception) {
            return response()->json([
                'error' => 'Import failed.',
                'detail' => $exception->getMessage(),
            ], 500);
        }
    }

    private function applyAccountScope(Builder $query, Request $request): ?int
    {
        $accountId = $this->resolveBlogAccountId($request);

        if ($accountId) {
            $query->where('account_id', $accountId);
        }

        return $accountId;
    }

    private function resolveBlogAccountId(Request $request): ?int
    {
        $accountId = $this->resolveAccountId($request);

        if ($accountId && $this->hasSystemPostSupport()) {
            $this->ensureSystemPosts($accountId);
        }

        return $accountId;
    }

    private function resolveAccountId(Request $request): ?int
    {
        $siteCode = $request->query('site_code') ?: $request->header('X-Site-Code');

        if ($siteCode) {
            $account = Account::where('site_code', $siteCode)->first();
            if ($account) {
                return (int) $account->id;
            }
        }

        $headerAccountId = $request->header('X-Account-Id');
        if ($headerAccountId && $headerAccountId !== 'all') {
            return (int) $headerAccountId;
        }

        return null;
    }

    private function nextSortOrder(int $accountId): int
    {
        return (int) Post::where('account_id', $accountId)->max('sort_order') + 1;
    }

    private function normalizeKeyword(?string $keyword): ?string
    {
        if ($keyword === null) {
            return null;
        }

        $keyword = trim($keyword);

        return $keyword === '' ? null : $keyword;
    }

    private function applySearchFilter(Builder $query, string $search): void
    {
        $needle = $this->normalizeSearchTerm($search);

        if ($needle === '') {
            return;
        }

        $likeValue = '%' . $needle . '%';

        $query->where(function (Builder $subQuery) use ($likeValue) {
            if ($this->hasSearchTextSupport()) {
                $subQuery->whereRaw($this->accentInsensitiveLikeSql('posts.search_text'), [$likeValue]);
            } else {
                $subQuery->whereRaw($this->accentInsensitiveLikeSql('posts.title'), [$likeValue])
                    ->orWhereRaw($this->accentInsensitiveLikeSql('posts.slug'), [$likeValue])
                    ->orWhereRaw($this->accentInsensitiveLikeSql('posts.excerpt'), [$likeValue])
                    ->orWhereRaw($this->accentInsensitiveLikeSql('posts.content'), [$likeValue]);
            }

            $subQuery->orWhereRaw($this->accentInsensitiveLikeSql('posts.seo_keyword'), [$likeValue]);

            if ($this->hasBlogCategorySupport()) {
                $subQuery->orWhereHas('category', function (Builder $categoryQuery) use ($likeValue) {
                    $categoryQuery->whereRaw($this->accentInsensitiveLikeSql('blog_categories.name'), [$likeValue])
                        ->orWhereRaw($this->accentInsensitiveLikeSql('blog_categories.slug'), [$likeValue]);
                });
            }
        });
    }

    private function normalizeSearchTerm(?string $search): string
    {
        return Str::of((string) $search)
            ->trim()
            ->lower()
            ->ascii()
            ->replaceMatches('/\s+/u', ' ')
            ->trim()
            ->value();
    }

    private function accentInsensitiveLikeSql(string $expression): string
    {
        if ($this->supportsAccentInsensitiveSearch()) {
            return 'immutable_unaccent(' . $expression . ') ILIKE ?';
        }

        return 'LOWER(COALESCE(' . $expression . ", '')) LIKE ?";
    }

    private function supportsAccentInsensitiveSearch(): bool
    {
        static $cache = null;

        if ($cache !== null) {
            return $cache;
        }

        try {
            if (DB::getDriverName() !== 'pgsql') {
                return $cache = false;
            }

            $result = DB::selectOne("SELECT to_regprocedure('immutable_unaccent(text)') AS procedure_name");
            $row = (array) $result;

            return $cache = !empty($row['procedure_name']);
        } catch (Throwable) {
            return $cache = false;
        }
    }

    private function ensureSeoKeywordExists(int $accountId, ?string $keyword): void
    {
        if ($keyword === null) {
            return;
        }

        if (!$this->hasSeoKeywordTable()) {
            return;
        }

        PostSeoKeyword::firstOrCreate([
            'account_id' => $accountId,
            'keyword' => $keyword,
        ]);
    }

    private function normalizeFlag($value, bool $default = false): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if ($value === null || $value === '') {
            return $default;
        }

        $normalized = Str::lower(trim((string) $value));

        if (in_array($normalized, ['1', 'true', 'yes', 'y', 'on', 'co'], true)) {
            return true;
        }

        if (in_array($normalized, ['0', 'false', 'no', 'n', 'off', 'khong'], true)) {
            return false;
        }

        return $default;
    }

    private function normalizeMediaGalleryBlocks(string $content): string
    {
        if (!Str::contains($content, self::MEDIA_GALLERY_BLOCK_CLASS)) {
            return $content;
        }

        $wrappedHtml = sprintf('<div id="__bdt_gallery_root__">%s</div>', $content);
        $dom = new DOMDocument('1.0', 'UTF-8');
        $options = (defined('LIBXML_HTML_NOIMPLIED') ? LIBXML_HTML_NOIMPLIED : 0)
            | (defined('LIBXML_HTML_NODEFDTD') ? LIBXML_HTML_NODEFDTD : 0)
            | LIBXML_NOERROR
            | LIBXML_NOWARNING;

        $previousLibxmlState = libxml_use_internal_errors(true);
        try {
            $dom->loadHTML('<?xml encoding="utf-8" ?>' . mb_convert_encoding($wrappedHtml, 'HTML-ENTITIES', 'UTF-8'), $options);
        } catch (Throwable) {
            libxml_clear_errors();
            libxml_use_internal_errors($previousLibxmlState);

            return $content;
        }

        $xpath = new DOMXPath($dom);
        $nodes = $xpath->query(sprintf(
            '//*[contains(concat(" ", normalize-space(@class), " "), " %s ")]',
            self::MEDIA_GALLERY_BLOCK_CLASS
        ));

        if ($nodes !== false) {
            $galleryNodes = [];

            foreach ($nodes as $node) {
                $galleryNodes[] = $node;
            }

            foreach ($galleryNodes as $node) {
                $this->normalizeMediaGalleryNode($node);
            }
        }

        $rootNode = $xpath->query('//*[@id="__bdt_gallery_root__"]')->item(0);
        $normalizedContent = $rootNode ? $this->extractInnerHtml($rootNode) : $content;

        libxml_clear_errors();
        libxml_use_internal_errors($previousLibxmlState);

        return $normalizedContent;
    }

    private function normalizeMediaGalleryNode(\DOMNode $node): void
    {
        if (!$node instanceof \DOMElement) {
            return;
        }

        $items = $this->decodeMediaGalleryPayload($node->getAttribute(self::MEDIA_GALLERY_PAYLOAD_ATTRIBUTE));

        if (empty($items)) {
            return;
        }

        $imageCount = count(array_filter($items, fn (array $item) => ($item['type'] ?? null) === 'image'));
        $videoCount = count(array_filter($items, fn (array $item) => ($item['type'] ?? null) === 'video'));
        $summary = $this->buildMediaGallerySummary($imageCount, $videoCount);
        $payload = $this->encodeMediaGalleryPayload($items);
        $previewUrl = $this->resolveMediaGalleryPreviewUrl($items);

        $node->setAttribute('contenteditable', 'false');
        $node->setAttribute('role', 'button');
        $node->setAttribute('tabindex', '0');
        $node->setAttribute(self::MEDIA_GALLERY_PAYLOAD_ATTRIBUTE, $payload);
        $node->setAttribute('data-gallery-count', (string) count($items));
        $node->setAttribute('data-image-count', (string) $imageCount);
        $node->setAttribute('data-video-count', (string) $videoCount);
        $node->setAttribute('data-gallery-summary', $summary);
        $node->setAttribute('title', 'Nhấn để chỉnh block media gallery');
        $node->setAttribute('aria-label', $summary . '. Nhấn để chỉnh block media gallery');
        $node->setAttribute(
            'style',
            $previewUrl !== ''
                ? sprintf('--ql-bdt-media-gallery-preview: url("%s");', str_replace('"', '%22', $previewUrl))
                : '--ql-bdt-media-gallery-preview: none;'
        );

        while ($node->firstChild) {
            $node->removeChild($node->firstChild);
        }

        $node->appendChild($node->ownerDocument->createTextNode($summary . ' • Nhấn để chỉnh'));
    }

    private function decodeMediaGalleryPayload(?string $payload): array
    {
        $rawPayload = trim((string) $payload);

        if ($rawPayload === '') {
            return [];
        }

        $candidates = [rawurldecode($rawPayload), $rawPayload];

        foreach ($candidates as $candidate) {
            try {
                $decoded = json_decode($candidate, true, 512, JSON_THROW_ON_ERROR);
            } catch (Throwable) {
                continue;
            }

            $items = is_array($decoded) && array_is_list($decoded)
                ? $decoded
                : ($decoded['items'] ?? []);

            $normalizedItems = $this->normalizeMediaGalleryItems($items);

            if (!empty($normalizedItems)) {
                return $normalizedItems;
            }
        }

        return [];
    }

    private function encodeMediaGalleryPayload(array $items): string
    {
        return rawurlencode((string) json_encode([
            'version' => 1,
            'items' => array_values($items),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    private function normalizeMediaGalleryItems($items): array
    {
        if (!is_array($items)) {
            return [];
        }

        $normalizedItems = [];

        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }

            $type = trim((string) ($item['type'] ?? 'image'));

            if ($type === 'video') {
                $normalizedItem = $this->normalizeMediaGalleryVideoItem($item);
            } else {
                $normalizedItem = $this->normalizeMediaGalleryImageItem($item);
            }

            if ($normalizedItem !== null) {
                $normalizedItems[] = $normalizedItem;
            }
        }

        return $normalizedItems;
    }

    private function normalizeMediaGalleryImageItem(array $item): ?array
    {
        $src = trim((string) ($item['src'] ?? $item['url'] ?? ''));

        if ($src === '') {
            return null;
        }

        return [
            'id' => trim((string) ($item['id'] ?? '')) ?: ('image_' . Str::lower(Str::random(10))),
            'type' => 'image',
            'src' => $src,
            'alt' => trim((string) ($item['alt'] ?? $item['title'] ?? '')),
        ];
    }

    private function normalizeMediaGalleryVideoItem(array $item): ?array
    {
        $source = trim((string) ($item['url'] ?? $item['src'] ?? $item['youtubeId'] ?? ''));
        $videoId = $this->extractYouTubeVideoId($source);

        if ($videoId === null) {
            return null;
        }

        return [
            'id' => trim((string) ($item['id'] ?? '')) ?: ('video_' . Str::lower(Str::random(10))),
            'type' => 'video',
            'url' => 'https://www.youtube.com/watch?v=' . $videoId,
            'youtubeId' => $videoId,
            'thumbnail' => 'https://i.ytimg.com/vi/' . $videoId . '/hqdefault.jpg',
            'title' => trim((string) ($item['title'] ?? '')),
        ];
    }

    private function extractYouTubeVideoId(?string $value): ?string
    {
        $normalizedValue = $this->normalizeYouTubeCandidate($value);

        if ($normalizedValue === '') {
            return null;
        }

        if (preg_match(self::YOUTUBE_VIDEO_ID_PATTERN, $normalizedValue) === 1) {
            return $normalizedValue;
        }

        if (preg_match(
            '/(?:youtube(?:-nocookie)?\.com\/(?:watch\/?\?(?:[^#\s]*&)?(?:v|vi)=|embed\/|live\/|shorts\/|v\/|e\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/i',
            $normalizedValue,
            $matches
        ) === 1) {
            return $matches[1];
        }

        $parts = parse_url($normalizedValue);
        if ($parts === false) {
            return null;
        }

        $host = Str::lower((string) ($parts['host'] ?? ''));
        $pathSegments = array_values(array_filter(explode('/', (string) ($parts['path'] ?? '')), fn ($segment) => $segment !== ''));

        parse_str((string) ($parts['query'] ?? ''), $query);

        if (!empty($query['u'])) {
            $nestedUrl = (string) $query['u'];
            if (Str::startsWith($nestedUrl, '/')) {
                $nestedUrl = 'https://www.youtube.com' . $nestedUrl;
            }

            $nestedVideoId = $this->extractYouTubeVideoId(rawurldecode($nestedUrl));
            if ($nestedVideoId !== null) {
                return $nestedVideoId;
            }
        }

        if (Str::contains($host, 'youtu.be')) {
            $candidate = $pathSegments[0] ?? '';
            return preg_match(self::YOUTUBE_VIDEO_ID_PATTERN, $candidate) === 1 ? $candidate : null;
        }

        if (Str::contains($host, 'youtube.com') || Str::contains($host, 'youtube-nocookie.com')) {
            foreach (['v', 'vi'] as $queryKey) {
                $candidate = trim((string) ($query[$queryKey] ?? ''));
                if (preg_match(self::YOUTUBE_VIDEO_ID_PATTERN, $candidate) === 1) {
                    return $candidate;
                }
            }

            foreach (['embed', 'live', 'shorts', 'v', 'e'] as $segmentName) {
                $segmentIndex = array_search($segmentName, $pathSegments, true);
                if ($segmentIndex !== false) {
                    $candidate = $pathSegments[$segmentIndex + 1] ?? '';
                    if (preg_match(self::YOUTUBE_VIDEO_ID_PATTERN, $candidate) === 1) {
                        return $candidate;
                    }
                }
            }
        }

        return null;
    }

    private function normalizeYouTubeCandidate(?string $value): string
    {
        $normalized = trim(html_entity_decode((string) $value, ENT_QUOTES | ENT_HTML5, 'UTF-8'));

        if ($normalized === '') {
            return '';
        }

        $decoded = rawurldecode($normalized);
        if ($decoded !== '') {
            $normalized = $decoded;
        }

        $normalized = str_replace('&amp;', '&', $normalized);

        if (Str::startsWith($normalized, '//')) {
            return 'https:' . $normalized;
        }

        if (!preg_match('/^https?:\/\//i', $normalized) && preg_match('/(?:youtube(?:-nocookie)?\.com|youtu\.be)/i', $normalized) === 1) {
            return 'https://' . ltrim($normalized, '/');
        }

        return $normalized;
    }

    private function resolveMediaGalleryPreviewUrl(array $items): string
    {
        $firstItem = $items[0] ?? null;

        if (!is_array($firstItem)) {
            return '';
        }

        if (($firstItem['type'] ?? null) === 'video') {
            return trim((string) ($firstItem['thumbnail'] ?? ''));
        }

        return trim((string) ($firstItem['src'] ?? ''));
    }

    private function buildMediaGallerySummary(int $imageCount, int $videoCount): string
    {
        if ($imageCount <= 0 && $videoCount <= 0) {
            return 'Khối media trống';
        }

        $parts = ['Block media'];

        if ($imageCount > 0) {
            $parts[] = $imageCount . ' ảnh';
        }

        if ($videoCount > 0) {
            $parts[] = $videoCount . ' video';
        }

        return implode(' • ', $parts);
    }

    private function extractInnerHtml(\DOMNode $node): string
    {
        $innerHtml = '';

        foreach ($node->childNodes as $childNode) {
            $innerHtml .= $node->ownerDocument?->saveHTML($childNode) ?? '';
        }

        return $innerHtml;
    }

    private function seoKeywordCollection(?int $accountId, ?Builder $fallbackBaseQuery = null): array
    {
        if ($accountId && $this->hasSeoKeywordTable()) {
            return PostSeoKeyword::where('account_id', $accountId)
                ->orderBy('keyword')
                ->get(['id', 'keyword'])
                ->map(fn ($item) => [
                    'id' => (int) $item->id,
                    'keyword' => $item->keyword,
                ])
                ->values()
                ->all();
        }

        $baseQuery = $fallbackBaseQuery ? clone $fallbackBaseQuery : Post::query();

        if ($accountId) {
            $baseQuery->where('account_id', $accountId);
        }

        return $baseQuery
            ->whereNotNull('seo_keyword')
            ->where('seo_keyword', '<>', '')
            ->select('seo_keyword')
            ->distinct()
            ->orderBy('seo_keyword')
            ->get()
            ->map(fn ($item) => [
                'id' => null,
                'keyword' => $item->seo_keyword,
            ])
            ->values()
            ->all();
    }

    private function hasSeoKeywordTable(): bool
    {
        static $cache = null;

        if ($cache === null) {
            $cache = Schema::hasTable('post_seo_keywords');
        }

        return $cache;
    }

    private function hasSearchTextSupport(): bool
    {
        static $cache = null;

        if ($cache === null) {
            $cache = Schema::hasTable('posts') && Schema::hasColumn('posts', 'search_text');
        }

        return $cache;
    }

    private function resolveCategoryIdForAccount(int $accountId, $categoryId): ?int
    {
        if (!$this->hasBlogCategorySupport()) {
            return null;
        }

        if ($categoryId === null || $categoryId === '' || $categoryId === '0' || $categoryId === 0) {
            return null;
        }

        $resolved = BlogCategory::where('account_id', $accountId)
            ->whereKey((int) $categoryId)
            ->value('id');

        if (!$resolved) {
            throw ValidationException::withMessages([
                'blog_category_id' => ['Category not found for this account.'],
            ]);
        }

        return (int) $resolved;
    }

    private function nextCategorySortOrder(int $accountId): int
    {
        if (!$this->hasBlogCategorySupport()) {
            return 1;
        }

        return (int) BlogCategory::where('account_id', $accountId)->max('sort_order') + 1;
    }

    private function buildUniqueCategorySlug(string $source, int $accountId, ?int $exceptId = null): string
    {
        $baseSlug = Str::slug($source);
        if ($baseSlug === '') {
            $baseSlug = 'blog-category';
        }

        $slug = $baseSlug;
        $counter = 1;

        while (true) {
            $query = BlogCategory::where('account_id', $accountId)->where('slug', $slug);

            if ($exceptId !== null) {
                $query->where('id', '<>', $exceptId);
            }

            if (!$query->exists()) {
                return $slug;
            }

            $counter++;
            $slug = $baseSlug . '-' . $counter;
        }
    }

    private function resequenceCategorySortOrders(int $accountId): void
    {
        if (!$this->hasBlogCategorySupport()) {
            return;
        }

        $ids = BlogCategory::where('account_id', $accountId)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->pluck('id')
            ->all();

        DB::transaction(function () use ($accountId, $ids) {
            foreach ($ids as $index => $id) {
                BlogCategory::where('account_id', $accountId)
                    ->whereKey($id)
                    ->update(['sort_order' => $index + 1]);
            }
        });
    }

    private function blogCategoryCollection(?int $accountId, ?Builder $fallbackBaseQuery = null): array
    {
        if ($accountId && $this->hasBlogCategorySupport()) {
            return BlogCategory::where('account_id', $accountId)
                ->orderBy('sort_order')
                ->orderBy('name')
                ->get(['id', 'name', 'slug', 'sort_order'])
                ->map(fn ($category) => [
                    'id' => (int) $category->id,
                    'name' => $category->name,
                    'slug' => $category->slug,
                    'sort_order' => (int) $category->sort_order,
                ])
                ->values()
                ->all();
        }

        if (!$this->hasBlogCategorySupport()) {
            return [];
        }

        $baseQuery = $fallbackBaseQuery ? clone $fallbackBaseQuery : Post::query();

        if ($accountId) {
            $baseQuery->where('account_id', $accountId);
        }

        $ids = $baseQuery
            ->whereNotNull('blog_category_id')
            ->select('blog_category_id')
            ->distinct()
            ->pluck('blog_category_id')
            ->filter()
            ->map(fn ($id) => (int) $id)
            ->all();

        if (empty($ids)) {
            return [];
        }

        return BlogCategory::whereIn('id', $ids)
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get(['id', 'name', 'slug', 'sort_order'])
            ->map(fn ($category) => [
                'id' => (int) $category->id,
                'name' => $category->name,
                'slug' => $category->slug,
                'sort_order' => (int) $category->sort_order,
            ])
            ->values()
            ->all();
    }

    private function hasBlogCategorySupport(): bool
    {
        static $cache = null;

        if ($cache === null) {
            $cache = Schema::hasTable('blog_categories') && Schema::hasColumn('posts', 'blog_category_id');
        }

        return $cache;
    }

    private function hasSystemPostSupport(): bool
    {
        static $cache = null;

        if ($cache === null) {
            $cache = Schema::hasTable('posts') && Schema::hasColumn('posts', 'is_system');
        }

        return $cache;
    }

    private function ensureSystemPosts(int $accountId): void
    {
        app(BlogSystemPostService::class)->ensureForAccount($accountId);
    }

    private function buildUniqueSlug(string $source, int $accountId, ?int $exceptId = null): string
    {
        $baseSlug = Str::slug($source);
        if ($baseSlug === '') {
            $baseSlug = 'post';
        }

        $slug = $baseSlug;
        $counter = 1;

        while (true) {
            $query = Post::where('account_id', $accountId)->where('slug', $slug);

            if ($exceptId !== null) {
                $query->where('id', '<>', $exceptId);
            }

            if (!$query->exists()) {
                return $slug;
            }

            $counter++;
            $slug = $baseSlug . '-' . $counter;
        }
    }

    /**
     * @return array<int, string>
     */
    private function flattenValidationErrors(ValidationException $exception): array
    {
        return collect($exception->errors())
            ->flatten()
            ->map(fn ($message) => trim((string) $message))
            ->filter()
            ->values()
            ->all();
    }

}
