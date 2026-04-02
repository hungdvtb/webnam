<?php

namespace App\Services;

use App\Models\BlogCategory;
use App\Models\Post;
use App\Models\PostSeoKeyword;
use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Throwable;

class BlogExcelService
{
    private const HEADERS = [
        'post_key',
        'title',
        'slug',
        'excerpt',
        'content_html',
        'category_slug',
        'category_name',
        'seo_keyword',
        'visibility_status',
        'is_published',
        'is_starred',
        'post_type',
        'is_system',
        'published_at',
        'created_at',
        'updated_at',
        'sort_order',
        'featured_image_url',
        'content_image_urls',
        'content_link_urls',
    ];

    public function __construct(
        private readonly SimpleXlsxService $xlsx
    ) {
    }

    /**
     * @param  array<int, Post>  $posts
     * @return array{path: string, filename: string}
     */
    public function export(int $accountId, array $posts): array
    {
        if (empty($posts)) {
            throw ValidationException::withMessages([
                'excel' => ['Khong co bai viet nao de export.'],
            ]);
        }

        $rows = [];

        foreach (array_values($posts) as $index => $post) {
            $contentHtml = $this->prepareContentHtmlForExcel((string) ($post->content ?? ''));
            $references = $this->extractContentReferences($contentHtml);

            $rows[] = [
                'post_key' => $this->buildPostKey($index + 1, (string) ($post->slug ?: $post->title)),
                'title' => (string) ($post->title ?? ''),
                'slug' => (string) ($post->slug ?? ''),
                'excerpt' => (string) ($post->excerpt ?? ''),
                'content_html' => $contentHtml,
                'category_slug' => (string) ($post->category->slug ?? ''),
                'category_name' => (string) ($post->category->name ?? ''),
                'seo_keyword' => (string) ($post->seo_keyword ?? ''),
                'visibility_status' => $post->is_published ? 'published' : 'draft',
                'is_published' => $post->is_published ? '1' : '0',
                'is_starred' => $post->is_starred ? '1' : '0',
                'post_type' => $post->is_system ? 'system' : 'regular',
                'is_system' => $post->is_system ? '1' : '0',
                'published_at' => $post->published_at?->toAtomString() ?? '',
                'created_at' => $post->created_at?->toAtomString() ?? '',
                'updated_at' => $post->updated_at?->toAtomString() ?? '',
                'sort_order' => (string) ((int) ($post->sort_order ?? 0)),
                'featured_image_url' => $this->normalizeOnlineUrl((string) ($post->featured_image ?? '')),
                'content_image_urls' => implode("\n", $references['image_urls']),
                'content_link_urls' => implode("\n", $references['link_urls']),
            ];
        }

        $tmpDir = storage_path('app/tmp');
        if (!is_dir($tmpDir) && !mkdir($tmpDir, 0755, true) && !is_dir($tmpDir)) {
            throw new RuntimeException('Khong the tao thu muc tam.');
        }

        $filename = $this->buildFilename($posts);
        $path = $tmpDir . DIRECTORY_SEPARATOR . $filename;

        $this->xlsx->write($path, self::HEADERS, $rows, 'Blog Posts');

        return ['path' => $path, 'filename' => $filename];
    }

