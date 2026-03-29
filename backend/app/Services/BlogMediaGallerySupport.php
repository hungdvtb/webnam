<?php

namespace App\Services;

use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;
use Illuminate\Support\Str;
use Throwable;

class BlogMediaGallerySupport
{
    public const MEDIA_GALLERY_BLOCK_CLASS = 'ql-bdt-media-gallery';
    public const MEDIA_GALLERY_PAYLOAD_ATTRIBUTE = 'data-gallery-payload';
    private const YOUTUBE_VIDEO_ID_PATTERN = '/^[a-zA-Z0-9_-]{6,}$/';

    public static function normalizeHtml(string $content): string
    {
        if (!Str::contains($content, self::MEDIA_GALLERY_BLOCK_CLASS)) {
            return $content;
        }

        return self::transformHtml($content, static function (DOMXPath $xpath): void {
            foreach (self::galleryNodes($xpath) as $node) {
                self::normalizeMediaGalleryNode($node);
            }
        });
    }

    public static function rewriteAssetReferences(string $content, callable $resolver): string
    {
        if (trim($content) === '') {
            return '';
        }

        return self::transformHtml($content, static function (DOMXPath $xpath) use ($resolver): void {
            foreach (self::galleryNodes($xpath) as $node) {
                self::rewriteMediaGalleryNodeAssets($node, $resolver);
            }

            foreach ($xpath->query('//*[@style]') ?: [] as $styleNode) {
                if ($styleNode instanceof DOMElement) {
                    self::rewriteStyleUrls($styleNode, $resolver);
                }
            }

            foreach ($xpath->query('//img[@src or @srcset] | //source[@src or @srcset] | //video[@poster]') ?: [] as $mediaNode) {
                if (!$mediaNode instanceof DOMElement) {
                    continue;
                }

                self::rewriteMediaElementAttributes($mediaNode, $resolver);
            }
        });
    }

    private static function transformHtml(string $content, callable $transformer): string
    {
        $wrappedHtml = sprintf('<div id="__blog_media_root__">%s</div>', $content);
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

        $rootNode = $xpath->query('//*[@id="__blog_media_root__"]')->item(0);
        $result = $rootNode instanceof DOMNode ? self::extractInnerHtml($rootNode) : $content;

        libxml_clear_errors();
        libxml_use_internal_errors($previousState);

        return $result;
    }

    /**
     * @return array<int, DOMElement>
     */
    private static function galleryNodes(DOMXPath $xpath): array
    {
        $galleryNodes = [];
        $nodes = $xpath->query(sprintf(
            '//*[contains(concat(" ", normalize-space(@class), " "), " %s ")]',
            self::MEDIA_GALLERY_BLOCK_CLASS
        ));

        if ($nodes === false) {
            return [];
        }

        foreach ($nodes as $node) {
            if ($node instanceof DOMElement) {
                $galleryNodes[] = $node;
            }
        }

        return $galleryNodes;
    }

    private static function rewriteMediaElementAttributes(DOMElement $node, callable $resolver): void
    {
        foreach (['src', 'poster'] as $attribute) {
            if ($node->hasAttribute($attribute)) {
                $node->setAttribute(
                    $attribute,
                    self::applyResolver($resolver, $node->getAttribute($attribute), $node, $attribute)
                );
            }
        }

        if ($node->hasAttribute('srcset')) {
            $node->setAttribute(
                'srcset',
                self::rewriteSrcSetValue($node->getAttribute('srcset'), $resolver, $node)
            );
        }
    }

    private static function rewriteStyleUrls(DOMElement $node, callable $resolver): void
    {
        $style = trim($node->getAttribute('style'));
        if ($style === '') {
            return;
        }

        $rewritten = preg_replace_callback(
            '/url\((["\']?)(.*?)\1\)/i',
            static function (array $matches) use ($resolver, $node) {
                $quote = $matches[1] ?? '';
                $value = trim((string) ($matches[2] ?? ''));

                if ($value === '') {
                    return $matches[0];
                }

                $nextValue = self::applyResolver($resolver, $value, $node, 'style');
                return 'url(' . $quote . $nextValue . $quote . ')';
            },
            $style
        );

        if (is_string($rewritten)) {
            $node->setAttribute('style', $rewritten);
        }
    }

    private static function rewriteSrcSetValue(string $srcset, callable $resolver, DOMElement $node): string
    {
        if (trim($srcset) === '' || Str::contains($srcset, 'data:')) {
            return $srcset;
        }

        $parts = array_map('trim', explode(',', $srcset));
        $rewrittenParts = [];

        foreach ($parts as $part) {
            if ($part === '') {
                continue;
            }

            [$url, $descriptor] = array_pad(preg_split('/\s+/', $part, 2), 2, '');
            $nextUrl = self::applyResolver($resolver, $url, $node, 'srcset');
            $rewrittenParts[] = trim($nextUrl . ' ' . $descriptor);
        }

        return implode(', ', $rewrittenParts);
    }

