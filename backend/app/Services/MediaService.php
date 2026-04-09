<?php

namespace App\Services;

use App\Models\MediaAsset;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;

class MediaService
{
    private const DEFAULT_COLLECTION = 'general';
    private const MANAGED_ROUTE_PATTERN = '#/(?:api/)?media/assets/([0-9a-z]{26})/#i';
    private const MANAGED_OBJECT_PATTERN = '#/media-assets/([0-9a-z]{26})/#i';

    public function uploadImage(UploadedFile $file, array $options = []): MediaAsset
    {
        $contents = @file_get_contents($file->getRealPath());
        if ($contents === false) {
            throw new RuntimeException('Khong the doc tep anh da tai len.');
        }

        return $this->storeBinaryAsset(
            $contents,
            $file->getClientOriginalName(),
            $file->getClientOriginalExtension(),
            $file->getMimeType() ?: null,
            $options
        );
    }

    /**
     * @param  array<int, UploadedFile>  $files
     * @return array<int, MediaAsset>
     */
    public function uploadImages(array $files, array $options = []): array
    {
        return array_values(array_filter(array_map(
            fn ($file) => $file instanceof UploadedFile ? $this->uploadImage($file, $options) : null,
            $files
        )));
    }

    public function importFromReference(?string $value, array $options = []): ?MediaAsset
    {
        $normalized = trim((string) $value);
        if ($normalized === '') {
            return null;
        }

        if ($existingPublicId = $this->extractPublicIdFromUrl($normalized)) {
            $existingAsset = MediaAsset::query()->where('public_id', $existingPublicId)->first();
            if ($existingAsset) {
                if (!empty($options['clone_existing'])) {
                    $path = parse_url($normalized, PHP_URL_PATH) ?: $normalized;
                    $originalName = basename((string) $path) ?: null;

                    return $this->cloneAssetFromExisting($existingAsset, $options, $originalName);
                }

                return $existingAsset;
            }
        }

        if ($this->isHttpUrl($normalized)) {
            return $this->importFromRemoteUrl($normalized, $options);
        }

        return $this->importFromLocalReference($normalized, $options);
    }

    public function importFromAbsolutePath(string $path, array $options = []): MediaAsset
    {
        $resolvedPath = realpath($path);
        if ($resolvedPath === false || !is_file($resolvedPath)) {
            throw new RuntimeException('Khong tim thay tep anh de dong bo: ' . $path);
        }

        $contents = @file_get_contents($resolvedPath);
        if ($contents === false || $contents === '') {
            throw new RuntimeException('Khong the doc tep anh de dong bo: ' . $path);
        }

        $extension = pathinfo($resolvedPath, PATHINFO_EXTENSION);
        $mimeType = @mime_content_type($resolvedPath) ?: null;

        return $this->storeBinaryAsset(
            $contents,
            basename($resolvedPath),
            $extension,
            $mimeType,
            $options
        );
    }

    public function storeGeneratedAsset(
        string $contents,
        string $originalName,
        ?string $mimeType = null,
        array $options = []
    ): MediaAsset {
        $extension = pathinfo($originalName, PATHINFO_EXTENSION);

        return $this->storeBinaryAsset(
            $contents,
            $originalName,
            $extension,
            $mimeType,
            $options
        );
    }

    public function buildAssetPayload(?MediaAsset $asset, ?string $legacyUrl = null): ?array
    {
        if (!$asset) {
            $fallbackUrl = $this->normalizeLegacyUrl($legacyUrl);

            return $fallbackUrl !== '' ? [
                'id' => null,
                'public_id' => null,
                'url' => $fallbackUrl,
                'image_url' => $fallbackUrl,
                'thumbnail_url' => $fallbackUrl,
                'medium_url' => $fallbackUrl,
                'large_url' => $fallbackUrl,
                'original_url' => $fallbackUrl,
                'width' => null,
                'height' => null,
                'srcset' => '',
            ] : null;
        }

        return [
            'id' => (int) $asset->id,
            'public_id' => $asset->public_id,
            'url' => $this->buildAssetUrl($asset, 'large'),
            'image_url' => $this->buildAssetUrl($asset, 'large'),
            'thumbnail_url' => $this->buildAssetUrl($asset, 'thumbnail'),
            'medium_url' => $this->buildAssetUrl($asset, 'medium'),
            'large_url' => $this->buildAssetUrl($asset, 'large'),
            'original_url' => $this->buildAssetUrl($asset, 'original'),
            'width' => $asset->width,
            'height' => $asset->height,
            'srcset' => $this->buildSrcset($asset),
        ];
    }

