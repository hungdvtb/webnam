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
use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;
use Illuminate\Http\Client\PendingRequest;
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

    public function processNextItem(BlogAiBulkJob $job): array
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

        $nextItem = BlogAiUrlImportItem::query()
            ->where('blog_ai_bulk_job_id', $job->id)
            ->where('status', BlogAiUrlImportItem::STATUS_PENDING)
            ->orderBy('position')
            ->orderBy('id')
            ->first();

        if (!$nextItem) {
            $finalStatus = $this->hasFailedItems($job)
                ? BlogAiBulkJob::STATUS_COMPLETED_WITH_ERRORS
                : BlogAiBulkJob::STATUS_COMPLETED;

            return [
                'job' => $this->syncJobFromItems($job, $finalStatus),
                'item' => null,
                'done' => true,
                'paused' => false,
                'message' => 'Khong con bai nao dang cho tao.',
            ];
        }

        $job->forceFill([
            'status' => BlogAiBulkJob::STATUS_RUNNING,
            'started_at' => $job->started_at ?? now(),
            'finished_at' => null,
        ])->save();

        $nextItem->forceFill([
            'status' => BlogAiUrlImportItem::STATUS_PROCESSING,
            'last_error' => null,
            'started_at' => $nextItem->started_at ?? now(),
            'finished_at' => null,
        ])->save();

        $this->appendLog($job, 'info', 'process_item', sprintf(
            'Dang tao bai %d: %s',
            (int) $nextItem->position,
            $nextItem->source_title ?: $nextItem->source_url
        ), [
            'item_id' => $nextItem->id,
            'source_url' => $nextItem->source_url,
        ]);

        try {
            $brief = $this->extractArticleBrief($nextItem->source_url, (string) $nextItem->source_title);
            if ($brief === null) {
                throw new \RuntimeException('Khong tach duoc noi dung bai viet nguon.');
            }

            $businessProfile = $this->resolveBusinessProfile((int) $job->account_id);
            $this->incrementAiRequests($job, 1, null);
            $result = $this->generateArticle($brief, $businessProfile, (int) $job->account_id);
            $this->incrementAiRequests($job, 0, $result['model']);
            $persisted = $this->persistGeneratedArticle($job, $brief, $result['article'], $businessProfile);

            $nextItem->forceFill([
                'status' => BlogAiUrlImportItem::STATUS_COMPLETED,
                'post_id' => $persisted['post']->id,
                'generated_title' => $persisted['post']->title,
                'last_model' => $result['model'],
                'source_brief' => $brief['brief'],
                'metadata' => array_merge($nextItem->metadata ?? [], [
                    'source_outline' => $brief['outline'],
                    'competitor_mentions' => $brief['competitor_mentions'],
                    'persist_action' => $persisted['action'],
                ]),
                'finished_at' => now(),
            ])->save();

            $this->appendLog($job, 'info', 'item_completed', sprintf(
                'OK bai %d: da luu nhap "%s".',
                (int) $nextItem->position,
                $persisted['post']->title
            ), [
                'item_id' => $nextItem->id,
                'post_id' => $persisted['post']->id,
            ]);

            return [
                'job' => $this->syncJobFromItems($job),
                'item' => $nextItem->fresh(),
                'done' => false,
                'paused' => false,
                'message' => 'Da tao xong mot bai.',
            ];
        } catch (Throwable $exception) {
            $classified = $this->aiExceptionClassifier->classify($exception);
            $isQuota = ($classified['error_code'] ?? '') === 'AI_RATE_LIMITED';

            if ($isQuota) {
                $nextItem->forceFill([
                    'status' => BlogAiUrlImportItem::STATUS_PENDING,
                    'last_error' => $classified['detail'] ?: $classified['message'],
                    'finished_at' => null,
                ])->save();

                $this->appendLog($job, 'warning', 'quota_pause', $classified['detail'] ?: $classified['message'], [
                    'item_id' => $nextItem->id,
                    'error_code' => $classified['error_code'],
                ]);

                return [
                    'job' => $this->syncJobFromItems($job, BlogAiBulkJob::STATUS_PAUSED, [
                        'stopped_due_to_quota' => true,
                        'last_error' => $classified['detail'] ?: $classified['message'],
                    ]),
                    'item' => $nextItem->fresh(),
                    'done' => false,
                    'paused' => true,
                    'message' => 'Da tam dung vi AI bi gioi han quota.',
                ];
            }

            $nextItem->forceFill([
                'status' => BlogAiUrlImportItem::STATUS_FAILED,
                'last_error' => $this->shortError($exception),
                'finished_at' => now(),
            ])->save();

            $this->appendLog($job, 'error', 'item_failed', $this->shortError($exception), [
                'item_id' => $nextItem->id,
                'source_url' => $nextItem->source_url,
                'error_code' => $classified['error_code'] ?? null,
            ]);

            return [
                'job' => $this->syncJobFromItems($job),
                'item' => $nextItem->fresh(),
                'done' => false,
                'paused' => false,
                'message' => 'Bai nay loi, da chuyen sang bai tiep theo neu tiep tuc chay.',
            ];
        }
    }

    public function pause(BlogAiBulkJob $job): BlogAiBulkJob
    {
        $this->assertUrlJob($job);

        $job->forceFill([
            'status' => BlogAiBulkJob::STATUS_PAUSED,
            'summary' => array_merge($job->summary ?? [], [
                'paused_at' => now()->toIso8601String(),
            ]),
        ])->save();

        $this->appendLog($job, 'warning', 'paused', 'Nguoi dung da tam dung tien trinh tao bai.');

        return $this->syncJobFromItems($job, BlogAiBulkJob::STATUS_PAUSED);
    }

    public function resetFailedItems(BlogAiBulkJob $job): BlogAiBulkJob
    {
        $this->assertUrlJob($job);

        BlogAiUrlImportItem::query()
            ->where('blog_ai_bulk_job_id', $job->id)
            ->where('status', BlogAiUrlImportItem::STATUS_FAILED)
            ->update([
                'status' => BlogAiUrlImportItem::STATUS_PENDING,
                'last_error' => null,
                'finished_at' => null,
                'updated_at' => now(),
            ]);

        $this->appendLog($job, 'info', 'reset_failed', 'Da dua cac bai loi ve trang thai cho tao lai.');

        return $this->syncJobFromItems($job, BlogAiBulkJob::STATUS_SCANNED);
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
            'source_hash' => sha1($url),
            'competitor_mentions' => $competitorMentions,
        ];
    }

    private function generateArticle(array $brief, array $businessProfile, int $accountId): array
    {
        $payload = [
            'business_profile' => $businessProfile,
            'source_url' => $brief['source_url'],
            'source_title' => $brief['title'],
            'source_brief' => $brief['brief'],
            'competitor_mentions_to_avoid' => $brief['competitor_mentions'],
        ];

        $prompt = "You are a Vietnamese SEO editor for a ceramic business.\n"
            . "Use the competitor article only as topic research. Do not copy its sentences, paragraph order, images, claims, contact information, or brand identity.\n"
            . "Write one brand-new Vietnamese article for the provided business profile.\n"
            . "Keep facts conservative. If source details are not confirmed for this business, turn them into general buying/use guidance instead of claiming them as company facts.\n"
            . "Use the business phone, email, address, and brand from business_profile when contact details are needed.\n"
            . "Avoid mentioning competitor brand names, competitor phone numbers, competitor emails, or source domains.\n"
            . "Return valid JSON only. No markdown, no code fences, no explanation.\n\n"
            . "Hard rules:\n"
            . "1. Content should be 2500 to 4500 Vietnamese characters before HTML conversion.\n"
            . "2. category_name should be a long-term Vietnamese blog category.\n"
            . "3. seo_keywords must contain 4 to 8 relevant phrases.\n"
            . "4. sections must contain 3 to 5 sections.\n"
            . "5. faq must contain 2 to 4 questions.\n\n"
            . "JSON schema:\n"
            . "{\n"
            . "  \"title\": \"...\",\n"
            . "  \"slug_hint\": \"...\",\n"
            . "  \"excerpt\": \"...\",\n"
            . "  \"seo_title\": \"...\",\n"
            . "  \"seo_description\": \"...\",\n"
            . "  \"seo_keywords\": [\"...\"],\n"
            . "  \"category_name\": \"...\",\n"
            . "  \"sections\": [\n"
            . "    {\"heading\": \"...\", \"paragraphs\": [\"...\"], \"list_items\": [\"...\"]}\n"
            . "  ],\n"
            . "  \"faq\": [{\"question\": \"...\", \"answer\": \"...\"}]\n"
            . "}\n\n"
            . "Input data:\n"
            . json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);

        $result = $this->geminiService->generateText($prompt, $accountId);
        $candidate = $this->extractJsonCandidate($result['text']);
        if ($candidate === null) {
            throw new \RuntimeException('AI tra ve noi dung khong dung JSON.');
        }

        $article = json_decode($candidate, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($article)) {
            throw new \RuntimeException('AI tra ve JSON khong hop le.');
        }

        return [
            'article' => $article,
            'model' => $result['model'] ?? null,
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

        return implode("\n", array_filter($parts));
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
        return Http::timeout(25)
            ->connectTimeout(10)
            ->withHeaders([
                'User-Agent' => 'Mozilla/5.0 (compatible; BlogResearchBot/1.0; +https://gomdaithanh.com)',
                'Accept' => 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            ]);
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

        $bestNode = null;
        $bestLength = 0;

        foreach ($queries as $query) {
            $nodes = $xpath->query($query);
            if ($nodes === false) {
                continue;
            }

            foreach ($nodes as $node) {
                $length = mb_strlen($this->cleanText($this->nodeText($node)));
                if ($length > $bestLength) {
                    $bestLength = $length;
                    $bestNode = $node;
                }
            }
        }

        return $bestNode;
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

    private function syncJobFromItems(BlogAiBulkJob $job, ?string $forcedStatus = null, array $extraSummary = []): BlogAiBulkJob
    {
        $job->refresh();
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
        ], $extraSummary);

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

    private function incrementAiRequests(BlogAiBulkJob $job, int $count, ?string $model): void
    {
        $job->refresh();
        $summary = $job->summary ?? [];
        $summary['ai_requests_used'] = (int) ($summary['ai_requests_used'] ?? 0) + $count;

        $job->forceFill([
            'summary' => $summary,
            'ai_model' => $model ?: $job->ai_model,
        ])->save();
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

    private function escapeHtml(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    private function shortError(Throwable $exception): string
    {
        return Str::limit(trim((string) $exception->getMessage()) ?: $exception::class, 500, '...');
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