    private static function rewriteMediaGalleryNodeAssets(DOMElement $node, callable $resolver): void
    {
        $items = self::decodeMediaGalleryPayload($node->getAttribute(self::MEDIA_GALLERY_PAYLOAD_ATTRIBUTE));
        if (empty($items)) {
            self::normalizeMediaGalleryNode($node);
            return;
        }

        $rewrittenItems = array_map(
            static function (array $item) use ($resolver, $node): array {
                if (($item['type'] ?? null) !== 'image') {
                    return $item;
                }

                $item['src'] = self::applyResolver($resolver, (string) ($item['src'] ?? ''), $node, 'gallery-src');
                return $item;
            },
            $items
        );

        self::normalizeMediaGalleryNode($node, $rewrittenItems);
    }

    /**
     * @param  array<int, array<string, string>>|null  $overrideItems
     */
    private static function normalizeMediaGalleryNode(DOMElement $node, ?array $overrideItems = null): void
    {
        $items = $overrideItems ?? self::decodeMediaGalleryPayload($node->getAttribute(self::MEDIA_GALLERY_PAYLOAD_ATTRIBUTE));

        if (empty($items)) {
            return;
        }

        $imageCount = count(array_filter($items, fn (array $item) => ($item['type'] ?? null) === 'image'));
        $videoCount = count(array_filter($items, fn (array $item) => ($item['type'] ?? null) === 'video'));
        $summary = self::buildMediaGallerySummary($imageCount, $videoCount);
        $payload = self::encodeMediaGalleryPayload($items);
        $previewUrl = self::resolveMediaGalleryPreviewUrl($items);

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

    private static function applyResolver(callable $resolver, string $value, DOMElement $node, string $attribute): string
    {
        $normalizedValue = trim(html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($normalizedValue === '') {
            return $value;
        }

        $resolvedValue = $resolver($normalizedValue, [
            'tag' => strtolower($node->tagName),
            'attribute' => $attribute,
        ]);

        return is_string($resolvedValue) && trim($resolvedValue) !== ''
            ? $resolvedValue
            : $value;
    }

    /**
     * @return array<int, array<string, string>>
     */
    public static function decodeMediaGalleryPayload(?string $payload): array
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

            $normalizedItems = self::normalizeMediaGalleryItems($items);
            if (!empty($normalizedItems)) {
                return $normalizedItems;
            }
        }

        return [];
    }

    /**
     * @param  array<int, array<string, string>>  $items
     */
    public static function encodeMediaGalleryPayload(array $items): string
    {
        return rawurlencode((string) json_encode([
            'version' => 1,
            'items' => array_values($items),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    /**
     * @param  mixed  $items
     * @return array<int, array<string, string>>
     */
    public static function normalizeMediaGalleryItems(mixed $items): array
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
            $normalizedItem = $type === 'video'
                ? self::normalizeMediaGalleryVideoItem($item)
                : self::normalizeMediaGalleryImageItem($item);

            if ($normalizedItem !== null) {
                $normalizedItems[] = $normalizedItem;
            }
        }

        return $normalizedItems;
    }

    /**
     * @param  array<string, mixed>  $item
     * @return array<string, string>|null
     */
    private static function normalizeMediaGalleryImageItem(array $item): ?array
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

    /**
     * @param  array<string, mixed>  $item
     * @return array<string, string>|null
     */
    private static function normalizeMediaGalleryVideoItem(array $item): ?array
    {
        $source = trim((string) ($item['url'] ?? $item['src'] ?? $item['youtubeId'] ?? ''));
        $videoId = self::extractYouTubeVideoId($source);

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

    private static function extractYouTubeVideoId(?string $value): ?string
    {
        $normalizedValue = self::normalizeYouTubeCandidate($value);

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
        $pathSegments = array_values(array_filter(explode('/', (string) ($parts['path'] ?? '')), static fn ($segment) => $segment !== ''));

        parse_str((string) ($parts['query'] ?? ''), $query);

        if (!empty($query['u'])) {
            $nestedUrl = (string) $query['u'];
            if (Str::startsWith($nestedUrl, '/')) {
                $nestedUrl = 'https://www.youtube.com' . $nestedUrl;
            }

            $nestedVideoId = self::extractYouTubeVideoId(rawurldecode($nestedUrl));
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

    private static function normalizeYouTubeCandidate(?string $value): string
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

    /**
     * @param  array<int, array<string, string>>  $items
     */
    private static function resolveMediaGalleryPreviewUrl(array $items): string
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

    private static function buildMediaGallerySummary(int $imageCount, int $videoCount): string
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

    private static function extractInnerHtml(DOMNode $node): string
    {
        $innerHtml = '';

        foreach ($node->childNodes as $childNode) {
            $innerHtml .= $node->ownerDocument?->saveHTML($childNode) ?? '';
        }

        return $innerHtml;
    }
}
