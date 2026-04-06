<?php

namespace App\Console\Commands;

use App\Models\ProductImage;
use App\Services\MediaService;
use Illuminate\Console\Command;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use SplFileInfo;
use Throwable;

class SyncProductImagesFromDirectory extends Command
{
    protected $signature = 'product-images:sync-directory
        {directory : Thu muc chua anh da xoa logo/can cap nhat}
        {--dry-run : Chi kiem tra match, khong ghi database}
        {--update-all-matches : Cho phep mot ten file cap nhat nhieu ProductImage}';

    protected $description = 'Bulk sync product images from a local directory by matching original filenames.';

    /**
     * @var array<int, string>
     */
    private const SUPPORTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'];

    public function handle(MediaService $mediaService): int
    {
        $resolvedDirectory = $this->resolveDirectory((string) $this->argument('directory'));
        if ($resolvedDirectory === null) {
            $this->error('Khong tim thay thu muc anh can dong bo.');

            return self::FAILURE;
        }

        $files = $this->collectImageFiles($resolvedDirectory);
        if ($files === []) {
            $this->warn('Thu muc khong co anh hop le de xu ly.');

            return self::SUCCESS;
        }

        $inputGroups = [];
        foreach ($files as $filePath) {
            $key = $this->normalizeFileName(basename($filePath));
            $inputGroups[$key][] = $filePath;
        }

        $productImageMap = $this->buildProductImageMap();
        $allowMultipleMatches = (bool) $this->option('update-all-matches');
        $dryRun = (bool) $this->option('dry-run');
        $reportedDuplicateKeys = [];

        $summary = [
            'scanned_files' => count($files),
            'matched_files' => 0,
            'unmatched_files' => 0,
            'ambiguous_files' => 0,
            'duplicate_input_names' => 0,
            'updated_records' => 0,
            'created_assets' => 0,
            'failed_records' => 0,
        ];

        foreach ($files as $filePath) {
            $basename = basename($filePath);
            $normalizedName = $this->normalizeFileName($basename);
            $inputMatches = $inputGroups[$normalizedName] ?? [];

            if (count($inputMatches) > 1) {
                if (!isset($reportedDuplicateKeys[$normalizedName])) {
                    $reportedDuplicateKeys[$normalizedName] = true;
                    $summary['duplicate_input_names']++;
                    $this->warn(sprintf(
                        'Bo qua "%s" vi trong thu muc co nhieu file trung ten. Hay doi ten de map ro rang hon.',
                        $basename
                    ));
                }

                continue;
            }

            $matchedImages = $productImageMap[$normalizedName] ?? [];
            $matchCount = count($matchedImages);

            if ($matchCount === 0) {
                $summary['unmatched_files']++;
                $this->line(sprintf('Khong tim thay ProductImage nao khop ten file "%s".', $basename));
                continue;
            }

            if ($matchCount > 1 && !$allowMultipleMatches) {
                $summary['ambiguous_files']++;
                $this->warn(sprintf(
                    'Bo qua "%s" vi dang khop %d ProductImage. Dung --update-all-matches neu ban muon cap nhat tat ca.',
                    $basename,
                    $matchCount
                ));
                continue;
            }

            $summary['matched_files']++;

            if ($dryRun) {
                $summary['updated_records'] += $matchCount;
                $this->info(sprintf('[dry-run] "%s" se cap nhat %d ProductImage.', $basename, $matchCount));
                continue;
            }

            foreach ($matchedImages as $productImage) {
                try {
                    $asset = $mediaService->importFromAbsolutePath($filePath, [
                        'collection' => 'products',
                        'source' => 'product-image-directory-sync',
                    ]);

                    $productImage->forceFill([
                        'media_asset_id' => $asset->id,
                        'image_url' => $mediaService->buildAssetUrl($asset, 'large'),
                        'file_name' => $basename,
                        'file_size' => filesize($filePath) ?: null,
                    ])->save();

                    $summary['updated_records']++;
                    $summary['created_assets']++;
                } catch (Throwable $exception) {
                    $summary['failed_records']++;
                    $this->warn(sprintf(
                        'Khong the cap nhat ProductImage #%d tu file "%s": %s',
                        $productImage->id,
                        $basename,
                        $exception->getMessage()
                    ));
                }
            }
        }

        $this->newLine();
        $this->table(
            ['Chi so', 'Gia tri'],
            [
                ['Files scanned', (string) $summary['scanned_files']],
                ['Files matched', (string) $summary['matched_files']],
                ['Files unmatched', (string) $summary['unmatched_files']],
                ['Files ambiguous', (string) $summary['ambiguous_files']],
                ['Duplicate input names', (string) $summary['duplicate_input_names']],
                ['Records updated', (string) $summary['updated_records']],
                ['Assets created', (string) $summary['created_assets']],
                ['Failed records', (string) $summary['failed_records']],
            ]
        );

        if ($dryRun) {
            $this->comment('Dry-run da hoan tat. Khong co thay doi nao duoc ghi vao database.');
        } elseif ($summary['failed_records'] === 0) {
            $this->info('Dong bo anh san pham hoan tat.');
        }

        return $summary['failed_records'] > 0 ? self::FAILURE : self::SUCCESS;
    }

    private function resolveDirectory(string $directory): ?string
    {
        $resolved = realpath($directory);

        return ($resolved !== false && is_dir($resolved)) ? $resolved : null;
    }

    /**
     * @return array<int, string>
     */
    private function collectImageFiles(string $directory): array
    {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($directory, RecursiveDirectoryIterator::SKIP_DOTS)
        );

        $paths = [];

        /** @var SplFileInfo $file */
        foreach ($iterator as $file) {
            if (!$file->isFile()) {
                continue;
            }

            $extension = strtolower((string) $file->getExtension());
            if (!in_array($extension, self::SUPPORTED_EXTENSIONS, true)) {
                continue;
            }

            $paths[] = $file->getPathname();
        }

        sort($paths, SORT_NATURAL | SORT_FLAG_CASE);

        return $paths;
    }

    /**
     * @return array<string, array<int, ProductImage>>
     */
    private function buildProductImageMap(): array
    {
        $images = ProductImage::query()
            ->with('mediaAsset')
            ->where(function ($query) {
                $query->whereNotNull('file_name')
                    ->orWhereHas('mediaAsset', function ($assetQuery) {
                        $assetQuery->whereNotNull('original_name');
                    });
            })
            ->orderBy('id')
            ->get();

        $map = [];

        foreach ($images as $image) {
            $candidateName = trim((string) ($image->file_name ?: $image->mediaAsset?->original_name ?: ''));
            $normalizedName = $this->normalizeFileName($candidateName);

            if ($normalizedName === '') {
                continue;
            }

            $map[$normalizedName][] = $image;
        }

        return $map;
    }

    private function normalizeFileName(?string $value): string
    {
        return strtolower(trim((string) $value));
    }
}
