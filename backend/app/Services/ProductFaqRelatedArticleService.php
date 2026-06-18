<?php

namespace App\Services;

use App\Models\Account;
use App\Models\Post;
use App\Models\ProductFaq;
use App\Models\ProductFaqRelatedArticle;
use App\Models\SiteDomain;
use App\Support\PublicSiteUrlResolver;
use DOMDocument;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Throwable;

class ProductFaqRelatedArticleService
{
    public function __construct(
        protected PublicSiteUrlResolver $urlResolver
    ) {
    }

    public function sync(ProductFaq $faq, array $entries): void
    {
        if (!$this->tableExists()) {
            return;
        }

        $rows = collect($entries)
            ->take(50)
            ->map(fn ($entry) => is_array($entry) ? $entry : [])
            ->map(fn (array $entry) => $this->resolveEntryForStorage($entry, (int) $faq->account_id))
            ->filter()
            ->unique(fn (array $entry) => $entry['post_id']
                ? 'post:' . $entry['post_id']
                : 'url:' . Str::lower($entry['url']))
            ->values()
            ->map(function (array $row, int $index) use ($faq) {
                return [
                    ...$row,
                    'account_id' => $faq->account_id,
                    'product_faq_id' => $faq->id,
                    'sort_order' => $index + 1,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            });

        $currentRows = $faq->relatedArticles()
            ->get(['post_id', 'source', 'url', 'title', 'excerpt', 'image_url', 'sort_order'])
            ->map(fn (ProductFaqRelatedArticle $article) => $this->comparableRow([
                'post_id' => $article->post_id,
                'source' => $article->source,
                'url' => $article->url,
                'title' => $article->title,
                'excerpt' => $article->excerpt,
                'image_url' => $article->image_url,
                'sort_order' => (int) $article->sort_order,
            ]))
            ->values()
            ->all();
        $nextRows = $rows
            ->map(fn (array $row) => $this->comparableRow($row))
            ->values()
            ->all();

        if ($currentRows === $nextRows) {
            return;
        }

        $faq->relatedArticles()->delete();

        if ($rows->isNotEmpty()) {
            ProductFaqRelatedArticle::query()->insert($rows->all());
        }
    }

    public function publicPayload(ProductFaq $faq): array
    {
        return $this->payload($faq, false);
    }

    public function adminPayload(ProductFaq $faq): array
    {
        return $this->payload($faq, true);
    }

    public function previewManualUrl(int $accountId, string $url): array
    {
        $normalizedUrl = $this->normalizeWebsiteUrl($url, $accountId);
        $post = $this->resolvePostFromUrl($normalizedUrl, $accountId);

        if ($post) {
            if (!$this->isPublicPost($post)) {
                throw ValidationException::withMessages([
                    'url' => ['Bài viết này chưa được xuất bản hoặc đã bị ẩn.'],
                ]);
            }

            return [
                ...$this->postPayload($post),
                'source' => ProductFaqRelatedArticle::SOURCE_MANUAL,
                'available' => true,
            ];
        }

        try {
            $response = Http::accept('text/html,application/xhtml+xml')
                ->connectTimeout(3)
                ->timeout(6)
                ->get($normalizedUrl);
        } catch (Throwable) {
            throw ValidationException::withMessages([
                'url' => ['Không thể truy cập link này để kiểm tra.'],
            ]);
        }

        if (!$response->successful()) {
            throw ValidationException::withMessages([
                'url' => ['Link không tồn tại hoặc website trả về lỗi.'],
            ]);
        }

        $metadata = $this->extractHtmlMetadata((string) $response->body(), $normalizedUrl);

        return [
            'source' => ProductFaqRelatedArticle::SOURCE_MANUAL,
            'post_id' => null,
            'title' => $metadata['title'] ?: $this->fallbackTitleFromUrl($normalizedUrl),
            'excerpt' => $metadata['excerpt'],
            'image' => $metadata['image'],
            'url' => $normalizedUrl,
            'available' => true,
        ];
    }

    public function tableExists(): bool
    {
        return Schema::hasTable('product_faq_related_articles');
    }

    private function payload(ProductFaq $faq, bool $admin): array
    {
        if (!$this->tableExists()) {
            return [];
        }

        $articles = $faq->relationLoaded('relatedArticles')
            ? $faq->relatedArticles
            : $faq->relatedArticles()->with('post.featuredMediaAsset')->get();

        return $articles
            ->sortBy(fn (ProductFaqRelatedArticle $article) => [
                (int) $article->sort_order,
                (int) $article->id,
            ])
            ->map(function (ProductFaqRelatedArticle $article) use ($admin) {
                $post = $article->relationLoaded('post')
                    ? $article->post
                    : $article->post()->with('featuredMediaAsset')->first();

                if ($article->post_id) {
                    if (!$post) {
                        return $admin ? $this->storedPayload($article, false) : null;
                    }

                    if (!$admin && !$this->isPublicPost($post)) {
                        return null;
                    }

                    return [
                        ...$this->postPayload($post),
                        'id' => (int) $article->id,
                        'source' => $article->source,
                        'sort_order' => (int) $article->sort_order,
                        'available' => $this->isPublicPost($post),
                    ];
                }

                if ($article->source === ProductFaqRelatedArticle::SOURCE_POST) {
                    return $admin ? $this->storedPayload($article, false) : null;
                }

                return $this->storedPayload($article, true);
            })
            ->filter()
            ->values()
            ->all();
    }

    private function resolveEntryForStorage(array $entry, int $accountId): ?array
    {
        $source = ($entry['source'] ?? null) === ProductFaqRelatedArticle::SOURCE_MANUAL
            ? ProductFaqRelatedArticle::SOURCE_MANUAL
            : ProductFaqRelatedArticle::SOURCE_POST;
        $postId = is_numeric($entry['post_id'] ?? null) ? (int) $entry['post_id'] : null;

        if ($postId) {
            $post = Post::query()
                ->with('featuredMediaAsset')
                ->where('account_id', $accountId)
                ->find($postId);

            if (!$post) {
                return null;
            }

            $payload = $this->postPayload($post);

            return [
                'post_id' => $post->id,
                'source' => $source,
                'url' => $payload['url'],
                'title' => $payload['title'],
                'excerpt' => $payload['excerpt'],
                'image_url' => $post->featured_image,
            ];
        }

        if ($source !== ProductFaqRelatedArticle::SOURCE_MANUAL) {
            return null;
        }

        $url = $this->normalizeWebsiteUrl((string) ($entry['url'] ?? ''), $accountId);
        $post = $this->resolvePostFromUrl($url, $accountId);

        if ($post) {
            $payload = $this->postPayload($post);

            return [
                'post_id' => $post->id,
                'source' => $source,
                'url' => $payload['url'],
                'title' => $payload['title'],
                'excerpt' => $payload['excerpt'],
                'image_url' => $post->featured_image,
            ];
        }

        return [
            'post_id' => null,
            'source' => $source,
            'url' => $url,
            'title' => $this->cleanText($entry['title'] ?? null, 255)
                ?: $this->fallbackTitleFromUrl($url),
            'excerpt' => $this->cleanText($entry['excerpt'] ?? null, 1000),
            'image_url' => $this->normalizeOptionalImageUrl($entry['image'] ?? $entry['image_url'] ?? null, $url),
        ];
    }

    private function comparableRow(array $row): array
    {
        return [
            'post_id' => isset($row['post_id']) ? (int) $row['post_id'] : null,
            'source' => (string) ($row['source'] ?? ProductFaqRelatedArticle::SOURCE_POST),
            'url' => (string) ($row['url'] ?? ''),
            'title' => (string) ($row['title'] ?? ''),
            'excerpt' => (string) ($row['excerpt'] ?? ''),
            'image_url' => (string) ($row['image_url'] ?? ''),
            'sort_order' => (int) ($row['sort_order'] ?? 0),
        ];
    }

    private function postPayload(Post $post): array
    {
        if (!$post->relationLoaded('featuredMediaAsset')) {
            $post->load('featuredMediaAsset');
        }

        return [
            'post_id' => (int) $post->id,
            'title' => $post->title,
            'excerpt' => $this->cleanText($post->excerpt, 1000),
            'image' => $post->featured_image_media ?: $post->featured_image,
            'url' => $this->urlResolver->buildBlogUrl($post->slug, (int) $post->account_id),
        ];
    }

    private function storedPayload(ProductFaqRelatedArticle $article, bool $available): array
    {
        return [
            'id' => (int) $article->id,
            'source' => $article->source,
            'post_id' => $article->post_id ? (int) $article->post_id : null,
            'title' => $article->title ?: $this->fallbackTitleFromUrl((string) $article->url),
            'excerpt' => $article->excerpt,
            'image' => $article->image_url,
            'url' => $article->url,
            'sort_order' => (int) $article->sort_order,
            'available' => $available,
        ];
    }

    private function isPublicPost(Post $post): bool
    {
        return (bool) $post->is_published
            && (!$post->published_at || $post->published_at->lte(now()))
            && !$post->trashed()
            && !(bool) $post->is_system;
    }

    private function resolvePostFromUrl(string $url, int $accountId): ?Post
    {
        $path = rawurldecode((string) parse_url($url, PHP_URL_PATH));

        if (!preg_match('#/blog/([^/]+)/?$#i', $path, $matches)) {
            return null;
        }

        $slugOrId = trim($matches[1]);

        return Post::query()
            ->with('featuredMediaAsset')
            ->where('account_id', $accountId)
            ->where(function ($query) use ($slugOrId) {
                $query->where('slug', $slugOrId);
                if (ctype_digit($slugOrId)) {
                    $query->orWhereKey((int) $slugOrId);
                }
            })
            ->first();
    }

    private function normalizeWebsiteUrl(string $value, int $accountId): string
    {
        $value = trim($value);
        if ($value === '') {
            throw ValidationException::withMessages([
                'url' => ['Nhập link bài viết cần gắn.'],
            ]);
        }

        if (str_starts_with($value, '/')) {
            $baseUrl = $this->urlResolver->resolveBaseUrl($accountId);
            if (!$baseUrl) {
                throw ValidationException::withMessages([
                    'url' => ['Chưa cấu hình domain website để kiểm tra link tương đối.'],
                ]);
            }
            $value = rtrim($baseUrl, '/') . '/' . ltrim($value, '/');
        }

        if (!filter_var($value, FILTER_VALIDATE_URL)) {
            throw ValidationException::withMessages([
                'url' => ['Link không đúng định dạng URL.'],
            ]);
        }

        $parts = parse_url($value);
        $scheme = Str::lower((string) ($parts['scheme'] ?? ''));
        $host = $this->normalizeHost((string) ($parts['host'] ?? ''));

        if (!in_array($scheme, ['http', 'https'], true) || $host === '') {
            throw ValidationException::withMessages([
                'url' => ['Link phải sử dụng HTTP hoặc HTTPS.'],
            ]);
        }

        if (!in_array($host, $this->allowedHosts($accountId), true)) {
            throw ValidationException::withMessages([
                'url' => ['Chỉ được gắn link thuộc website hiện tại.'],
            ]);
        }

        $fragmentless = preg_replace('/#.*$/', '', $value);

        return trim((string) $fragmentless);
    }

    private function allowedHosts(int $accountId): array
    {
        $candidates = collect();
        $baseUrl = $this->urlResolver->resolveBaseUrl($accountId);
        if ($baseUrl) {
            $candidates->push(parse_url($baseUrl, PHP_URL_HOST));
        }

        $account = Account::query()->find($accountId);
        if ($account?->domain) {
            $candidates->push(parse_url(
                preg_match('/^https?:\/\//i', $account->domain) ? $account->domain : 'https://' . $account->domain,
                PHP_URL_HOST
            ));
        }

        $candidates = $candidates->merge(
            SiteDomain::query()
                ->where('account_id', $accountId)
                ->pluck('domain')
                ->map(function ($domain) {
                    $value = preg_match('/^https?:\/\//i', $domain) ? $domain : 'https://' . $domain;
                    return parse_url($value, PHP_URL_HOST);
                })
        );

        foreach ([config('app.frontend_url')] as $configuredUrl) {
            if ($configuredUrl) {
                $candidates->push(parse_url(
                    preg_match('/^https?:\/\//i', $configuredUrl) ? $configuredUrl : 'https://' . $configuredUrl,
                    PHP_URL_HOST
                ));
            }
        }

        return $candidates
            ->push(request()->getHost())
            ->map(fn ($host) => $this->normalizeHost((string) $host))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function normalizeHost(string $host): string
    {
        $host = Str::lower(trim($host, " \t\n\r\0\x0B."));

        foreach (['www.'] as $prefix) {
            if (str_starts_with($host, $prefix)) {
                $host = substr($host, strlen($prefix));
            }
        }

        return $host;
    }

    private function extractHtmlMetadata(string $html, string $pageUrl): array
    {
        $title = null;
        $excerpt = null;
        $image = null;

        if ($html !== '') {
            $document = new DOMDocument();
            $previous = libxml_use_internal_errors(true);
            $loaded = $document->loadHTML($html, LIBXML_NONET | LIBXML_NOWARNING | LIBXML_NOERROR);
            libxml_clear_errors();
            libxml_use_internal_errors($previous);

            if ($loaded) {
                foreach ($document->getElementsByTagName('meta') as $meta) {
                    $key = Str::lower(trim((string) ($meta->getAttribute('property') ?: $meta->getAttribute('name'))));
                    $content = trim((string) $meta->getAttribute('content'));
                    if ($content === '') {
                        continue;
                    }

                    if (!$title && in_array($key, ['og:title', 'twitter:title'], true)) {
                        $title = $content;
                    } elseif (!$excerpt && in_array($key, ['description', 'og:description', 'twitter:description'], true)) {
                        $excerpt = $content;
                    } elseif (!$image && in_array($key, ['og:image', 'twitter:image', 'twitter:image:src'], true)) {
                        $image = $this->resolveRelativeUrl($content, $pageUrl);
                    }
                }

                if (!$title) {
                    $titleNode = $document->getElementsByTagName('title')->item(0);
                    $title = $titleNode ? trim((string) $titleNode->textContent) : null;
                }
            }
        }

        return [
            'title' => $this->cleanText($title, 255),
            'excerpt' => $this->cleanText($excerpt, 1000),
            'image' => $this->cleanText($image, 2048),
        ];
    }

    private function normalizeOptionalImageUrl($value, string $pageUrl): ?string
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        return $this->cleanText($this->resolveRelativeUrl($value, $pageUrl), 2048);
    }

    private function resolveRelativeUrl(string $value, string $pageUrl): string
    {
        if (filter_var($value, FILTER_VALIDATE_URL)) {
            return $value;
        }

        if (!str_starts_with($value, '/')) {
            return $value;
        }

        $parts = parse_url($pageUrl);
        $scheme = $parts['scheme'] ?? 'https';
        $host = $parts['host'] ?? '';
        $port = isset($parts['port']) ? ':' . $parts['port'] : '';

        return $host ? $scheme . '://' . $host . $port . $value : $value;
    }

    private function fallbackTitleFromUrl(string $url): string
    {
        $path = trim(rawurldecode((string) parse_url($url, PHP_URL_PATH)), '/');
        $lastSegment = collect(explode('/', $path))->filter()->last();

        return $lastSegment
            ? Str::of($lastSegment)->replace(['-', '_'], ' ')->squish()->title()->value()
            : 'Bài viết liên quan';
    }

    private function cleanText($value, int $maxLength): ?string
    {
        $text = Str::of(html_entity_decode(strip_tags((string) $value), ENT_QUOTES | ENT_HTML5, 'UTF-8'))
            ->replaceMatches('/\s+/u', ' ')
            ->trim()
            ->value();

        return $text === '' ? null : Str::limit($text, $maxLength, '');
    }
}
