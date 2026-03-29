<?php

namespace App\Services;

use App\Models\BlogCategory;
use App\Models\Post;
use App\Models\PostSeoKeyword;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RuntimeException;
use Throwable;
use ZipArchive;

class BlogBundleService
{
    private const POSTS_XLSX_HEADERS = [
        'bundle_post_key',
        'title',
        'slug',
        'excerpt',
        'content_file',
        'category_slug',
        'category_name',
        'seo_keyword',
        'status',
        'is_published',
        'is_starred',
        'is_system',
        'published_at',
        'created_at',
        'updated_at',
        'sort_order',
        'featured_image_ref',
    ];

    public function __construct(
        private readonly SimpleXlsxService $xlsxService
    ) {
    }

    /**
     * @param  array<int, Post>  $posts
     * @return array{path: string, filename: string, post_count: int, asset_count: int}
     */
    public function export(int $accountId, array $posts): array
    {
        if (empty($posts)) {
            throw ValidationException::withMessages([
                'bundle' => ['Khong co bai viet nao de export.'],
            ]);
        }

        $workspace = $this->makeWorkspace('blog-export-');
        $bundleRoot = $workspace . DIRECTORY_SEPARATOR . 'bundle';
        $contentDirectory = $bundleRoot . DIRECTORY_SEPARATOR . 'content';
        $mediaDirectory = $bundleRoot . DIRECTORY_SEPARATOR . 'media';

        if (!mkdir($contentDirectory, 0755, true) && !is_dir($contentDirectory)) {
            $this->cleanupDirectory($workspace);
            throw new RuntimeException('Khong the tao thu muc export.');
        }

        if (!mkdir($mediaDirectory, 0755, true) && !is_dir($mediaDirectory)) {
            $this->cleanupDirectory($workspace);
            throw new RuntimeException('Khong the tao thu muc media export.');
        }

        $assetMap = [];
        $errors = [];
        $rows = [];
        $usedCategories = [];

        foreach (array_values($posts) as $index => $post) {
            try {
                $rowKey = $this->buildBundlePostKey($index + 1, (string) ($post->slug ?: $post->title));
                $contentFile = 'content/' . $rowKey . '.html';
                $content = BlogMediaGallerySupport::rewriteAssetReferences(
                    (string) ($post->content ?? ''),
                    function (string $reference) use (&$assetMap, $bundleRoot): string {
                        return $this->exportAssetToBundleReference($reference, $bundleRoot, $assetMap);
                    }
                );

                $contentAbsolutePath = $bundleRoot . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $contentFile);
                $contentDirectoryPath = dirname($contentAbsolutePath);
                if (!is_dir($contentDirectoryPath) && !mkdir($contentDirectoryPath, 0755, true) && !is_dir($contentDirectoryPath)) {
                    throw new RuntimeException('Khong the ghi file noi dung vao bundle.');
                }

                file_put_contents($contentAbsolutePath, $content);

                $featuredImageReference = $this->exportAssetToBundleReference(
                    (string) ($post->featured_image ?? ''),
                    $bundleRoot,
                    $assetMap
                );

                if ($post->category instanceof BlogCategory) {
                    $usedCategories[$post->category->slug] = [
                        'slug' => (string) $post->category->slug,
                        'name' => (string) $post->category->name,
                        'sort_order' => (int) $post->category->sort_order,
                    ];
                }

                $rows[] = [
                    'bundle_post_key' => $rowKey,
                    'title' => (string) $post->title,
                    'slug' => (string) $post->slug,
                    'excerpt' => (string) ($post->excerpt ?? ''),
                    'content_file' => $contentFile,
                    'category_slug' => (string) ($post->category->slug ?? ''),
                    'category_name' => (string) ($post->category->name ?? ''),
                    'seo_keyword' => (string) ($post->seo_keyword ?? ''),
                    'status' => $post->is_published ? 'published' : 'draft',
                    'is_published' => $post->is_published ? '1' : '0',
                    'is_starred' => $post->is_starred ? '1' : '0',
                    'is_system' => $post->is_system ? '1' : '0',
                    'published_at' => $post->published_at?->toAtomString() ?? '',
                    'created_at' => $post->created_at?->toAtomString() ?? '',
                    'updated_at' => $post->updated_at?->toAtomString() ?? '',
                    'sort_order' => (string) ((int) ($post->sort_order ?? 0)),
                    'featured_image_ref' => $featuredImageReference,
                ];
            } catch (Throwable $exception) {
                $errors[] = sprintf(
                    'Bai "%s" khong export duoc day du: %s',
                    (string) ($post->title ?? ('#' . $post->id)),
                    $exception->getMessage()
                );
            }
        }