    public function buildAssetUrl(MediaAsset|string|null $asset, string $variant = 'large'): string
    {
        if ($asset instanceof MediaAsset) {
            $descriptor = $this->resolveVariantDescriptor($asset, $variant);

            if ($descriptor === null) {
                return '';
            }

            $path = ltrim((string) ($descriptor['path'] ?? ''), '/');
            if ($path === '') {
                return '';
            }

            $publicBaseUrl = trim((string) config('media.public_base_url', ''));
            if ($publicBaseUrl !== '') {
                return rtrim($publicBaseUrl, '/') . '/' . $path;
            }

            return rtrim($this->baseAppUrl(), '/') . '/api/' . trim((string) config('media.route_prefix', 'media/assets'), '/') . '/' . $asset->public_id . '/' . $variant;
        }

        return $this->normalizeLegacyUrl($asset);
    }

    public function buildSrcset(?MediaAsset $asset): string
    {
        if (!$asset) {
            return '';
        }

        $parts = [];

        foreach (['thumbnail', 'medium', 'large'] as $variant) {
            $descriptor = $this->resolveVariantDescriptor($asset, $variant);
            $width = (int) ($descriptor['width'] ?? 0);
            $url = $this->buildAssetUrl($asset, $variant);

            if ($url !== '' && $width > 0) {
                $parts[] = $url . ' ' . $width . 'w';
            }
        }

        return implode(', ', $parts);
    }

    public function resolveVariantDescriptor(MediaAsset $asset, string $variant = 'large', bool $preferFallback = false): ?array
    {
        $variants = is_array($asset->variants) ? $asset->variants : [];
        $requested = $variants[$variant] ?? null;

        if (!is_array($requested)) {
            $requested = $variants['large'] ?? $variants['original'] ?? null;
        }

        if (!is_array($requested)) {
            return null;
        }

        $formats = is_array($requested['formats'] ?? null) ? $requested['formats'] : [];

        if ($preferFallback && isset($formats['fallback'])) {
            return array_merge($requested, $formats['fallback']);
        }

        if (isset($formats['webp'])) {
            return array_merge($requested, $formats['webp']);
        }

        if (isset($formats['fallback'])) {
            return array_merge($requested, $formats['fallback']);
        }

        if (isset($formats['source'])) {
            return array_merge($requested, $formats['source']);
        }

        return $requested;
    }

    public function stream(MediaAsset $asset, string $variant = 'large')
    {
        $descriptor = $this->resolveVariantDescriptor($asset, $variant);

        if ($descriptor === null) {
            abort(404);
        }

        $path = ltrim((string) ($descriptor['path'] ?? ''), '/');
        if ($path === '') {
            abort(404);
        }

        $disk = Storage::disk($asset->disk ?: $this->diskName());

        if (!$disk->exists($path)) {
            abort(404);
        }

        $stream = $disk->readStream($path);
        if (!is_resource($stream)) {
            abort(404);
        }

        return response()->stream(function () use ($stream) {
            fpassthru($stream);
            fclose($stream);
        }, 200, array_filter([
            'Content-Type' => $descriptor['mime'] ?? null,
            'Content-Length' => isset($descriptor['size_bytes']) ? (string) $descriptor['size_bytes'] : null,
            'Cache-Control' => 'public, max-age=31536000, immutable',
        ]));
    }

    public function deleteAsset(MediaAsset|int|null $asset): void
    {
        $resolved = $asset instanceof MediaAsset
            ? $asset
            : ($asset ? MediaAsset::query()->find($asset) : null);

        if (!$resolved) {
            return;
        }

        $paths = [];
        foreach ((array) $resolved->variants as $variant) {
            if (!is_array($variant)) {
                continue;
            }

            $formats = is_array($variant['formats'] ?? null) ? $variant['formats'] : [];
            foreach ($formats as $format) {
                $path = ltrim((string) ($format['path'] ?? ''), '/');
                if ($path !== '') {
                    $paths[] = $path;
                }
            }
        }

        $paths = array_values(array_unique($paths));
        if (!empty($paths)) {
            Storage::disk($resolved->disk ?: $this->diskName())->delete($paths);
        }

        $resolved->delete();
    }

