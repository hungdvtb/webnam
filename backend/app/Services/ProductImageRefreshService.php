<?php

namespace App\Services;

use App\Models\Product;
use App\Models\ProductImage;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

class ProductImageRefreshService
{
    public function __construct(
        protected MediaService $mediaService
    ) {
    }

    /**
     * @param  array<int, UploadedFile>  $files
     * @param  array{
     *     product_ids?: array<int, int|string>,
     *     scope_selected_only?: bool,
     *     update_all_matches?: bool
     * }  $options
     */
    public function preview(array $files, array $options = []): array
    {
        $inputGroups = $this->groupInputFiles($files);
        $scopeProductIds = $this->resolveScopedProductIds($options);
        $imageMap = $this->buildProductImageMap($scopeProductIds);

        return $this->buildPlan(
            $inputGroups,
            $imageMap,
            [
                'scope_selected_only' => !empty($options['scope_selected_only']) && !empty($scopeProductIds),
                'update_all_matches' => (bool) ($options['update_all_matches'] ?? false),
                'scoped_product_count' => count($scopeProductIds),
            ]
        );
    }

    /**
     * @param  array<int, UploadedFile>  $files
     * @param  array{
     *     product_ids?: array<int, int|string>,
     *     scope_selected_only?: bool,
     *     update_all_matches?: bool
     * }  $options
     */
    public function apply(array $files, array $options = []): array
    {
        $inputGroups = $this->groupInputFiles($files);
        $scopeProductIds = $this->resolveScopedProductIds($options);
        $imageMap = $this->buildProductImageMap($scopeProductIds);
        $plan = $this->buildPlan(
            $inputGroups,
            $imageMap,
            [
                'scope_selected_only' => !empty($options['scope_selected_only']) && !empty($scopeProductIds),
                'update_all_matches' => (bool) ($options['update_all_matches'] ?? false),
                'scoped_product_count' => count($scopeProductIds),
            ]
        );

        $updatedProductIds = [];
        $updatedRecords = 0;
        $failedRecords = 0;
        $appliedFileNames = 0;

        foreach ($plan['items'] as $item) {
            if (($item['status'] ?? '') !== 'ready') {
                continue;
            }

            $normalizedName = (string) ($item['normalized_name'] ?? '');
            $inputGroup = $inputGroups[$normalizedName] ?? null;
            $sourceFile = $inputGroup['files'][0]['file'] ?? null;

            if (!$sourceFile instanceof UploadedFile) {
                continue;
            }

            $seedAsset = null;
            $seedAssetAttached = false;
            $itemUpdated = false;

            foreach ((array) ($item['target_records'] ?? []) as $targetRecord) {
                $productImageId = (int) ($targetRecord['product_image_id'] ?? 0);
                if ($productImageId <= 0) {
                    continue;
                }

                $productImage = ProductImage::query()
                    ->with('product')
                    ->find($productImageId);

                if (!$productImage) {
                    $failedRecords++;
                    continue;
                }

                $nextAsset = null;
                $usedSeedAsset = false;

                try {
                    if ($seedAsset === null) {
                        $seedAsset = $this->mediaService->uploadImage($sourceFile, [
                            'collection' => 'products',
                            'source' => 'product-image-bulk-refresh',
                        ]);
                    }

                    if (!$seedAssetAttached) {
                        $nextAsset = $seedAsset;
                        $usedSeedAsset = true;
                    } else {
                        $nextAsset = $this->mediaService->cloneAssetFromExisting(
                            $seedAsset,
                            [
                                'collection' => 'products',
                                'source' => 'product-image-bulk-refresh-clone',
                            ],
                            $sourceFile->getClientOriginalName()
                        );
                    }

                    $previousAssetId = $productImage->media_asset_id
                        ? (int) $productImage->media_asset_id
                        : null;

                    DB::transaction(function () use ($productImage, $nextAsset, $sourceFile): void {
                        $productImage->forceFill([
                            'media_asset_id' => $nextAsset->id,
                            'image_url' => $this->mediaService->buildAssetUrl($nextAsset, 'large'),
                            'file_name' => $sourceFile->getClientOriginalName(),
                            'file_size' => $sourceFile->getSize() ?: null,
                        ])->save();
                    });

                    if ($usedSeedAsset) {
                        $seedAssetAttached = true;
                    }

                    $this->deleteAssetIfUnused($previousAssetId);

                    $updatedRecords++;
                    $itemUpdated = true;
                    $updatedProductIds[] = (int) $productImage->product_id;
                } catch (Throwable $exception) {
                    $failedRecords++;

                    if (!$usedSeedAsset && $nextAsset?->id) {
                        $this->deleteAssetSilently((int) $nextAsset->id);
                    }
                }
            }

            if ($seedAsset && !$seedAssetAttached) {
                $this->deleteAssetSilently((int) $seedAsset->id);
            }

            if ($itemUpdated) {
                $appliedFileNames++;
            }
        }

        $updatedProductIds = array_values(array_unique(array_filter($updatedProductIds)));

        if (!empty($updatedProductIds)) {
            Product::withTrashed()
                ->whereIn('id', $updatedProductIds)
                ->update(['updated_at' => now()]);
        }

        $plan['summary']['updated_records'] = $updatedRecords;
        $plan['summary']['failed_records'] = $failedRecords;
        $plan['summary']['updated_products'] = count($updatedProductIds);
        $plan['summary']['applied_file_names'] = $appliedFileNames;

        return array_merge($plan, [
            'updated_product_ids' => $updatedProductIds,
        ]);
    }

