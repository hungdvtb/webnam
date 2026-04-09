<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\BlogAiBulkJob;
use App\Services\BlogAi\BlogAiBulkGenerationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BlogAiBulkController extends Controller
{
    public function __construct(
        private readonly BlogAiBulkGenerationService $generationService,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $accountId = $this->resolveAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        $limit = max(min((int) $request->query('limit', 5), 20), 1);

        $jobs = BlogAiBulkJob::query()
            ->where('account_id', $accountId)
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
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        $validated = $request->validate([
            'file' => 'required|file|max:10240|mimes:xlsx,csv,txt',
        ]);

        $job = $this->generationService->createJobFromUpload(
            $accountId,
            $validated['file'],
            auth()->id()
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
        $job = $this->generationService->run($job);

        return response()->json([
            'data' => $this->mapJob($job, true),
        ]);
    }

    private function resolveJob(Request $request, int $jobId): BlogAiBulkJob
    {
        $accountId = $this->resolveAccountId($request);
        if (!$accountId) {
            abort(400, 'Account ID is required');
        }

        return BlogAiBulkJob::query()
            ->where('account_id', $accountId)
            ->whereKey($jobId)
            ->firstOrFail();
    }

    private function mapJob(BlogAiBulkJob $job, bool $withLogs = false): array
    {
        $job->refresh();

        $payload = [
            'id' => $job->id,
            'status' => $job->status,
            'source_filename' => $job->source_filename,
            'total_keywords' => (int) $job->total_keywords,
            'unique_keywords' => (int) $job->unique_keywords,
            'cluster_count' => (int) $job->cluster_count,
            'processed_clusters' => (int) $job->processed_clusters,
            'categories_created' => (int) $job->categories_created,
            'posts_created' => (int) $job->posts_created,
            'posts_failed' => (int) $job->posts_failed,
            'ai_model' => $job->ai_model,
            'summary' => $job->summary ?? [],
            'errors' => $job->errors ?? [],
            'metadata' => $job->metadata ?? [],
            'started_at' => $job->started_at?->toIso8601String(),
            'finished_at' => $job->finished_at?->toIso8601String(),
            'created_at' => $job->created_at?->toIso8601String(),
            'updated_at' => $job->updated_at?->toIso8601String(),
        ];

        if (!$withLogs) {
            return $payload;
        }

        $logs = $job->logs()
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

        $payload['logs'] = $logs;

        return $payload;
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