        if (!empty($errors)) {
            $this->cleanupDirectory($workspace);
            throw ValidationException::withMessages(['bundle' => $errors]);
        }

        $manifest = [
            'type' => 'webnam-blog-bundle',
            'version' => 1,
            'account_id' => $accountId,
            'exported_at' => now()->toAtomString(),
            'post_count' => count($rows),
            'asset_count' => count($assetMap),
            'categories' => array_values(array_sort($usedCategories, fn (array $category) => [
                (int) ($category['sort_order'] ?? 0),
                (string) ($category['name'] ?? ''),
            ])),
        ];

        file_put_contents(
            $bundleRoot . DIRECTORY_SEPARATOR . 'manifest.json',
            (string) json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );

        $this->xlsxService->write(
            $bundleRoot . DIRECTORY_SEPARATOR . 'posts.xlsx',
            self::POSTS_XLSX_HEADERS,
            $rows,
            'Posts'
        );

        $filename = $this->buildArchiveFilename($posts);
        $zipPath = $workspace . DIRECTORY_SEPARATOR . $filename;
        $this->zipDirectory($bundleRoot, $zipPath);
        $this->cleanupDirectory($bundleRoot);

        return [
            'path' => $zipPath,
            'filename' => $filename,
            'post_count' => count($rows),
            'asset_count' => count($assetMap),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function import(int $accountId, UploadedFile $file): array
    {
        $workspace = $this->makeWorkspace('blog-import-');

        try {
            $archivePath = $workspace . DIRECTORY_SEPARATOR . ($file->getClientOriginalName() ?: 'blog-bundle.zip');
            copy($file->getRealPath(), $archivePath);

            $extractRoot = $workspace . DIRECTORY_SEPARATOR . 'bundle';
            if (!mkdir($extractRoot, 0755, true) && !is_dir($extractRoot)) {
                throw new RuntimeException('Khong the tao thu muc import.');
            }

            $this->extractZip($archivePath, $extractRoot);
            $bundleRoot = $this->locateBundleRoot($extractRoot);
            $manifest = $this->readManifest($bundleRoot);
            $workbook = $this->xlsxService->read($bundleRoot . DIRECTORY_SEPARATOR . 'posts.xlsx');
            $headers = $workbook['headers'] ?? [];
            $rows = $workbook['rows'] ?? [];

            $this->validateWorkbookHeaders($headers);

            if (empty($rows)) {
                throw ValidationException::withMessages([
                    'bundle' => ['File Excel khong co dong bai viet nao de import.'],
                ]);
            }

            $categoryDefinitions = $this->validateManifestCategories($manifest['categories'] ?? []);
            $preparedRows = $this->prepareImportRows($accountId, $bundleRoot, $rows, $categoryDefinitions);
            $importToken = now()->format('YmdHis') . '-' . Str::lower(Str::random(8));
            $assetCache = [];

            $result = DB::transaction(function () use (
                $accountId,
                $bundleRoot,
                $preparedRows,
                $categoryDefinitions,
                $importToken,
                &$assetCache
            ) {
                $categoryIdsBySlug = $this->syncImportCategories($accountId, $categoryDefinitions);

                $created = 0;
                $updated = 0;
                $importedKeywords = [];

                foreach ($preparedRows as $row) {
                    $featuredImage = $this->importAssetReference(
                        $row['featured_image_ref'],
                        $bundleRoot,
                        $importToken,
                        $assetCache
                    );

                    $content = BlogMediaGallerySupport::rewriteAssetReferences(
                        $row['content'],
                        function (string $reference) use ($bundleRoot, $importToken, &$assetCache): string {
                            return $this->importAssetReference($reference, $bundleRoot, $importToken, $assetCache);
                        }
                    );

                    $post = $row['existing_post'];
                    $isExisting = $post instanceof Post;

                    if (!$isExisting) {
                        $post = new Post();
                        $post->account_id = $accountId;
                        $created++;
                    } else {
                        $updated++;
                    }

                    $post->timestamps = false;
                    $post->title = $row['title'];
                    $post->slug = $row['slug'];
                    $post->excerpt = $row['excerpt'];
                    $post->content = $content;
                    $post->featured_image = $featuredImage ?: null;
                    $post->seo_keyword = $row['seo_keyword'] ?: null;
                    $post->blog_category_id = $row['category_slug'] !== ''
                        ? ($categoryIdsBySlug[$row['category_slug']] ?? null)
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
                    'categories_created' => count(array_filter($categoryDefinitions, fn (array $item) => !($item['exists'] ?? false))),
                    'assets_imported' => count($assetCache),
                ];
            });

            return $result + ['errors' => []];
        } finally {
            $this->cleanupDirectory($workspace);
        }
    }

    /**
     * @param  array<int, array<string, mixed>>  $categories
     * @return array<string, array<string, mixed>>
     */
    private function validateManifestCategories(array $categories): array
    {
        $errors = [];
        $definitions = [];

        foreach ($categories as $index => $category) {
            $slug = trim((string) ($category['slug'] ?? ''));
            $name = trim((string) ($category['name'] ?? ''));
            $sortOrder = (int) ($category['sort_order'] ?? ($index + 1));

            if ($slug === '' && $name === '') {
                continue;
            }

            if ($slug === '' || $name === '') {
                $errors[] = sprintf('Danh muc trong manifest o vi tri %d dang thieu slug hoac ten.', $index + 1);
                continue;
            }

            if (isset($definitions[$slug]) && $definitions[$slug]['name'] !== $name) {
                $errors[] = sprintf('Danh muc slug "%s" dang bi trung nhung khac ten.', $slug);
                continue;
            }

            $definitions[$slug] = [
                'slug' => $slug,
                'name' => $name,
                'sort_order' => max($sortOrder, 1),
            ];
        }

        if (!empty($errors)) {
            throw ValidationException::withMessages(['bundle' => $errors]);
        }

        return $definitions;
    }

    /**
     * @param  array<int, array<string, string>>  $rows
     * @param  array<string, array<string, mixed>>  $categoryDefinitions
     * @return array<int, array<string, mixed>>
     */
    private function prepareImportRows(
        int $accountId,
        string $bundleRoot,
        array $rows,
        array $categoryDefinitions
    ): array {
        $errors = [];
        $preparedRows = [];
        $slugOccurrences = [];

        foreach ($rows as $index => $row) {
            $rowNumber = $index + 2;
            $title = trim((string) ($row['title'] ?? ''));
            $slug = trim((string) ($row['slug'] ?? ''));
            $excerpt = (string) ($row['excerpt'] ?? '');
            $contentFile = trim((string) ($row['content_file'] ?? ''));
            $categorySlug = trim((string) ($row['category_slug'] ?? ''));
            $categoryName = trim((string) ($row['category_name'] ?? ''));
            $seoKeyword = trim((string) ($row['seo_keyword'] ?? ''));
            $status = Str::lower(trim((string) ($row['status'] ?? '')));
            $featuredImageRef = trim((string) ($row['featured_image_ref'] ?? ''));

            if ($title === '') {
                $errors[] = sprintf('Dong %d dang thieu cot title.', $rowNumber);
            }

            if ($slug === '') {
                $errors[] = sprintf('Dong %d dang thieu slug.', $rowNumber);
            } else {
                $slugOccurrences[$slug][] = $rowNumber;
            }

            if ($contentFile === '') {
                $errors[] = sprintf('Dong %d dang thieu cot content_file.', $rowNumber);
            }

            if (($categorySlug === '') xor ($categoryName === '')) {
                $errors[] = sprintf('Dong %d co du lieu danh muc khong day du.', $rowNumber);
            }

            if ($categorySlug !== '') {
                $definition = $categoryDefinitions[$categorySlug] ?? null;
                if ($definition === null) {
                    $errors[] = sprintf('Dong %d dang dung danh muc "%s" khong ton tai trong manifest.', $rowNumber, $categorySlug);
                } elseif ($definition['name'] !== $categoryName) {
                    $errors[] = sprintf('Dong %d co danh muc "%s" nhung ten khong khop manifest.', $rowNumber, $categorySlug);
                }
            }

            $isPublished = $this->parseBoolean($row['is_published'] ?? '', false);
            $statusFlag = $status === '' ? $isPublished : in_array($status, ['published', 'publish', 'active'], true);
            if ($status !== '' && $statusFlag !== $isPublished) {
                $errors[] = sprintf('Dong %d co cot status va is_published khong khop nhau.', $rowNumber);
            }

            $contentAbsolutePath = $this->resolveBundleFilePath($bundleRoot, $contentFile);
            if ($contentAbsolutePath === null || !is_file($contentAbsolutePath)) {
                $errors[] = sprintf('Dong %d dang thieu file noi dung "%s".', $rowNumber, $contentFile);
                $content = '';
            } else {
                $content = (string) file_get_contents($contentAbsolutePath);
                if (trim($content) === '') {
                    $errors[] = sprintf('Dong %d co file noi dung rong.', $rowNumber);
                }
            }

            try {
                if ($featuredImageRef !== '') {
                    $this->importAssetReference($featuredImageRef, $bundleRoot, 'validate', [], false);
                }

                if ($content !== '') {
                    BlogMediaGallerySupport::rewriteAssetReferences(
                        $content,
                        function (string $reference) use ($bundleRoot): string {
                            return $this->importAssetReference($reference, $bundleRoot, 'validate', [], false);
                        }
                    );
                }
            } catch (Throwable $exception) {
                $errors[] = sprintf('Dong %d co loi anh/noi dung: %s', $rowNumber, $exception->getMessage());
            }

            $preparedRows[] = [
                'row_number' => $rowNumber,
                'title' => $title,
                'slug' => $slug,
                'excerpt' => $excerpt,
                'content' => $content,
                'content_file' => $contentFile,
                'category_slug' => $categorySlug,
                'seo_keyword' => $seoKeyword,
                'featured_image_ref' => $featuredImageRef,
                'is_published' => $isPublished,
                'is_starred' => $this->parseBoolean($row['is_starred'] ?? '', false),
                'is_system' => $this->parseBoolean($row['is_system'] ?? '', false),
                'published_at' => $this->parseDateValue($row['published_at'] ?? ''),
                'created_at' => $this->parseDateValue($row['created_at'] ?? '') ?? now(),
                'updated_at' => $this->parseDateValue($row['updated_at'] ?? '') ?? $this->parseDateValue($row['created_at'] ?? '') ?? now(),
                'sort_order' => max((int) ($row['sort_order'] ?? 0), 0),
                'existing_post' => null,
            ];
        }

        foreach ($slugOccurrences as $slug => $rowNumbers) {
            if (count($rowNumbers) > 1) {
                $errors[] = sprintf(
                    'Slug "%s" dang bi trung trong file Excel o cac dong: %s.',
                    $slug,
                    implode(', ', $rowNumbers)
                );
            }
        }

        $categorySlugs = array_keys($categoryDefinitions);
        if (!empty($categorySlugs)) {
            $existingCategories = BlogCategory::where('account_id', $accountId)
                ->whereIn('slug', $categorySlugs)
                ->get(['id', 'slug', 'name'])
                ->keyBy('slug');

            foreach ($categoryDefinitions as $slug => &$definition) {
                $existingCategory = $existingCategories->get($slug);
                if (!$existingCategory) {
                    $definition['exists'] = false;
                    continue;
                }

                if ((string) $existingCategory->name !== (string) $definition['name']) {
                    $errors[] = sprintf(
                        'Danh muc slug "%s" dang ton tai voi ten "%s", khong khop voi file import "%s".',
                        $slug,
                        $existingCategory->name,
                        $definition['name']
                    );
                    continue;
                }

                $definition['exists'] = true;
                $definition['id'] = (int) $existingCategory->id;
            }
            unset($definition);
        }

        $slugs = array_values(array_filter(array_map(fn (array $row) => $row['slug'], $preparedRows)));
        if (!empty($slugs)) {
            $existingPosts = Post::where('account_id', $accountId)
                ->whereIn('slug', $slugs)
                ->get(['id', 'slug', 'is_system'])
                ->keyBy('slug');

            foreach ($preparedRows as &$preparedRow) {
                $existingPost = $existingPosts->get($preparedRow['slug']);

                if (!$existingPost) {
                    continue;
                }

                if ($preparedRow['is_system'] && $existingPost->is_system) {
                    $preparedRow['existing_post'] = $existingPost;
                    continue;
                }

                $errors[] = sprintf(
                    'Dong %d bi trung slug "%s" voi du lieu hien co tren he thong.',
                    $preparedRow['row_number'],
                    $preparedRow['slug']
                );
            }
            unset($preparedRow);
        }

        if (!empty($errors)) {
            throw ValidationException::withMessages(['bundle' => $errors]);
        }

        return $preparedRows;
    }

    /**
     * @param  array<string, array<string, mixed>>  $categoryDefinitions
     * @return array<string, int>
     */
    private function syncImportCategories(int $accountId, array $categoryDefinitions): array
    {
        if (empty($categoryDefinitions)) {
            return [];
        }

        $idsBySlug = BlogCategory::where('account_id', $accountId)
            ->whereIn('slug', array_keys($categoryDefinitions))
            ->get(['id', 'slug'])
            ->mapWithKeys(fn (BlogCategory $category) => [(string) $category->slug => (int) $category->id])
            ->all();

        foreach ($categoryDefinitions as $slug => $definition) {
            if (isset($idsBySlug[$slug])) {
                BlogCategory::where('account_id', $accountId)
                    ->whereKey($idsBySlug[$slug])
                    ->update([
                        'name' => $definition['name'],
                        'sort_order' => (int) $definition['sort_order'],
                    ]);
                continue;
            }

            $category = BlogCategory::create([
                'account_id' => $accountId,
                'name' => $definition['name'],
                'slug' => $slug,
                'sort_order' => (int) $definition['sort_order'],
            ]);

            $idsBySlug[$slug] = (int) $category->id;
        }

        return $idsBySlug;
    }

    /**
     * @param  array<int, string>  $headers
     */
    private function validateWorkbookHeaders(array $headers): void
    {
        $missing = array_values(array_diff(self::POSTS_XLSX_HEADERS, $headers));

        if (!empty($missing)) {
            throw ValidationException::withMessages([
                'bundle' => ['File Excel dang thieu cac cot bat buoc: ' . implode(', ', $missing)],
            ]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function readManifest(string $bundleRoot): array
    {
        $manifestPath = $bundleRoot . DIRECTORY_SEPARATOR . 'manifest.json';
        if (!is_file($manifestPath)) {
            throw ValidationException::withMessages([
                'bundle' => ['Khong tim thay manifest.json trong goi import.'],
            ]);
        }

        $decoded = json_decode((string) file_get_contents($manifestPath), true);
        if (!is_array($decoded)) {
            throw ValidationException::withMessages([
                'bundle' => ['manifest.json khong dung dinh dang JSON hop le.'],
            ]);
        }

        if (($decoded['type'] ?? null) !== 'webnam-blog-bundle') {
            throw ValidationException::withMessages([
                'bundle' => ['Goi import khong dung dinh dang blog bundle cua he thong.'],
            ]);
        }

        return $decoded;
    }

    private function makeWorkspace(string $prefix): string
    {
        $workspace = storage_path('app/tmp/' . $prefix . Str::lower(Str::random(12)));

        if (!mkdir($workspace, 0755, true) && !is_dir($workspace)) {
            throw new RuntimeException('Khong the tao thu muc tam.');
        }

        return $workspace;
    }

    private function extractZip(string $archivePath, string $destinationPath): void
    {
        $zip = new ZipArchive();
        if ($zip->open($archivePath) !== true) {
            throw ValidationException::withMessages([
                'bundle' => ['Khong the mo file ZIP import.'],
            ]);
        }

        if (!$zip->extractTo($destinationPath)) {
            $zip->close();
            throw ValidationException::withMessages([
                'bundle' => ['Khong the giai nen file ZIP import.'],
            ]);
        }

        $zip->close();
    }

    private function locateBundleRoot(string $extractRoot): string
    {
        if (
            is_file($extractRoot . DIRECTORY_SEPARATOR . 'manifest.json')
            && is_file($extractRoot . DIRECTORY_SEPARATOR . 'posts.xlsx')
        ) {
            return $extractRoot;
        }

        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($extractRoot, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::SELF_FIRST
        );

        foreach ($iterator as $fileInfo) {
            if (!$fileInfo->isDir()) {
                continue;
            }

            $directory = $fileInfo->getPathname();
            if (
                is_file($directory . DIRECTORY_SEPARATOR . 'manifest.json')
                && is_file($directory . DIRECTORY_SEPARATOR . 'posts.xlsx')
            ) {
                return $directory;
            }
        }

        throw ValidationException::withMessages([
            'bundle' => ['Goi import khong chua du manifest.json va posts.xlsx.'],
        ]);
    }

    /**
     * @param  array<string, string>  $assetMap
     */
    private function exportAssetToBundleReference(string $reference, string $bundleRoot, array &$assetMap): string
    {
        $normalizedReference = trim(html_entity_decode($reference, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($normalizedReference === '') {
            return '';
        }

        if (isset($assetMap[$normalizedReference])) {
            return $assetMap[$normalizedReference];
        }

        $asset = $this->downloadAsset($normalizedReference);
        $extension = $this->resolveAssetExtension(
            $asset['extension'] ?? null,
            $asset['mime'] ?? null,
            $normalizedReference
        );
        $hash = sha1($asset['contents']);
        $relativePath = 'media/' . substr($hash, 0, 2) . '/' . $hash . '.' . $extension;
        $absolutePath = $bundleRoot . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);

        $directory = dirname($absolutePath);
        if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
            throw new RuntimeException('Khong the tao thu muc media trong bundle.');
        }

        if (!is_file($absolutePath)) {
            file_put_contents($absolutePath, $asset['contents']);
        }

        $assetMap[$normalizedReference] = 'bundle://' . $relativePath;
        return $assetMap[$normalizedReference];
    }

    /**
     * @param  array<string, string>  $assetCache
     */
    private function importAssetReference(
        string $reference,
        string $bundleRoot,
        string $importToken,
        array &$assetCache,
        bool $store = true
    ): string {
        $normalizedReference = trim(html_entity_decode($reference, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($normalizedReference === '') {
            return '';
        }

        if (!Str::startsWith($normalizedReference, 'bundle://')) {
            return $normalizedReference;
        }

        if (isset($assetCache[$normalizedReference])) {
            return $assetCache[$normalizedReference];
        }

        $relativePath = ltrim(Str::after($normalizedReference, 'bundle://'), '/');
        $absolutePath = $this->resolveBundleFilePath($bundleRoot, $relativePath);

        if ($absolutePath === null || !is_file($absolutePath)) {
            throw new RuntimeException('Thieu file anh "' . $relativePath . '" trong goi import.');
        }

        if (!$store) {
            return $normalizedReference;
        }

        $contents = (string) file_get_contents($absolutePath);
        $extension = $this->resolveAssetExtension(
            pathinfo($absolutePath, PATHINFO_EXTENSION),
            $this->guessMimeType($contents),
            $absolutePath
        );
        $hash = sha1($contents);
        $targetPath = 'uploads/blog-import/' . $importToken . '/' . substr($hash, 0, 2) . '/' . $hash . '.' . $extension;

        if (!Storage::disk('public')->exists($targetPath)) {
            Storage::disk('public')->put($targetPath, $contents);
        }

        $assetCache[$normalizedReference] = asset('storage/' . $targetPath);
        return $assetCache[$normalizedReference];
    }

    /**
     * @return array{contents: string, mime: string, extension: ?string}
     */
    private function downloadAsset(string $reference): array
    {
        if (preg_match('/^data:(?<mime>image\/[a-zA-Z0-9.+-]+);base64,(?<data>.+)$/', $reference, $matches) === 1) {
            $contents = base64_decode((string) $matches['data'], true);
            if ($contents === false) {
                throw new RuntimeException('Khong the giai ma anh base64.');
            }

            return [
                'contents' => $contents,
                'mime' => (string) $matches['mime'],
                'extension' => $this->extensionFromMime((string) $matches['mime']),
            ];
        }

        $localPath = $this->resolveLocalAssetPath($reference);
        if ($localPath !== null) {
            if (!is_file($localPath)) {
                throw new RuntimeException('Khong tim thay anh noi bo: ' . basename($localPath));
            }

            $contents = (string) file_get_contents($localPath);

            return [
                'contents' => $contents,
                'mime' => $this->guessMimeType($contents),
                'extension' => pathinfo($localPath, PATHINFO_EXTENSION) ?: null,
            ];
        }

        if (!preg_match('/^https?:\/\//i', $reference)) {
            throw new RuntimeException('Duong dan anh khong hop le: ' . $reference);
        }

        $response = Http::timeout(20)->retry(1, 200)->get($reference);
        if (!$response->successful()) {
            throw new RuntimeException('Khong tai duoc anh tu URL: ' . $reference);
        }

        $contents = (string) $response->body();
        if ($contents === '') {
            throw new RuntimeException('Anh tai ve bi rong: ' . $reference);
        }

        return [
            'contents' => $contents,
            'mime' => trim((string) $response->header('Content-Type')) ?: $this->guessMimeType($contents),
            'extension' => pathinfo(parse_url($reference, PHP_URL_PATH) ?: '', PATHINFO_EXTENSION) ?: null,
        ];
    }

    private function resolveLocalAssetPath(string $reference): ?string
    {
        $rawReference = trim($reference);
        if ($rawReference === '') {
            return null;
        }

        $pathCandidate = $rawReference;
        $queryParams = [];

        if (preg_match('/^https?:\/\//i', $rawReference)) {
            $pathCandidate = (string) (parse_url($rawReference, PHP_URL_PATH) ?: '');
            parse_str((string) (parse_url($rawReference, PHP_URL_QUERY) ?: ''), $queryParams);
        } elseif (Str::startsWith($rawReference, '/')) {
            $pathCandidate = $rawReference;
        }

        if (str_contains($pathCandidate, '/media/proxy') && !empty($queryParams['url'])) {
            return $this->resolveLocalAssetPath((string) $queryParams['url']);
        }

        $normalizedPath = rawurldecode(trim((string) $pathCandidate));

        if (Str::startsWith($normalizedPath, '/storage/')) {
            return storage_path('app/public/' . ltrim(Str::after($normalizedPath, '/storage/'), '/'));
        }

        if (Str::startsWith($normalizedPath, 'storage/')) {
            return storage_path('app/public/' . ltrim(Str::after($normalizedPath, 'storage/'), '/'));
        }

        if (preg_match('/^[A-Za-z]:\\\\/', $normalizedPath) === 1 && is_file($normalizedPath)) {
            return $normalizedPath;
        }

        return null;
    }

    private function resolveBundleFilePath(string $bundleRoot, string $relativePath): ?string
    {
        $normalizedRelativePath = str_replace(['/', '\\'], DIRECTORY_SEPARATOR, ltrim($relativePath, '/\\'));
        if ($normalizedRelativePath === '') {
            return null;
        }

        $absolutePath = $bundleRoot . DIRECTORY_SEPARATOR . $normalizedRelativePath;
        $bundleRootRealPath = realpath($bundleRoot);
        $parentDirectory = dirname($absolutePath);

        if ($bundleRootRealPath === false || !is_dir($parentDirectory)) {
            return is_file($absolutePath) ? $absolutePath : null;
        }

        $parentRealPath = realpath($parentDirectory);
        if ($parentRealPath === false || !str_starts_with($parentRealPath, $bundleRootRealPath)) {
            return null;
        }

        return $absolutePath;
    }

    /**
     * @param  array<int, string>  $keywords
     */
    private function syncSeoKeywords(int $accountId, array $keywords): void
    {
        if (!Schema::hasTable('post_seo_keywords')) {
            return;
        }

        $normalizedKeywords = array_values(array_unique(array_filter(array_map(
            static fn ($keyword) => trim((string) $keyword),
            $keywords
        ))));

        foreach ($normalizedKeywords as $keyword) {
            PostSeoKeyword::firstOrCreate([
                'account_id' => $accountId,
                'keyword' => $keyword,
            ]);
        }
    }

    private function buildBundlePostKey(int $position, string $slugOrTitle): string
    {
        $base = Str::slug($slugOrTitle);
        if ($base === '') {
            $base = 'post';
        }

        return sprintf('post-%04d-%s', $position, Str::limit($base, 64, ''));
    }

    /**
     * @param  array<int, Post>  $posts
     */
    private function buildArchiveFilename(array $posts): string
    {
        if (count($posts) === 1) {
            $post = reset($posts);
            $slug = Str::slug((string) ($post?->slug ?: $post?->title ?: 'post'));
            return 'blog-export-' . ($slug ?: 'post') . '-' . now()->format('Ymd-His') . '.zip';
        }

        return 'blog-export-' . count($posts) . '-posts-' . now()->format('Ymd-His') . '.zip';
    }

    private function zipDirectory(string $sourceDirectory, string $zipPath): void
    {
        $zip = new ZipArchive();
        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Khong the tao file ZIP export.');
        }

        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($sourceDirectory, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );

        foreach ($iterator as $fileInfo) {
            if (!$fileInfo->isFile()) {
                continue;
            }

            $absolutePath = $fileInfo->getPathname();
            $relativePath = str_replace(
                DIRECTORY_SEPARATOR,
                '/',
                Str::after($absolutePath, $sourceDirectory . DIRECTORY_SEPARATOR)
            );
            $zip->addFile($absolutePath, $relativePath);
        }

        $zip->close();
    }

    private function parseBoolean(mixed $value, bool $default = false): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        $normalized = Str::lower(trim((string) $value));
        if ($normalized === '') {
            return $default;
        }

        if (in_array($normalized, ['1', 'true', 'yes', 'y', 'on', 'co', 'published'], true)) {
            return true;
        }

        if (in_array($normalized, ['0', 'false', 'no', 'n', 'off', 'khong', 'draft'], true)) {
            return false;
        }

        return $default;
    }

    private function parseDateValue(mixed $value): ?Carbon
    {
        $normalized = trim((string) $value);
        if ($normalized === '') {
            return null;
        }

        if (is_numeric($normalized)) {
            $serial = (float) $normalized;
            if ($serial > 0) {
                return Carbon::createFromTimestampUTC((int) round(($serial - 25569) * 86400));
            }
        }

        try {
            return Carbon::parse($normalized);
        } catch (Throwable) {
            return null;
        }
    }

    private function resolveAssetExtension(?string $extension, ?string $mimeType, string $fallbackPath): string
    {
        $normalizedExtension = Str::lower(trim((string) $extension));
        if ($normalizedExtension !== '') {
            return preg_replace('/[^a-z0-9]+/i', '', $normalizedExtension) ?: 'bin';
        }

        $mimeExtension = $this->extensionFromMime((string) $mimeType);
        if ($mimeExtension !== null) {
            return $mimeExtension;
        }

        $pathExtension = pathinfo(parse_url($fallbackPath, PHP_URL_PATH) ?: $fallbackPath, PATHINFO_EXTENSION);
        $pathExtension = Str::lower(trim((string) $pathExtension));

        return $pathExtension !== '' ? $pathExtension : 'bin';
    }

    private function extensionFromMime(string $mimeType): ?string
    {
        $normalizedMimeType = Str::lower(trim(Str::before($mimeType, ';')));

        return match ($normalizedMimeType) {
            'image/jpeg', 'image/jpg' => 'jpg',
            'image/png' => 'png',
            'image/gif' => 'gif',
            'image/webp' => 'webp',
            'image/avif' => 'avif',
            'image/svg+xml' => 'svg',
            'image/bmp' => 'bmp',
            default => null,
        };
    }

    private function guessMimeType(string $contents): string
    {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mimeType = $finfo ? (string) finfo_buffer($finfo, $contents) : '';
        if ($finfo) {
            finfo_close($finfo);
        }

        return $mimeType ?: 'application/octet-stream';
    }

    private function cleanupDirectory(?string $path): void
    {
        if (!$path || !file_exists($path)) {
            return;
        }

        if (is_file($path) || is_link($path)) {
            @unlink($path);
            return;
        }

        $items = scandir($path);
        if ($items === false) {
            return;
        }

        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }

            $this->cleanupDirectory($path . DIRECTORY_SEPARATOR . $item);
        }

        @rmdir($path);
    }
}