    /**
     * @param  array<int, UploadedFile>  $files
     * @return array<string, array{normalized_name: string, file_name: string, input_count: int, files: array<int, array{name: string, size: int|null, file: UploadedFile}>}>
     */
    protected function groupInputFiles(array $files): array
    {
        $groups = [];

        foreach ($files as $file) {
            if (!$file instanceof UploadedFile) {
                continue;
            }

            $fileName = trim((string) $file->getClientOriginalName());
            $normalizedName = $this->normalizeFileName($fileName);

            if ($normalizedName === '') {
                continue;
            }

            if (!isset($groups[$normalizedName])) {
                $groups[$normalizedName] = [
                    'normalized_name' => $normalizedName,
                    'file_name' => $fileName,
                    'input_count' => 0,
                    'files' => [],
                ];
            }

            $groups[$normalizedName]['files'][] = [
                'name' => $fileName,
                'size' => $file->getSize() ?: null,
                'file' => $file,
            ];
            $groups[$normalizedName]['input_count']++;
        }

        return $groups;
    }

    /**
     * @param  array{
     *     product_ids?: array<int, int|string>,
     *     scope_selected_only?: bool
     * }  $options
     * @return array<int, int>
     */
    protected function resolveScopedProductIds(array $options): array
    {
        if (empty($options['scope_selected_only'])) {
            return [];
        }

        return array_values(array_unique(array_filter(
            array_map(
                static fn ($value) => is_numeric($value) ? (int) $value : 0,
                (array) ($options['product_ids'] ?? [])
            ),
            static fn (int $value) => $value > 0
        )));
    }

    /**
     * @param  array<int, int>  $productIds
     * @return array<string, array<int, ProductImage>>
     */
    protected function buildProductImageMap(array $productIds = []): array
    {
        $images = ProductImage::query()
            ->with([
                'product:id,name,sku',
                'mediaAsset:id,original_name',
            ])
            ->where(function ($query) {
                $query->whereNotNull('file_name')
                    ->orWhereHas('mediaAsset', function ($assetQuery) {
                        $assetQuery->whereNotNull('original_name');
                    });
            })
            ->whereHas('product', function ($productQuery) use ($productIds) {
                if (!empty($productIds)) {
                    $productQuery->whereIn('products.id', $productIds);
                }
            })
            ->orderBy('product_images.id')
            ->get();

        $map = [];

        foreach ($images as $image) {
            $matchedName = trim((string) ($image->file_name ?: $image->mediaAsset?->original_name ?: ''));
            $normalizedName = $this->normalizeFileName($matchedName);

            if ($normalizedName === '') {
                continue;
            }

            $map[$normalizedName][] = $image;
        }

        return $map;
    }