    /**
     * @return array{total_rows: int, created: int, updated: int, categories_created: int, errors: list<string>}
     */
    public function import(int $accountId, UploadedFile $file): array
    {
        $tmpDir = storage_path('app/tmp');
        if (!is_dir($tmpDir) && !mkdir($tmpDir, 0755, true) && !is_dir($tmpDir)) {
            throw new RuntimeException('Khong the tao thu muc tam.');
        }

        $tmpPath = $tmpDir . DIRECTORY_SEPARATOR . 'blog-import-' . Str::lower(Str::random(12)) . '.xlsx';
        copy($file->getRealPath(), $tmpPath);

        try {
            $workbook = $this->xlsx->read($tmpPath);
        } finally {
            @unlink($tmpPath);
        }

        $headerMap = $this->buildHeaderMap($workbook['headers'] ?? []);
        $rows = $workbook['rows'] ?? [];

        $this->validateHeaders($headerMap);

        if (empty($rows)) {
            throw ValidationException::withMessages([
                'excel' => ['File Excel khong co dong du lieu nao de import.'],
            ]);
        }

        $errors = [];
        $preparedRows = [];
        $slugSeen = [];
        $categoryDefs = [];
        $now = now();

        foreach ($rows as $index => $row) {
            $lineNumber = $index + 2;
            $title = trim($this->readCell($row, $headerMap, 'title'));
            $slug = trim($this->readCell($row, $headerMap, 'slug'));
            $excerpt = (string) $this->readCell($row, $headerMap, 'excerpt');
            $contentHtml = $this->normalizeImportedContentHtml((string) $this->readCell($row, $headerMap, 'content_html'));
            $categorySlug = trim($this->readCell($row, $headerMap, 'category_slug'));
            $categoryName = trim($this->readCell($row, $headerMap, 'category_name'));
            $seoKeyword = trim($this->readCell($row, $headerMap, 'seo_keyword'));
            $visibilityStatus = Str::lower(trim($this->readCell($row, $headerMap, 'visibility_status', 'status')));
            $postType = Str::lower(trim($this->readCell($row, $headerMap, 'post_type')));
            $isPublished = $this->parseBoolean($this->readCell($row, $headerMap, 'is_published'), false);
            $isStarred = $this->parseBoolean($this->readCell($row, $headerMap, 'is_starred'), false);
            $isSystem = $this->parsePostType($postType, $this->readCell($row, $headerMap, 'is_system'));
            $publishedAt = $this->parseDate($this->readCell($row, $headerMap, 'published_at'));
            $createdAt = $this->parseDate($this->readCell($row, $headerMap, 'created_at')) ?? $now->copy();
            $updatedAt = $this->parseDate($this->readCell($row, $headerMap, 'updated_at')) ?? $now->copy();
            $sortOrder = max((int) $this->readCell($row, $headerMap, 'sort_order'), 0);
            $featuredImage = trim($this->readCell($row, $headerMap, 'featured_image_url'));

            if ($visibilityStatus !== '') {
                $isPublished = $this->parseVisibilityStatus($visibilityStatus, $isPublished);
            }

            if ($categoryName !== '' && $categorySlug === '') {
                $categorySlug = Str::slug($categoryName);
            }

            if ($categorySlug !== '' && $categoryName === '') {
                $categoryName = Str::of(str_replace(['-', '_'], ' ', $categorySlug))
                    ->headline()
                    ->value();
            }

            if ($title === '') {
                $errors[] = "Dong {$lineNumber}: thieu cot title.";
            }

            if ($slug === '') {
                $errors[] = "Dong {$lineNumber}: thieu slug.";
            } elseif (isset($slugSeen[$slug])) {
                $errors[] = "Dong {$lineNumber}: slug \"{$slug}\" bi trung voi dong {$slugSeen[$slug]}.";
            } else {
                $slugSeen[$slug] = $lineNumber;
            }

            if ($categorySlug !== '' && $categoryName === '') {
                $errors[] = "Dong {$lineNumber}: danh muc co slug nhung thieu ten.";
            }

            if ($categorySlug === '' && $categoryName !== '') {
                $errors[] = "Dong {$lineNumber}: ten danh muc khong tao duoc slug hop le.";
            }

            if ($categorySlug !== '' && $categoryName !== '') {
                if (!isset($categoryDefs[$categorySlug])) {
                    $categoryDefs[$categorySlug] = ['name' => $categoryName];
                } elseif ($categoryDefs[$categorySlug]['name'] !== $categoryName) {
                    $errors[] = "Dong {$lineNumber}: category_slug \"{$categorySlug}\" co category_name khong nhat quan.";
                }
            }

            $preparedRows[] = [
                'line' => $lineNumber,
                'title' => $title,
                'slug' => $slug,
                'excerpt' => $excerpt,
                'content_html' => $contentHtml,
                'category_slug' => $categorySlug,
                'category_name' => $categoryName,
                'seo_keyword' => $seoKeyword,
                'is_published' => $isPublished,
                'is_starred' => $isStarred,
                'is_system' => $isSystem,
                'published_at' => $publishedAt,
                'created_at' => $createdAt,
                'updated_at' => $updatedAt,
                'sort_order' => $sortOrder,
                'featured_image' => $featuredImage !== '' ? $this->normalizeOnlineUrl($featuredImage) : null,
                'existing_post' => null,
            ];
        }

        if (!empty($errors)) {
            throw ValidationException::withMessages(['excel' => $errors]);
        }

        $slugs = array_values(array_filter(array_map(
            static fn (array $row) => (string) ($row['slug'] ?? ''),
            $preparedRows
        )));

        if (!empty($slugs)) {
            $existingPosts = Post::withTrashed()
                ->where('account_id', $accountId)
                ->whereIn('slug', $slugs)
                ->get()
                ->keyBy('slug');

            foreach ($preparedRows as &$row) {
                $existingPost = $existingPosts->get($row['slug']);

                if (!$existingPost instanceof Post) {
                    continue;
                }

                if ((bool) $existingPost->is_system !== (bool) $row['is_system']) {
                    $errors[] = sprintf(
                        'Dong %d: slug "%s" dang ton tai nhung khac loai bai viet (system/regular).',
                        $row['line'],
                        $row['slug']
                    );
                    continue;
                }

                $row['existing_post'] = $existingPost;
            }
            unset($row);
        }

        if (!empty($errors)) {
            throw ValidationException::withMessages(['excel' => $errors]);
        }

        return DB::transaction(function () use ($accountId, $preparedRows, $categoryDefs): array {
            $categorySync = $this->syncCategories($accountId, $categoryDefs);
            $created = 0;
            $updated = 0;
            $importedKeywords = [];

            foreach ($preparedRows as $row) {
                $post = $row['existing_post'];
                $isExisting = $post instanceof Post;

                if (!$isExisting) {
                    $post = new Post();
                    $post->account_id = $accountId;
                    $created++;
                } else {
                    $updated++;
                    if (method_exists($post, 'trashed') && $post->trashed()) {
                        $post->restore();
                    }
                }

                $post->timestamps = false;
                $post->account_id = $accountId;
                $post->title = $row['title'];
                $post->slug = $row['slug'];
                $post->excerpt = $row['excerpt'];
                $post->content = $row['content_html'];
                $post->featured_image = $row['featured_image'];
                $post->seo_keyword = $row['seo_keyword'] !== '' ? $row['seo_keyword'] : null;
                $post->blog_category_id = $row['category_slug'] !== ''
                    ? ($categorySync['ids'][$row['category_slug']] ?? null)
                    : null;
                $post->is_published = $row['is_published'];
                $post->is_starred = $row['is_starred'];
                $post->is_system = $row['is_system'];
                $post->sort_order = $row['sort_order'];
                $post->published_at = $row['published_at'];
                $post->created_at = $row['created_at'];
                $post->updated_at = $row['updated_at'];
                $post->save();

                if ($row['seo_keyword'] !== '') {
                    $importedKeywords[] = $row['seo_keyword'];
                }
            }

            $this->syncSeoKeywords($accountId, $importedKeywords);

            return [
                'total_rows' => count($preparedRows),
                'created' => $created,
                'updated' => $updated,
                'categories_created' => $categorySync['created'],
                'errors' => [],
            ];
        });
    }

