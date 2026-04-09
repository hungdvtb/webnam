<?php

namespace App\Services\BlogAi;

use App\Models\BlogAiBulkJob;
use App\Models\BlogAiBulkJobLog;
use App\Models\BlogCategory;
use App\Models\Category;
use App\Models\MediaAsset;
use App\Models\Post;
use App\Models\PostSeoKeyword;
use App\Models\Product;
use App\Services\MediaService;
use App\Services\SimpleXlsxService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class BlogAiBulkGenerationService
{
    private const IMPORT_DIRECTORY = 'blog-ai-imports';

    private const KEYWORD_HEADER_ALIASES = [
        'keyword',
        'keywords',
        'tu khoa',
        'tu khoa seo',
        'keyword seo',
        'main keyword',
        'search keyword',
        'query',
        'term',
    ];

    private const VOLUME_HEADER_ALIASES = [
        'search volume',
        'search_volume',
        'volume',
        'luot tim kiem',
        'luong tim kiem',
        'searches',
        'sv',
        'monthly volume',
        'monthly search volume',
    ];

    private const TOPIC_STOP_WORDS = [
        'la', 'gi', 'nao', 'co', 'nen', 'hay', 'va', 'voi', 'cua', 'cho', 'tai', 'o', 'tu', 'den',
        'khi', 'cach', 'huong', 'dan', 'kinh', 'nghiem', 'bi', 'quyet', 'mua', 'ban', 'gia', 'bao',
        'nhieu', 'tot', 'khong', 'dep', 'nhat', 're', 'cao', 'cap', 'so', 'sanh', 'phan', 'biet',
        'y', 'nghia', 'phong', 'thuy', 'bao', 'quan', 'su', 'dung', 'mau', 'nao', 'loai', 'the',
        'gioi', 'thieu', 'review', 'top', 'tai', 'sao', 'mot', 'nhung', 'cac', 'de', 'lam', 'nhu',
        'o', 'dau', 'ha', 'noi', 'hcm',
    ];

    private array $nextCategorySortOrderCache = [];
    private array $nextPostSortOrderCache = [];

    public function __construct(
        private readonly SimpleXlsxService $xlsxService,
        private readonly MediaService $mediaService,
        private readonly BlogAiArticleService $articleService,
    ) {
    }

    public function createJobFromUpload(int $accountId, UploadedFile $file, ?int $userId = null): BlogAiBulkJob
    {
        $extension = Str::lower($file->getClientOriginalExtension() ?: 'xlsx');
        $fileName = 'blog-ai-' . Str::lower((string) Str::ulid()) . '.' . $extension;
        $storedPath = $file->storeAs(self::IMPORT_DIRECTORY, $fileName, 'local');

        if (!$storedPath) {
            throw new \RuntimeException('Khong the luu file keyword vao storage.');
        }

        return BlogAiBulkJob::query()->create([
            'account_id' => $accountId,
            'created_by' => $userId,
            'status' => BlogAiBulkJob::STATUS_PENDING,
            'source_filename' => $file->getClientOriginalName() ?: $fileName,
            'source_disk' => 'local',
            'source_path' => $storedPath,
            'metadata' => [
                'mime_type' => $file->getClientMimeType(),
                'size_bytes' => $file->getSize(),
                'extension' => $extension,
            ],
        ]);
    }

    public function run(BlogAiBulkJob $job): BlogAiBulkJob
    {
        $job->refresh();

        if ($job->status === BlogAiBulkJob::STATUS_RUNNING) {
            throw ValidationException::withMessages([
                'job' => ['Tien trinh nay dang duoc xu ly.'],
            ]);
        }

        $this->markJobRunning($job);

        try {
            $keywordRows = $this->loadKeywordRows($job);
            $job->update([
                'total_keywords' => count($keywordRows['raw_rows']),
                'unique_keywords' => count($keywordRows['rows']),
                'metadata' => array_merge($job->metadata ?? [], [
                    'headers' => $keywordRows['headers'],
                    'keyword_header' => $keywordRows['keyword_header'],
                    'volume_header' => $keywordRows['volume_header'],
                    'deduplicated_keywords' => $keywordRows['duplicate_count'],
                ]),
            ]);

            $this->appendLog(
                $job,
                'info',
                'read_file',
                sprintf(
                    'Da doc %d dong keyword, con %d keyword duy nhat sau khi loai trung.',
                    count($keywordRows['raw_rows']),
                    count($keywordRows['rows'])
                )
            );

            $clusters = $this->clusterKeywords($keywordRows['rows']);
            if ($clusters === []) {
                throw ValidationException::withMessages([
                    'file' => ['Khong tim thay cum keyword hop le de tao bai viet.'],
                ]);
            }

            $resourceContext = $this->loadResourceContext($job->account_id);

            $job->update([
                'cluster_count' => count($clusters),
            ]);

            $this->appendLog(
                $job,
                'info',
                'cluster_keywords',
                sprintf('Da gom %d keyword thanh %d cum chu de.', count($keywordRows['rows']), count($clusters))
            );

            $summary = [
                'posts_created' => 0,
                'posts_updated' => 0,
                'categories_created' => 0,
                'skipped_clusters' => 0,
                'skipped_duplicates' => 0,
                'created_post_ids' => [],
                'updated_post_ids' => [],
                'created_category_ids' => [],
                'skipped_duplicate_posts' => [],
            ];
            $errors = [];
            $aiModel = null;

            foreach ($clusters as $index => $cluster) {
                $clusterNumber = $index + 1;

                try {
                    $this->appendLog(
                        $job,
                        'info',
                        'generate_cluster',
                        sprintf(
                            'Dang xu ly cum %d/%d: %s',
                            $clusterNumber,
                            count($clusters),
                            $cluster['primary_keyword']
                        ),
                        [
                            'primary_keyword' => $cluster['primary_keyword'],
                            'keyword_count' => count($cluster['keywords']),
                            'search_volume_total' => $cluster['search_volume_total'],
                        ]
                    );

                    $duplicateMatch = $this->findGlobalDuplicatePost($cluster, $resourceContext);
                    if ($duplicateMatch && $duplicateMatch['match_type'] === 'semantic_duplicate') {
                        $summary['skipped_clusters']++;
                        $summary['skipped_duplicates']++;
                        $summary['skipped_duplicate_posts'][] = [
                            'post_id' => $duplicateMatch['post']['id'],
                            'title' => $duplicateMatch['post']['title'],
                            'slug' => $duplicateMatch['post']['slug'],
                            'keyword' => $cluster['primary_keyword'],
                            'score' => $duplicateMatch['score'],
                        ];

                        $job->update([
                            'processed_clusters' => $clusterNumber,
                            'posts_created' => $summary['posts_created'],
                            'categories_created' => $summary['categories_created'],
                            'ai_model' => $aiModel,
                            'summary' => $summary,
                        ]);

                        $this->appendLog(
                            $job,
                            'warning',
                            'duplicate_cluster',
                            sprintf(
                                'Bo qua cum "%s" vi qua gan voi bai da co "%s".',
                                $cluster['primary_keyword'],
                                $duplicateMatch['post']['title']
                            ),
                            [
                                'primary_keyword' => $cluster['primary_keyword'],
                                'matched_post_id' => $duplicateMatch['post']['id'],
                                'matched_post_slug' => $duplicateMatch['post']['slug'],
                                'matched_post_title' => $duplicateMatch['post']['title'],
                                'duplicate_score' => $duplicateMatch['score'],
                            ]
                        );

                        continue;
                    }

                    $suggestedCategory = $this->suggestCategoryName($cluster);
                    $blogCategory = $this->resolveOrCreateBlogCategory(
                        $job,
                        $suggestedCategory,
                        $resourceContext,
                        $summary
                    );

                    $internalLinks = $this->buildInternalLinks($cluster, $blogCategory, $resourceContext);
                    $featuredImage = $this->resolveFeaturedImage($cluster, $resourceContext);

                    $article = $this->articleService->generateArticle([
                        'primary_keyword' => $cluster['primary_keyword'],
                        'secondary_keywords' => $cluster['secondary_keywords'],
                        'cluster_keywords' => array_map(
                            fn (array $item) => [
                                'keyword' => $item['keyword'],
                                'search_volume' => $item['search_volume'],
                            ],
                            $cluster['keywords']
                        ),
                        'intent_label' => $cluster['intent_label'],
                        'topic_label' => $cluster['topic_label'],
                        'suggested_category' => $blogCategory->name,
                        'industry_context' => $this->resolveIndustryContext($cluster),
                        'keyword_volume_total' => $cluster['search_volume_total'],
                        'related_products' => array_values(array_filter(array_map(
                            fn (array $link) => ($link['type'] ?? '') === 'product'
                                ? ['name' => $link['anchor'], 'url' => $link['url']]
                                : null,
                            $internalLinks
                        ))),
                        'related_product_categories' => array_values(array_filter(array_map(
                            fn (array $link) => ($link['type'] ?? '') === 'product_category'
                                ? ['name' => $link['anchor'], 'url' => $link['url']]
                                : null,
                            $internalLinks
                        ))),
                        'related_blog_categories' => [
                            ['name' => $blogCategory->name, 'url' => '/blog?category=' . $blogCategory->slug],
                        ],
                        'internal_links' => $internalLinks,
                        'inline_image_url' => $featuredImage['url'],
                        'inline_image_alt' => $featuredImage['alt'],
                    ], $job->account_id);

                    if (!$aiModel && !empty($article['model'])) {
                        $aiModel = (string) $article['model'];
                    }

                    $persistedPost = $this->persistGeneratedPost(
                        $job,
                        $cluster,
                        $blogCategory,
                        $article,
                        $featuredImage,
                        (int) ($duplicateMatch['post']['id'] ?? 0)
                    );

                    if ($persistedPost['action'] === 'created') {
                        $summary['posts_created']++;
                        $summary['created_post_ids'][] = $persistedPost['post']->id;
                    } else {
                        $summary['posts_updated']++;
                        $summary['updated_post_ids'][] = $persistedPost['post']->id;
                    }

                    $this->ensureSeoKeywordsExist(
                        $job->account_id,
                        array_merge([$cluster['primary_keyword']], $cluster['secondary_keywords'])
                    );
                    $this->rememberGeneratedPostContext($persistedPost['post'], $resourceContext);

                    $job->update([
                        'processed_clusters' => $clusterNumber,
                        'posts_created' => $summary['posts_created'],
                        'categories_created' => $summary['categories_created'],
                        'ai_model' => $aiModel,
                        'summary' => $summary,
                    ]);

                    $message = $persistedPost['action'] === 'created'
                        ? sprintf('Da tao bai nhap "%s".', $persistedPost['post']->title)
                        : sprintf('Da cap nhat bai nhap ton tai "%s".', $persistedPost['post']->title);

                    $this->appendLog(
                        $job,
                        !empty($article['used_ai']) ? 'info' : 'warning',
                        'save_post',
                        $message,
                        [
                            'post_id' => $persistedPost['post']->id,
                            'slug' => $persistedPost['post']->slug,
                            'category' => $blogCategory->name,
                            'image_source' => $featuredImage['source'],
                            'used_ai' => (bool) ($article['used_ai'] ?? false),
                            'warning' => $article['warning'] ?? null,
                        ]
                    );
                } catch (\Throwable $exception) {
                    $errors[] = sprintf(
                        'Cum "%s": %s',
                        $cluster['primary_keyword'],
                        trim((string) $exception->getMessage()) ?: 'Khong the tao bai viet cho cum nay.'
                    );

                    $job->update([
                        'processed_clusters' => $clusterNumber,
                        'posts_failed' => count($errors),
                    ]);

                    $this->appendLog(
                        $job,
                        'error',
                        'cluster_error',
                        end($errors),
                        [
                            'primary_keyword' => $cluster['primary_keyword'],
                        ]
                    );
                }
            }

            $status = $errors === []
                ? BlogAiBulkJob::STATUS_COMPLETED
                : ($summary['posts_created'] > 0 || $summary['posts_updated'] > 0
                    ? BlogAiBulkJob::STATUS_COMPLETED_WITH_ERRORS
                    : BlogAiBulkJob::STATUS_FAILED);

            $job->update([
                'status' => $status,
                'finished_at' => now(),
                'posts_created' => $summary['posts_created'],
                'posts_failed' => count($errors),
                'categories_created' => $summary['categories_created'],
                'ai_model' => $aiModel,
                'summary' => $summary,
                'errors' => $errors,
            ]);

            $this->appendLog(
                $job,
                $errors === [] ? 'info' : 'warning',
                'completed',
                sprintf(
                    'Hoan tat xu ly file. Tao moi %d bai, cap nhat %d bai, bo qua %d cum trung y, tao %d danh muc, loi %d cum.',
                    $summary['posts_created'],
                    $summary['posts_updated'],
                    $summary['skipped_duplicates'],
                    $summary['categories_created'],
                    count($errors)
                )
            );
        } catch (\Throwable $exception) {
            $message = trim((string) $exception->getMessage()) ?: 'Khong the xu ly file keyword.';

            $job->update([
                'status' => BlogAiBulkJob::STATUS_FAILED,
                'finished_at' => now(),
                'errors' => [$message],
            ]);

            $this->appendLog($job, 'error', 'failed', $message);
        }

        return $job->fresh('logs');
    }

    private function markJobRunning(BlogAiBulkJob $job): void
    {
        $job->update([
            'status' => BlogAiBulkJob::STATUS_RUNNING,
            'started_at' => now(),
            'finished_at' => null,
            'errors' => null,
        ]);

        $this->appendLog(
            $job,
            'info',
            'start',
            sprintf('Bat dau xu ly file "%s".', $job->source_filename)
        );
    }

    private function loadKeywordRows(BlogAiBulkJob $job): array
    {
        $path = $this->resolveStoredFilePath($job);
        $extension = Str::lower(pathinfo($path, PATHINFO_EXTENSION));

        if ($extension === 'csv') {
            $workbook = $this->readCsvFile($path);
        } elseif ($extension === 'xlsx') {
            $workbook = $this->xlsxService->read($path);
        } else {
            throw ValidationException::withMessages([
                'file' => ['Chi ho tro file .xlsx hoac .csv cho tool nay.'],
            ]);
        }

        $headers = array_values(array_map(
            fn ($header) => trim((string) $header),
            (array) ($workbook['headers'] ?? [])
        ));
        $rows = array_values((array) ($workbook['rows'] ?? []));

        if ($headers === [] || $rows === []) {
            throw ValidationException::withMessages([
                'file' => ['File keyword khong co du lieu hop le.'],
            ]);
        }

        $headerMap = [];
        foreach ($headers as $header) {
            $headerMap[$this->normalizeHeader($header)] = $header;
        }

        $keywordHeader = $this->resolveHeaderAlias($headerMap, self::KEYWORD_HEADER_ALIASES);
        $volumeHeader = $this->resolveHeaderAlias($headerMap, self::VOLUME_HEADER_ALIASES);

        if ($keywordHeader === null || $volumeHeader === null) {
            throw ValidationException::withMessages([
                'file' => ['File keyword phai co it nhat 2 cot: keyword va search volume.'],
            ]);
        }

        $deduped = [];
        $rawRows = [];
        $duplicates = 0;

        foreach ($rows as $rowIndex => $row) {
            $keyword = $this->cleanText($row[$keywordHeader] ?? '');
            $searchVolume = $this->parseInteger($row[$volumeHeader] ?? 0);

            if ($keyword === '') {
                continue;
            }

            $rawRows[] = [
                'keyword' => $keyword,
                'search_volume' => $searchVolume,
            ];

            $normalizedKeyword = $this->normalizeKeywordText($keyword);
            if ($normalizedKeyword === '') {
                continue;
            }

            $extra = [];
            foreach ($row as $header => $value) {
                if ($header === $keywordHeader || $header === $volumeHeader) {
                    continue;
                }

                $cleanValue = $this->cleanText($value);
                if ($cleanValue !== '') {
                    $extra[$header] = $cleanValue;
                }
            }

            if (isset($deduped[$normalizedKeyword])) {
                $duplicates++;
                $deduped[$normalizedKeyword]['search_volume'] = max(
                    $deduped[$normalizedKeyword]['search_volume'],
                    $searchVolume
                );
                $deduped[$normalizedKeyword]['extra'] = array_merge(
                    $deduped[$normalizedKeyword]['extra'],
                    $extra
                );
                continue;
            }

            $deduped[$normalizedKeyword] = [
                'keyword' => $keyword,
                'normalized_keyword' => $normalizedKeyword,
                'search_volume' => $searchVolume,
                'extra' => $extra,
                'row_number' => $rowIndex + 2,
                'topic_tokens' => $this->extractTopicTokens($keyword),
                'intent_key' => $this->resolveIntentKey($keyword),
                'intent_group' => $this->resolveIntentGroup($keyword),
            ];
        }

        $rows = array_values($deduped);
        usort($rows, function (array $left, array $right) {
            if ($left['search_volume'] !== $right['search_volume']) {
                return $right['search_volume'] <=> $left['search_volume'];
            }

            return strcmp($left['keyword'], $right['keyword']);
        });

        return [
            'headers' => $headers,
            'keyword_header' => $keywordHeader,
            'volume_header' => $volumeHeader,
            'raw_rows' => $rawRows,
            'rows' => $rows,
            'duplicate_count' => $duplicates,
        ];
    }

    private function readCsvFile(string $path): array
    {
        $handle = fopen($path, 'rb');
        if (!$handle) {
            throw new \RuntimeException('Khong the doc file CSV keyword.');
        }

        $headers = [];
        $rows = [];

        try {
            while (($data = fgetcsv($handle)) !== false) {
                $data = array_map(function ($value) {
                    $text = (string) $value;
                    $text = preg_replace('/^\xEF\xBB\xBF/', '', $text) ?? $text;

                    return trim($text);
                }, $data);

                if ($headers === []) {
                    $headers = $data;
                    continue;
                }

                $assoc = [];
                foreach ($headers as $index => $header) {
                    if (trim((string) $header) === '') {
                        continue;
                    }

                    $assoc[$header] = (string) ($data[$index] ?? '');
                }

                if (array_filter($assoc, fn ($value) => trim((string) $value) !== '')) {
                    $rows[] = $assoc;
                }
            }
        } finally {
            fclose($handle);
        }

        return [
            'headers' => $headers,
            'rows' => $rows,
        ];
    }

    private function clusterKeywords(array $rows): array
    {
        $clusters = [];

        foreach ($rows as $row) {
            $bestIndex = null;
            $bestScore = 0.0;

            foreach ($clusters as $index => $cluster) {
                if (!$this->areIntentGroupsCompatible($row['intent_group'], $cluster['intent_group'])) {
                    continue;
                }

                $score = $this->scoreKeywordAgainstCluster($row, $cluster);
                if ($score > $bestScore) {
                    $bestScore = $score;
                    $bestIndex = $index;
                }
            }

            if ($bestIndex !== null && $bestScore >= 58) {
                $clusters[$bestIndex]['keywords'][] = $row;
                $clusters[$bestIndex]['topic_tokens'] = $this->mergeTopicTokens(
                    $clusters[$bestIndex]['topic_tokens'],
                    $row['topic_tokens']
                );

                if ($row['search_volume'] > $clusters[$bestIndex]['highest_volume']) {
                    $clusters[$bestIndex]['highest_volume'] = $row['search_volume'];
                    $clusters[$bestIndex]['representative_keyword'] = $row['keyword'];
                }

                continue;
            }

            $clusters[] = [
                'keywords' => [$row],
                'topic_tokens' => $row['topic_tokens'],
                'intent_group' => $row['intent_group'],
                'intent_key' => $row['intent_key'],
                'representative_keyword' => $row['keyword'],
                'highest_volume' => $row['search_volume'],
            ];
        }

        $finalClusters = [];

        foreach ($clusters as $cluster) {
            usort($cluster['keywords'], function (array $left, array $right) {
                if ($left['search_volume'] !== $right['search_volume']) {
                    return $right['search_volume'] <=> $left['search_volume'];
                }

                return strcmp($left['keyword'], $right['keyword']);
            });

            $primary = $cluster['keywords'][0];
            $clusterKeywords = $cluster['keywords'];

            $finalClusters[] = [
                'keywords' => $clusterKeywords,
                'primary_keyword' => $primary['keyword'],
                'secondary_keywords' => array_values(array_map(
                    fn (array $item) => $item['keyword'],
                    array_slice($clusterKeywords, 1, 8)
                )),
                'search_volume_total' => array_sum(array_map(
                    fn (array $item) => (int) ($item['search_volume'] ?? 0),
                    $clusterKeywords
                )),
                'intent_group' => $cluster['intent_group'],
                'intent_key' => $cluster['intent_key'],
                'intent_label' => $this->intentLabelFromKey($cluster['intent_key']),
                'topic_tokens' => $cluster['topic_tokens'],
                'topic_label' => $this->buildTopicLabel($clusterKeywords, $cluster['topic_tokens']),
            ];
        }

        usort($finalClusters, function (array $left, array $right) {
            if ($left['search_volume_total'] !== $right['search_volume_total']) {
                return $right['search_volume_total'] <=> $left['search_volume_total'];
            }

            return strcmp($left['primary_keyword'], $right['primary_keyword']);
        });

        return $finalClusters;
    }

    private function loadResourceContext(int $accountId): array
    {
        $products = Product::query()
            ->with([
                'category:id,name,slug',
                'images:id,product_id,media_asset_id,image_url,is_primary,sort_order,file_name',
                'images.mediaAsset:id,public_id,disk,collection,original_name,original_extension,mime_type,width,height,size_bytes,variants,metadata',
            ])
            ->where('account_id', $accountId)
            ->get(['id', 'account_id', 'name', 'slug', 'category_id', 'meta_keywords', 'meta_description']);

        $categories = Category::query()
            ->where('account_id', $accountId)
            ->get(['id', 'account_id', 'name', 'slug', 'meta_keywords', 'meta_description', 'parent_id']);

        $blogCategories = BlogCategory::query()
            ->where('account_id', $accountId)
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get(['id', 'account_id', 'name', 'slug', 'sort_order']);

        $existingPosts = Post::query()
            ->with(['category:id,name,slug'])
            ->where('account_id', $accountId)
            ->where('is_system', false)
            ->get([
                'id',
                'account_id',
                'blog_category_id',
                'title',
                'slug',
                'seo_keyword',
                'excerpt',
                'meta_title',
                'meta_description',
                'meta_keywords',
            ]);

        return [
            'products' => $products,
            'categories' => $categories,
            'blog_categories' => $blogCategories,
            'existing_posts' => $existingPosts->map(
                fn (Post $post) => $this->buildExistingPostContext($post)
            )->all(),
            'blog_categories_by_signature' => $blogCategories->mapWithKeys(function (BlogCategory $category) {
                return [$this->categorySignature($category->name) => $category];
            })->all(),
        ];
    }

    private function buildExistingPostContext(Post $post): array
    {
        $primaryKeyword = $this->cleanText($post->seo_keyword ?: $post->title);
        $categoryName = $this->cleanText($post->category?->name ?? '');

        $rawKeywords = preg_split('/[,;\r\n]+/u', (string) ($post->meta_keywords ?? '')) ?: [];
        $normalizedKeywordPool = [];

        foreach (array_merge([$primaryKeyword], $rawKeywords) as $keyword) {
            $normalizedKeyword = $this->normalizeKeywordText($this->cleanText($keyword));
            if ($normalizedKeyword === '' || in_array($normalizedKeyword, $normalizedKeywordPool, true)) {
                continue;
            }

            $normalizedKeywordPool[] = $normalizedKeyword;
        }

        $haystack = $this->normalizeKeywordText(implode(' ', array_filter([
            $post->title,
            $post->slug,
            $post->seo_keyword,
            $post->excerpt,
            $post->meta_title,
            $post->meta_description,
            $post->meta_keywords,
            $categoryName,
        ])));

        $topicTokens = $this->dedupComparisonTokens(array_merge(
            $this->extractTopicTokens($primaryKeyword),
            $this->extractTopicTokens((string) $post->title),
            $this->extractTopicTokens((string) ($post->meta_keywords ?? '')),
            $this->extractTopicTokens($categoryName)
        ));

        return [
            'id' => (int) $post->id,
            'title' => (string) $post->title,
            'slug' => (string) $post->slug,
            'primary_keyword_normalized' => $this->normalizeKeywordText($primaryKeyword),
            'keyword_pool' => $normalizedKeywordPool,
            'topic_tokens' => $topicTokens,
            'haystack' => $haystack,
            'intent_group' => $this->resolveIntentGroup($primaryKeyword !== '' ? $primaryKeyword : (string) $post->title),
            'category_signature' => $this->categorySignature($categoryName),
        ];
    }

    private function findGlobalDuplicatePost(array $cluster, array $resourceContext): ?array
    {
        $bestMatch = null;

        foreach ((array) ($resourceContext['existing_posts'] ?? []) as $postContext) {
            if (!is_array($postContext)) {
                continue;
            }

            $match = $this->scoreClusterAgainstExistingPost($cluster, $postContext);
            if ($match === null) {
                continue;
            }

            if ($bestMatch === null || $match['score'] > $bestMatch['score']) {
                $bestMatch = $match;
            }
        }

        return $bestMatch;
    }

    private function scoreClusterAgainstExistingPost(array $cluster, array $postContext): ?array
    {
        $clusterPrimaryNormalized = $this->normalizeKeywordText((string) ($cluster['primary_keyword'] ?? ''));
        if ($clusterPrimaryNormalized === '' || empty($postContext['id'])) {
            return null;
        }

        if ($clusterPrimaryNormalized === ($postContext['primary_keyword_normalized'] ?? '')) {
            return [
                'score' => 140,
                'match_type' => 'exact_keyword',
                'post' => $postContext,
            ];
        }

        $clusterKeywordSlugs = array_values(array_filter(array_map(
            fn (array $item) => Str::slug((string) ($item['keyword'] ?? '')),
            (array) ($cluster['keywords'] ?? [])
        )));

        if (!empty($postContext['slug']) && in_array($postContext['slug'], $clusterKeywordSlugs, true)) {
            return [
                'score' => 132,
                'match_type' => 'exact_slug',
                'post' => $postContext,
            ];
        }

        $clusterTokens = $this->clusterComparisonTokens($cluster);
        $postTokens = $this->dedupComparisonTokens((array) ($postContext['topic_tokens'] ?? []));
        $intersectionCount = count(array_intersect($clusterTokens, $postTokens));
        $unionCount = count(array_unique(array_merge($clusterTokens, $postTokens)));
        $jaccard = $unionCount > 0 ? ($intersectionCount / $unionCount) : 0;

        $sharedPhraseHits = 0;
        foreach ($this->clusterNormalizedKeywords($cluster) as $normalizedKeyword) {
            if ($normalizedKeyword !== '' && str_contains((string) ($postContext['haystack'] ?? ''), $normalizedKeyword)) {
                $sharedPhraseHits++;
            }
        }

        $primaryPhraseBonus = str_contains((string) ($postContext['haystack'] ?? ''), $clusterPrimaryNormalized)
            || str_contains($clusterPrimaryNormalized, (string) ($postContext['primary_keyword_normalized'] ?? ''))
            || str_contains((string) ($postContext['primary_keyword_normalized'] ?? ''), $clusterPrimaryNormalized)
                ? 34
                : 0;

        $intentBonus = $cluster['intent_group'] === ($postContext['intent_group'] ?? '')
            ? 14
            : ($this->areIntentGroupsCompatible($cluster['intent_group'], (string) ($postContext['intent_group'] ?? '')) ? 8 : 0);

        $requestedCategorySignature = $this->categorySignature($this->suggestCategoryName($cluster));
        $categoryBonus = $requestedCategorySignature !== ''
            && $requestedCategorySignature === ($postContext['category_signature'] ?? '')
                ? 10
                : 0;

        $score = (int) round(
            ($jaccard * 58)
            + ($intersectionCount * 8)
            + min($sharedPhraseHits * 14, 42)
            + $primaryPhraseBonus
            + $intentBonus
            + $categoryBonus
        );

        if ($score < 76 || $intersectionCount < 2) {
            return null;
        }

        return [
            'score' => $score,
            'match_type' => 'semantic_duplicate',
            'post' => $postContext,
        ];
    }

    private function clusterNormalizedKeywords(array $cluster): array
    {
        $keywords = array_merge(
            [(string) ($cluster['primary_keyword'] ?? '')],
            (array) ($cluster['secondary_keywords'] ?? []),
            array_map(
                fn (array $item) => (string) ($item['keyword'] ?? ''),
                (array) ($cluster['keywords'] ?? [])
            )
        );

        $normalized = [];
        foreach ($keywords as $keyword) {
            $candidate = $this->normalizeKeywordText($keyword);
            if ($candidate === '' || in_array($candidate, $normalized, true)) {
                continue;
            }

            $normalized[] = $candidate;
        }

        return $normalized;
    }

    private function clusterComparisonTokens(array $cluster): array
    {
        $tokens = array_merge(
            (array) ($cluster['topic_tokens'] ?? []),
            ...array_map(
                fn (string $keyword) => $this->extractTopicTokens($keyword),
                $this->clusterNormalizedKeywords($cluster)
            )
        );

        return $this->dedupComparisonTokens($tokens);
    }

    private function dedupComparisonTokens(array $tokens): array
    {
        $filtered = [];

        foreach ($tokens as $token) {
            $normalized = $this->normalizeKeywordText((string) $token);
            if ($normalized === '' || strlen($normalized) < 3) {
                continue;
            }

            if (in_array($normalized, ['gom', 'su', 'bat', 'trang', 'men'], true)) {
                continue;
            }

            if (!in_array($normalized, $filtered, true)) {
                $filtered[] = $normalized;
            }
        }

        return $filtered;
    }

    private function rememberGeneratedPostContext(Post $post, array &$resourceContext): void
    {
        $context = $this->buildExistingPostContext($post);

        foreach ((array) ($resourceContext['existing_posts'] ?? []) as $index => $existingPost) {
            if ((int) ($existingPost['id'] ?? 0) !== $context['id']) {
                continue;
            }

            $resourceContext['existing_posts'][$index] = $context;

            return;
        }

        $resourceContext['existing_posts'][] = $context;
    }

    private function suggestCategoryName(array $cluster): string
    {
        $haystack = Str::lower(Str::ascii(
            $cluster['primary_keyword']
            . ' '
            . implode(' ', $cluster['secondary_keywords'])
            . ' '
            . $cluster['topic_label']
        ));

        if ($this->containsAny($haystack, ['do tho', 'tho cung', 'bat huong', 'lu huong', 'chan nen', 'ban tho'])) {
            return in_array($cluster['intent_group'], ['knowledge', 'comparison'], true)
                ? 'Kien thuc do tho Bat Trang'
                : 'Do tho Bat Trang';
        }

        if ($this->containsAny($haystack, ['qua tang', 'in logo', 'qua bieu', 'doanh nghiep', 'ky niem'])) {
            return in_array($cluster['intent_group'], ['knowledge', 'comparison'], true)
                ? 'Kinh nghiem chon qua tang gom su'
                : 'Qua tang gom su';
        }

        if ($this->containsAny($haystack, ['loc binh', 'binh hoa', 'trang tri', 'noi that', 'de ban', 'phong khach'])) {
            return 'Gom su trang tri';
        }

        if ($this->containsAny($haystack, ['bao quan', 've sinh', 'su dung'])) {
            return 'Bao quan va su dung gom su';
        }

        if ($this->containsAny($haystack, ['phong thuy', 'y nghia', 'kieng ky'])) {
            return 'Phong thuy va y nghia gom su';
        }

        return 'Kien thuc gom su Bat Trang';
    }

    private function resolveOrCreateBlogCategory(
        BlogAiBulkJob $job,
        string $requestedName,
        array &$resourceContext,
        array &$summary
    ): BlogCategory {
        $signature = $this->categorySignature($requestedName);
        if (isset($resourceContext['blog_categories_by_signature'][$signature])) {
            return $resourceContext['blog_categories_by_signature'][$signature];
        }

        $name = trim($requestedName) !== '' ? trim($requestedName) : 'Kien thuc gom su Bat Trang';
        $slug = $this->buildUniqueCategorySlug($job->account_id, $name);
        $sortOrder = $this->nextCategorySortOrder($job->account_id);

        $category = BlogCategory::query()->create([
            'account_id' => $job->account_id,
            'name' => $name,
            'slug' => $slug,
            'sort_order' => $sortOrder,
        ]);

        $resourceContext['blog_categories']->push($category);
        $resourceContext['blog_categories_by_signature'][$signature] = $category;

        $summary['categories_created']++;
        $summary['created_category_ids'][] = $category->id;

        $job->update([
            'categories_created' => $summary['categories_created'],
        ]);

        $this->appendLog(
            $job,
            'info',
            'create_category',
            sprintf('Da tao danh muc blog "%s".', $category->name),
            [
                'category_id' => $category->id,
                'slug' => $category->slug,
            ]
        );

        return $category;
    }

    private function buildInternalLinks(array $cluster, BlogCategory $blogCategory, array $resourceContext): array
    {
        $tokens = $cluster['topic_tokens'];
        $links = [];

        $links[] = [
            'type' => 'blog_category',
            'url' => '/blog?category=' . $blogCategory->slug,
            'anchor' => $blogCategory->name,
            'description' => 'Chuyen muc blog lien quan de doc them cac bai cung chu de.',
        ];

        $productCandidates = $this->scoreProductsForCluster($cluster, $resourceContext['products']);
        foreach ($productCandidates->take(2) as $item) {
            $links[] = [
                'type' => 'product',
                'url' => '/product/' . $item['product']->slug,
                'anchor' => $item['product']->name,
                'description' => 'San pham lien quan de doi chieu kieu dang, hoa tiet va muc dich su dung.',
            ];
        }

        $categoryCandidates = $this->scoreProductCategoriesForCluster($tokens, $resourceContext['categories']);
        foreach ($categoryCandidates->take(1) as $item) {
            $links[] = [
                'type' => 'product_category',
                'url' => '/category/' . $item['category']->slug,
                'anchor' => $item['category']->name,
                'description' => 'Danh muc san pham lien quan de mo rong lua chon cung chu de.',
            ];
        }

        $uniqueLinks = [];
        foreach ($links as $link) {
            $key = Str::lower(($link['type'] ?? '') . '|' . ($link['url'] ?? ''));
            if (!isset($uniqueLinks[$key])) {
                $uniqueLinks[$key] = $link;
            }
        }

        return array_values($uniqueLinks);
    }

    private function scoreProductsForCluster(array $cluster, Collection $products): Collection
    {
        $tokens = $cluster['topic_tokens'];
        $primaryKeyword = $this->normalizeKeywordText($cluster['primary_keyword']);

        return $products
            ->map(function (Product $product) use ($tokens, $primaryKeyword) {
                $haystack = $this->normalizeKeywordText(
                    $product->name
                    . ' '
                    . ($product->category?->name ?? '')
                    . ' '
                    . ($product->meta_keywords ?? '')
                    . ' '
                    . ($product->meta_description ?? '')
                );

                $tokenScore = $this->tokenOverlapScore($tokens, $haystack);
                $phraseBonus = $primaryKeyword !== '' && str_contains($haystack, $primaryKeyword) ? 30 : 0;
                $hasImageBonus = $product->images->isNotEmpty() ? 10 : 0;
                $score = $tokenScore + $phraseBonus + $hasImageBonus;

                return [
                    'product' => $product,
                    'score' => $score,
                ];
            })
            ->filter(fn (array $item) => $item['score'] >= 38 && !empty($item['product']->slug))
            ->sortByDesc('score')
            ->values();
    }

    private function scoreProductCategoriesForCluster(array $tokens, Collection $categories): Collection
    {
        return $categories
            ->map(function (Category $category) use ($tokens) {
                $haystack = $this->normalizeKeywordText(
                    $category->name . ' ' . ($category->meta_keywords ?? '') . ' ' . ($category->meta_description ?? '')
                );

                return [
                    'category' => $category,
                    'score' => $this->tokenOverlapScore($tokens, $haystack),
                ];
            })
            ->filter(fn (array $item) => $item['score'] >= 34 && !empty($item['category']->slug))
            ->sortByDesc('score')
            ->values();
    }

    private function resolveFeaturedImage(array $cluster, array $resourceContext): array
    {
        $productCandidates = $this->scoreProductsForCluster($cluster, $resourceContext['products']);
        $primaryKeyword = $cluster['primary_keyword'];

        foreach ($productCandidates as $candidate) {
            /** @var Product $product */
            $product = $candidate['product'];
            $image = $product->images
                ->sortBy([
                    ['is_primary', 'desc'],
                    ['sort_order', 'asc'],
                ])
                ->first();

            if (!$image) {
                continue;
            }

            try {
                $asset = null;

                if ($image->mediaAsset instanceof MediaAsset) {
                    $asset = $this->mediaService->cloneAssetFromExisting($image->mediaAsset, [
                        'collection' => 'blog-ai-featured',
                        'source' => 'blog-ai-library-image',
                    ], $image->file_name ?: ($product->slug . '.jpg'));
                } elseif (!empty($image->image_url)) {
                    $asset = $this->mediaService->importFromReference($image->image_url, [
                        'collection' => 'blog-ai-featured',
                        'source' => 'blog-ai-library-image',
                        'clone_existing' => true,
                    ]);
                }

                if ($asset instanceof MediaAsset) {
                    return [
                        'asset' => $asset,
                        'url' => $this->mediaService->buildAssetUrl($asset, 'large'),
                        'alt' => $primaryKeyword . ' - ' . $product->name,
                        'source' => 'product_library',
                    ];
                }
            } catch (\Throwable) {
            }
        }

        $svg = $this->buildGeneratedCoverSvg($cluster);
        $asset = $this->mediaService->storeGeneratedAsset(
            $svg,
            (Str::slug($primaryKeyword) ?: 'blog-ai-cover') . '.svg',
            'image/svg+xml',
            [
                'collection' => 'blog-ai-generated',
                'source' => 'blog-ai-generated-cover',
            ]
        );

        return [
            'asset' => $asset,
            'url' => $this->mediaService->buildAssetUrl($asset, 'original'),
            'alt' => $primaryKeyword,
            'source' => 'generated',
        ];
    }

    private function buildGeneratedCoverSvg(array $cluster): string
    {
        $theme = Str::lower(Str::ascii($cluster['topic_label'] . ' ' . $cluster['primary_keyword']));
        $palette = match (true) {
            $this->containsAny($theme, ['do tho', 'tho cung', 'bat huong', 'lu huong']) => [
                'bg1' => '#2f241f',
                'bg2' => '#8d6a4e',
                'accent' => '#d8c0a2',
                'line' => '#f2e5d1',
            ],
            $this->containsAny($theme, ['qua tang', 'doanh nghiep', 'in logo']) => [
                'bg1' => '#113849',
                'bg2' => '#3e6b78',
                'accent' => '#e2c17d',
                'line' => '#f6ecd6',
            ],
            default => [
                'bg1' => '#7a4e2f',
                'bg2' => '#c98b55',
                'accent' => '#f2ddc5',
                'line' => '#fff3e4',
            ],
        };

        $title = $this->truncateForSvg($cluster['primary_keyword'], 36);
        $subtitle = $this->truncateForSvg($cluster['topic_label'], 48);

        return <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1600" y2="900" gradientUnits="userSpaceOnUse">
      <stop stop-color="{$palette['bg1']}"/>
      <stop offset="1" stop-color="{$palette['bg2']}"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#bg)"/>
  <circle cx="1240" cy="220" r="210" fill="{$palette['accent']}" fill-opacity="0.14"/>
  <circle cx="300" cy="760" r="240" fill="{$palette['accent']}" fill-opacity="0.10"/>
  <path d="M320 650C430 520 610 470 790 500C970 530 1140 640 1290 680" stroke="{$palette['line']}" stroke-width="3" stroke-opacity="0.38"/>
  <path d="M980 260C1035 335 1070 420 1070 510C1070 610 1025 685 940 742H660C575 685 530 610 530 510C530 420 565 335 620 260H980Z" fill="{$palette['accent']}" fill-opacity="0.14" stroke="{$palette['line']}" stroke-opacity="0.35" stroke-width="3"/>
  <path d="M690 225C735 178 785 155 850 155C915 155 965 178 1010 225" stroke="{$palette['line']}" stroke-width="5" stroke-linecap="round" stroke-opacity="0.6"/>
  <text x="160" y="240" fill="{$palette['line']}" font-size="32" font-family="Georgia, 'Times New Roman', serif" letter-spacing="3">BAT TRANG CERAMICS BLOG</text>
  <text x="160" y="390" fill="#ffffff" font-size="78" font-weight="700" font-family="Georgia, 'Times New Roman', serif">{$this->escapeForSvg($title)}</text>
  <text x="160" y="470" fill="{$palette['line']}" font-size="34" font-family="Arial, sans-serif">{$this->escapeForSvg($subtitle)}</text>
  <text x="160" y="620" fill="{$palette['line']}" font-size="26" font-family="Arial, sans-serif">Noi dung theo cum keyword va search intent</text>
  <text x="160" y="665" fill="{$palette['line']}" font-size="26" font-family="Arial, sans-serif">Danh cho blog gom su, do tho va qua tang gom su</text>
</svg>
SVG;
    }

    private function persistGeneratedPost(
        BlogAiBulkJob $job,
        array $cluster,
        BlogCategory $blogCategory,
        array $article,
        array $featuredImage,
        int $forcedExistingPostId = 0
    ): array {
        $title = trim((string) ($article['title'] ?? ''));
        if ($title === '') {
            throw new \RuntimeException('Bai viet AI khong co tieu de hop le.');
        }

        $requestedSlug = Str::slug((string) ($article['slug_hint'] ?? $title)) ?: 'blog-ai-post';

        $existingPost = null;

        if ($forcedExistingPostId > 0) {
            $existingPost = Post::query()
                ->where('account_id', $job->account_id)
                ->where('is_system', false)
                ->where('id', $forcedExistingPostId)
                ->first();
        }

        if (!$existingPost) {
            $existingPost = Post::query()
                ->where('account_id', $job->account_id)
                ->where('is_system', false)
                ->where(function ($query) use ($cluster, $requestedSlug) {
                    $query->where('seo_keyword', $cluster['primary_keyword'])
                        ->orWhere('slug', $requestedSlug);
                })
                ->first();
        }

        $baseSlug = $existingPost
            ? $existingPost->slug
            : $this->buildUniquePostSlug($job->account_id, $requestedSlug);

        $payload = [
            'account_id' => $job->account_id,
            'blog_category_id' => $blogCategory->id,
            'title' => $title,
            'slug' => $existingPost ? $existingPost->slug : $baseSlug,
            'seo_keyword' => $cluster['primary_keyword'],
            'content' => (string) ($article['content_html'] ?? ''),
            'excerpt' => (string) ($article['excerpt'] ?? ''),
            'featured_image' => $featuredImage['url'],
            'featured_media_asset_id' => $featuredImage['asset']->id ?? null,
            'meta_title' => (string) ($article['meta_title'] ?? ''),
            'meta_description' => (string) ($article['meta_description'] ?? ''),
            'meta_keywords' => (string) ($article['meta_keywords'] ?? ''),
            'is_system' => false,
            'is_published' => false,
            'is_starred' => false,
            'published_at' => null,
        ];

        if (!$existingPost) {
            $payload['sort_order'] = $this->nextPostSortOrder($job->account_id);
            $post = Post::query()->create($payload);
            $post->setRelation('category', $blogCategory);

            return [
                'post' => $post,
                'action' => 'created',
            ];
        }

        $previousFeaturedAssetId = $existingPost->featured_media_asset_id;
        $previousContent = (string) $existingPost->content;

        $existingPost->fill($payload);
        $existingPost->save();
        $existingPost->setRelation('category', $blogCategory);

        if ($previousFeaturedAssetId && $previousFeaturedAssetId !== $existingPost->featured_media_asset_id) {
            $this->mediaService->deleteAsset($previousFeaturedAssetId);
        }

        $this->cleanupRemovedManagedContentAssets($previousContent, (string) $existingPost->content);

        return [
            'post' => $existingPost,
            'action' => 'updated',
        ];
    }

    private function cleanupRemovedManagedContentAssets(?string $previousContent, ?string $nextContent): void
    {
        $previousIds = $this->mediaService->collectManagedPublicIdsFromHtml($previousContent);
        $nextIds = $this->mediaService->collectManagedPublicIdsFromHtml($nextContent);

        foreach (array_diff($previousIds, $nextIds) as $publicId) {
            $assetId = MediaAsset::query()->where('public_id', $publicId)->value('id');
            if ($assetId) {
                $this->mediaService->deleteAsset((int) $assetId);
            }
        }
    }

    private function ensureSeoKeywordsExist(int $accountId, array $keywords): void
    {
        foreach ($keywords as $keyword) {
            $normalized = $this->cleanText($keyword);
            if ($normalized === '') {
                continue;
            }

            PostSeoKeyword::query()->firstOrCreate([
                'account_id' => $accountId,
                'keyword' => $normalized,
            ]);
        }
    }

    private function resolveStoredFilePath(BlogAiBulkJob $job): string
    {
        if ($job->source_disk !== 'local') {
            throw new \RuntimeException('Chi ho tro storage local cho file keyword.');
        }

        if (!Storage::disk('local')->exists($job->source_path)) {
            throw new \RuntimeException('Khong tim thay file keyword da upload.');
        }

        return Storage::disk('local')->path($job->source_path);
    }

    private function resolveHeaderAlias(array $headerMap, array $aliases): ?string
    {
        foreach ($aliases as $alias) {
            $normalizedAlias = $this->normalizeHeader($alias);

            if (isset($headerMap[$normalizedAlias])) {
                return $headerMap[$normalizedAlias];
            }
        }

        foreach ($headerMap as $normalizedHeader => $originalHeader) {
            foreach ($aliases as $alias) {
                $normalizedAlias = $this->normalizeHeader($alias);

                if (str_contains($normalizedHeader, $normalizedAlias)) {
                    return $originalHeader;
                }
            }
        }

        return null;
    }

    private function normalizeHeader(string $value): string
    {
        $normalized = Str::lower(Str::ascii(trim($value)));
        $normalized = preg_replace('/[^a-z0-9]+/', ' ', $normalized) ?? $normalized;

        return trim($normalized);
    }

    private function parseInteger(mixed $value): int
    {
        $normalized = preg_replace('/[^0-9.-]/', '', (string) $value) ?? (string) $value;

        return max((int) round((float) $normalized), 0);
    }

    private function normalizeKeywordText(string $value): string
    {
        $normalized = Str::lower(Str::ascii(trim($value)));
        $normalized = preg_replace('/[^a-z0-9\s]+/', ' ', $normalized) ?? $normalized;
        $normalized = preg_replace('/\s+/u', ' ', $normalized) ?? $normalized;

        return trim($normalized);
    }

    private function extractTopicTokens(string $keyword): array
    {
        $normalized = $this->normalizeKeywordText($keyword);
        if ($normalized === '') {
            return [];
        }

        return array_values(array_filter(
            explode(' ', $normalized),
            fn ($token) => $token !== ''
                && strlen($token) > 1
                && !in_array($token, self::TOPIC_STOP_WORDS, true)
        ));
    }

    private function resolveIntentKey(string $keyword): string
    {
        $normalized = $this->normalizeKeywordText($keyword);

        return match (true) {
            $this->containsAny($normalized, ['gia', 'bao nhieu', 'bao gia']) => 'pricing',
            $this->containsAny($normalized, ['so sanh', 'phan biet', 'khac nhau']) => 'comparison',
            $this->containsAny($normalized, ['mua', 'ban', 'o dau', 'cua hang', 'shop']) => 'commercial',
            $this->containsAny($normalized, ['cach', 'huong dan', 'kinh nghiem', 'bi quyet']) => 'guide',
            $this->containsAny($normalized, ['y nghia', 'phong thuy', 'kieng ky', 'nen']) => 'advisory',
            $this->containsAny($normalized, ['la gi']) => 'informational',
            default => 'topical',
        };
    }

    private function resolveIntentGroup(string $keyword): string
    {
        return match ($this->resolveIntentKey($keyword)) {
            'pricing', 'commercial' => 'transaction',
            'comparison' => 'comparison',
            default => 'knowledge',
        };
    }

    private function areIntentGroupsCompatible(string $left, string $right): bool
    {
        if ($left === $right) {
            return true;
        }

        return in_array($left, ['knowledge', 'comparison'], true)
            && in_array($right, ['knowledge', 'comparison'], true);
    }

    private function scoreKeywordAgainstCluster(array $row, array $cluster): float
    {
        $rowTokens = $row['topic_tokens'];
        $clusterTokens = $cluster['topic_tokens'];

        if ($rowTokens === [] || $clusterTokens === []) {
            return 0;
        }

        $intersectionCount = count(array_intersect($rowTokens, $clusterTokens));
        $unionCount = count(array_unique(array_merge($rowTokens, $clusterTokens)));
        $jaccard = $unionCount > 0 ? ($intersectionCount / $unionCount) : 0;

        $rowKeyword = $row['normalized_keyword'];
        $representative = $this->normalizeKeywordText((string) ($cluster['representative_keyword'] ?? ''));
        $phraseBonus = ($representative !== '' && (str_contains($rowKeyword, $representative) || str_contains($representative, $rowKeyword)))
            ? 18
            : 0;
        $intentBonus = $row['intent_key'] === $cluster['intent_key'] ? 10 : 0;

        return ($jaccard * 60) + ($intersectionCount * 9) + $phraseBonus + $intentBonus;
    }

    private function mergeTopicTokens(array $left, array $right): array
    {
        $counts = [];

        foreach (array_merge($left, $right) as $token) {
            $counts[$token] = ($counts[$token] ?? 0) + 1;
        }

        arsort($counts);

        return array_slice(array_keys($counts), 0, 8);
    }

    private function intentLabelFromKey(string $intentKey): string
    {
        return match ($intentKey) {
            'pricing' => 'Tim gia va doi chieu',
            'comparison' => 'So sanh va phan biet',
            'commercial' => 'Can chon mua',
            'guide' => 'Huong dan va kinh nghiem',
            'advisory' => 'Phong thuy va goi y',
            'informational' => 'Thong tin can biet',
            default => 'Chu de tong hop',
        };
    }

    private function buildTopicLabel(array $keywords, array $topicTokens): string
    {
        if ($topicTokens !== []) {
            return Str::of(implode(' ', array_slice($topicTokens, 0, 4)))
                ->headline()
                ->value();
        }

        return Str::headline((string) ($keywords[0]['keyword'] ?? 'Gom Bat Trang'));
    }

    private function tokenOverlapScore(array $tokens, string $haystack): int
    {
        if ($tokens === [] || trim($haystack) === '') {
            return 0;
        }

        $score = 0;
        foreach ($tokens as $token) {
            if (in_array($token, ['gom', 'su', 'bat', 'trang'], true)) {
                continue;
            }

            if (str_contains($haystack, $token)) {
                $score += strlen($token) >= 5 ? 18 : 12;
            }
        }

        return $score;
    }

    private function categorySignature(string $name): string
    {
        $tokens = $this->extractTopicTokens($name);
        if ($tokens === []) {
            return Str::lower(Str::slug($name));
        }

        sort($tokens);

        return implode('|', $tokens);
    }

    private function buildUniqueCategorySlug(int $accountId, string $source): string
    {
        $baseSlug = Str::slug($source) ?: 'blog-category';
        $slug = $baseSlug;
        $suffix = 2;

        while (BlogCategory::query()
            ->where('account_id', $accountId)
            ->where('slug', $slug)
            ->exists()
        ) {
            $slug = $baseSlug . '-' . $suffix;
            $suffix++;
        }

        return $slug;
    }

    private function buildUniquePostSlug(int $accountId, string $source): string
    {
        $baseSlug = Str::slug($source) ?: 'blog-ai-post';
        $slug = $baseSlug;
        $suffix = 2;

        while (Post::query()
            ->where('account_id', $accountId)
            ->where('slug', $slug)
            ->exists()
        ) {
            $slug = $baseSlug . '-' . $suffix;
            $suffix++;
        }

        return $slug;
    }

    private function nextCategorySortOrder(int $accountId): int
    {
        if (!isset($this->nextCategorySortOrderCache[$accountId])) {
            $this->nextCategorySortOrderCache[$accountId] = (int) BlogCategory::query()
                ->where('account_id', $accountId)
                ->max('sort_order') + 1;
        }

        return $this->nextCategorySortOrderCache[$accountId]++;
    }

    private function nextPostSortOrder(int $accountId): int
    {
        if (!isset($this->nextPostSortOrderCache[$accountId])) {
            $this->nextPostSortOrderCache[$accountId] = (int) Post::query()
                ->where('account_id', $accountId)
                ->max('sort_order') + 1;
        }

        return $this->nextPostSortOrderCache[$accountId]++;
    }

    private function resolveIndustryContext(array $cluster): string
    {
        $haystack = Str::lower(Str::ascii(
            $cluster['primary_keyword'] . ' ' . implode(' ', $cluster['secondary_keywords']) . ' ' . $cluster['topic_label']
        ));

        if ($this->containsAny($haystack, ['do tho', 'tho cung', 'bat huong', 'lu huong'])) {
            return 'Uu tien boi canh do tho Bat Trang, tinh trang nghiem, cach sap dat va su dong bo tren ban tho.';
        }

        if ($this->containsAny($haystack, ['qua tang', 'doanh nghiep', 'in logo', 'qua bieu'])) {
            return 'Uu tien boi canh qua tang gom su, doi tuong nhan qua, thong diep trao tang va muc do dong bo bo qua.';
        }

        return 'Uu tien boi canh gom su Bat Trang, cach chon theo khong gian, cong nang, hoa tiet va tinh ung dung thuc te.';
    }

    private function truncateForSvg(string $value, int $limit): string
    {
        return Str::limit($value, $limit, '...');
    }

    private function escapeForSvg(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_XML1 | ENT_SUBSTITUTE, 'UTF-8');
    }

    private function containsAny(string $haystack, array $needles): bool
    {
        foreach ($needles as $needle) {
            if ($needle !== '' && str_contains($haystack, $needle)) {
                return true;
            }
        }

        return false;
    }

    private function cleanText(mixed $value): string
    {
        $normalized = html_entity_decode(strip_tags((string) $value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $normalized = preg_replace('/\s+/u', ' ', $normalized) ?? $normalized;

        return trim($normalized);
    }

    private function appendLog(
        BlogAiBulkJob $job,
        string $level,
        string $step,
        string $message,
        array $context = []
    ): void {
        BlogAiBulkJobLog::query()->create([
            'blog_ai_bulk_job_id' => $job->id,
            'level' => $level,
            'step' => $step,
            'message' => $message,
            'context' => $context !== [] ? $context : null,
        ]);
    }
}