    /**
     * @param  array<string, array{normalized_name: string, file_name: string, input_count: int, files: array<int, array{name: string, size: int|null, file: UploadedFile}>}>  $inputGroups
     * @param  array<string, array<int, ProductImage>>  $productImageMap
     * @param  array{
     *     scope_selected_only: bool,
     *     update_all_matches: bool,
     *     scoped_product_count: int
     * }  $options
     */
    protected function buildPlan(array $inputGroups, array $productImageMap, array $options): array
    {
        $summary = [
            'uploaded_files' => 0,
            'unique_file_names' => count($inputGroups),
            'ready_files' => 0,
            'unmatched_files' => 0,
            'ambiguous_files' => 0,
            'duplicate_input_files' => 0,
            'matched_records' => 0,
        ];

        $items = [];

        foreach ($inputGroups as $normalizedName => $inputGroup) {
            $summary['uploaded_files'] += (int) ($inputGroup['input_count'] ?? 0);

            $candidateRecords = array_map(
                fn (ProductImage $image) => $this->serializeCandidateRecord($image),
                $productImageMap[$normalizedName] ?? []
            );

            $candidateCount = count($candidateRecords);
            $status = 'ready';
            $targetRecords = $candidateRecords;

            if (($inputGroup['input_count'] ?? 0) > 1) {
                $status = 'duplicate_input';
                $targetRecords = [];
                $summary['duplicate_input_files']++;
            } elseif ($candidateCount === 0) {
                $status = 'unmatched';
                $targetRecords = [];
                $summary['unmatched_files']++;
            } elseif ($candidateCount > 1 && empty($options['update_all_matches'])) {
                $status = 'ambiguous';
                $targetRecords = [];
                $summary['ambiguous_files']++;
            } else {
                $summary['ready_files']++;
                $summary['matched_records'] += $candidateCount;
            }

            $items[] = [
                'file_name' => $inputGroup['file_name'],
                'normalized_name' => $normalizedName,
                'input_count' => (int) $inputGroup['input_count'],
                'input_files' => array_map(
                    static fn (array $file) => [
                        'name' => $file['name'],
                        'size' => $file['size'],
                    ],
                    $inputGroup['files']
                ),
                'status' => $status,
                'candidate_count' => $candidateCount,
                'target_count' => count($targetRecords),
                'can_update_all_matches' => $candidateCount > 1,
                'candidate_records' => $candidateRecords,
                'target_records' => $targetRecords,
            ];
        }

        return [
            'options' => $options,
            'summary' => $summary,
            'items' => $items,
        ];
    }

    protected function serializeCandidateRecord(ProductImage $image): array
    {
        $matchedBy = filled($image->file_name) ? 'file_name' : 'media_asset_original_name';
        $matchedName = trim((string) ($image->file_name ?: $image->mediaAsset?->original_name ?: ''));

        return [
            'product_image_id' => (int) $image->id,
            'product_id' => (int) $image->product_id,
            'product_name' => trim((string) ($image->product?->name ?: ('San pham #' . $image->product_id))),
            'product_sku' => trim((string) ($image->product?->sku ?: '')),
            'image_url' => (string) ($image->large_url ?: $image->image_url),
            'thumbnail_url' => (string) ($image->thumbnail_url ?: $image->large_url ?: $image->image_url),
            'file_name' => trim((string) $image->file_name),
            'matched_name' => $matchedName,
            'matched_by' => $matchedBy,
            'is_primary' => (bool) $image->is_primary,
            'sort_order' => (int) $image->sort_order,
        ];
    }

    protected function normalizeFileName(?string $value): string
    {
        return strtolower(trim((string) $value));
    }

    protected function deleteAssetIfUnused(?int $assetId): void
    {
        if (!$assetId) {
            return;
        }

        if (ProductImage::query()->where('media_asset_id', $assetId)->exists()) {
            return;
        }

        foreach ($this->assetReferenceColumns() as $reference) {
            $table = (string) ($reference['table'] ?? '');
            $column = (string) ($reference['column'] ?? '');

            if ($table === '' || $column === '' || !Schema::hasTable($table) || !Schema::hasColumn($table, $column)) {
                continue;
            }

            if (DB::table($table)->where($column, $assetId)->exists()) {
                return;
            }
        }

        $this->deleteAssetSilently($assetId);
    }

    protected function deleteAssetSilently(int $assetId): void
    {
        try {
            $this->mediaService->deleteAsset($assetId);
        } catch (Throwable) {
            // Ignore cleanup failures so the image update itself still succeeds.
        }
    }

    /**
     * @return array<int, array{table: string, column: string}>
     */
    protected function assetReferenceColumns(): array
    {
        return [
            ['table' => 'banners', 'column' => 'media_asset_id'],
            ['table' => 'categories', 'column' => 'banner_media_asset_id'],
            ['table' => 'categories', 'column' => 'logo_media_asset_id'],
            ['table' => 'posts', 'column' => 'featured_media_asset_id'],
        ];
    }
}