    /**
     * @param  array<string, string>  $headerMap
     */
    private function validateHeaders(array $headerMap): void
    {
        $missing = [];

        foreach (['title', 'slug', 'content_html'] as $requiredHeader) {
            if (!isset($headerMap[$requiredHeader])) {
                $missing[] = $requiredHeader;
            }
        }

        if (!empty($missing)) {
            throw ValidationException::withMessages([
                'excel' => ['File Excel thieu cac cot bat buoc: ' . implode(', ', $missing)],
            ]);
        }
    }

    /**
     * @param  array<string, array{name: string}>  $defs
     * @return array{ids: array<string, int>, created: int}
     */
    private function syncCategories(int $accountId, array $defs): array
    {
        if (empty($defs)) {
            return ['ids' => [], 'created' => 0];
        }

        $existingCategories = BlogCategory::where('account_id', $accountId)
            ->whereIn('slug', array_keys($defs))
            ->get(['id', 'slug']);

        $idBySlug = $existingCategories
            ->mapWithKeys(fn (BlogCategory $category) => [(string) $category->slug => (int) $category->id])
            ->all();

        $created = 0;
        $nextSortOrder = (int) BlogCategory::where('account_id', $accountId)->max('sort_order');

        foreach ($defs as $slug => $def) {
            if (isset($idBySlug[$slug])) {
                BlogCategory::where('account_id', $accountId)
                    ->whereKey($idBySlug[$slug])
                    ->update(['name' => $def['name']]);
                continue;
            }

            $nextSortOrder++;
            $category = BlogCategory::create([
                'account_id' => $accountId,
                'name' => $def['name'],
                'slug' => $slug,
                'sort_order' => $nextSortOrder,
            ]);

            $idBySlug[$slug] = (int) $category->id;
            $created++;
        }

        return ['ids' => $idBySlug, 'created' => $created];
    }

