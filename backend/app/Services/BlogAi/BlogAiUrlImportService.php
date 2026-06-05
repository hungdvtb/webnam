<?php

namespace App\Services\BlogAi;

use App\Models\BlogAiBulkJob;
use App\Models\BlogAiBulkJobLog;
use App\Models\BlogAiUrlImportItem;
use App\Models\BlogCategory;
use App\Models\Post;
use App\Models\SiteDomain;
use App\Models\SiteSetting;
use App\Services\AI\AiExceptionClassifier;
use App\Services\AI\GeminiService;
use App\Support\BlogContentHtmlNormalizer;
use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Throwable;

class BlogAiUrlImportService
{
    public const SOURCE_TYPE = 'competitor_url';

    private const DEFAULT_MAX_AI_REQUESTS = 20;
    private const DEFAULT_MAX_ARCHIVE_PAGES = 120;
    private const MAX_SOURCE_PARAGRAPHS = 14;
    private const MAX_SOURCE_HEADINGS = 18;
    private const MAX_SOURCE_BRIEF_CHARACTERS = 6500;
    private const MAX_SOURCE_STRUCTURE_CHARACTERS = 12000;
    private const DEFAULT_AI_TIMEOUT_SECONDS = 45;
    private const DEFAULT_AI_CONNECT_TIMEOUT_SECONDS = 10;
    private const DEFAULT_PROCESSING_STALE_AFTER_SECONDS = 900;
    private const DEFAULT_BATCH_SIZE = 3;

    public function __construct(
        private readonly GeminiService $geminiService,
        private readonly AiExceptionClassifier $aiExceptionClassifier,
    ) {
    }

    public function createJobFromUrl(
        int $accountId,
        string $sourceUrl,
        ?int $userId = null,
        ?int $maxAiRequests = null,
        ?int $maxArchivePages = null,
    ): BlogAiBulkJob {
        $normalizedUrl = $this->normalizeUrl($sourceUrl);
        if ($normalizedUrl === '') {
            throw ValidationException::withMessages([
                'source_url' => ['Link doi thu khong hop le.'],
            ]);
        }

        $host = parse_url($normalizedUrl, PHP_URL_HOST) ?: 'source-url';
        $maxAiRequests = min(max($maxAiRequests ?: self::DEFAULT_MAX_AI_REQUESTS, 1), 200);
        $maxArchivePages = min(max($maxArchivePages ?: self::DEFAULT_MAX_ARCHIVE_PAGES, 1), 300);

        return BlogAiBulkJob::query()->create([
            'account_id' => $accountId,
            'created_by' => $userId,
            'status' => BlogAiBulkJob::STATUS_PENDING,
            'source_filename' => Str::limit('URL: ' . $host, 250, ''),
            'source_disk' => 'url',
            'source_path' => Str::limit($normalizedUrl, 500, ''),
            'metadata' => [
                'source_type' => self::SOURCE_TYPE,
                'source_url' => $normalizedUrl,
                'source_host' => $host,
                'max_ai_requests' => $maxAiRequests,
                'max_archive_pages' => $maxArchivePages,
            ],
            'summary' => [
                'progress_percent' => 0,
                'ai_requests_used' => 0,
                'max_ai_requests' => $maxAiRequests,
                'ai_articles_requested' => 0,
                'ai_articles_created' => 0,
                'avg_articles_per_ai_request' => 0,
                'avg_requested_articles_per_ai_request' => 0,
                'ai_prompt_tokens_used' => 0,
                'ai_output_tokens_used' => 0,
                'ai_total_tokens_used' => 0,
                'processed_items' => 0,
                'pending_items' => 0,
                'completed_items' => 0,
                'failed_items' => 0,
            ],
        ]);
    }

    public function scan(BlogAiBulkJob $job): BlogAiBulkJob
    {
        $job->refresh();
        $this->assertUrlJob($job);

        $metadata = $job->metadata ?? [];
        $sourceUrl = $this->normalizeUrl((string) ($metadata['source_url'] ?? $job->source_path));
        $maxArchivePages = min(max((int) ($metadata['max_archive_pages'] ?? self::DEFAULT_MAX_ARCHIVE_PAGES), 1), 300);

        if ($sourceUrl === '') {
            throw ValidationException::withMessages([
                'source_url' => ['Link doi thu khong hop le.'],
            ]);
        }

        $job->forceFill([
            'status' => BlogAiBulkJob::STATUS_SCANNING,
            'started_at' => $job->started_at ?? now(),
            'finished_at' => null,
            'errors' => [],
        ])->save();

        $this->appendLog($job, 'info', 'scan_start', sprintf('Bat dau quet tat ca link bai viet tu: %s', $sourceUrl));

        try {
            $articleLinks = $this->discoverArticleLinks($job, $sourceUrl, $maxArchivePages);
            $created = 0;
            $existing = 0;

            DB::transaction(function () use ($job, $articleLinks, &$created, &$existing) {
                foreach ($articleLinks as $index => $link) {
                    $sourceHash = sha1($link['url']);
                    $item = BlogAiUrlImportItem::query()->firstOrCreate(
                        [
                            'blog_ai_bulk_job_id' => $job->id,
                            'source_hash' => $sourceHash,
                        ],
                        [
                            'position' => $index + 1,
                            'source_url' => $link['url'],
                            'source_title' => $link['title'] ?: $link['url'],
                            'status' => BlogAiUrlImportItem::STATUS_PENDING,
                            'metadata' => [
                                'discovered_title' => $link['title'] ?? '',
                            ],
                        ]
                    );

                    if ($item->wasRecentlyCreated) {
                        $created++;
                    } else {
                        $existing++;
                        $item->forceFill([
                            'position' => $index + 1,
                            'source_url' => $link['url'],
                            'source_title' => $item->source_title ?: ($link['title'] ?: $link['url']),
                        ])->save();
                    }
                }
            });

            $this->appendLog($job, 'info', 'scan_done', sprintf(
                'Da quet xong %d link bai viet. Moi: %d, da co: %d.',
                count($articleLinks),
                $created,
                $existing
            ));

            return $this->syncJobFromItems($job, BlogAiBulkJob::STATUS_SCANNED);
        } catch (Throwable $exception) {
            $job->forceFill([
                'status' => BlogAiBulkJob::STATUS_FAILED,
                'finished_at' => now(),
                'errors' => [$this->shortError($exception)],
            ])->save();

            $this->appendLog($job, 'error', 'scan_failed', $this->shortError($exception));

            throw $exception;
        }
    }

