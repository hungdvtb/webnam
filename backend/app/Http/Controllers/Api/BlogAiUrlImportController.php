<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\BlogAiBulkJob;
use App\Models\BlogAiUrlImportItem;
use App\Models\Post;
use App\Services\BlogAi\BlogAiUrlImportQueueWorkerService;
use App\Services\BlogAi\BlogAiUrlImportService;
use App\Support\PublicSiteUrlResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BlogAiUrlImportController extends Controller
{
    public function __construct(
        private readonly BlogAiUrlImportService $urlImportService,
        private readonly BlogAiUrlImportQueueWorkerService $queueWorkerService,
        private readonly PublicSiteUrlResolver $publicSiteUrlResolver,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $accountId = $this->resolveAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Thieu Account ID.'], 400);
        }

        $limit = max(min((int) $request->query('limit', 5), 20), 1);

        $jobs = BlogAiBulkJob::query()
            ->where('account_id', $accountId)
            ->where('metadata->source_type', BlogAiUrlImportService::SOURCE_TYPE)
            ->latest('id')
            ->limit($limit)
            ->get();

        return response()->json([
            'data' => $jobs->map(fn (BlogAiBulkJob $job) => $this->mapJob($job, false))->values()->all(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $accountId = $this->resolveAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Thieu Account ID.'], 400);
        }

        $validated = $request->validate([
            'source_url' => 'required|string|max:500',
            'max_ai_requests' => 'nullable|integer|min:1|max:200',
            'max_archive_pages' => 'nullable|integer|min:1|max:300',
        ]);

        $job = $this->urlImportService->createJobFromUrl(
            $accountId,
            $validated['source_url'],
            auth()->id(),
            isset($validated['max_ai_requests']) ? (int) $validated['max_ai_requests'] : null,
            isset($validated['max_archive_pages']) ? (int) $validated['max_archive_pages'] : null,
        );

        return response()->json([
            'data' => $this->mapJob($job, true),
        ], 201);
    }

    public function show(Request $request, int $jobId): JsonResponse
    {
        $job = $this->resolveJob($request, $jobId);

        return response()->json([
            'data' => $this->mapJob($job, true),
        ]);
    }

    public function run(Request $request, int $jobId): JsonResponse
    {
        $job = $this->resolveJob($request, $jobId);
        $retryFailedOnly = $request->boolean('retry_failed')
            || $request->input('mode') === 'retry_failed';
        $retryItemIds = null;
        if ($retryFailedOnly && $request->has('retry_item_ids')) {
            $retryItemIds = collect($request->input('retry_item_ids', []))
                ->map(fn ($value) => (int) $value)
                ->filter(fn (int $value) => $value > 0)
                ->unique()
                ->values()
                ->all();
        }

        $job = $this->urlImportService->startProcessing($job, $retryFailedOnly, $retryItemIds);
        $worker = $this->queueWorkerService->ensureRunning();

        return response()->json([
            'data' => $this->mapJob($job, true),
            'item' => null,
            'done' => false,
            'paused' => false,
            'queued' => true,
            'worker' => $worker,
            'message' => ($worker['running'] ?? false)
                ? 'Da dua tien trinh vao hang doi nen.'
                : 'Da danh dau hang doi, nhung worker nen chua chay. Hay kiem tra log worker.',
        ]);
    }

    public function processNext(Request $request, int $jobId): JsonResponse
    {
        $job = $this->resolveJob($request, $jobId);
        $retryFailedOnly = $request->boolean('retry_failed')
            || $request->input('mode') === 'retry_failed';
        $retryItemIds = null;
        if ($retryFailedOnly && $request->has('retry_item_ids')) {
            $retryItemIds = collect($request->input('retry_item_ids', []))
                ->map(fn ($value) => (int) $value)
                ->filter(fn (int $value) => $value > 0)
                ->unique()
                ->values()
                ->all();
        }

        $result = $this->urlImportService->processNextItem($job, $retryFailedOnly, $retryItemIds);

        return response()->json([
            'data' => $this->mapJob($result['job'], true),
            'item' => $result['item'] ? $this->mapItem($result['item']) : null,
            'items' => collect($result['items'] ?? [])
                ->filter(fn ($item) => $item instanceof BlogAiUrlImportItem)
                ->map(fn (BlogAiUrlImportItem $item) => $this->mapItem($item))
                ->values()
                ->all(),
            'batch' => $result['batch'] ?? null,
            'done' => (bool) ($result['done'] ?? false),
            'paused' => (bool) ($result['paused'] ?? false),
            'message' => $result['message'] ?? null,
        ]);
    }

    public function scan(Request $request, int $jobId): JsonResponse
    {
        $job = $this->resolveJob($request, $jobId);
        $job = $this->urlImportService->scan($job);

        return response()->json([
            'data' => $this->mapJob($job, true),
        ]);
    }

    public function pause(Request $request, int $jobId): JsonResponse
    {
        $job = $this->resolveJob($request, $jobId);
        $job = $this->urlImportService->pause($job);

        return response()->json([
            'data' => $this->mapJob($job, true),
        ]);
    }

    public function resetFailed(Request $request, int $jobId): JsonResponse
    {
        $job = $this->resolveJob($request, $jobId);
        $job = $this->urlImportService->resetFailedItems($job);

        return response()->json([
            'data' => $this->mapJob($job, true),
        ]);
    }

    private function resolveJob(Request $request, int $jobId): BlogAiBulkJob
    {
        $accountId = $this->resolveAccountId($request);
        if (!$accountId) {
            abort(400, 'Thieu Account ID.');
        }

        return BlogAiBulkJob::query()
            ->where('account_id', $accountId)
            ->where('metadata->source_type', BlogAiUrlImportService::SOURCE_TYPE)
            ->whereKey($jobId)
            ->firstOrFail();
    }

    private function mapJob(BlogAiBulkJob $job, bool $withLogs = false): array
    {
        $job->refresh();
        $metadata = $job->metadata ?? [];
        $summary = $job->summary ?? [];

        $payload = [
            'id' => $job->id,
            'status' => $job->status,
            'source_filename' => $job->source_filename,
            'source_url' => $metadata['source_url'] ?? $job->source_path,
            'source_type' => $metadata['source_type'] ?? null,
            'total_keywords' => (int) $job->total_keywords,
            'unique_keywords' => (int) $job->unique_keywords,
            'cluster_count' => (int) $job->cluster_count,
            'processed_clusters' => (int) $job->processed_clusters,
            'categories_created' => (int) $job->categories_created,
            'posts_created' => (int) $job->posts_created,
            'posts_failed' => (int) $job->posts_failed,
            'posts_updated' => (int) ($summary['posts_updated'] ?? 0),
            'ai_model' => $job->ai_model,
            'max_ai_requests' => isset($metadata['max_ai_requests']) ? (int) $metadata['max_ai_requests'] : null,
            'summary' => $summary,
            'worker' => $this->queueWorkerService->status(),
            'errors' => $job->errors ?? [],
            'metadata' => $metadata,
            'started_at' => $job->started_at?->toIso8601String(),
            'finished_at' => $job->finished_at?->toIso8601String(),
            'created_at' => $job->created_at?->toIso8601String(),
            'updated_at' => $job->updated_at?->toIso8601String(),
        ];

        if (!$withLogs) {
            return $payload;
        }

        $payload['items'] = $job->urlImportItems()
            ->with(['post' => fn ($query) => $query
                ->withTrashed()
                ->select('id', 'account_id', 'title', 'slug', 'is_published', 'published_at', 'deleted_at')])
            ->limit(1000)
            ->get()
            ->map(fn (BlogAiUrlImportItem $item) => $this->mapItem($item))
            ->values()
            ->all();

        $payload['logs'] = $job->logs()
            ->latest('id')
            ->limit(200)
            ->get()
            ->reverse()
            ->values()
            ->map(fn ($log) => [
                'id' => $log->id,
                'level' => $log->level,
                'step' => $log->step,
                'message' => $log->message,
                'context' => $log->context ?? [],
                'created_at' => $log->created_at?->toIso8601String(),
            ])
            ->all();

        return $payload;
    }

    private function mapItem(BlogAiUrlImportItem $item): array
    {
        $generatedPost = $this->mapGeneratedPost($this->resolveGeneratedPost($item));
        $hasMissingPost = $item->post_id && !$generatedPost;

        return [
            'id' => $item->id,
            'position' => (int) $item->position,
            'source_url' => $item->source_url,
            'source_link_url' => $item->source_url,
            'source_title' => $item->source_title,
            'status' => $item->status,
            'post_id' => $item->post_id ? (int) $item->post_id : null,
            'generated_title' => $item->generated_title,
            'generated_post' => $generatedPost,
            'generated_post_missing' => (bool) $hasMissingPost,
            'generated_public_url' => $generatedPost['public_url'] ?? null,
            'generated_admin_url' => $generatedPost['admin_edit_url'] ?? null,
            'generated_open_url' => $generatedPost['open_url'] ?? null,
            'last_model' => $item->last_model,
            'last_error' => $item->last_error,
            'started_at' => $item->started_at?->toIso8601String(),
            'finished_at' => $item->finished_at?->toIso8601String(),
            'created_at' => $item->created_at?->toIso8601String(),
            'updated_at' => $item->updated_at?->toIso8601String(),
        ];
    }

    private function resolveGeneratedPost(BlogAiUrlImportItem $item): ?Post
    {
        if (!$item->post_id) {
            return null;
        }

        if ($item->relationLoaded('post')) {
            $post = $item->getRelation('post');
            if ($post instanceof Post) {
                return $post;
            }
        }

        return Post::withTrashed()
            ->select('id', 'account_id', 'title', 'slug', 'is_published', 'published_at', 'deleted_at')
            ->find((int) $item->post_id);
    }

    private function mapGeneratedPost(?Post $post): ?array
    {
        if (!$post) {
            return null;
        }

        $isDeleted = method_exists($post, 'trashed') && $post->trashed();
        $publicUrl = $this->publicSiteUrlResolver->buildBlogUrl($post->slug, (int) $post->account_id);
        $publicPath = $this->publicSiteUrlResolver->buildBlogPath($post->slug);
        $adminEditUrl = '/admin/blog/edit/' . $post->id;
        $isPubliclyVisible = !$isDeleted && $this->isPostPubliclyVisible($post);

        return [
            'id' => (int) $post->id,
            'title' => $post->title,
            'slug' => $post->slug,
            'is_published' => (bool) $post->is_published,
            'is_deleted' => $isDeleted,
            'is_publicly_visible' => $isPubliclyVisible,
            'published_at' => $post->published_at?->toIso8601String(),
            'deleted_at' => $post->deleted_at?->toIso8601String(),
            'public_path' => $publicPath,
            'public_url' => $publicUrl,
            'admin_edit_url' => $adminEditUrl,
            'open_url' => $isDeleted ? null : ($isPubliclyVisible && $publicUrl !== '' ? $publicUrl : $adminEditUrl),
            'open_target' => $isDeleted ? 'deleted' : ($isPubliclyVisible && $publicUrl !== '' ? 'public' : 'admin'),
        ];
    }

    private function isPostPubliclyVisible(Post $post): bool
    {
        if (method_exists($post, 'trashed') && $post->trashed()) {
            return false;
        }

        if (!$post->is_published) {
            return false;
        }

        return $post->published_at === null || $post->published_at->lessThanOrEqualTo(now());
    }

    private function resolveAccountId(Request $request): ?int
    {
        $siteCode = $request->query('site_code') ?: $request->header('X-Site-Code');

        if ($siteCode) {
            $account = Account::query()->where('site_code', $siteCode)->first();
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
}