    /**
     * @param  array<int, string>  $keywords
     */
    private function syncSeoKeywords(int $accountId, array $keywords): void
    {
        if (!Schema::hasTable('post_seo_keywords')) {
            return;
        }

        $uniqueKeywords = array_values(array_unique(array_filter(array_map(
            static fn ($keyword) => trim((string) $keyword),
            $keywords
        ))));

        foreach ($uniqueKeywords as $keyword) {
            PostSeoKeyword::firstOrCreate([
                'account_id' => $accountId,
                'keyword' => $keyword,
            ]);
        }
    }

    /**
     * @param  array<string, mixed>  $row
     * @param  array<string, string>  $headerMap
     */
    private function readCell(array $row, array $headerMap, string ...$candidates): string
    {
        foreach ($candidates as $candidate) {
            $resolvedHeader = $headerMap[Str::lower(trim($candidate))] ?? null;

            if ($resolvedHeader !== null) {
                return (string) ($row[$resolvedHeader] ?? '');
            }
        }

        return '';
    }

    /**
     * @param  array<int, string>  $headers
     * @return array<string, string>
     */
    private function buildHeaderMap(array $headers): array
    {
        $map = [];

        foreach ($headers as $header) {
            $normalizedHeader = Str::lower(trim((string) $header));

            if ($normalizedHeader === '') {
                continue;
            }

            $map[$normalizedHeader] = (string) $header;
        }

        return $map;
    }

    private function parseVisibilityStatus(string $value, bool $default = false): bool
    {
        if ($value === '') {
            return $default;
        }

        return in_array($value, ['published', 'publish', 'visible', 'show', 'active', '1', 'true'], true);
    }

    private function parsePostType(string $value, mixed $fallback): bool
    {
        if ($value === '') {
            return $this->parseBoolean($fallback, false);
        }

        return in_array($value, ['system', 'system_post', 'system-post', 'he-thong'], true);
    }

    private function parseBoolean(mixed $value, bool $default = false): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        $normalizedValue = Str::lower(trim((string) $value));

        if ($normalizedValue === '') {
            return $default;
        }