    public function cloneAssetFromExisting(MediaAsset $asset, array $options = [], ?string $originalName = null): MediaAsset
    {
        $descriptor = $this->resolveVariantDescriptor($asset, 'original', true)
            ?? $this->resolveVariantDescriptor($asset, 'large', true);

        if ($descriptor === null) {
            throw new RuntimeException('Khong tim thay du lieu asset goc de clone.');
        }

        $path = ltrim((string) ($descriptor['path'] ?? ''), '/');
        if ($path === '') {
            throw new RuntimeException('Asset goc khong co duong dan hop le de clone.');
        }

        $disk = Storage::disk($asset->disk ?: $this->diskName());
        if (!$disk->exists($path)) {
            throw new RuntimeException('Khong tim thay tep asset goc de clone tren cloud.');
        }

        $contents = $disk->get($path);
        if (!is_string($contents) || $contents === '') {
            throw new RuntimeException('Khong the doc tep asset goc de clone.');
        }

        return $this->storeBinaryAsset(
            $contents,
            $originalName ?: $asset->original_name,
            $descriptor['extension'] ?? $asset->original_extension,
            $descriptor['mime'] ?? $asset->mime_type,
            $options
        );
    }

    public function extractPublicIdFromUrl(?string $value): ?string
    {
        $normalized = trim((string) $value);
        if ($normalized === '') {
            return null;
        }

        foreach ([self::MANAGED_ROUTE_PATTERN, self::MANAGED_OBJECT_PATTERN] as $pattern) {
            if (preg_match($pattern, $normalized, $matches) === 1) {
                return Str::lower((string) ($matches[1] ?? ''));
            }
        }

        return null;
    }

    /**
     * @return array<int, string>
     */
    public function collectManagedPublicIdsFromHtml(?string $html): array
    {
        $content = (string) $html;
        if (trim($content) === '') {
            return [];
        }

        $matches = [];
        preg_match_all(self::MANAGED_ROUTE_PATTERN, $content, $routeMatches);
        preg_match_all(self::MANAGED_OBJECT_PATTERN, $content, $objectMatches);

        $matches = array_merge($routeMatches[1] ?? [], $objectMatches[1] ?? []);

        return array_values(array_unique(array_map(
            static fn ($value) => Str::lower(trim((string) $value)),
            array_filter($matches)
        )));
    }

    public function normalizeLegacyUrl(?string $value): string
    {
        $normalized = trim((string) $value);
        if ($normalized === '') {
            return '';
        }

        if ($managedPublicId = $this->extractPublicIdFromUrl($normalized)) {
            $asset = MediaAsset::query()->where('public_id', $managedPublicId)->first();
            return $asset ? $this->buildAssetUrl($asset, 'large') : $normalized;
        }

        if ($this->isHttpUrl($normalized) || preg_match('#^(data|blob):#i', $normalized) === 1) {
            return $normalized;
        }

        $path = '/' . ltrim((string) preg_replace('#^/?storage/#i', 'storage/', $normalized), '/');

        return rtrim($this->baseAppUrl(), '/') . $path;
    }

    private function importFromRemoteUrl(string $url, array $options = []): MediaAsset
    {
        $response = Http::timeout(45)
            ->withOptions([
                'verify' => config('media.http.verify', true),
            ])
            ->withHeaders(['Accept' => 'image/*,*/*;q=0.8'])
            ->get($url);

        if (!$response->successful()) {
            throw new RuntimeException('Khong the tai anh tu URL: ' . $url);
        }

        $path = parse_url($url, PHP_URL_PATH) ?: $url;
        $extension = pathinfo((string) $path, PATHINFO_EXTENSION);
        $fileName = basename((string) $path) ?: ('remote-image.' . ($extension ?: 'jpg'));

        return $this->storeBinaryAsset(
            $response->body(),
            $fileName,
            $extension,
            $response->header('Content-Type'),
            $options
        );
    }

    private function importFromLocalReference(string $value, array $options = []): MediaAsset
    {
        $normalized = trim($value);
        $path = parse_url($normalized, PHP_URL_PATH) ?: $normalized;
        $relativePath = ltrim((string) preg_replace('#^/?storage/#i', '', $path), '/');

        $disk = Storage::disk('public');
        if (!$disk->exists($relativePath)) {
            throw new RuntimeException('Khong tim thay anh local de migrate: ' . $value);
        }

        $contents = $disk->get($relativePath);
        if (!is_string($contents) || $contents === '') {
            throw new RuntimeException('Khong the doc noi dung anh local de migrate: ' . $value);
        }

        $extension = pathinfo($relativePath, PATHINFO_EXTENSION);
        $fullPath = $disk->path($relativePath);
        $mimeType = @mime_content_type($fullPath) ?: null;

        return $this->storeBinaryAsset(
            $contents,
            basename($relativePath),
            $extension,
            $mimeType,
            $options
        );
    }