    public function processNextItem(
        BlogAiBulkJob $job,
        bool $retryFailedOnly = false,
        ?array $retryItemIds = null,
        ?callable $onProgress = null,
    ): array
    {
        $job->refresh();
        $this->assertUrlJob($job);

        if ($job->status === BlogAiBulkJob::STATUS_SCANNING) {
            throw ValidationException::withMessages([
                'job' => ['Tien trinh dang quet link, hay cho quet xong truoc khi tao bai.'],
            ]);
        }

        $metadata = $job->metadata ?? [];
        $summary = $job->summary ?? [];
        $maxAiRequests = min(max((int) ($metadata['max_ai_requests'] ?? $summary['max_ai_requests'] ?? self::DEFAULT_MAX_AI_REQUESTS), 1), 200);
        $usedRequests = (int) ($summary['ai_requests_used'] ?? 0);

        if ($usedRequests >= $maxAiRequests) {
            $job = $this->syncJobFromItems($job, BlogAiBulkJob::STATUS_PAUSED, [
                'stopped_due_to_request_limit' => true,
                'last_error' => 'Da dung vi dat gioi han request AI cho lan chay nay.',
            ]);

            return [
                'job' => $job,
                'item' => null,
                'done' => false,
                'paused' => true,
                'message' => 'Da dung vi dat gioi han request AI.',
            ];
        }

        $this->failStaleProcessingItems($job);

        $batchItems = $this->nextProcessableItems($job, $retryFailedOnly, $retryItemIds);

        if ($batchItems->isEmpty()) {
            $finalStatus = $retryFailedOnly
                ? $this->resolveRetryFinishedStatus($job)
                : ($this->hasFailedItems($job)
                    ? BlogAiBulkJob::STATUS_COMPLETED_WITH_ERRORS
                    : BlogAiBulkJob::STATUS_COMPLETED);

            return [
                'job' => $this->syncJobFromItems($job, $finalStatus),
                'item' => null,
                'items' => [],
                'batch' => [
                    'requested_items' => 0,
                    'processed_items' => 0,
                    'ai_requests_used' => 0,
                ],
                'done' => true,
                'paused' => false,
                'message' => $retryFailedOnly
                    ? 'Khong con bai loi nao dang cho chay lai.'
                    : 'Khong con bai nao dang cho tao.',
            ];
        }

        $job->forceFill([
            'status' => BlogAiBulkJob::STATUS_RUNNING,
            'started_at' => $job->started_at ?? now(),
            'finished_at' => null,
        ])->save();

        foreach ($batchItems as $item) {
            $item->forceFill([
                'status' => BlogAiUrlImportItem::STATUS_PROCESSING,
                'last_error' => null,
                'started_at' => $item->started_at ?? now(),
                'finished_at' => null,
            ])->save();
        }

        $this->appendLog($job, 'info', $retryFailedOnly ? 'retry_failed_batch' : 'process_batch', sprintf(
            $retryFailedOnly ? 'Dang chay lai batch %d bai loi.' : 'Dang tao batch %d bai.',
            $batchItems->count()
        ), [
            'item_ids' => $batchItems->pluck('id')->map(fn ($id) => (int) $id)->values()->all(),
            'positions' => $batchItems->pluck('position')->map(fn ($position) => (int) $position)->values()->all(),
            'max_batch_size' => $this->batchSize(),
        ]);
        $this->reportProgress($onProgress, $this->workerProgressPayload(
            $job,
            $batchItems->first(),
            $retryFailedOnly ? 'retry_batch_start' : 'batch_start'
        ));

        $processedItems = [];
        $itemStatuses = [];
        $briefEntries = [];

        foreach ($batchItems->values() as $batchIndex => $item) {
            try {
                $this->reportProgress($onProgress, $this->workerProgressPayload($job, $item, 'crawl_source'));
                $brief = $this->extractArticleBrief($item->source_url, (string) $item->source_title);
                if ($brief === null) {
                    throw new \RuntimeException('Khong tach duoc noi dung bai viet nguon.');
                }

                $brief['source_id'] = $this->batchSourceId($batchIndex);
                $briefEntries[] = [
                    'item' => $item->fresh(),
                    'brief' => $brief,
                ];
            } catch (Throwable $exception) {
                $classified = $this->classifySourceException($exception);
                $errorMessage = $this->detailedError($exception, $classified);

                $item->forceFill([
                    'status' => BlogAiUrlImportItem::STATUS_FAILED,
                    'last_error' => $errorMessage,
                    'finished_at' => now(),
                ])->save();

                $freshItem = $item->fresh();
                $processedItems[] = $freshItem;
                $itemStatuses[] = $this->aiBatchItemStatus($freshItem, 'source_extract_failed');

                $this->appendLog($job, 'error', 'crawl_failed', $errorMessage, [
                    'item_id' => $item->id,
                    'position' => $item->position,
                    'source_url' => $item->source_url,
                    'error_code' => $classified['error_code'] ?? null,
                    'retryable' => (bool) ($classified['retryable'] ?? false),
                    'exception_class' => $exception::class,
                ]);
                $this->reportProgress($onProgress, $this->workerProgressPayload($job, $freshItem, 'crawl_failed'));
            }
        }

        if ($briefEntries === []) {
            return [
                'job' => $this->syncJobFromItems($job),
                'item' => $processedItems[0] ?? null,
                'items' => $processedItems,
                'batch' => [
                    'requested_items' => $batchItems->count(),
                    'processed_items' => count($processedItems),
                    'ai_requests_used' => 0,
                    'item_statuses' => $itemStatuses,
                ],
                'done' => false,
                'paused' => false,
                'message' => 'Batch nay loi khi lay noi dung nguon, chua goi AI.',
            ];
        }

        $businessProfile = $this->resolveBusinessProfile((int) $job->account_id);
        $attempts = [];
        $briefs = array_map(fn (array $entry) => $entry['brief'], $briefEntries);
        $plannedRequestNumber = $usedRequests + 1;

        $this->appendLog($job, 'info', 'ai_batch_request_start', sprintf(
            'Goi Gemini request #%d cho %d bai (batch toi da %d).',
            $plannedRequestNumber,
            count($briefs),
            $this->batchSize()
        ), [
            'request_number' => $plannedRequestNumber,
            'article_count' => count($briefs),
            'source_ids' => array_map(fn (array $brief) => $brief['source_id'], $briefs),
            'item_ids' => array_map(fn (array $entry) => (int) $entry['item']->id, $briefEntries),
        ]);
        $this->reportProgress($onProgress, $this->workerProgressPayload($job, $briefEntries[0]['item'] ?? null, 'ai_request'));

        try {
            $result = $this->generateArticles(
                $briefs,
                $businessProfile,
                (int) $job->account_id,
                function (array $attempt) use ($job, &$attempts, $briefs, $onProgress): void {
                    $recordedAttempt = $this->recordAiRequestAttempt($job, count($briefs), $attempt);
                    $attempts[] = $recordedAttempt;
                    $this->reportProgress($onProgress, $this->workerProgressPayload(
                        $job->fresh(),
                        null,
                        ($recordedAttempt['status'] ?? null) === 'success' ? 'ai_request_done' : 'ai_request_failed',
                        [
                            'last_ai_attempt' => $recordedAttempt,
                        ]
                    ));
                }
            );

            foreach ($briefEntries as $entry) {
                /** @var BlogAiUrlImportItem $item */
                $this->persistGeneratedArticleResult(
                    $job,
                    $entry['item']->fresh(),
                    $entry['brief'],
                    $result,
                    $businessProfile,
                    $processedItems,
                    $itemStatuses,
                    $onProgress
                );
            }

            $latestAttempt = $attempts[count($attempts) - 1] ?? [];
            $this->appendLog($job, 'info', 'ai_batch_request_done', $this->aiBatchLogMessage(
                $latestAttempt,
                count($briefs),
                $itemStatuses
            ), [
                'article_count' => count($briefs),
                'model' => $result['model'] ?? ($latestAttempt['model'] ?? null),
                'usage' => $result['usage'] ?? ($latestAttempt['usage'] ?? null),
                'attempts' => $attempts,
                'item_statuses' => $itemStatuses,
            ]);

            return [
                'job' => $this->syncJobFromItems($job),
                'item' => $processedItems[0] ?? null,
                'items' => $processedItems,
                'batch' => [
                    'requested_items' => $batchItems->count(),
                    'processed_items' => count($processedItems),
                    'ai_requests_used' => count($attempts),
                    'model' => $result['model'] ?? null,
                    'usage' => $result['usage'] ?? null,
                    'item_statuses' => $itemStatuses,
                ],
                'done' => false,
                'paused' => false,
                'message' => sprintf('Da xu ly batch %d bai bang %d request AI.', count($processedItems), max(count($attempts), 0)),
            ];
        } catch (Throwable $exception) {
            $classified = $this->aiExceptionClassifier->classify($exception);
            $isQuota = ($classified['error_code'] ?? '') === 'AI_RATE_LIMITED';

            if ($isQuota) {
                foreach ($briefEntries as $entry) {
                    /** @var BlogAiUrlImportItem $item */
                    $item = $entry['item']->fresh();
                    $item->forceFill([
                        'status' => $retryFailedOnly
                            ? BlogAiUrlImportItem::STATUS_FAILED
                            : BlogAiUrlImportItem::STATUS_PENDING,
                        'last_error' => $classified['detail'] ?: $classified['message'],
                        'finished_at' => $retryFailedOnly ? now() : null,
                    ])->save();

                    $freshItem = $item->fresh();
                    $processedItems[] = $freshItem;
                    $itemStatuses[] = $this->aiBatchItemStatus($freshItem, 'quota_pause');
                }

                $this->appendLog($job, 'warning', 'quota_pause', $classified['detail'] ?: $classified['message'], [
                    'item_ids' => array_map(fn (array $entry) => (int) $entry['item']->id, $briefEntries),
                    'error_code' => $classified['error_code'],
                    'attempts' => $attempts,
                    'item_statuses' => $itemStatuses,
                ]);

                return [
                    'job' => $this->syncJobFromItems($job, BlogAiBulkJob::STATUS_PAUSED, [
                        'stopped_due_to_quota' => true,
                        'last_error' => $classified['detail'] ?: $classified['message'],
                    ]),
                    'item' => $processedItems[0] ?? null,
                    'items' => $processedItems,
                    'batch' => [
                        'requested_items' => $batchItems->count(),
                        'processed_items' => count($processedItems),
                        'ai_requests_used' => count($attempts),
                        'attempts' => $attempts,
                        'item_statuses' => $itemStatuses,
                    ],
                    'done' => false,
                    'paused' => true,
                    'message' => 'Da tam dung vi AI bi gioi han quota.',
                ];
            }

            $errorMessage = $this->detailedError($exception, $classified);
            if (count($briefEntries) > 1 && (bool) ($classified['retryable'] ?? false)) {
                $this->appendLog($job, 'warning', 'ai_batch_fallback', sprintf(
                    'Batch AI loi transient (%s). Dang thu tach tung bai de bai tot van duoc tao.',
                    $classified['error_code'] ?? 'AI_ERROR'
                ), [
                    'item_ids' => array_map(fn (array $entry) => (int) $entry['item']->id, $briefEntries),
                    'error_code' => $classified['error_code'] ?? null,
                    'exception_class' => $exception::class,
                    'batch_error' => $errorMessage,
                    'attempts' => $attempts,
                ]);

                $this->processBriefEntriesIndividuallyAfterAiFailure(
                    $job,
                    $briefEntries,
                    $businessProfile,
                    $processedItems,
                    $itemStatuses,
                    $attempts,
                    $onProgress
                );

                $this->appendLog($job, 'info', 'ai_batch_fallback_done', 'Da ket thuc fallback tung bai sau loi batch AI.', [
                    'item_statuses' => $itemStatuses,
                    'attempts' => $attempts,
                ]);

                return [
                    'job' => $this->syncJobFromItems($job),
                    'item' => $processedItems[0] ?? null,
                    'items' => $processedItems,
                    'batch' => [
                        'requested_items' => $batchItems->count(),
                        'processed_items' => count($processedItems),
                        'ai_requests_used' => count($attempts),
                        'attempts' => $attempts,
                        'item_statuses' => $itemStatuses,
                    ],
                    'done' => false,
                    'paused' => false,
                    'message' => 'Batch AI loi, da thu tach tung bai va danh loi rieng cac bai khong tao duoc.',
                ];
            }

            foreach ($briefEntries as $entry) {
                /** @var BlogAiUrlImportItem $item */
                $freshItem = $this->markItemFailed(
                    $job,
                    $entry['item']->fresh(),
                    $errorMessage,
                    'ai_request_failed',
                    [
                        'source_brief' => $entry['brief']['brief'] ?? null,
                        'metadata' => [
                            'source_outline' => $entry['brief']['outline'] ?? [],
                            'competitor_mentions' => $entry['brief']['competitor_mentions'] ?? [],
                            'ai_batch_source_id' => $entry['brief']['source_id'] ?? null,
                            'ai_batch_error' => $errorMessage,
                        ],
                    ]
                );

                $processedItems[] = $freshItem;
                $itemStatuses[] = $this->aiBatchItemStatus($freshItem, 'ai_request_failed');
            }

            $this->appendLog($job, 'error', 'ai_batch_request_failed', $errorMessage, [
                'item_ids' => array_map(fn (array $entry) => (int) $entry['item']->id, $briefEntries),
                'error_code' => $classified['error_code'] ?? null,
                'exception_class' => $exception::class,
                'attempts' => $attempts,
                'item_statuses' => $itemStatuses,
            ]);

            return [
                'job' => $this->syncJobFromItems($job),
                'item' => $processedItems[0] ?? null,
                'items' => $processedItems,
                'batch' => [
                    'requested_items' => $batchItems->count(),
                    'processed_items' => count($processedItems),
                    'ai_requests_used' => count($attempts),
                    'attempts' => $attempts,
                    'item_statuses' => $itemStatuses,
                ],
                'done' => false,
                'paused' => false,
                'message' => 'Batch nay loi, da danh dau cac bai trong batch de khong goi lai nhieu lan.',
            ];
        }
    }

    public function pause(BlogAiBulkJob $job): BlogAiBulkJob
    {
        $this->assertUrlJob($job);
        $metadata = array_merge($job->metadata ?? [], [
            'processing_active' => false,
            'run_finished_at' => now()->toIso8601String(),
        ]);

        $job->forceFill([
            'status' => BlogAiBulkJob::STATUS_PAUSED,
            'summary' => array_merge($job->summary ?? [], [
                'paused_at' => now()->toIso8601String(),
                'processing_active' => false,
            ]),
            'metadata' => $metadata,
        ])->save();

        $this->appendLog($job, 'warning', 'paused', 'Nguoi dung da tam dung tien trinh tao bai.');

        return $this->syncJobFromItems($job, BlogAiBulkJob::STATUS_PAUSED);
    }

    public function resetFailedItems(BlogAiBulkJob $job): BlogAiBulkJob
    {
        $this->assertUrlJob($job);

        $failedCount = BlogAiUrlImportItem::query()
            ->where('blog_ai_bulk_job_id', $job->id)
            ->where('status', BlogAiUrlImportItem::STATUS_FAILED)
            ->count();

        $this->appendLog($job, 'info', 'retry_failed_ready', sprintf(
            'San sang chay lai %d bai loi. Trang thai tung bai duoc giu nguyen cho den khi retry that su xu ly.',
            $failedCount
        ));

        return $this->syncJobFromItems($job);
    }

    public function startProcessing(BlogAiBulkJob $job, bool $retryFailedOnly = false, ?array $retryItemIds = null): BlogAiBulkJob
    {
        $job->refresh();
        $this->assertUrlJob($job);

        if ($job->status === BlogAiBulkJob::STATUS_SCANNING) {
            throw ValidationException::withMessages([
                'job' => ['Tien trinh dang quet link, hay cho quet xong truoc khi tao bai.'],
            ]);
        }

        $this->failStaleProcessingItems($job);

        $retryItemIds = $retryFailedOnly && is_array($retryItemIds)
            ? array_values(array_filter(array_unique(array_map('intval', $retryItemIds)), fn (int $id) => $id > 0))
            : null;

        $pendingCount = BlogAiUrlImportItem::query()
            ->where('blog_ai_bulk_job_id', $job->id)
            ->where('status', BlogAiUrlImportItem::STATUS_PENDING)
            ->count();
        $failedCount = BlogAiUrlImportItem::query()
            ->where('blog_ai_bulk_job_id', $job->id)
            ->where('status', BlogAiUrlImportItem::STATUS_FAILED)
            ->when($retryFailedOnly && is_array($retryItemIds), fn ($query) => $query->whereIn('id', $retryItemIds))
            ->count();

        if ($retryFailedOnly && $failedCount === 0) {
            return $this->syncJobFromItems($job, $this->resolveRetryFinishedStatus($job), [
                'processing_active' => false,
                'last_error' => 'Khong co bai loi nao trong danh sach chay lai.',
            ]);
        }

        if (!$retryFailedOnly && $pendingCount === 0) {
            return $this->syncJobFromItems($job, $this->hasFailedItems($job)
                ? BlogAiBulkJob::STATUS_COMPLETED_WITH_ERRORS
                : BlogAiBulkJob::STATUS_COMPLETED);
        }

        $metadata = array_merge($job->metadata ?? [], [
            'processing_active' => true,
            'run_mode' => $retryFailedOnly ? 'retry_failed' : 'pending',
            'retry_item_ids' => $retryFailedOnly ? ($retryItemIds ?? []) : null,
            'run_requested_at' => now()->toIso8601String(),
            'run_started_by' => auth()->id(),
        ]);

        $job->forceFill([
            'status' => BlogAiBulkJob::STATUS_RUNNING,
            'started_at' => $job->started_at ?? now(),
            'finished_at' => null,
            'metadata' => $metadata,
        ])->save();

        $this->appendLog($job, 'info', $retryFailedOnly ? 'retry_queued' : 'run_queued', $retryFailedOnly
            ? sprintf('Da dua %d bai loi vao hang doi chay lai.', $failedCount)
            : sprintf('Da dua %d bai cho xu ly vao hang doi tao bai nen.', $pendingCount));

        return $this->syncJobFromItems($job, BlogAiBulkJob::STATUS_RUNNING, [
            'processing_active' => true,
        ]);
    }