        return in_array($normalizedValue, ['1', 'true', 'yes', 'y', 'on', 'co'], true);
    }

    private function parseDate(mixed $value): ?Carbon
    {
        $normalizedValue = trim((string) $value);

        if ($normalizedValue === '') {
            return null;
        }

        if (is_numeric($normalizedValue)) {
            $serial = (float) $normalizedValue;
            if ($serial > 0) {
                return Carbon::createFromTimestampUTC((int) round(($serial - 25569) * 86400));
            }
        }

        try {
            return Carbon::parse($normalizedValue);
        } catch (Throwable) {
            return null;
        }
    }

    private function normalizeImportedContentHtml(string $content): string
    {
        if (trim($content) === '') {
            return '';
        }

        return BlogMediaGallerySupport::normalizeHtml(
            $this->prepareContentHtmlForExcel($content)
        );
    }

    private function prepareContentHtmlForExcel(string $content): string
    {
        if (trim($content) === '') {
            return '';
        }

        $rewrittenContent = BlogMediaGallerySupport::rewriteAssetReferences(
            $content,
            fn (string $reference) => $this->normalizeOnlineUrl($reference)
        );

        return $this->transformHtml($rewrittenContent, function (DOMXPath $xpath): void {
            foreach ($xpath->query('//a[@href]') ?: [] as $node) {
                if (!$node instanceof DOMElement) {
                    continue;
                }

                $href = trim($node->getAttribute('href'));
                if ($href === '') {
                    continue;
                }

                $node->setAttribute('href', $this->normalizeOnlineUrl($href));
            }
        });
    }

    /**
     * @return array{image_urls: list<string>, link_urls: list<string>}
     */
    private function extractContentReferences(string $content): array
    {
        if (trim($content) === '') {
            return ['image_urls' => [], 'link_urls' => []];
        }

        $imageUrls = [];
        $linkUrls = [];

        $this->transformHtml($content, function (DOMXPath $xpath) use (&$imageUrls, &$linkUrls): void {
            foreach ($xpath->query(sprintf(
                '//*[contains(concat(" ", normalize-space(@class), " "), " %s ")]',
                BlogMediaGallerySupport::MEDIA_GALLERY_BLOCK_CLASS
            )) ?: [] as $node) {
                if (!$node instanceof DOMElement) {
                    continue;
                }

                $payload = $node->getAttribute(BlogMediaGallerySupport::MEDIA_GALLERY_PAYLOAD_ATTRIBUTE);
                foreach (BlogMediaGallerySupport::decodeMediaGalleryPayload($payload) as $item) {
                    $type = trim((string) ($item['type'] ?? 'image'));

                    if ($type === 'video') {
                        $linkUrls[] = $this->normalizeOnlineUrl((string) ($item['url'] ?? ''));
                        continue;
                    }

                    $imageUrls[] = $this->normalizeOnlineUrl((string) ($item['src'] ?? ''));
                }
            }

            foreach ($xpath->query('//img[@src] | //source[@src] | //video[@poster]') ?: [] as $node) {
                if (!$node instanceof DOMElement) {
                    continue;
                }

                foreach (['src', 'poster'] as $attribute) {
                    if ($node->hasAttribute($attribute)) {
                        $imageUrls[] = $this->normalizeOnlineUrl($node->getAttribute($attribute));
                    }
                }
            }

            foreach ($xpath->query('//img[@srcset] | //source[@srcset]') ?: [] as $node) {
                if (!$node instanceof DOMElement) {
                    continue;
                }

                foreach ($this->parseSrcSetUrls($node->getAttribute('srcset')) as $srcsetUrl) {
                    $imageUrls[] = $this->normalizeOnlineUrl($srcsetUrl);
                }
            }

            foreach ($xpath->query('//*[@style]') ?: [] as $node) {
                if (!$node instanceof DOMElement) {
                    continue;
                }

                foreach ($this->parseStyleUrls($node->getAttribute('style')) as $styleUrl) {
                    $imageUrls[] = $this->normalizeOnlineUrl($styleUrl);
                }
            }

            foreach ($xpath->query('//a[@href]') ?: [] as $node) {
                if (!$node instanceof DOMElement) {
                    continue;
                }

                $linkUrls[] = $this->normalizeOnlineUrl($node->getAttribute('href'));
            }
        });

        return [
            'image_urls' => $this->uniqueUrls($imageUrls),
            'link_urls' => $this->uniqueUrls($linkUrls),
        ];
    }

    /**
     * @param  list<string>  $urls
     * @return list<string>
     */
    private function uniqueUrls(array $urls): array
    {
        $filtered = array_values(array_filter(array_map(function (string $url): string {
            $normalizedUrl = trim($url);

            if ($normalizedUrl === '' || $normalizedUrl === '#') {
                return '';
            }

            return $normalizedUrl;
        }, $urls)));

        return array_values(array_unique($filtered));
    }

    /**
     * @return list<string>
     */
    private function parseSrcSetUrls(string $srcset): array
    {
        if (trim($srcset) === '') {
            return [];
        }

        $urls = [];

        foreach (explode(',', $srcset) as $part) {
            $segments = preg_split('/\s+/', trim($part), 2);
            $url = trim((string) ($segments[0] ?? ''));

            if ($url !== '') {
                $urls[] = $url;
            }
        }

        return $urls;
    }

    /**
     * @return list<string>
     */
    private function parseStyleUrls(string $style): array
    {
        if (trim($style) === '') {
            return [];
        }

        preg_match_all('/url\((["\']?)(.*?)\1\)/i', $style, $matches);

        return array_values(array_filter(array_map(
            static fn ($value) => trim((string) $value),
            $matches[2] ?? []
        )));
    }

    private function normalizeOnlineUrl(string $value): string
    {
        $normalizedValue = trim(html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8'));

        if ($normalizedValue === '') {
            return '';
        }

        if (Str::startsWith($normalizedValue, ['data:', 'mailto:', 'tel:', 'javascript:', '#'])) {
            return $normalizedValue;
        }

        if (Str::startsWith($normalizedValue, '//')) {
            $scheme = request()?->getScheme() ?: (parse_url((string) config('app.url'), PHP_URL_SCHEME) ?: 'https');
            return $scheme . ':' . $normalizedValue;
        }

        if (preg_match('/^[a-z][a-z0-9+.-]*:/i', $normalizedValue) === 1) {
            return $normalizedValue;
        }

        if (Str::startsWith($normalizedValue, '/')) {
            return url($normalizedValue);
        }

        return url('/' . ltrim($normalizedValue, '/'));
    }

    private function transformHtml(string $content, callable $transformer): string
    {
        $wrappedHtml = sprintf('<div id="__blog_excel_root__">%s</div>', $content);
        $dom = new DOMDocument('1.0', 'UTF-8');
        $options = (defined('LIBXML_HTML_NOIMPLIED') ? LIBXML_HTML_NOIMPLIED : 0)
            | (defined('LIBXML_HTML_NODEFDTD') ? LIBXML_HTML_NODEFDTD : 0)
            | LIBXML_NOERROR
            | LIBXML_NOWARNING;

        $previousState = libxml_use_internal_errors(true);

        try {
            $dom->loadHTML(
                '<?xml encoding="utf-8" ?>' . mb_convert_encoding($wrappedHtml, 'HTML-ENTITIES', 'UTF-8'),
                $options
            );
        } catch (Throwable) {
            libxml_clear_errors();
            libxml_use_internal_errors($previousState);

            return $content;
        }

        $xpath = new DOMXPath($dom);
        $transformer($xpath);

        $rootNode = $xpath->query('//*[@id="__blog_excel_root__"]')->item(0);
        $result = $rootNode instanceof DOMNode ? $this->extractInnerHtml($rootNode) : $content;

        libxml_clear_errors();
        libxml_use_internal_errors($previousState);

        return $result;
    }

    private function extractInnerHtml(DOMNode $node): string
    {
        $innerHtml = '';

        foreach ($node->childNodes as $childNode) {
            $innerHtml .= $node->ownerDocument?->saveHTML($childNode) ?? '';
        }

        return $innerHtml;
    }

    private function buildPostKey(int $position, string $slugOrTitle): string
    {
        $base = Str::slug($slugOrTitle) ?: 'post';

        return sprintf('post-%04d-%s', $position, Str::limit($base, 60, ''));
    }

    /**
     * @param  array<int, Post>  $posts
     */
    private function buildFilename(array $posts): string
    {
        $suffix = now()->format('Ymd-His');

        if (count($posts) === 1) {
            $post = reset($posts);
            $slug = Str::slug((string) ($post?->slug ?: $post?->title ?: 'post')) ?: 'post';

            return "blog-export-{$slug}-{$suffix}.xlsx";
        }

        return 'blog-export-' . count($posts) . "-posts-{$suffix}.xlsx";
    }
}
