<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\BlogCategory;
use App\Models\Post;
use App\Models\PostSeoKeyword;
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

        // Public visitors only see visible posts.
        if (!$request->user()) {
            $query->published();
        }

        $search = trim((string) $request->query('search', ''));
        if ($search !== '') {
            $query->where(function (Builder $subQuery) use ($search) {
                $subQuery->where('title', 'like', '%' . $search . '%')
                    ->orWhere('slug', 'like', '%' . $search . '%')
                    ->orWhere('excerpt', 'like', '%' . $search . '%')
                    ->orWhere('content', 'like', '%' . $search . '%');
            });
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

        $defaultPerPage = $request->user() ? 200 : 9;
        $perPage = min(max((int) $request->query('per_page', $defaultPerPage), 1), 1000);

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
        $accountId = $this->resolveAccountId($request);
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

        $accountId = $this->resolveAccountId($request);
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

        $accountId = $this->resolveAccountId($request);
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
        $accountId = $this->resolveAccountId($request);
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

        $accountId = $this->resolveAccountId($request);
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
        $accountId = $this->resolveAccountId($request);
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

        $accountId = $this->resolveAccountId($request);
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

        $accountId = $this->resolveAccountId($request);
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
        $accountId = $this->resolveAccountId($request);
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

        $accountId = $this->resolveAccountId($request);
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

        $accountId = $this->resolveAccountId($request);
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

        $accountId = $this->resolveAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        $validated['account_id'] = $accountId;
        $validated['blog_category_id'] = $this->resolveCategoryIdForAccount(
            $accountId,
            $validated['blog_category_id'] ?? null
        );
        $validated['seo_keyword'] = $this->normalizeKeyword($validated['seo_keyword'] ?? null);
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
        $accountId = $this->resolveAccountId($request);
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

        if (array_key_exists('blog_category_id', $validated)) {
            $validated['blog_category_id'] = $this->resolveCategoryIdForAccount(
                $accountId,
                $validated['blog_category_id']
            );
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
        $accountId = $this->resolveAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        $post = Post::where('account_id', $accountId)->whereKey($id)->firstOrFail();
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

        $accountId = $this->resolveAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        $providedIds = array_values(array_unique(array_map('intval', $validated['ids'])));

        $currentIds = Post::where('account_id', $accountId)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $invalidIds = array_values(array_diff($providedIds, $currentIds));
        if (!empty($invalidIds)) {
            return response()->json([
                'error' => 'Some post IDs are invalid for this account.',
                'invalid_ids' => $invalidIds,
            ], 422);
        }

        $remainingIds = array_values(array_diff($currentIds, $providedIds));
        $finalOrder = array_merge($providedIds, $remainingIds);

        DB::transaction(function () use ($finalOrder) {
            foreach ($finalOrder as $index => $postId) {
                Post::whereKey($postId)->update(['sort_order' => $index + 1]);
            }
        });

        return response()->json(['message' => 'Posts reordered successfully']);
    }

    /**
     * Import multiple posts from a single Word (.docx) file.
     */
    public function importWord(Request $request)
    {
        $validated = $request->validate([
            'file' => 'required|file|mimes:docx|max:20480',
        ]);

        $accountId = $this->resolveAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        try {
            $plainText = $this->extractDocxText($validated['file']->getRealPath());
            $entries = $this->parseImportedPosts($plainText);
        } catch (Throwable $exception) {
            return response()->json([
                'error' => 'Unable to read DOCX file.',
                'detail' => $exception->getMessage(),
            ], 422);
        }

        if (empty($entries)) {
            return response()->json([
                'error' => 'No valid post block found in file.',
                'rule' => 'Use ===POST=== and ===END_POST=== markers as defined in template.',
            ], 422);
        }

        $created = 0;
        $errors = [];
        $nextSortOrder = $this->nextSortOrder($accountId);

        foreach ($entries as $index => $entry) {
            try {
                if (trim((string) ($entry['title'] ?? '')) === '') {
                    $errors[] = 'Block #' . ($index + 1) . ': Missing TITLE.';
                    continue;
                }

                $content = trim((string) ($entry['content'] ?? ''));
                if ($content === '') {
                    $errors[] = 'Block #' . ($index + 1) . ': Missing CONTENT_HTML section.';
                    continue;
                }

                $normalizedKeyword = $this->normalizeKeyword($entry['seo_keyword'] ?? null);
                $slugSource = $entry['slug'] ?? $entry['title'];
                $slug = $this->buildUniqueSlug($slugSource, $accountId);

                $isPublished = array_key_exists('is_published', $entry)
                    ? (bool) $entry['is_published']
                    : true;

                Post::create([
                    'account_id' => $accountId,
                    'title' => trim((string) $entry['title']),
                    'slug' => $slug,
                    'seo_keyword' => $normalizedKeyword,
                    'excerpt' => trim((string) ($entry['excerpt'] ?? '')),
                    'content' => $content,
                    'featured_image' => trim((string) ($entry['featured_image'] ?? '')) ?: null,
                    'is_starred' => (bool) ($entry['is_starred'] ?? false),
                    'is_published' => $isPublished,
                    'published_at' => $isPublished ? now() : null,
                    'sort_order' => $nextSortOrder++,
                ]);

                $this->ensureSeoKeywordExists($accountId, $normalizedKeyword);
                $created++;
            } catch (Throwable $exception) {
                $errors[] = 'Block #' . ($index + 1) . ': ' . $exception->getMessage();
            }
        }

        $skipped = count($entries) - $created;

        if ($created === 0) {
            return response()->json([
                'error' => 'Import failed. No post was created.',
                'errors' => $errors,
            ], 422);
        }

        return response()->json([
            'message' => 'Import completed.',
            'total_blocks' => count($entries),
            'created' => $created,
            'skipped' => $skipped,
            'errors' => $errors,
        ], 201);
    }

    /**
     * Download the DOCX template for batch import.
     */
    public function downloadImportTemplate()
    {
        $relativePath = 'templates/blog-import-template.docx';
        $absolutePath = storage_path('app/public/' . $relativePath);

        if (!Storage::disk('public')->exists($relativePath)) {
            $this->createDocxTemplate($absolutePath);
        }

        return response()->download($absolutePath, 'mau-import-bai-viet-seo.docx');
    }

    private function applyAccountScope(Builder $query, Request $request): ?int
    {
        $accountId = $this->resolveAccountId($request);

        if ($accountId) {
            $query->where('account_id', $accountId);
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

    private function extractDocxText(string $realPath): string
    {
        $zip = new ZipArchive();

        if ($zip->open($realPath) !== true) {
            throw new RuntimeException('Failed to open DOCX archive.');
        }

        $documentXml = $zip->getFromName('word/document.xml');
        $zip->close();

        if ($documentXml === false) {
            throw new RuntimeException('DOCX structure is invalid (word/document.xml not found).');
        }

        $dom = new DOMDocument();
        $dom->preserveWhiteSpace = false;
        $dom->loadXML($documentXml, LIBXML_NOERROR | LIBXML_NOWARNING);

        $xpath = new DOMXPath($dom);
        $xpath->registerNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main');

        $paragraphs = $xpath->query('//w:body/w:p');
        $lines = [];

        if (!$paragraphs) {
            return '';
        }

        foreach ($paragraphs as $paragraph) {
            $textNodes = $xpath->query('.//w:t', $paragraph);
            $line = '';

            if ($textNodes) {
                foreach ($textNodes as $textNode) {
                    $line .= $textNode->nodeValue;
                }
            }

            $lines[] = trim($line);
        }

        return trim(implode("\n", $lines));
    }

    /**
     * Parse file format:
     * ===POST===
     * TITLE: ...
     * SLUG: ...
     * SEO_KEYWORD: ...
     * FEATURED_IMAGE: ...
     * STARRED: yes/no
     * PUBLISHED: yes/no
     * EXCERPT:
     * ...
     * ===EXCERPT_END===
     * CONTENT_HTML:
     * <p>...</p>
     * ===CONTENT_END===
     * ===END_POST===
     */
    private function parseImportedPosts(string $plainText): array
    {
        $normalized = str_replace(["\r\n", "\r"], "\n", $plainText);
        $normalized = preg_replace('/^\xEF\xBB\xBF/', '', $normalized);

        preg_match_all('/===POST===\s*(.*?)\s*===END_POST===/s', $normalized, $matches);

        if (empty($matches[1])) {
            return [];
        }

        $entries = [];

        foreach ($matches[1] as $block) {
            $parsed = $this->parseImportBlock($block);

            if (!empty($parsed['title'])) {
                $entries[] = $parsed;
            }
        }

        return $entries;
    }

    private function parseImportBlock(string $block): array
    {
        $data = [
            'title' => '',
            'slug' => '',
            'seo_keyword' => null,
            'excerpt' => '',
            'content' => '',
            'featured_image' => null,
            'is_starred' => false,
            'is_published' => true,
        ];

        $mode = 'fields';
        $excerptLines = [];
        $contentLines = [];

        $lines = explode("\n", trim($block));

        foreach ($lines as $line) {
            $trimmed = trim($line);

            if (strcasecmp($trimmed, 'EXCERPT:') === 0) {
                $mode = 'excerpt';
                continue;
            }

            if (strcasecmp($trimmed, '===EXCERPT_END===') === 0) {
                $mode = 'fields';
                continue;
            }

            if (strcasecmp($trimmed, 'CONTENT_HTML:') === 0 || strcasecmp($trimmed, 'CONTENT:') === 0) {
                $mode = 'content';
                continue;
            }

            if (strcasecmp($trimmed, '===CONTENT_END===') === 0) {
                $mode = 'fields';
                continue;
            }

            if ($mode === 'excerpt') {
                $excerptLines[] = rtrim($line);
                continue;
            }

            if ($mode === 'content') {
                $contentLines[] = rtrim($line);
                continue;
            }

            if (preg_match('/^TITLE\s*:\s*(.+)$/i', $line, $match)) {
                $data['title'] = trim($match[1]);
                continue;
            }

            if (preg_match('/^SLUG\s*:\s*(.*)$/i', $line, $match)) {
                $data['slug'] = trim($match[1]);
                continue;
            }

            if (preg_match('/^SEO_KEYWORD\s*:\s*(.*)$/i', $line, $match)) {
                $data['seo_keyword'] = trim($match[1]);
                continue;
            }

            if (preg_match('/^FEATURED_IMAGE\s*:\s*(.*)$/i', $line, $match)) {
                $data['featured_image'] = trim($match[1]);
                continue;
            }

            if (preg_match('/^STARRED\s*:\s*(.*)$/i', $line, $match)) {
                $data['is_starred'] = $this->normalizeFlag($match[1], false);
                continue;
            }

            if (preg_match('/^PUBLISHED\s*:\s*(.*)$/i', $line, $match)) {
                $data['is_published'] = $this->normalizeFlag($match[1], true);
                continue;
            }
        }

        $data['excerpt'] = trim(implode("\n", $excerptLines));

        $content = trim(implode("\n", $contentLines));

        if ($content !== '' && strip_tags($content) === $content) {
            $content = $this->convertPlainTextToHtml($content);
        }

        if ($content === '' && $data['excerpt'] !== '') {
            $content = '<p>' . nl2br(e($data['excerpt'])) . '</p>';
        }

        if ($data['excerpt'] === '' && $content !== '') {
            $data['excerpt'] = Str::limit(trim(strip_tags($content)), 200, '...');
        }

        $data['content'] = $content;

        return $data;
    }

    private function convertPlainTextToHtml(string $text): string
    {
        $chunks = preg_split('/\n\s*\n/', trim($text));
        $htmlBlocks = [];

        foreach ($chunks as $chunk) {
            $line = trim($chunk);
            if ($line === '') {
                continue;
            }

            $htmlBlocks[] = '<p>' . nl2br(e($line)) . '</p>';
        }

        return implode("\n", $htmlBlocks);
    }

    private function createDocxTemplate(string $absolutePath): void
    {
        $directory = dirname($absolutePath);
        if (!is_dir($directory)) {
            mkdir($directory, 0755, true);
        }

        $lines = [
            'HUONG DAN IMPORT BAI VIET SEO HANG LOAT',
            '',
            'MOT FILE DOCX CO THE CHUA NHIEU BAI.',
            'MOI BAI BAT BUOC NAM GIUA 2 MOC: ===POST=== va ===END_POST===',
            '',
            'CAU TRUC TUNG BAI:',
            '===POST===',
            'TITLE: Tieu de bai viet',
            'SLUG: slug-bai-viet (co the de trong)',
            'SEO_KEYWORD: tu khoa seo chinh',
            'FEATURED_IMAGE: https://duong-dan-anh.jpg (co the de trong)',
            'STARRED: yes',
            'PUBLISHED: yes',
            'EXCERPT:',
            'Doan mo ta ngan.',
            '===EXCERPT_END===',
            'CONTENT_HTML:',
            '<p>Noi dung HTML day du.</p>',
            '===CONTENT_END===',
            '===END_POST===',
            '',
            'VI DU BAI 1',
            '===POST===',
            'TITLE: Cach chon gom Bat Trang cho phong khach',
            'SLUG: cach-chon-gom-bat-trang-cho-phong-khach',
            'SEO_KEYWORD: gom bat trang phong khach',
            'FEATURED_IMAGE: https://example.com/anh-1.jpg',
            'STARRED: yes',
            'PUBLISHED: yes',
            'EXCERPT:',
            'Goi y cach chon gom su dep, hop menh va de bai tri.',
            '===EXCERPT_END===',
            'CONTENT_HTML:',
            '<h2>Vi sao nen chon gom Bat Trang?</h2>',
            '<p>Doan van mo dau...</p>',
            '<ul><li>Men ben mau</li><li>Dang dep</li></ul>',
            '===CONTENT_END===',
            '===END_POST===',
            '',
            'VI DU BAI 2',
            '===POST===',
            'TITLE: Bao quan do gom dung cach khi vao mua nom',
            'SLUG: bao-quan-do-gom-dung-cach-khi-vao-mua-nom',
            'SEO_KEYWORD: bao quan do gom',
            'FEATURED_IMAGE: ',
            'STARRED: no',
            'PUBLISHED: yes',
            'EXCERPT:',
            'Tong hop meo giup gom luon sach va ben.',
            '===EXCERPT_END===',
            'CONTENT_HTML:',
            '<p>Noi dung bai viet thu hai...</p>',
            '===CONTENT_END===',
            '===END_POST===',
        ];

        $contentTypesXml = <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
XML;

        $relsXml = <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
XML;

        $documentXml = $this->buildWordDocumentXml($lines);

        $zip = new ZipArchive();
        if ($zip->open($absolutePath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Cannot create DOCX template.');
        }

        $zip->addFromString('[Content_Types].xml', $contentTypesXml);
        $zip->addFromString('_rels/.rels', $relsXml);
        $zip->addFromString('word/document.xml', $documentXml);
        $zip->close();
    }

    private function buildWordDocumentXml(array $lines): string
    {
        $paragraphs = [];

        foreach ($lines as $line) {
            if ($line === '') {
                $paragraphs[] = '<w:p/>';
                continue;
            }

            $paragraphs[] = '<w:p><w:r><w:t xml:space="preserve">' . htmlspecialchars($line, ENT_XML1 | ENT_COMPAT, 'UTF-8') . '</w:t></w:r></w:p>';
        }

        $body = implode('', $paragraphs);

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            . '<w:body>'
            . $body
            . '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
            . '</w:body>'
            . '</w:document>';
    }
}