    public function processNextAvailableJob(?callable $onProgress = null): bool
    {
        $lock = Cache::lock('blog_ai_url_import_process_next', max((int) config('blog_ai_url_import.worker.lock_ttl', 180), 60));

        if (!$lock->get()) {
            return false;
        }

        try {
            $job = BlogAiBulkJob::query()
                ->where('status', BlogAiBulkJob::STATUS_RUNNING)
                ->where('metadata->source_type', self::SOURCE_TYPE)
                ->where('metadata->processing_active', true)
                ->orderBy('id')
                ->first();

            if (!$job) {
                return false;
            }

            $metadata = $job->metadata ?? [];
            $retryFailedOnly = ($metadata['run_mode'] ?? null) === 'retry_failed';
            $retryItemIds = $retryFailedOnly && is_array($metadata['retry_item_ids'] ?? null)
                ? array_values(array_filter(array_unique(array_map('intval', $metadata['retry_item_ids'])), fn (int $id) => $id > 0))
                : null;

            $this->reportProgress($onProgress, $this->workerProgressPayload($job, null, 'job_picked'));
            $result = $this->processNextItem($job, $retryFailedOnly, $retryItemIds, $onProgress);
            $freshJob = $result['job']->fresh();
            $nextMetadata = $freshJob->metadata ?? [];

            if ($retryFailedOnly && is_array($retryItemIds)) {
                $processedItemIds = collect($result['items'] ?? [])
                    ->filter(fn ($item) => $item instanceof BlogAiUrlImportItem)
                    ->map(fn (BlogAiUrlImportItem $item) => (int) $item->id)
                    ->whenEmpty(fn ($collection) => ($result['item'] ?? null) instanceof BlogAiUrlImportItem
                        ? collect([(int) $result['item']->id])
                        : collect())
                    ->values()
                    ->all();

                $nextMetadata['retry_item_ids'] = array_values(array_filter(
                    $retryItemIds,
                    fn (int $itemId) => !in_array($itemId, $processedItemIds, true)
                ));
            }

            if (($result['done'] ?? false) || ($result['paused'] ?? false) || $freshJob->status !== BlogAiBulkJob::STATUS_RUNNING) {
                $nextMetadata['processing_active'] = false;
                $nextMetadata['run_finished_at'] = now()->toIso8601String();
            }

            $freshJob->forceFill(['metadata' => $nextMetadata])->save();

            return true;
        } finally {
            optional($lock)->release();
        }
    }

    private function nextProcessableItems(BlogAiBulkJob $job, bool $retryFailedOnly, ?array $retryItemIds)
    {
        $targetStatus = $retryFailedOnly
            ? BlogAiUrlImportItem::STATUS_FAILED
            : BlogAiUrlImportItem::STATUS_PENDING;

        $query = BlogAiUrlImportItem::query()
            ->where('blog_ai_bulk_job_id', $job->id)
            ->where('status', $targetStatus);

        if ($retryFailedOnly && is_array($retryItemIds)) {
            $retryItemIds = array_values(array_filter(array_unique(array_map('intval', $retryItemIds)), fn (int $id) => $id > 0));
            if ($retryItemIds === []) {
                $query->whereRaw('1 = 0');
            } else {
                $query->whereIn('id', $retryItemIds);
            }
        }

        return $query
            ->orderBy('position')
            ->orderBy('id')
            ->limit($this->batchSize())
            ->get();
    }

    private function batchSize(): int
    {
        return min(max((int) config('blog_ai_url_import.batch_size', self::DEFAULT_BATCH_SIZE), 1), self::DEFAULT_BATCH_SIZE);
    }

    private function batchSourceId(int $index): string
    {
        return 'article_' . ($index + 1);
    }

    private function itemTimeoutSeconds(): int
    {
        return max((int) config('blog_ai_url_import.item_timeout_seconds', self::DEFAULT_PROCESSING_STALE_AFTER_SECONDS), 60);
    }

    private function discoverArticleLinks(BlogAiBulkJob $job, string $sourceUrl, int $maxArchivePages): array
    {
        $queue = [$sourceUrl];
        $visited = [];
        $articleLinks = [];
        $basePath = rtrim((string) parse_url($sourceUrl, PHP_URL_PATH), '/');

        while ($queue !== [] && count($visited) < $maxArchivePages) {
            $archiveUrl = array_shift($queue);
            $archiveKey = $this->normalizeUrl($archiveUrl);
            if ($archiveKey === '' || isset($visited[$archiveKey])) {
                continue;
            }

            $visited[$archiveKey] = true;
            $html = $this->fetchUrl($archiveKey);
            $links = $this->extractLinks($html, $archiveKey);

            foreach ($links as $link) {
                $url = $link['url'];
                if (!$this->sameHost($sourceUrl, $url)) {
                    continue;
                }

                if ($this->isPaginationLink($sourceUrl, $url, $link['text'], $basePath)) {
                    if (!isset($visited[$url]) && !in_array($url, $queue, true) && count($visited) + count($queue) < $maxArchivePages) {
                        $queue[] = $url;
                    }
                    continue;
                }

                if (($link['navigation_context'] ?? false)
                    || !$this->isPotentialArticleLink($sourceUrl, $url, $link['text'], $basePath)) {
                    continue;
                }

                if (!isset($articleLinks[$url])) {
                    $articleLinks[$url] = [
                        'url' => $url,
                        'title' => $link['text'],
                        'score' => $this->articleLinkScore($sourceUrl, $url, $link['text'], $basePath),
                        'position' => count($articleLinks) + 1,
                    ];
                }
            }

            $this->appendLog($job, 'info', 'discover_links', sprintf(
                'Da quet archive %d/%d, tong cong %d link bai viet.',
                count($visited),
                $maxArchivePages,
                count($articleLinks)
            ), [
                'archive_url' => $archiveKey,
            ]);
        }

        uasort($articleLinks, function (array $left, array $right): int {
            return (($right['score'] ?? 0) <=> ($left['score'] ?? 0))
                ?: (($left['position'] ?? 0) <=> ($right['position'] ?? 0));
        });

        return array_map(
            fn (array $item) => [
                'url' => $item['url'],
                'title' => $item['title'],
            ],
            array_values($articleLinks)
        );
    }

    private function extractArticleBrief(string $url, string $fallbackTitle = ''): ?array
    {
        $html = $this->fetchUrl($url);
        $document = $this->loadHtml($html);
        $xpath = new DOMXPath($document);
        $this->removeNoiseNodes($xpath);

        $title = $this->firstText($xpath, '//h1')
            ?: $this->extractTitleTag($xpath)
            ?: $fallbackTitle
            ?: $url;
        $metaDescription = $this->extractMetaDescription($xpath);
        $root = $this->selectContentRoot($xpath);
        $headings = $this->extractNodeTexts($xpath, './/h1|.//h2|.//h3', $root, self::MAX_SOURCE_HEADINGS, 25);
        $paragraphs = $this->extractNodeTexts($xpath, './/p|.//li', $root, self::MAX_SOURCE_PARAGRAPHS, 50);
        $sourceText = $this->cleanText($root ? $this->nodeText($root) : $this->nodeText($document));
        $sourceHtmlStructure = $root
            ? $this->extractSourceHtmlStructure($root, $url)
            : '';

        if (mb_strlen($sourceText) < 400 && count($paragraphs) < 3) {
            return null;
        }

        $outline = [];
        foreach ($headings as $heading) {
            $outline[] = '- ' . $heading;
        }

        $keyPoints = [];
        foreach ($paragraphs as $paragraph) {
            $keyPoints[] = '- ' . Str::limit($paragraph, 280, '');
        }

        $competitorMentions = $this->detectCompetitorMentions($url, $title . "\n" . $metaDescription . "\n" . $sourceText);
        $brief = implode("\n", array_filter([
            'Tieu de nguon: ' . $title,
            $metaDescription !== '' ? 'Mo ta nguon: ' . $metaDescription : '',
            $outline !== [] ? "Heading chinh:\n" . implode("\n", $outline) : '',
            $keyPoints !== [] ? "Y chinh da rut gon:\n" . implode("\n", $keyPoints) : '',
        ]));

        return [
            'source_url' => $url,
            'title' => $this->cleanText($title),
            'meta_description' => $this->cleanText($metaDescription),
            'outline' => array_values(array_unique($headings)),
            'key_points' => $paragraphs,
            'brief' => Str::limit($brief, self::MAX_SOURCE_BRIEF_CHARACTERS, ''),
            'source_html_structure' => Str::limit($sourceHtmlStructure, self::MAX_SOURCE_STRUCTURE_CHARACTERS, ''),
            'source_hash' => sha1($url),
            'competitor_mentions' => $competitorMentions,
        ];
    }

    private function generateArticles(array $briefs, array $businessProfile, int $accountId, ?callable $onRequestAttempt = null): array
    {
        $articlesPayload = [];
        foreach (array_values($briefs) as $index => $brief) {
            $sourceId = (string) ($brief['source_id'] ?? $this->batchSourceId($index));
            $articlesPayload[] = [
                'source_id' => $sourceId,
                'source_url' => $brief['source_url'],
                'source_title' => $brief['title'],
                'source_brief' => $brief['brief'],
                'source_html_structure' => $brief['source_html_structure'] ?? '',
                'competitor_mentions_to_avoid' => $brief['competitor_mentions'],
            ];
        }

        $payload = [
            'business_profile' => $businessProfile,
            'articles' => $articlesPayload,
        ];

        $prompt = "You are a Vietnamese SEO editor for a ceramic business.\n"
            . "Use each competitor article only as topic research. Do not copy sentences, paragraph order, images, claims, contact information, or brand identity.\n"
            . "Write one brand-new Vietnamese article for every input article in the same single response.\n"
            . "Do all SEO fields, outline/content writing, rewrite, and HTML formatting inside this one response. Do not require any extra AI calls.\n"
            . "Mirror each source article presentation as closely as practical: heading hierarchy, paragraph rhythm, lists, image placements, links, and tables when they exist.\n"
            . "Keep facts conservative. If source details are not confirmed for this business, turn them into general buying/use guidance instead of claiming them as company facts.\n"
            . "Use the business phone, email, address, and brand from business_profile when contact details are needed.\n"
            . "Avoid mentioning competitor brand names, competitor phone numbers, competitor emails, or source domains.\n"
            . "Return valid JSON only. No markdown, no code fences, no explanation.\n\n"
            . "Hard rules:\n"
            . "1. Return exactly one object in articles for every input source_id, up to 3 objects total.\n"
            . "2. Preserve each source_id exactly. If one source cannot be written, return an object with that source_id and an error string instead of omitting it.\n"
            . "3. Each successful article should be 2500 to 4500 Vietnamese characters before HTML conversion.\n"
            . "4. category_name should be a long-term Vietnamese blog category.\n"
            . "5. seo_keywords must contain 4 to 8 relevant phrases.\n"
            . "6. content_html must be clean HTML, not markdown text. Use h2/h3, p, strong, ul/li, ol/li, a, img, figure, table when relevant.\n"
            . "7. Do not output raw markdown such as **bold** or ## heading inside content_html.\n"
            . "8. sections can be provided as fallback, but content_html is preferred.\n"
            . "9. faq must contain 2 to 4 questions when appropriate.\n\n"
            . "JSON schema:\n"
            . "{\n"
            . "  \"articles\": [\n"
            . "    {\n"
            . "      \"source_id\": \"article_1\",\n"
            . "      \"title\": \"...\",\n"
            . "      \"slug_hint\": \"...\",\n"
            . "      \"excerpt\": \"...\",\n"
            . "      \"seo_title\": \"...\",\n"
            . "      \"seo_description\": \"...\",\n"
            . "      \"seo_keywords\": [\"...\"],\n"
            . "      \"category_name\": \"...\",\n"
            . "      \"content_html\": \"<p>...</p><h2>...</h2>\",\n"
            . "      \"sections\": [{\"heading\": \"...\", \"paragraphs\": [\"...\"], \"list_items\": [\"...\"]}],\n"
            . "      \"faq\": [{\"question\": \"...\", \"answer\": \"...\"}]\n"
            . "    }\n"
            . "  ]\n"
            . "}\n\n"
            . "Input data:\n"
            . json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);

        $options = [
            'timeout' => (int) config('blog_ai_url_import.ai.timeout', self::DEFAULT_AI_TIMEOUT_SECONDS),
            'connect_timeout' => (int) config('blog_ai_url_import.ai.connect_timeout', self::DEFAULT_AI_CONNECT_TIMEOUT_SECONDS),
            'max_api_keys' => (int) config('blog_ai_url_import.ai.max_api_keys', 1),
            'max_model_candidates' => (int) config('blog_ai_url_import.ai.max_model_candidates', 1),
            'transient_retry_delays_ms' => config('blog_ai_url_import.ai.transient_retry_delays_ms', []),
        ];

        if ($onRequestAttempt !== null) {
            $options['on_request_attempt'] = $onRequestAttempt;
        }

        $result = $this->geminiService->generateText($prompt, $accountId, null, $options);
        $decoded = $this->decodeGeneratedArticlesResponse(
            (string) ($result['text'] ?? ''),
            $briefs,
            $businessProfile,
            $result['model'] ?? null
        );