    private function storeBinaryAsset(
        string $contents,
        ?string $originalName = null,
        ?string $originalExtension = null,
        ?string $mimeType = null,
        array $options = []
    ): MediaAsset {
        if ($contents === '') {
            throw new RuntimeException('Du lieu anh dau vao dang rong.');
        }

        $publicId = Str::lower((string) Str::ulid());
        $collection = trim((string) ($options['collection'] ?? self::DEFAULT_COLLECTION)) ?: self::DEFAULT_COLLECTION;
        $disk = Storage::disk($this->diskName());

        $guessedMime = $mimeType ?: ((string) @finfo_buffer(finfo_open(FILEINFO_MIME_TYPE), $contents));
        $extension = $this->normalizeExtension($originalExtension ?: $this->extensionFromMime($guessedMime) ?: 'jpg');
        $basePath = 'media-assets/' . $publicId;

        $imageInfo = @getimagesizefromstring($contents);
        $sourceImage = $this->createImageResource($contents);
        $variants = [];

        if (!$imageInfo || !$sourceImage) {
            $originalPath = $basePath . '/original.' . $extension;
            $this->putBinary($disk, $originalPath, $contents, $guessedMime ?: $this->mimeFromExtension($extension));

            $originalDescriptor = [
                'width' => null,
                'height' => null,
                'formats' => [
                    'source' => [
                        'path' => $originalPath,
                        'mime' => $guessedMime ?: $this->mimeFromExtension($extension),
                        'extension' => $extension,
                        'size_bytes' => strlen($contents),
                    ],
                ],
            ];

            $variants = [
                'original' => $originalDescriptor,
                'thumbnail' => $originalDescriptor,
                'medium' => $originalDescriptor,
                'large' => $originalDescriptor,
            ];
        } else {
            $width = (int) ($imageInfo[0] ?? 0);
            $height = (int) ($imageInfo[1] ?? 0);
            $preserveAlpha = $this->shouldPreserveAlpha($guessedMime ?: '', $extension);
            $fallbackExtension = $preserveAlpha ? 'png' : 'jpg';
            $fallbackMime = $preserveAlpha ? 'image/png' : 'image/jpeg';

            $originalPath = $basePath . '/original.' . $extension;
            $this->putBinary($disk, $originalPath, $contents, $guessedMime ?: $this->mimeFromExtension($extension));

            $variants['original'] = [
                'width' => $width,
                'height' => $height,
                'formats' => [
                    'source' => [
                        'path' => $originalPath,
                        'mime' => $guessedMime ?: $this->mimeFromExtension($extension),
                        'extension' => $extension,
                        'size_bytes' => strlen($contents),
                    ],
                ],
            ];

            foreach ((array) config('media.sizes', []) as $variantName => $targetWidth) {
                $targetWidth = max((int) $targetWidth, 1);
                $targetHeight = $width > 0 ? max((int) round(($height / $width) * min($width, $targetWidth)), 1) : null;
                $resized = $this->resizeImage($sourceImage, $width, $height, $targetWidth, $preserveAlpha);

                $variantFormats = [];

                if (function_exists('imagewebp')) {
                    $webpBinary = $this->encodeImage($resized, 'webp');
                    $webpPath = $basePath . '/' . $variantName . '.webp';
                    $this->putBinary($disk, $webpPath, $webpBinary, 'image/webp');
                    $variantFormats['webp'] = [
                        'path' => $webpPath,
                        'mime' => 'image/webp',
                        'extension' => 'webp',
                        'size_bytes' => strlen($webpBinary),
                    ];
                }

                $fallbackBinary = $this->encodeImage($resized, $fallbackExtension);
                $fallbackPath = $basePath . '/' . $variantName . '.' . $fallbackExtension;
                $this->putBinary($disk, $fallbackPath, $fallbackBinary, $fallbackMime);
                $variantFormats['fallback'] = [
                    'path' => $fallbackPath,
                    'mime' => $fallbackMime,
                    'extension' => $fallbackExtension,
                    'size_bytes' => strlen($fallbackBinary),
                ];

                $variants[$variantName] = [
                    'width' => min($width, $targetWidth),
                    'height' => $targetHeight,
                    'formats' => $variantFormats,
                ];

                imagedestroy($resized);
            }

            imagedestroy($sourceImage);
        }

        $asset = MediaAsset::query()->create([
            'public_id' => $publicId,
            'disk' => $this->diskName(),
            'collection' => $collection,
            'original_name' => $originalName ?: ('image.' . $extension),
            'original_extension' => $extension,
            'mime_type' => $guessedMime ?: $this->mimeFromExtension($extension),
            'width' => (int) ($imageInfo[0] ?? 0) ?: null,
            'height' => (int) ($imageInfo[1] ?? 0) ?: null,
            'size_bytes' => strlen($contents),
            'variants' => $variants,
            'metadata' => [
                'collection' => $collection,
                'source' => $options['source'] ?? null,
            ],
        ]);

        return $asset;
    }