        return [
            'articles' => $decoded['articles'],
            'model' => $result['model'] ?? null,
            'usage' => $result['usage'] ?? null,
            'warning' => $decoded['warning'] ?? null,
        ];
    }

    private function persistGeneratedArticleResult(
        BlogAiBulkJob $job,
        BlogAiUrlImportItem $item,
        array $brief,
        array $result,
        array $businessProfile,
        array &$processedItems,
        array &$itemStatuses,
        ?callable $onProgress = null,
    ): void {
        $item = $item->fresh();
        $sourceId = (string) ($brief['source_id'] ?? '');
        $articles = is_array($result['articles'] ?? null) ? $result['articles'] : [];
        $generated = is_array($articles[$sourceId] ?? null) ? $articles[$sourceId] : null;

        if (!$generated || !empty($generated['error']) || !is_array($generated['article'] ?? null)) {
            $stage = $this->stageForMissingAiResult($generated, $result);
            $errorMessage = Str::limit((string) ($generated['error'] ?? $result['warning'] ?? 'AI khong tra ve bai viet cho item nay trong batch.'), 700, '...');
            $item->forceFill([
                'status' => BlogAiUrlImportItem::STATUS_FAILED,
                'last_error' => $errorMessage,
                'last_model' => $result['model'] ?? null,
                'source_brief' => $brief['brief'],
                'metadata' => array_merge($item->metadata ?? [], [
                    'source_outline' => $brief['outline'],
                    'competitor_mentions' => $brief['competitor_mentions'],
                    'ai_batch_source_id' => $sourceId,
                    'ai_warning' => $result['warning'] ?? null,
                ]),
                'finished_at' => now(),
            ])->save();

            $freshItem = $item->fresh();
            $processedItems[] = $freshItem;
            $itemStatuses[] = $this->aiBatchItemStatus($freshItem, $stage);

            $this->appendLog($job, 'error', $stage, $errorMessage, [
                'item_id' => (int) $freshItem->id,
                'position' => (int) $freshItem->position,
                'source_url' => $freshItem->source_url,
                'source_id' => $sourceId,
                'model' => $result['model'] ?? null,
                'warning' => $result['warning'] ?? null,
            ]);
            $this->reportProgress($onProgress, $this->workerProgressPayload($job, $freshItem, $stage));

            return;
        }

        try {
            $this->reportProgress($onProgress, $this->workerProgressPayload($job, $item, 'save_post'));
            $persisted = $this->persistGeneratedArticle($job, $brief, $generated['article'], $businessProfile);

            $item->forceFill([
                'status' => BlogAiUrlImportItem::STATUS_COMPLETED,
                'post_id' => $persisted['post']->id,
                'generated_title' => $persisted['post']->title,
                'last_model' => $result['model'],
                'source_brief' => $brief['brief'],
                'metadata' => array_merge($item->metadata ?? [], [
                    'source_outline' => $brief['outline'],
                    'competitor_mentions' => $brief['competitor_mentions'],
                    'persist_action' => $persisted['action'],
                    'ai_batch_source_id' => $sourceId,
                    'ai_warning' => $generated['warning'] ?? $result['warning'] ?? null,
                ]),
                'finished_at' => now(),
            ])->save();

            $freshItem = $item->fresh();
            $processedItems[] = $freshItem;
            $itemStatuses[] = $this->aiBatchItemStatus($freshItem, 'completed', [
                'post_id' => $persisted['post']->id,
            ]);
            $this->reportProgress($onProgress, $this->workerProgressPayload($job, $freshItem, 'item_completed'));
        } catch (Throwable $exception) {
            $classified = $this->classifySaveException($exception);
            $errorMessage = $this->detailedError($exception, $classified);
            $freshItem = $this->markItemFailed($job, $item, $errorMessage, 'save_failed', [
                'last_model' => $result['model'] ?? null,
                'source_brief' => $brief['brief'] ?? null,
                'metadata' => [
                    'source_outline' => $brief['outline'] ?? [],
                    'competitor_mentions' => $brief['competitor_mentions'] ?? [],
                    'ai_batch_source_id' => $sourceId,
                    'save_error' => $errorMessage,
                ],
            ]);

            $processedItems[] = $freshItem;
            $itemStatuses[] = $this->aiBatchItemStatus($freshItem, 'save_failed');
            $this->appendLog($job, 'error', 'save_failed', $errorMessage, [
                'item_id' => (int) $freshItem->id,
                'position' => (int) $freshItem->position,
                'source_url' => $freshItem->source_url,
                'error_code' => $classified['error_code'],
                'exception_class' => $exception::class,
            ]);
            $this->reportProgress($onProgress, $this->workerProgressPayload($job, $freshItem, 'save_failed'));
        }
    }

    private function processBriefEntriesIndividuallyAfterAiFailure(
        BlogAiBulkJob $job,
        array $briefEntries,
        array $businessProfile,
        array &$processedItems,
        array &$itemStatuses,
        array &$attempts,
        ?callable $onProgress = null,
    ): void {
        foreach ($briefEntries as $entry) {
            /** @var BlogAiUrlImportItem $item */
            $item = $entry['item']->fresh();
            $brief = $entry['brief'];

            try {
                $this->reportProgress($onProgress, $this->workerProgressPayload($job, $item, 'ai_retry_single'));
                $singleResult = $this->generateArticles(
                    [$brief],
                    $businessProfile,
                    (int) $job->account_id,
                    function (array $attempt) use ($job, &$attempts, $onProgress): void {
                        $recordedAttempt = $this->recordAiRequestAttempt($job, 1, $attempt);
                        $attempts[] = $recordedAttempt;
                        $this->reportProgress($onProgress, $this->workerProgressPayload(
                            $job->fresh(),
                            null,
                            ($recordedAttempt['status'] ?? null) === 'success' ? 'ai_retry_single_done' : 'ai_retry_single_failed',
                            [
                                'last_ai_attempt' => $recordedAttempt,
                            ]
                        ));
                    }
                );

                $this->persistGeneratedArticleResult(
                    $job,
                    $item,
                    $brief,
                    $singleResult,
                    $businessProfile,
                    $processedItems,
                    $itemStatuses,
                    $onProgress
                );
            } catch (Throwable $singleException) {
                $classified = $this->aiExceptionClassifier->classify($singleException);
                $errorMessage = $this->detailedError($singleException, $classified);
                $freshItem = $this->markItemFailed($job, $item, $errorMessage, 'ai_retry_single_failed', [
                    'source_brief' => $brief['brief'] ?? null,
                    'metadata' => [
                        'source_outline' => $brief['outline'] ?? [],
                        'competitor_mentions' => $brief['competitor_mentions'] ?? [],
                        'ai_batch_source_id' => $brief['source_id'] ?? null,
                        'ai_retry_single_error' => $errorMessage,
                    ],
                ]);

                $processedItems[] = $freshItem;
                $itemStatuses[] = $this->aiBatchItemStatus($freshItem, 'ai_retry_single_failed');
                $this->appendLog($job, 'error', 'ai_retry_single_failed', $errorMessage, [
                    'item_id' => (int) $freshItem->id,
                    'position' => (int) $freshItem->position,
                    'source_url' => $freshItem->source_url,
                    'error_code' => $classified['error_code'] ?? null,
                    'retryable' => (bool) ($classified['retryable'] ?? false),
                    'exception_class' => $singleException::class,
                ]);
                $this->reportProgress($onProgress, $this->workerProgressPayload($job, $freshItem, 'ai_retry_single_failed'));
            }
        }
    }

    private function decodeGeneratedArticlesResponse(string $rawText, array $briefs, array $businessProfile, ?string $model): array
    {
        $candidate = $this->extractJsonCandidate($rawText);
        $parseErrors = [];
        $briefsBySourceId = [];
        $sourceIds = [];

        foreach (array_values($briefs) as $index => $brief) {
            $sourceId = (string) ($brief['source_id'] ?? $this->batchSourceId($index));
            $briefsBySourceId[$sourceId] = $brief;
            $sourceIds[] = $sourceId;
        }

        foreach (array_filter([$candidate, $candidate ? $this->repairJsonCandidate($candidate) : null]) as $jsonCandidate) {
            try {
                $decoded = json_decode($jsonCandidate, true, 512, JSON_THROW_ON_ERROR);
                $rows = $this->extractArticleRows($decoded);

                if ($rows === []) {
                    $parseErrors[] = 'Decoded JSON did not contain an articles array.';
                    continue;
                }

                $articles = [];
                foreach (array_values($rows) as $rowIndex => $row) {
                    if (!is_array($row)) {
                        continue;
                    }

                    $sourceId = $this->cleanText($row['source_id'] ?? $row['sourceId'] ?? $row['id'] ?? '');
                    if ($sourceId === '' && isset($sourceIds[$rowIndex])) {
                        $sourceId = $sourceIds[$rowIndex];
                    }

                    if ($sourceId === '' || !isset($briefsBySourceId[$sourceId])) {
                        continue;
                    }

                    if ($this->articleRowIsErrorOnly($row)) {
                        $articles[$sourceId] = [
                            'error' => Str::limit($this->cleanText($row['error'] ?? $row['message'] ?? 'AI bao loi cho bai nay trong batch.'), 700, '...'),
                        ];
                        continue;
                    }

                    $articles[$sourceId] = [
                        'article' => $this->normalizeGeneratedArticle($row, $briefsBySourceId[$sourceId], $businessProfile, $rawText),
                        'warning' => count($parseErrors) > 0
                            ? 'AI JSON response required cleanup before saving.'
                            : null,
                    ];
                }

                return [
                    'articles' => $articles,
                    'warning' => count($parseErrors) > 0
                        ? 'AI JSON response required cleanup before saving.'
                        : null,
                ];
            } catch (Throwable $exception) {
                $parseErrors[] = $exception->getMessage();
            }
        }

        $reason = $candidate === null
            ? 'AI response did not contain a JSON object.'
            : ('AI JSON parse failed: ' . implode(' | ', array_filter($parseErrors)));

        return [
            'articles' => [],
            'warning' => Str::limit($reason . ' Model: ' . ($model ?: 'unknown') . '. Raw excerpt: ' . $this->rawResponseExcerpt($rawText), 700, '...'),
        ];
    }

    private function extractArticleRows(mixed $decoded): array
    {
        if (!is_array($decoded)) {
            return [];
        }

        if (isset($decoded['articles']) && is_array($decoded['articles'])) {
            return array_is_list($decoded['articles'])
                ? $decoded['articles']
                : array_values($decoded['articles']);
        }

        if (isset($decoded['article']) && is_array($decoded['article'])) {
            return [$decoded['article']];
        }

        if (array_is_list($decoded)) {
            return $decoded;
        }

        return [$decoded];
    }

    private function articleRowIsErrorOnly(array $row): bool
    {
        $error = $this->cleanText($row['error'] ?? $row['message'] ?? '');
        if ($error === '') {
            return false;
        }

        return $this->cleanText($row['title'] ?? '') === ''
            && trim((string) ($row['content_html'] ?? $row['contentHtml'] ?? $row['html'] ?? '')) === ''
            && !is_array($row['sections'] ?? null);
    }

    private function normalizeGeneratedArticle(array $article, array $brief, array $businessProfile, string $rawText): array
    {
        $title = $this->cleanText($article['title'] ?? '') ?: $this->cleanText($brief['title'] ?? '') ?: 'Kinh nghiem chon gom su Bat Trang';
        $article['title'] = Str::limit($title, 250, '');
        $article['slug_hint'] = $this->cleanText($article['slug_hint'] ?? $article['slug'] ?? '') ?: $title;
        $article['excerpt'] = $this->cleanText($article['excerpt'] ?? '') ?: Str::limit($this->cleanText($brief['meta_description'] ?? $brief['brief'] ?? ''), 280, '');
        $article['seo_title'] = $this->cleanText($article['seo_title'] ?? $article['meta_title'] ?? '') ?: $title;
        $article['seo_description'] = $this->cleanText($article['seo_description'] ?? $article['meta_description'] ?? '') ?: $article['excerpt'];
        $article['category_name'] = $this->cleanText($article['category_name'] ?? '') ?: 'Kien thuc gom su';

        if (empty($article['seo_keywords'])) {
            $article['seo_keywords'] = $this->fallbackKeywords($brief, $title);
        }

        $contentHtml = trim((string) ($article['content_html'] ?? $article['contentHtml'] ?? $article['html'] ?? ''));
        $sections = is_array($article['sections'] ?? null) ? $article['sections'] : [];

        if ($contentHtml === '' && $sections === []) {
            $htmlCandidate = $this->extractHtmlCandidate($rawText);
            if ($htmlCandidate !== '') {
                $article['content_html'] = $htmlCandidate;
            } else {
                $fallback = $this->buildFallbackArticleFromBrief($brief, $businessProfile, $rawText);
                $article['sections'] = $fallback['sections'];
                $article['faq'] = $fallback['faq'];
            }
        }

        return $article;
    }

    private function buildFallbackArticleFromBrief(array $brief, array $businessProfile, string $rawText = ''): array
    {
        $sourceTitle = $this->cleanText($brief['title'] ?? '') ?: 'gom su Bat Trang';
        $brand = $this->cleanText($businessProfile['brand_name'] ?? '') ?: 'Gom Dai Thanh';
        $keyPoints = array_slice($this->normalizeTextList($brief['key_points'] ?? [], 6), 0, 5);
        $firstPoint = $keyPoints[0] ?? 'nguoi doc can co thong tin ro rang de chon mau gom su phu hop voi nhu cau su dung';
        $secondPoint = $keyPoints[1] ?? 'nen uu tien chat men, kich thuoc, hoa tiet va cach bai tri trong khong gian thuc te';

        return [
            'title' => Str::limit($sourceTitle, 250, ''),
            'slug_hint' => $sourceTitle,
            'excerpt' => sprintf('%s tong hop lai chu de nay theo huong tu van thuc te, de nguoi doc de chon san pham phu hop.', $brand),
            'seo_title' => Str::limit($sourceTitle, 80, ''),
            'seo_description' => sprintf('Goi y chon va su dung %s theo nhu cau thuc te, tranh noi dung sao chep tu doi thu.', Str::limit($sourceTitle, 90, '')),
            'seo_keywords' => $this->fallbackKeywords($brief, $sourceTitle),
            'category_name' => 'Kien thuc gom su',
            'sections' => [
                [
                    'heading' => 'Tong quan chu de',
                    'paragraphs' => [
                        sprintf('Chu de "%s" thuong xuat hien khi nguoi doc muon hieu ro cach chon, cach dung hoac cach so sanh cac lua chon gom su truoc khi mua.', $sourceTitle),
                        sprintf('Thay vi sao chep noi dung tu nguon doi thu, bai viet nay chuyen thanh cac goi y thuc te gan voi %s va nhu cau cua khach hang.', $brand),
                    ],
                    'list_items' => [],
                ],
                [
                    'heading' => 'Nhung diem nen xem ky',
                    'paragraphs' => [
                        ucfirst($firstPoint) . '.',
                        ucfirst($secondPoint) . '.',
                    ],
                    'list_items' => array_slice($keyPoints, 2, 4),
                ],
                [
                    'heading' => 'Goi y lua chon phu hop',
                    'paragraphs' => [
                        'Khi chon gom su Bat Trang, nen can doi giua chat men, hoa tiet, kich thuoc va khong gian dat de mon do vua dep rieng le vua hai hoa voi tong the.',
                        'Neu can tu van chi tiet hon, hay doi chieu nhu cau su dung, ngan sach va phong cach bai tri truoc khi quyet dinh mau cu the.',
                    ],
                    'list_items' => [],
                ],
            ],
            'faq' => [
                [
                    'question' => 'Nen uu tien tieu chi nao khi chon gom su?',
                    'answer' => 'Nen uu tien dung nhu cau su dung, kich thuoc phu hop, chat men on dinh va hoa tiet hai hoa voi khong gian dat.',
                ],
                [
                    'question' => 'Bai viet AI fallback co duoc xuat ban ngay khong?',
                    'answer' => 'Khong. Bai duoc luu dang ban nhap de kiem tra va chinh sua truoc khi xuat ban.',
                ],
            ],
        ];
    }

    private function persistGeneratedArticle(BlogAiBulkJob $job, array $brief, array $article, array $businessProfile): array
    {
        $title = $this->cleanText($article['title'] ?? '');
        if ($title === '') {
            throw new \RuntimeException('Bai viet AI thieu tieu de.');
        }

        $category = $this->resolveOrCreateCategory(
            $job->account_id,
            $this->cleanText($article['category_name'] ?? '') ?: 'Kien thuc gom su'
        );
        $sourceHash = $brief['source_hash'];
        $sourceMarker = 'ai_source_url_hash:' . $sourceHash;
        $slugSource = $this->cleanText($article['slug_hint'] ?? $title);
        $requestedSlug = Str::slug($slugSource) ?: 'bai-viet-ai-url';

        $existingPost = Post::query()
            ->where('account_id', $job->account_id)
            ->where('content', 'like', '%' . $sourceMarker . '%')
            ->first();

        $slug = $existingPost
            ? $existingPost->slug
            : $this->buildUniquePostSlug($job->account_id, $requestedSlug);

        $competitorMentions = $brief['competitor_mentions'] ?? [];
        $contentHtml = $this->buildArticleHtml($article, $businessProfile);
        $contentHtml = $this->replaceCompetitorMentions($contentHtml, $competitorMentions, $businessProfile);
        $contentHtml = BlogContentHtmlNormalizer::normalize($contentHtml);
        $contentHtml .= "\n<!-- {$sourceMarker} -->";

        $seoKeywords = $this->normalizeKeywords($article['seo_keywords'] ?? [], $title);
        $payload = [
            'account_id' => $job->account_id,
            'blog_category_id' => $category->id,
            'title' => $this->replaceCompetitorMentions($title, $competitorMentions, $businessProfile),
            'slug' => $slug,
            'seo_keyword' => $seoKeywords[0] ?? $title,
            'content' => $contentHtml,
            'excerpt' => $this->replaceCompetitorMentions($this->cleanText($article['excerpt'] ?? ''), $competitorMentions, $businessProfile),
            'meta_title' => $this->replaceCompetitorMentions($this->cleanText($article['seo_title'] ?? $title), $competitorMentions, $businessProfile),
            'meta_description' => $this->replaceCompetitorMentions($this->cleanText($article['seo_description'] ?? ''), $competitorMentions, $businessProfile),
            'meta_keywords' => implode(', ', $seoKeywords),
            'is_system' => false,
            'is_published' => false,
            'is_starred' => false,
            'published_at' => null,
        ];

        if ($this->hasAiGeneratedColumn()) {
            $payload['is_ai_generated'] = true;
        }

        if ($existingPost) {
            $existingPost->fill($payload);
            $existingPost->save();
            $existingPost->setRelation('category', $category);

            return [
                'post' => $existingPost,
                'action' => 'updated',
            ];
        }

        $payload['sort_order'] = $this->nextPostSortOrder($job->account_id);
        $post = Post::query()->create($payload);
        $post->setRelation('category', $category);

        return [
            'post' => $post,
            'action' => 'created',
        ];
    }

    private function buildArticleHtml(array $article, array $businessProfile): string
    {
        $contentHtml = trim((string) ($article['content_html'] ?? $article['contentHtml'] ?? $article['html'] ?? ''));
        if ($contentHtml !== '') {
            $contentHtml = BlogContentHtmlNormalizer::normalize($contentHtml);
            $cta = $this->buildContactCta($businessProfile);

            if ($cta !== '') {
                $contentHtml .= "\n<h2>Can tu van them ve gom su Bat Trang?</h2>";
                $contentHtml .= "\n<p>" . $this->escapeHtml($cta) . '</p>';
            }

            return BlogContentHtmlNormalizer::normalize($contentHtml);
        }

        $parts = [];
        $sections = is_array($article['sections'] ?? null) ? $article['sections'] : [];

        foreach ($sections as $section) {
            if (!is_array($section)) {
                continue;
            }

            $heading = $this->cleanText($section['heading'] ?? '');
            if ($heading !== '') {
                $parts[] = '<h2>' . $this->escapeHtml($heading) . '</h2>';
            }

            foreach ($this->normalizeTextList($section['paragraphs'] ?? [], 4) as $paragraph) {
                $parts[] = '<p>' . $this->escapeHtml($paragraph) . '</p>';
            }

            $items = $this->normalizeTextList($section['list_items'] ?? [], 6);
            if ($items !== []) {
                $parts[] = '<ul>' . implode('', array_map(
                    fn (string $item) => '<li>' . $this->escapeHtml($item) . '</li>',
                    $items
                )) . '</ul>';
            }
        }

        $faq = is_array($article['faq'] ?? null) ? $article['faq'] : [];
        if ($faq !== []) {
            $parts[] = '<h2>Cau hoi thuong gap</h2>';
            foreach (array_slice($faq, 0, 4) as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $question = $this->cleanText($item['question'] ?? '');
                $answer = $this->cleanText($item['answer'] ?? '');
                if ($question === '' || $answer === '') {
                    continue;
                }
                $parts[] = '<h3>' . $this->escapeHtml($question) . '</h3>';
                $parts[] = '<p>' . $this->escapeHtml($answer) . '</p>';
            }
        }

        $cta = $this->buildContactCta($businessProfile);
        if ($cta !== '') {
            $parts[] = '<h2>Can tu van them ve gom su Bat Trang?</h2>';
            $parts[] = '<p>' . $this->escapeHtml($cta) . '</p>';
        }

        return BlogContentHtmlNormalizer::normalize(implode("\n", array_filter($parts)));
    }

    private function buildContactCta(array $profile): string
    {
        $parts = [];
        $brand = trim((string) ($profile['brand_name'] ?? ''));
        $phone = trim((string) ($profile['phone'] ?? ''));
        $email = trim((string) ($profile['email'] ?? ''));
        $address = trim((string) ($profile['address'] ?? ''));

        if ($brand !== '') {
            $parts[] = $brand . ' co the tu van mau, kich thuoc va cach chon san pham phu hop voi nhu cau thuc te.';
        }
        if ($phone !== '') {
            $parts[] = 'Lien he Hotline/Zalo ' . $phone . ' de duoc ho tro nhanh.';
        }
        if ($email !== '') {
            $parts[] = 'Email: ' . $email . '.';
        }
        if ($address !== '') {
            $parts[] = 'Dia chi: ' . $address . '.';
        }

        return implode(' ', $parts);
    }

    private function resolveBusinessProfile(int $accountId): array
    {
        $settings = [];
        foreach ([
            'site_name',
            'header_brand_text',
            'footer_brand_text',
            'contact_phone',
            'footer_hotline',
            'contact_email',
            'footer_email',
            'footer_address',
            'footer_description',
            'zalo_link',
            'store_locations',
        ] as $key) {
            $settings[$key] = SiteSetting::getValue($key, $accountId, '');
        }

        $brand = $this->firstNonEmpty([
            $settings['footer_brand_text'] ?? '',
            $settings['header_brand_text'] ?? '',
            $settings['site_name'] ?? '',
            'Gom Dai Thanh',
        ]);
        $phone = $this->firstNonEmpty([$settings['footer_hotline'] ?? '', $settings['contact_phone'] ?? '']);
        $email = $this->firstNonEmpty([$settings['footer_email'] ?? '', $settings['contact_email'] ?? '']);
        $address = $this->firstNonEmpty([$settings['footer_address'] ?? '', $this->firstStoreLocationAddress($settings['store_locations'] ?? '')]);
        $domain = SiteDomain::query()
            ->where('account_id', $accountId)
            ->orderByDesc('is_default')
            ->orderBy('id')
            ->value('domain');

        return [
            'brand_name' => $brand,
            'phone' => $phone,
            'email' => $email,
            'address' => $address,
            'zalo' => trim((string) ($settings['zalo_link'] ?? '')),
            'website' => $domain ? 'https://' . ltrim((string) $domain, '/') : '',
            'description' => trim((string) ($settings['footer_description'] ?? '')),
        ];
    }

    private function firstStoreLocationAddress(mixed $value): string
    {
        $decoded = is_string($value) ? json_decode($value, true) : $value;
        if (!is_array($decoded)) {
            return '';
        }

        foreach ($decoded as $item) {
            if (!is_array($item)) {
                continue;
            }

            $address = trim((string) ($item['address'] ?? ''));
            if ($address !== '') {
                return $address;
            }
        }

        return '';
    }

    private function detectCompetitorMentions(string $sourceUrl, string $text): array
    {
        $host = strtolower((string) parse_url($sourceUrl, PHP_URL_HOST));
        $hostWithoutWww = preg_replace('/^www\./', '', $host) ?? $host;
        $brandCandidates = [];

        if ($hostWithoutWww !== '') {
            $brandCandidates[] = $hostWithoutWww;
            $brandCandidates[] = preg_replace('/\.(com|vn|net|org|com\.vn)$/i', '', $hostWithoutWww) ?? $hostWithoutWww;
        }

        if (preg_match_all('/(?:Cong ty|CÔNG TY|Công ty|Xuong|Xưởng)\s+[^\n\r.]{4,80}/u', $text, $matches)) {
            foreach ($matches[0] as $match) {
                $brandCandidates[] = $this->cleanText($match);
            }
        }

        preg_match_all('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', $text, $emails);
        preg_match_all('/(?:\+?84|0)(?:[\s.\-]?\d){8,10}/', $text, $phones);

        return [
            'domains' => array_values(array_unique(array_filter($brandCandidates))),
            'emails' => array_values(array_unique($emails[0] ?? [])),
            'phones' => array_values(array_unique($phones[0] ?? [])),
        ];
    }

    private function replaceCompetitorMentions(string $value, array $mentions, array $profile): string
    {
        $result = $value;
        $brand = trim((string) ($profile['brand_name'] ?? ''));
        $phone = trim((string) ($profile['phone'] ?? ''));
        $email = trim((string) ($profile['email'] ?? ''));

        foreach ((array) ($mentions['domains'] ?? []) as $candidate) {
            $candidate = trim((string) $candidate);
            if ($candidate === '' || mb_strlen($candidate) < 5 || $brand === '') {
                continue;
            }
            $result = preg_replace('/' . preg_quote($candidate, '/') . '/iu', $brand, $result) ?? $result;
        }

        foreach ((array) ($mentions['phones'] ?? []) as $candidate) {
            $candidate = trim((string) $candidate);
            if ($candidate === '' || $phone === '') {
                continue;
            }
            $result = str_replace($candidate, $phone, $result);
        }

        foreach ((array) ($mentions['emails'] ?? []) as $candidate) {
            $candidate = trim((string) $candidate);
            if ($candidate === '' || $email === '') {
                continue;
            }
            $result = str_ireplace($candidate, $email, $result);
        }

        return $result;
    }

    private function fetchUrl(string $url): string
    {
        $maxAttempts = max((int) config('blog_ai_url_import.crawl.retry_attempts', 2), 1);
        $retryDelayMs = max((int) config('blog_ai_url_import.crawl.retry_delay_ms', 1500), 0);
        $lastException = null;

        for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
            try {
                return $this->fetchUrlOnce($url);
            } catch (Throwable $exception) {
                $lastException = $exception;

                if ($attempt >= $maxAttempts || !$this->isRetryableCrawlException($exception)) {
                    break;
                }

                if ($retryDelayMs > 0) {
                    usleep($retryDelayMs * 1000);
                }
            }
        }

        throw $lastException ?: new \RuntimeException('Khong tai duoc URL nguon.');
    }

    private function fetchUrlOnce(string $url): string
    {
        try {
            $response = $this->crawlerRequest()->get($url);
        } catch (Throwable $exception) {
            if (!$this->isSslCertificateProblem($exception)) {
                throw $exception;
            }

            $response = $this->crawlerRequest()
                ->withoutVerifying()
                ->get($url);
        }

        if (!$response->successful()) {
            throw new \RuntimeException('Khong tai duoc URL, HTTP ' . $response->status());
        }

        return (string) $response->body();
    }

    private function crawlerRequest(): PendingRequest
    {
        return Http::timeout(max((int) config('blog_ai_url_import.crawl.timeout', 45), 10))
            ->connectTimeout(max((int) config('blog_ai_url_import.crawl.connect_timeout', 12), 3))
            ->withHeaders([
                'User-Agent' => 'Mozilla/5.0 (compatible; BlogResearchBot/1.0; +https://gomdaithanh.com)',
                'Accept' => 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            ]);
    }

    private function isRetryableCrawlException(Throwable $exception): bool
    {
        $messages = [];
        $current = $exception;

        while ($current) {
            $messages[] = $current->getMessage();
            $current = $current->getPrevious();
        }

        $message = Str::lower(implode(' ', $messages));

        foreach ([
            'curl error 28',
            'operation timed out',
            'connection timed out',
            'timed out',
            'timeout',
            'curl error 6',
            'curl error 7',
            'could not resolve host',
            'failed to connect',
            'connection refused',
            'network is unreachable',
            'connection reset',
            'recv failure',
            'http 408',
            'http 425',
            'http 429',
            'http 500',
            'http 502',
            'http 503',
            'http 504',
        ] as $fragment) {
            if (str_contains($message, $fragment)) {
                return true;
            }
        }

        return false;
    }

    private function isSslCertificateProblem(Throwable $exception): bool
    {
        $messages = [];
        $current = $exception;

        while ($current) {
            $messages[] = $current->getMessage();
            $current = $current->getPrevious();
        }

        $message = Str::lower(implode(' ', $messages));

        return str_contains($message, 'curl error 60')
            || str_contains($message, 'ssl certificate problem')
            || str_contains($message, 'unable to get local issuer certificate');
    }

    private function extractLinks(string $html, string $baseUrl): array
    {
        $document = $this->loadHtml($html);
        $xpath = new DOMXPath($document);
        $anchors = $xpath->query('//a[@href]');
        $links = [];

        if ($anchors === false) {
            return [];
        }

        foreach ($anchors as $anchor) {
            if (!$anchor instanceof DOMElement) {
                continue;
            }

            $href = trim($anchor->getAttribute('href'));
            $url = $this->absoluteUrl($href, $baseUrl);
            $text = $this->cleanText($anchor->textContent);

            if ($url === '' || $this->shouldIgnoreUrl($url)) {
                continue;
            }

            $links[] = [
                'url' => $url,
                'text' => $text,
                'navigation_context' => $this->isNavigationContext($anchor),
            ];
        }

        return $links;
    }

    private function isNavigationContext(DOMElement $element): bool
    {
        $current = $element;

        while ($current instanceof DOMElement) {
            $tagName = Str::lower($current->tagName);
            if (in_array($tagName, ['body', 'html'], true)) {
                return false;
            }

            if (in_array($tagName, ['header', 'footer', 'aside', 'nav', 'form'], true)) {
                return true;
            }

            $context = Str::lower(trim($current->getAttribute('class') . ' ' . $current->getAttribute('id')));
            foreach ([
                'menu',
                'navbar',
                'navigation',
                'breadcrumb',
                'sidebar',
                'widget',
                'popup',
                'modal',
                'login',
                'account',
            ] as $marker) {
                if ($context !== '' && str_contains($context, $marker)) {
                    return true;
                }
            }

            $parent = $current->parentNode;
            $current = $parent instanceof DOMElement ? $parent : null;
        }

        return false;
    }

    private function loadHtml(string $html): DOMDocument
    {
        $document = new DOMDocument('1.0', 'UTF-8');
        $previous = libxml_use_internal_errors(true);
        $encoded = mb_convert_encoding($html, 'HTML-ENTITIES', 'UTF-8');
        $document->loadHTML('<?xml encoding="utf-8" ?>' . $encoded);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        return $document;
    }

    private function removeNoiseNodes(DOMXPath $xpath): void
    {
        $nodes = $xpath->query('//script|//style|//noscript|//svg|//iframe|//form|//nav|//header|//footer|//aside');
        if ($nodes === false) {
            return;
        }

        $remove = [];
        foreach ($nodes as $node) {
            $remove[] = $node;
        }

        foreach ($remove as $node) {
            $node->parentNode?->removeChild($node);
        }
    }

    private function selectContentRoot(DOMXPath $xpath): ?DOMNode
    {
        $queries = [
            '//article',
            '//*[contains(concat(" ", normalize-space(@class), " "), " entry-content ")]',
            '//*[contains(concat(" ", normalize-space(@class), " "), " post-content ")]',
            '//*[contains(concat(" ", normalize-space(@class), " "), " article-content ")]',
            '//*[contains(concat(" ", normalize-space(@class), " "), " blog-content ")]',
            '//*[contains(concat(" ", normalize-space(@class), " "), " content-area ")]',
            '//main',
            '//body',
        ];

        $fallbackNode = null;
        $fallbackLength = 0;

        foreach ($queries as $query) {
            $nodes = $xpath->query($query);
            if ($nodes === false) {
                continue;
            }

            $bestNode = null;
            $bestLength = 0;
            foreach ($nodes as $node) {
                $length = mb_strlen($this->cleanText($this->nodeText($node)));
                if ($length > $bestLength) {
                    $bestLength = $length;
                    $bestNode = $node;
                }
            }

            if ($bestNode && $bestLength >= 400) {
                return $bestNode;
            }

            if ($bestNode && $bestLength > $fallbackLength) {
                $fallbackNode = $bestNode;
                $fallbackLength = $bestLength;
            }
        }

        return $fallbackNode;
    }

    private function extractSourceHtmlStructure(DOMNode $root, string $baseUrl): string
    {
        $html = BlogContentHtmlNormalizer::normalize($this->innerHtml($root));
        if ($html === '') {
            return '';
        }

        $document = $this->loadHtml('<div id="__source_article_structure__">' . $html . '</div>');
        $xpath = new DOMXPath($document);
        $container = $xpath->query('//*[@id="__source_article_structure__"]')->item(0);

        if (!$container instanceof DOMNode) {
            return $html;
        }

        foreach ($xpath->query('.//a[@href]', $container) ?: [] as $link) {
            if ($link instanceof DOMElement) {
                $href = $this->absoluteUrl($link->getAttribute('href'), $baseUrl);
                if ($href !== '') {
                    $link->setAttribute('href', $href);
                }
            }
        }

        foreach ($xpath->query('.//img[@src] | .//source[@src] | .//video[@poster]', $container) ?: [] as $mediaNode) {
            if (!$mediaNode instanceof DOMElement) {
                continue;
            }

            foreach (['src', 'poster'] as $attribute) {
                if ($mediaNode->hasAttribute($attribute)) {
                    $url = $this->absoluteUrl($mediaNode->getAttribute($attribute), $baseUrl);
                    if ($url !== '') {
                        $mediaNode->setAttribute($attribute, $url);
                    }
                }
            }
        }

        return BlogContentHtmlNormalizer::normalize($this->innerHtml($container));
    }

    private function innerHtml(DOMNode $node): string
    {
        $html = '';
        foreach ($node->childNodes as $child) {
            $html .= $node->ownerDocument?->saveHTML($child) ?? '';
        }

        return $html;
    }

    private function extractNodeTexts(DOMXPath $xpath, string $query, ?DOMNode $context, int $limit, int $minLength): array
    {
        $nodes = $context ? $xpath->query($query, $context) : $xpath->query($query);
        if ($nodes === false) {
            return [];
        }

        $items = [];
        foreach ($nodes as $node) {
            $text = $this->cleanText($this->nodeText($node));
            if (mb_strlen($text) < $minLength) {
                continue;
            }
            $key = Str::lower(Str::ascii($text));
            if (isset($items[$key])) {
                continue;
            }
            $items[$key] = $text;
            if (count($items) >= $limit) {
                break;
            }
        }

        return array_values($items);
    }

    private function firstText(DOMXPath $xpath, string $query): string
    {
        $nodes = $xpath->query($query);
        if ($nodes === false || $nodes->length === 0) {
            return '';
        }

        return $this->cleanText($nodes->item(0)?->textContent ?? '');
    }

    private function extractTitleTag(DOMXPath $xpath): string
    {
        $title = $this->firstText($xpath, '//title');
        if ($title === '') {
            return '';
        }

        $parts = preg_split('/\s+[-|]\s+/u', $title) ?: [$title];

        return $this->cleanText($parts[0] ?? $title);
    }

    private function extractMetaDescription(DOMXPath $xpath): string
    {
        $nodes = $xpath->query('//meta[translate(@name, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")="description"]/@content');
        if ($nodes !== false && $nodes->length > 0) {
            return $this->cleanText($nodes->item(0)?->nodeValue ?? '');
        }

        $nodes = $xpath->query('//meta[translate(@property, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")="og:description"]/@content');
        if ($nodes !== false && $nodes->length > 0) {
            return $this->cleanText($nodes->item(0)?->nodeValue ?? '');
        }

        return '';
    }

    private function nodeText(DOMNode $node): string
    {
        return $node->textContent ?? '';
    }

    private function isPaginationLink(string $sourceUrl, string $url, string $text, string $basePath): bool
    {
        $path = rtrim((string) parse_url($url, PHP_URL_PATH), '/');
        $query = (string) parse_url($url, PHP_URL_QUERY);
        $normalizedText = trim($text);

        if ($basePath !== '' && str_starts_with($path, $basePath) && preg_match('#/page/\d+$#', $path) === 1) {
            return true;
        }

        if (preg_match('/(?:^|&)paged?=\d+(?:&|$)/', $query) === 1) {
            return true;
        }

        return preg_match('/^\d+$/', $normalizedText) === 1
            && $basePath !== ''
            && str_starts_with($path, $basePath);
    }

    private function isPotentialArticleLink(string $sourceUrl, string $url, string $text, string $basePath): bool
    {
        return $this->articleLinkScore($sourceUrl, $url, $text, $basePath) > 0;
    }

    private function articleLinkScore(string $sourceUrl, string $url, string $text, string $basePath): int
    {
        if ($this->normalizeUrl($sourceUrl) === $this->normalizeUrl($url)) {
            return 0;
        }

        $path = rtrim((string) parse_url($url, PHP_URL_PATH), '/');
        $lowerPath = Str::lower($path);

        if ($path === '' || $path === '/') {
            return 0;
        }

        if ($basePath !== '' && ($path === $basePath || str_starts_with($path, $basePath . '/page/'))) {
            return 0;
        }

        if ($this->isRejectedContentPath($lowerPath)) {
            return 0;
        }

        $slug = trim(basename($path));
        $hyphenCount = substr_count($slug, '-');
        $textLength = mb_strlen(trim($text));
        $segments = $this->pathSegments($path);
        $firstSegment = $segments[0] ?? '';
        $sourceSegments = $this->pathSegments($basePath ?: ((string) parse_url($sourceUrl, PHP_URL_PATH)));
        $sourceFirstSegment = $sourceSegments[0] ?? '';

        if ($firstSegment === 'blog' && count($segments) >= 2 && $hyphenCount >= 1) {
            return 100;
        }

        if ($sourceFirstSegment !== ''
            && $firstSegment === $sourceFirstSegment
            && count($segments) >= 2
            && $hyphenCount >= 1) {
            return 90;
        }

        if (in_array($firstSegment, ['tin-tuc', 'news', 'bai-viet', 'kien-thuc', 'cam-nang'], true)
            && count($segments) >= 2
            && $hyphenCount >= 1) {
            return 80;
        }

        if (preg_match('#^/\d{4}/\d{1,2}/[^/]+$#', $lowerPath) === 1 && $hyphenCount >= 1) {
            return 70;
        }

        if (count($segments) === 1 && $hyphenCount >= 3 && $textLength >= 16) {
            return 40;
        }

        return 0;
    }

    private function isRejectedContentPath(string $lowerPath): bool
    {
        foreach ([
            '/category/', '/tag/', '/author/', '/wp-', '/wp/', '/uploads/', '/feed',
            '/cart', '/checkout', '/gio-hang', '/thanh-toan', '/lien-he', '/tuyen-dung',
            '/san-pham', '/product', '/du-an', '/ho-so', '/ve-chung-toi', '/ve-gioi-thieu',
            '/gioi-thieu', '/bao-chi', '/cau-chuyen', '/chung-toi', '/about', '/press',
            '/my-account', '/tai-khoan', '/catalog', '/catalogue', '/chinh-sach',
        ] as $fragment) {
            if (str_contains($lowerPath, $fragment)) {
                return true;
            }
        }

        return preg_match('/\.(jpg|jpeg|png|webp|gif|pdf|doc|docx|xls|xlsx|zip)$/i', $lowerPath) === 1;
    }

    private function pathSegments(string $path): array
    {
        return array_values(array_filter(
            explode('/', trim(Str::lower($path), '/')),
            fn (string $segment) => $segment !== ''
        ));
    }

    private function shouldIgnoreUrl(string $url): bool
    {
        return str_starts_with($url, 'mailto:')
            || str_starts_with($url, 'tel:')
            || str_starts_with($url, 'javascript:')
            || str_starts_with($url, '#');
    }

    private function sameHost(string $left, string $right): bool
    {
        $leftHost = preg_replace('/^www\./', '', Str::lower((string) parse_url($left, PHP_URL_HOST))) ?? '';
        $rightHost = preg_replace('/^www\./', '', Str::lower((string) parse_url($right, PHP_URL_HOST))) ?? '';

        return $leftHost !== '' && $leftHost === $rightHost;
    }

    private function absoluteUrl(string $href, string $baseUrl): string
    {
        $href = trim(html_entity_decode($href, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($href === '' || str_starts_with($href, '#') || preg_match('/^(mailto|tel|javascript):/i', $href) === 1) {
            return '';
        }

        if (preg_match('#^https?://#i', $href) === 1) {
            return $this->normalizeUrl($href);
        }

        $base = parse_url($baseUrl);
        if (!is_array($base) || empty($base['host'])) {
            return '';
        }

        $scheme = $base['scheme'] ?? 'https';
        $host = $base['host'];
        $port = isset($base['port']) ? ':' . $base['port'] : '';

        if (str_starts_with($href, '//')) {
            return $this->normalizeUrl($scheme . ':' . $href);
        }

        if (str_starts_with($href, '/')) {
            $path = $href;
        } else {
            $basePath = $base['path'] ?? '/';
            $dir = preg_replace('#/[^/]*$#', '/', $basePath) ?? '/';
            $path = $dir . $href;
        }

        $path = $this->removeDotSegments($path);

        return $this->normalizeUrl($scheme . '://' . $host . $port . $path);
    }

    private function removeDotSegments(string $path): string
    {
        $parts = [];
        foreach (explode('/', $path) as $segment) {
            if ($segment === '' || $segment === '.') {
                continue;
            }
            if ($segment === '..') {
                array_pop($parts);
                continue;
            }
            $parts[] = $segment;
        }

        return '/' . implode('/', $parts);
    }

    private function normalizeUrl(string $url): string
    {
        $url = trim($url);
        if ($url === '') {
            return '';
        }

        if (str_starts_with($url, '//')) {
            $url = 'https:' . $url;
        }

        if (!preg_match('#^https?://#i', $url)) {
            $url = 'https://' . ltrim($url, '/');
        }

        $parts = parse_url($url);
        if (!is_array($parts) || empty($parts['host'])) {
            return '';
        }

        $scheme = strtolower($parts['scheme'] ?? 'https');
        if (!in_array($scheme, ['http', 'https'], true)) {
            return '';
        }

        $host = strtolower($parts['host']);
        $path = '/' . ltrim($parts['path'] ?? '/', '/');
        if ($path !== '/') {
            $path = rtrim($path, '/');
        }
        $query = isset($parts['query']) && $parts['query'] !== '' ? '?' . $parts['query'] : '';

        return $scheme . '://' . $host . $path . $query;
    }

    private function extractJsonCandidate(string $value): ?string
    {
        $trimmed = trim($value);
        $trimmed = preg_replace('/^```json\s*/i', '', $trimmed) ?? $trimmed;
        $trimmed = preg_replace('/^```\s*/', '', $trimmed) ?? $trimmed;
        $trimmed = preg_replace('/\s*```$/', '', $trimmed) ?? $trimmed;

        $startBrace = strpos($trimmed, '{');
        $startBracket = strpos($trimmed, '[');
        $start = false;

        if ($startBrace !== false && $startBracket !== false) {
            $start = min($startBrace, $startBracket);
        } elseif ($startBrace !== false) {
            $start = $startBrace;
        } elseif ($startBracket !== false) {
            $start = $startBracket;
        }

        $endBrace = strrpos($trimmed, '}');
        $endBracket = strrpos($trimmed, ']');
        $end = false;

        if ($endBrace !== false && $endBracket !== false) {
            $end = max($endBrace, $endBracket);
        } elseif ($endBrace !== false) {
            $end = $endBrace;
        } elseif ($endBracket !== false) {
            $end = $endBracket;
        }

        if ($start === false || $end === false || $end <= $start) {
            return null;
        }

        return substr($trimmed, $start, $end - $start + 1);
    }

    private function repairJsonCandidate(string $candidate): string
    {
        $repaired = preg_replace('/^\xEF\xBB\xBF/', '', trim($candidate)) ?? trim($candidate);
        $repaired = str_replace(["\r\n", "\r"], "\n", $repaired);
        $repaired = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $repaired) ?? $repaired;
        $repaired = preg_replace('/,\s*([}\]])/', '$1', $repaired) ?? $repaired;

        return trim($repaired);
    }

    private function extractHtmlCandidate(string $rawText): string
    {
        $trimmed = trim($rawText);
        $trimmed = preg_replace('/^```html\s*/i', '', $trimmed) ?? $trimmed;
        $trimmed = preg_replace('/^```\s*/', '', $trimmed) ?? $trimmed;
        $trimmed = preg_replace('/\s*```$/', '', $trimmed) ?? $trimmed;

        if (preg_match('/<(h1|h2|h3|p|ul|ol|li|table|figure|blockquote|strong|em|a)\b/i', $trimmed) !== 1) {
            return '';
        }

        return BlogContentHtmlNormalizer::normalize($trimmed);
    }

    private function fallbackKeywords(array $brief, string $fallback): array
    {
        $keywords = [$fallback, 'gom su Bat Trang', 'kinh nghiem chon gom su', 'qua tang gom su'];

        foreach ((array) ($brief['outline'] ?? []) as $heading) {
            $keywords[] = $heading;
        }

        return collect($keywords)
            ->map(fn ($item) => $this->cleanText($item))
            ->filter()
            ->unique(fn ($item) => Str::lower(Str::ascii((string) $item)))
            ->take(8)
            ->values()
            ->all();
    }

    private function rawResponseExcerpt(string $rawText): string
    {
        $excerpt = preg_replace('/\s+/u', ' ', strip_tags($rawText)) ?? $rawText;

        return Str::limit(trim($excerpt), 260, '...');
    }

    private function resolveOrCreateCategory(int $accountId, string $categoryName): BlogCategory
    {
        $name = $this->cleanText($categoryName) ?: 'Kien thuc gom su';
        $existing = BlogCategory::query()
            ->where('account_id', $accountId)
            ->whereRaw('LOWER(name) = ?', [Str::lower($name)])
            ->first();

        if ($existing) {
            return $existing;
        }

        return BlogCategory::query()->create([
            'account_id' => $accountId,
            'name' => $name,
            'slug' => $this->buildUniqueCategorySlug($accountId, $name),
            'sort_order' => $this->nextCategorySortOrder($accountId),
        ]);
    }

    private function recordAiRequestAttempt(BlogAiBulkJob $job, int $articleCount, array $attempt): array
    {
        $job->refresh();
        $summary = $job->summary ?? [];
        $usage = is_array($attempt['usage'] ?? null) ? $attempt['usage'] : [];
        $requestNumber = (int) ($summary['ai_requests_used'] ?? 0) + 1;
        $model = $attempt['model'] ?? null;

        $summary['ai_requests_used'] = $requestNumber;
        $summary['ai_articles_requested'] = (int) ($summary['ai_articles_requested'] ?? 0) + $articleCount;
        $summary['avg_requested_articles_per_ai_request'] = $requestNumber > 0
            ? round(((int) $summary['ai_articles_requested']) / $requestNumber, 2)
            : 0;
        $summary['ai_last_request_at'] = now()->toIso8601String();
        $summary['ai_last_request_articles'] = $articleCount;
        $summary['ai_last_request_model'] = $model;
        $summary['ai_last_request_status'] = $attempt['status'] ?? null;
        $summary['ai_last_request_usage'] = $usage !== [] ? $usage : null;

        foreach ([
            'promptTokenCount' => 'ai_prompt_tokens_used',
            'candidatesTokenCount' => 'ai_output_tokens_used',
            'totalTokenCount' => 'ai_total_tokens_used',
            'cachedContentTokenCount' => 'ai_cached_tokens_used',
        ] as $usageKey => $summaryKey) {
            if (isset($usage[$usageKey]) && is_numeric($usage[$usageKey])) {
                $summary[$summaryKey] = (int) ($summary[$summaryKey] ?? 0) + (int) $usage[$usageKey];
            }
        }

        $job->forceFill([
            'summary' => $summary,
            'ai_model' => $model ?: $job->ai_model,
        ])->save();

        return array_merge($attempt, [
            'request_number' => $requestNumber,
            'article_count' => $articleCount,
            'usage' => $usage !== [] ? $usage : null,
        ]);
    }

    private function aiBatchItemStatus(BlogAiUrlImportItem $item, string $stage, array $extra = []): array
    {
        return array_merge([
            'item_id' => (int) $item->id,
            'position' => (int) $item->position,
            'source_url' => $item->source_url,
            'status' => $item->status,
            'stage' => $stage,
            'post_id' => $item->post_id ? (int) $item->post_id : null,
            'model' => $item->last_model,
            'error' => $item->last_error,
        ], $extra);
    }

    private function aiBatchLogMessage(array $attempt, int $articleCount, array $itemStatuses): string
    {
        $usage = is_array($attempt['usage'] ?? null) ? $attempt['usage'] : [];
        $okCount = collect($itemStatuses)
            ->filter(fn (array $status) => ($status['status'] ?? null) === BlogAiUrlImportItem::STATUS_COMPLETED)
            ->count();
        $failedCount = collect($itemStatuses)
            ->filter(fn (array $status) => ($status['status'] ?? null) === BlogAiUrlImportItem::STATUS_FAILED)
            ->count();

        return sprintf(
            'Gemini request #%s: %d bai, model %s, token prompt=%s output=%s total=%s, ket qua %d OK/%d loi.',
            $attempt['request_number'] ?? '?',
            $articleCount,
            $attempt['model'] ?? 'unknown',
            $this->tokenLogValue($usage['promptTokenCount'] ?? null),
            $this->tokenLogValue($usage['candidatesTokenCount'] ?? null),
            $this->tokenLogValue($usage['totalTokenCount'] ?? null),
            $okCount,
            $failedCount
        );
    }

    private function tokenLogValue(mixed $value): string
    {
        return is_numeric($value) ? (string) ((int) $value) : 'n/a';
    }

    private function syncJobFromItems(BlogAiBulkJob $job, ?string $forcedStatus = null, array $extraSummary = []): BlogAiBulkJob
    {
        $job->refresh();
        $metadata = $job->metadata ?? [];
        $counts = BlogAiUrlImportItem::query()
            ->where('blog_ai_bulk_job_id', $job->id)
            ->selectRaw('status, COUNT(*) as aggregate')
            ->groupBy('status')
            ->pluck('aggregate', 'status');

        $pending = (int) ($counts[BlogAiUrlImportItem::STATUS_PENDING] ?? 0);
        $processing = (int) ($counts[BlogAiUrlImportItem::STATUS_PROCESSING] ?? 0);
        $completed = (int) ($counts[BlogAiUrlImportItem::STATUS_COMPLETED] ?? 0);
        $failed = (int) ($counts[BlogAiUrlImportItem::STATUS_FAILED] ?? 0);
        $total = $pending + $processing + $completed + $failed;
        $processed = $completed + $failed;
        $status = $forcedStatus ?: $job->status;

        if (!$forcedStatus && $total > 0 && $pending === 0 && $processing === 0) {
            $status = $failed > 0 ? BlogAiBulkJob::STATUS_COMPLETED_WITH_ERRORS : BlogAiBulkJob::STATUS_COMPLETED;
        }

        $summary = array_merge($job->summary ?? [], [
            'progress_percent' => $total > 0 ? round(($processed / $total) * 100, 2) : 0,
            'processed_items' => $processed,
            'pending_items' => $pending,
            'processing_items' => $processing,
            'completed_items' => $completed,
            'failed_items' => $failed,
            'total_items' => $total,
            'processing_active' => (bool) ($metadata['processing_active'] ?? false),
        ], $extraSummary);
        $aiRequests = (int) ($summary['ai_requests_used'] ?? 0);
        $summary['ai_articles_created'] = $completed;
        $summary['avg_articles_per_ai_request'] = $aiRequests > 0
            ? round($completed / $aiRequests, 2)
            : 0;

        $job->forceFill([
            'status' => $status,
            'total_keywords' => $total,
            'unique_keywords' => $total,
            'cluster_count' => $total,
            'processed_clusters' => $processed,
            'posts_created' => $completed,
            'posts_failed' => $failed,
            'summary' => $summary,
            'finished_at' => in_array($status, [
                BlogAiBulkJob::STATUS_COMPLETED,
                BlogAiBulkJob::STATUS_COMPLETED_WITH_ERRORS,
                BlogAiBulkJob::STATUS_FAILED,
            ], true) ? ($job->finished_at ?? now()) : null,
        ])->save();

        return $job->fresh();
    }

    private function failStaleProcessingItems(BlogAiBulkJob $job): void
    {
        $staleAfterSeconds = $this->itemTimeoutSeconds();
        $cutoff = now()->subSeconds($staleAfterSeconds);

        $staleItems = BlogAiUrlImportItem::query()
            ->where('blog_ai_bulk_job_id', $job->id)
            ->where('status', BlogAiUrlImportItem::STATUS_PROCESSING)
            ->where(function ($query) use ($cutoff) {
                $query->whereNull('updated_at')
                    ->orWhere('updated_at', '<=', $cutoff);
            })
            ->get();

        foreach ($staleItems as $item) {
            $message = sprintf(
                'ITEM_TIMEOUT: Item dang tao qua %d giay nen da danh dau loi de tien trinh chay tiep.',
                $staleAfterSeconds
            );

            $item->forceFill([
                'status' => BlogAiUrlImportItem::STATUS_FAILED,
                'last_error' => $message,
                'finished_at' => now(),
            ])->save();

            $this->appendLog($job, 'error', 'item_timeout', $message, [
                'item_id' => $item->id,
                'source_url' => $item->source_url,
            ]);
        }
    }

    private function resolveRetryFinishedStatus(BlogAiBulkJob $job): string
    {
        $counts = BlogAiUrlImportItem::query()
            ->where('blog_ai_bulk_job_id', $job->id)
            ->selectRaw('status, COUNT(*) as aggregate')
            ->groupBy('status')
            ->pluck('aggregate', 'status');

        $pending = (int) ($counts[BlogAiUrlImportItem::STATUS_PENDING] ?? 0);
        $processing = (int) ($counts[BlogAiUrlImportItem::STATUS_PROCESSING] ?? 0);
        $failed = (int) ($counts[BlogAiUrlImportItem::STATUS_FAILED] ?? 0);

        if ($processing > 0) {
            return BlogAiBulkJob::STATUS_RUNNING;
        }

        if ($failed > 0) {
            return BlogAiBulkJob::STATUS_COMPLETED_WITH_ERRORS;
        }

        if ($pending > 0) {
            return BlogAiBulkJob::STATUS_SCANNED;
        }

        return BlogAiBulkJob::STATUS_COMPLETED;
    }

    private function hasFailedItems(BlogAiBulkJob $job): bool
    {
        return BlogAiUrlImportItem::query()
            ->where('blog_ai_bulk_job_id', $job->id)
            ->where('status', BlogAiUrlImportItem::STATUS_FAILED)
            ->exists();
    }

    private function assertUrlJob(BlogAiBulkJob $job): void
    {
        if (($job->metadata['source_type'] ?? null) !== self::SOURCE_TYPE) {
            throw ValidationException::withMessages([
                'job' => ['Tien trinh nay khong phai job tao bai tu URL.'],
            ]);
        }
    }

    private function buildUniqueCategorySlug(int $accountId, string $source): string
    {
        $baseSlug = Str::slug($source) ?: 'blog-category';
        $slug = $baseSlug;
        $suffix = 2;

        while (BlogCategory::query()->where('account_id', $accountId)->where('slug', $slug)->exists()) {
            $slug = $baseSlug . '-' . $suffix;
            $suffix++;
        }

        return $slug;
    }

    private function buildUniquePostSlug(int $accountId, string $source): string
    {
        $baseSlug = Str::slug($source) ?: 'bai-viet-ai-url';
        $slug = $baseSlug;
        $suffix = 2;

        while (Post::withTrashed()->where('account_id', $accountId)->where('slug', $slug)->exists()) {
            $slug = $baseSlug . '-' . $suffix;
            $suffix++;
        }

        return $slug;
    }

    private function nextCategorySortOrder(int $accountId): int
    {
        return (int) BlogCategory::query()->where('account_id', $accountId)->max('sort_order') + 1;
    }

    private function nextPostSortOrder(int $accountId): int
    {
        return (int) Post::query()->where('account_id', $accountId)->max('sort_order') + 1;
    }

    private function hasAiGeneratedColumn(): bool
    {
        static $cache = null;
        if ($cache === null) {
            $cache = \Illuminate\Support\Facades\Schema::hasTable('posts')
                && \Illuminate\Support\Facades\Schema::hasColumn('posts', 'is_ai_generated');
        }

        return $cache;
    }

    private function normalizeKeywords(mixed $input, string $fallback): array
    {
        $items = is_array($input) ? $input : preg_split('/,|;|\n|\r/u', (string) $input);
        $keywords = collect($items ?: [])
            ->map(fn ($item) => $this->cleanText($item))
            ->filter()
            ->push($fallback)
            ->unique(fn ($item) => Str::lower(Str::ascii((string) $item)))
            ->take(8)
            ->values()
            ->all();

        return $keywords !== [] ? $keywords : [$fallback];
    }

    private function normalizeTextList(mixed $input, int $limit): array
    {
        $items = is_array($input) ? $input : preg_split('/\r\n|\r|\n/u', (string) $input);

        return collect($items ?: [])
            ->map(fn ($item) => $this->cleanText($item))
            ->filter()
            ->take($limit)
            ->values()
            ->all();
    }

    private function firstNonEmpty(array $values): string
    {
        foreach ($values as $value) {
            $normalized = trim((string) $value);
            if ($normalized !== '') {
                return $normalized;
            }
        }

        return '';
    }

    private function cleanText(mixed $value): string
    {
        $normalized = html_entity_decode(strip_tags((string) $value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $normalized = preg_replace('/\s+/u', ' ', $normalized) ?? $normalized;

        return trim($normalized);
    }

    private function markItemFailed(
        BlogAiBulkJob $job,
        BlogAiUrlImportItem $item,
        string $message,
        string $stage,
        array $extra = [],
    ): BlogAiUrlImportItem {
        $payload = [
            'status' => BlogAiUrlImportItem::STATUS_FAILED,
            'last_error' => Str::limit($message, 700, '...'),
            'finished_at' => now(),
        ];

        if (array_key_exists('last_model', $extra)) {
            $payload['last_model'] = $extra['last_model'];
        }

        if (array_key_exists('source_brief', $extra)) {
            $payload['source_brief'] = $extra['source_brief'];
        }

        if (is_array($extra['metadata'] ?? null)) {
            $payload['metadata'] = array_merge($item->metadata ?? [], [
                'failed_stage' => $stage,
            ], $extra['metadata']);
        }

        $item->forceFill($payload)->save();

        return $item->fresh();
    }

    private function stageForMissingAiResult(?array $generated, array $result): string
    {
        $message = Str::lower((string) ($generated['error'] ?? $result['warning'] ?? ''));

        foreach ([
            'json parse',
            'did not contain a json',
            'json response',
            'decoded json',
            'khong hop le',
            'sai dinh dang',
        ] as $fragment) {
            if (str_contains($message, $fragment)) {
                return 'ai_parse_failed';
            }
        }

        return 'ai_missing_article';
    }

    private function classifySourceException(Throwable $exception): array
    {
        $message = Str::lower($this->exceptionMessageChain($exception));
        $detail = $this->shortError($exception);

        if (str_contains($message, 'curl error 28')
            || str_contains($message, 'operation timed out')
            || str_contains($message, 'connection timed out')
            || str_contains($message, 'timed out')
            || str_contains($message, 'timeout')) {
            return [
                'status' => 504,
                'error_code' => 'CRAWL_TIMEOUT',
                'message' => 'Crawl URL doi thu bi timeout.',
                'detail' => $detail,
                'retryable' => true,
            ];
        }

        if ($this->isSslCertificateProblem($exception)) {
            return [
                'status' => 503,
                'error_code' => 'CRAWL_SSL_CERTIFICATE',
                'message' => 'Crawl URL doi thu bi loi chung chi SSL.',
                'detail' => $detail,
                'retryable' => false,
            ];
        }

        if (preg_match('/http\s+(\d{3})/i', $message, $matches) === 1) {
            $status = (int) $matches[1];

            return [
                'status' => $status,
                'error_code' => 'CRAWL_HTTP_ERROR',
                'message' => 'Crawl URL doi thu tra ve HTTP ' . $status . '.',
                'detail' => $detail,
                'retryable' => in_array($status, [408, 425, 429, 500, 502, 503, 504], true),
            ];
        }

        if (str_contains($message, 'curl error 6')
            || str_contains($message, 'curl error 7')
            || str_contains($message, 'could not resolve host')
            || str_contains($message, 'failed to connect')
            || str_contains($message, 'connection refused')
            || str_contains($message, 'network is unreachable')) {
            return [
                'status' => 503,
                'error_code' => 'CRAWL_NETWORK_ERROR',
                'message' => 'Khong ket noi duoc URL doi thu.',
                'detail' => $detail,
                'retryable' => true,
            ];
        }

        if (str_contains($message, 'khong tach duoc noi dung')) {
            return [
                'status' => 422,
                'error_code' => 'PARSE_ERROR',
                'message' => 'Khong tach duoc noi dung bai viet nguon.',
                'detail' => $detail,
                'retryable' => false,
            ];
        }

        return [
            'status' => 500,
            'error_code' => 'SOURCE_EXTRACT_FAILED',
            'message' => 'Khong lay duoc noi dung bai viet nguon.',
            'detail' => $detail,
            'retryable' => false,
        ];
    }

    private function classifySaveException(Throwable $exception): array
    {
        return [
            'status' => 500,
            'error_code' => 'SAVE_ERROR',
            'message' => 'Khong luu duoc bai viet AI.',
            'detail' => $this->shortError($exception),
            'retryable' => false,
        ];
    }

    private function exceptionMessageChain(Throwable $exception): string
    {
        $messages = [];
        $current = $exception;

        while ($current) {
            $messages[] = $current->getMessage();
            $current = $current->getPrevious();
        }

        return implode(' ', $messages);
    }

    private function reportProgress(?callable $onProgress, array $payload): void
    {
        if (!is_callable($onProgress)) {
            return;
        }

        try {
            $onProgress($payload);
        } catch (Throwable) {
            // Worker progress telemetry must never affect article generation.
        }
    }

    private function workerProgressPayload(
        BlogAiBulkJob $job,
        ?BlogAiUrlImportItem $item,
        string $step,
        array $extra = [],
    ): array {
        $summary = $job->fresh()->summary ?? [];

        return array_merge([
            'current_step' => $step,
            'current_job_id' => (int) $job->id,
            'current_item_id' => $item ? (int) $item->id : null,
            'current_item_position' => $item ? (int) $item->position : null,
            'current_item_title' => $item?->source_title,
            'current_item_url' => $item?->source_url,
            'ai_requests_used' => (int) ($summary['ai_requests_used'] ?? 0),
            'max_ai_requests' => (int) ($summary['max_ai_requests'] ?? $job->metadata['max_ai_requests'] ?? 0),
            'ai_total_tokens_used' => (int) ($summary['ai_total_tokens_used'] ?? 0),
        ], $extra);
    }

    private function escapeHtml(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    private function shortError(Throwable $exception): string
    {
        return Str::limit(trim((string) $exception->getMessage()) ?: $exception::class, 500, '...');
    }

    private function detailedError(Throwable $exception, array $classified = []): string
    {
        $errorCode = trim((string) ($classified['error_code'] ?? ''));
        $detail = trim((string) ($classified['detail'] ?? ''));
        $message = $detail !== ''
            ? $detail
            : (trim((string) $exception->getMessage()) ?: $exception::class);

        if ($errorCode === '') {
            $errorCode = class_basename($exception);
        }

        return Str::limit($errorCode . ': ' . $message, 700, '...');
    }

    private function appendLog(BlogAiBulkJob $job, string $level, string $step, string $message, array $context = []): void
    {
        BlogAiBulkJobLog::query()->create([
            'blog_ai_bulk_job_id' => $job->id,
            'level' => $level,
            'step' => $step,
            'message' => $message,
            'context' => $context !== [] ? $context : null,
        ]);
    }
}