    private function encodeImage($image, string $format): string
    {
        ob_start();

        if ($format === 'webp') {
            imagewebp($image, null, (int) config('media.quality.webp', 78));
        } elseif ($format === 'png') {
            imagepng($image, null, (int) config('media.quality.png', 6));
        } else {
            imagejpeg($image, null, (int) config('media.quality.jpeg', 80));
        }

        return (string) ob_get_clean();
    }

    private function resizeImage($image, int $sourceWidth, int $sourceHeight, int $targetWidth, bool $preserveAlpha)
    {
        $finalWidth = min($sourceWidth, $targetWidth);
        $finalHeight = max((int) round(($sourceHeight / max($sourceWidth, 1)) * $finalWidth), 1);

        $canvas = imagecreatetruecolor($finalWidth, $finalHeight);

        if ($preserveAlpha) {
            imagealphablending($canvas, false);
            imagesavealpha($canvas, true);
            $transparent = imagecolorallocatealpha($canvas, 255, 255, 255, 127);
            imagefilledrectangle($canvas, 0, 0, $finalWidth, $finalHeight, $transparent);
        } else {
            $background = imagecolorallocate($canvas, 255, 255, 255);
            imagefilledrectangle($canvas, 0, 0, $finalWidth, $finalHeight, $background);
        }

        imagecopyresampled($canvas, $image, 0, 0, 0, 0, $finalWidth, $finalHeight, $sourceWidth, $sourceHeight);

        return $canvas;
    }

    private function createImageResource(string $contents)
    {
        if (!function_exists('imagecreatefromstring')) {
            return null;
        }

        return @imagecreatefromstring($contents) ?: null;
    }

    private function putBinary($disk, string $path, string $contents, string $mimeType): void
    {
        $stored = $disk->put($path, $contents, [
            'visibility' => 'public',
            'ContentType' => $mimeType,
        ]);

        if (!$stored) {
            throw new RuntimeException('Khong the luu anh len Cloudflare R2.');
        }
    }

    private function shouldPreserveAlpha(string $mimeType, string $extension): bool
    {
        $normalizedMime = Str::lower(trim($mimeType));
        $normalizedExtension = $this->normalizeExtension($extension);

        return in_array($normalizedMime, ['image/png', 'image/webp', 'image/gif'], true)
            || in_array($normalizedExtension, ['png', 'webp', 'gif', 'svg'], true);
    }

    private function normalizeExtension(?string $extension): string
    {
        return match (Str::lower(trim((string) $extension))) {
            'jpeg' => 'jpg',
            'svg+xml' => 'svg',
            default => Str::lower(trim((string) $extension)) ?: 'jpg',
        };
    }

    private function extensionFromMime(?string $mimeType): ?string
    {
        return match (Str::lower(trim((string) $mimeType))) {
            'image/jpeg', 'image/jpg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
            'image/avif' => 'avif',
            'image/svg+xml' => 'svg',
            default => null,
        };
    }

    private function mimeFromExtension(string $extension): string
    {
        return match ($this->normalizeExtension($extension)) {
            'png' => 'image/png',
            'webp' => 'image/webp',
            'gif' => 'image/gif',
            'avif' => 'image/avif',
            'svg' => 'image/svg+xml',
            default => 'image/jpeg',
        };
    }

    private function isHttpUrl(string $value): bool
    {
        return filter_var($value, FILTER_VALIDATE_URL) !== false
            && preg_match('#^https?://#i', $value) === 1;
    }

    private function baseAppUrl(): string
    {
        $requestBase = request()?->getSchemeAndHttpHost();
        if (is_string($requestBase) && trim($requestBase) !== '') {
            return rtrim($requestBase, '/');
        }

        return rtrim((string) config('app.url', ''), '/');
    }

    private function diskName(): string
    {
        return (string) config('media.disk', 'r2');
    }
}
