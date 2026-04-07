<?php

namespace App\Services;

use App\Models\Product;
use App\Models\ProductImage;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Throwable;

class ProductImageBulkAppendService
{
    private const DEFAULT_PREVIEW_LIMIT = 24;

    public function __construct(
        protected MediaService $mediaService
    ) {
    }

    /**
     * @param  array<int, UploadedFile>  $files
     * @param  array{
     *     product_ids?: array<int, int|string>,
     *     scope_selected_only?: bool,
     *     insertion_mode?: string,
     *     after_index?: int|null,
     *     preview_limit?: int|null
     * }  $options
     */
    public function preview(array $files, array $options = []): array
    {
        $normalizedOptions = $this->normalizeOptions($options);
        $uploads = $this->buildUploadEntries($files);
        $products = $this->resolveTargetProducts($normalizedOptions);

        return $this->buildPlan(
            $uploads,
            $products,
            $normalizedOptions,
            $normalizedOptions['preview_limit']
        );
    }

    /**
     * @param  array<int, UploadedFile>  $files
     * @param  array{
     *     product_ids?: array<int, int|string>,
     *     scope_selected_only?: bool,
     *     insertion_mode?: string,
     *     after_index?: int|null,
     *     preview_limit?: int|null
     * }  $options
     */
    public function apply(array $files, array $options = []): array
    {
        $normalizedOptions = $this->normalizeOptions($options);
        $uploads = $this->buildUploadEntries($files);
        $products = $this->resolveTargetProducts($normalizedOptions);
        $plan = $this->buildPlan(
            $uploads,
            $products,
            $normalizedOptions,
            $normalizedOptions['preview_limit']
        );

        if (empty($plan['summary']['can_apply'])) {
            throw ValidationException::withMessages([
                'images' => [$this->buildBlockedApplyMessage($plan)],
            ]);
        }

        $seedAssets = [];
        $seedAssetAttached = [];
        $appliedProductIds = [];
        $failedProducts = [];
        $createdRecords = 0;

        try {
            foreach ($uploads as $upload) {
                $uploadIndex = (int) $upload['upload_index'];
                $seedAssets[$uploadIndex] = $this->mediaService->uploadImage(
                    $upload['file'],
                    [
                        'collection' => 'products',
                        'source' => 'product-image-bulk-append',
                    ]
                );
                $seedAssetAttached[$uploadIndex] = false;
            }

            foreach ($products as $product) {
                $decision = $this->resolveInsertionDecision($product->images->count(), $normalizedOptions);
                if (($decision['status'] ?? '') !== 'ready') {
                    continue;
                }

                try {
                    $createdForProduct = $this->appendImagesToProduct(
                        $product,
                        $uploads,
                        (int) ($decision['insertion_index'] ?? 0),
                        $seedAssets,
                        $seedAssetAttached
                    );

                    if ($createdForProduct > 0) {
                        $createdRecords += $createdForProduct;
                        $appliedProductIds[] = (int) $product->id;
                    }
                } catch (Throwable $exception) {
                    $failedProducts[] = [
                        'product_id' => (int) $product->id,
                        'product_name' => (string) $product->name,
                        'product_sku' => (string) ($product->sku ?? ''),
                        'message' => $exception->getMessage(),
                    ];
                }
            }
        } finally {
            $this->cleanupUnusedSeedAssets($seedAssets, $seedAssetAttached);
        }

        $appliedProductIds = array_values(array_unique(array_filter($appliedProductIds)));

        if (!empty($appliedProductIds)) {
            Product::withTrashed()
                ->whereIn('id', $appliedProductIds)
                ->update(['updated_at' => now()]);
        }

        $plan['summary']['applied_products'] = count($appliedProductIds);
        $plan['summary']['created_records'] = $createdRecords;
        $plan['summary']['failed_products'] = count($failedProducts);
        $plan['summary']['failed_records'] = count($failedProducts) * count($uploads);

        return array_merge($plan, [
            'applied_product_ids' => $appliedProductIds,
            'failed_products' => $failedProducts,
        ]);
    }

    /**
     * @param  array{
     *     product_ids?: array<int, int|string>,
     *     scope_selected_only?: bool,
     *     insertion_mode?: string,
     *     after_index?: int|null,
     *     preview_limit?: int|null
     * }  $options
     * @return array{
     *     product_ids: array<int, int>,
     *     scope_selected_only: bool,
     *     insertion_mode: string,
     *     after_index: int|null,
     *     preview_limit: int
     * }
     */
    protected function normalizeOptions(array $options): array
    {
        $normalizedIds = array_values(array_unique(array_filter(
            array_map(
                static fn ($value) => is_numeric($value) ? (int) $value : 0,
                (array) ($options['product_ids'] ?? [])
            ),
            static fn (int $value) => $value > 0
        )));

        $mode = strtolower(trim((string) ($options['insertion_mode'] ?? 'end')));
        if (!in_array($mode, ['start', 'after_index', 'end'], true)) {
            $mode = 'end';
        }

        $afterIndex = null;
        if ($mode === 'after_index') {
            $afterIndex = is_numeric($options['after_index'] ?? null)
                ? max(1, (int) $options['after_index'])
                : 1;
        }

        $previewLimit = is_numeric($options['preview_limit'] ?? null)
            ? max(1, min(100, (int) $options['preview_limit']))
            : self::DEFAULT_PREVIEW_LIMIT;

        return [
            'product_ids' => $normalizedIds,
            'scope_selected_only' => !empty($options['scope_selected_only']) && !empty($normalizedIds),
            'insertion_mode' => $mode,
            'after_index' => $afterIndex,
            'preview_limit' => $previewLimit,
        ];
    }

    /**
     * @param  array<int, UploadedFile>  $files
     * @return array<int, array{upload_index: int, file_name: string, file_size: int|null, file: UploadedFile}>
     */
    protected function buildUploadEntries(array $files): array
    {
        $uploads = [];

        foreach ($files as $file) {
            if (!$file instanceof UploadedFile) {
                continue;
            }

            $uploads[] = [
                'upload_index' => count($uploads),
                'file_name' => trim((string) $file->getClientOriginalName()),
                'file_size' => $file->getSize() ?: null,
                'file' => $file,
            ];
        }

        return $uploads;
    }

    /**
     * @param  array{
     *     product_ids: array<int, int>,
     *     scope_selected_only: bool,
     *     insertion_mode: string,
     *     after_index: int|null,
     *     preview_limit: int
     * }  $options
     * @return Collection<int, Product>
     */
    protected function resolveTargetProducts(array $options): Collection
    {
        $query = Product::query()
            ->select(['id', 'name', 'sku', 'sort_order'])
            ->with([
                'images' => function ($imageQuery) {
                    $imageQuery
                        ->with('mediaAsset')
                        ->orderByDesc('is_primary')
                        ->orderBy('sort_order')
                        ->orderBy('id');
                },
            ]);

        if (!empty($options['scope_selected_only'])) {
            $selectedIds = $options['product_ids'];
            $query->whereIn('id', $selectedIds);
        } else {
            $query->orderBy('sort_order')->orderBy('id');
        }

        $products = $query->get();

        if (!empty($options['scope_selected_only'])) {
            $positionMap = array_flip($options['product_ids']);
            $products = $products->sortBy(
                static fn (Product $product) => $positionMap[(int) $product->id] ?? PHP_INT_MAX
            )->values();
        }

        if ($products->isEmpty()) {
            throw ValidationException::withMessages([
                'product_ids' => [
                    !empty($options['scope_selected_only'])
                        ? 'Khong co san pham nao trong danh sach da chon de them anh.'
                        : 'Khong tim thay san pham nao de them anh hang loat.',
                ],
            ]);
        }

        return $products->values();
    }

    /**
     * @param  array<int, array{upload_index: int, file_name: string, file_size: int|null, file: UploadedFile}>  $uploads
     * @param  Collection<int, Product>  $products
     * @param  array{
     *     product_ids: array<int, int>,
     *     scope_selected_only: bool,
     *     insertion_mode: string,
     *     after_index: int|null,
     *     preview_limit: int
     * }  $options
     */
    protected function buildPlan(array $uploads, Collection $products, array $options, int $previewLimit): array
    {
        $uploadedCount = count($uploads);
        $existingCounts = $products->map(
            static fn (Product $product) => (int) $product->images->count()
        );

        $minExistingCount = $existingCounts->isEmpty() ? 0 : (int) $existingCounts->min();

        $summary = [
            'uploaded_files' => $uploadedCount,
            'new_images_per_product' => $uploadedCount,
            'target_products' => $products->count(),
            'eligible_products' => 0,
            'blocking_products' => 0,
            'products_with_no_images' => 0,
            'total_existing_images' => 0,
            'total_resulting_images' => 0,
            'inserted_records' => 0,
            'preview_products' => min($products->count(), $previewLimit),
            'hidden_preview_products' => max($products->count() - $previewLimit, 0),
            'supported_after_index_max_for_all_targets' => $minExistingCount,
        ];

        $previewProducts = [];

        foreach ($products as $productIndex => $product) {
            $existingImages = $product->images->values();
            $existingCount = (int) $existingImages->count();
            $decision = $this->resolveInsertionDecision($existingCount, $options);

            $summary['total_existing_images'] += $existingCount;

            if ($existingCount === 0) {
                $summary['products_with_no_images']++;
            }

            if (($decision['status'] ?? '') === 'ready') {
                $summary['eligible_products']++;
                $summary['inserted_records'] += $uploadedCount;
                $summary['total_resulting_images'] += $existingCount + $uploadedCount;
            } else {
                $summary['blocking_products']++;
            }

            if ($productIndex >= $previewLimit) {
                continue;
            }

            $previewProducts[] = $this->serializeProductPreview(
                $product,
                $existingImages,
                $uploads,
                $decision
            );
        }

        $summary['can_apply'] = $uploadedCount > 0
            && $summary['eligible_products'] > 0
            && $summary['blocking_products'] === 0;

        return [
            'options' => [
                'scope_selected_only' => (bool) $options['scope_selected_only'],
                'scope' => !empty($options['scope_selected_only']) ? 'selected' : 'all',
                'insertion_mode' => $options['insertion_mode'],
                'after_index' => $options['after_index'],
                'position_label' => $this->formatInsertionLabel($options['insertion_mode'], $options['after_index']),
                'preview_limit' => $previewLimit,
            ],
            'summary' => $summary,
            'uploads' => array_map(
                static fn (array $upload) => [
                    'upload_index' => $upload['upload_index'],
                    'file_name' => $upload['file_name'],
                    'file_size' => $upload['file_size'],
                ],
                $uploads
            ),
            'products' => $previewProducts,
        ];
    }

    /**
     * @param  Collection<int, ProductImage>  $existingImages
     * @param  array<int, array{upload_index: int, file_name: string, file_size: int|null, file: UploadedFile}>  $uploads
     * @param  array{status: string, insertion_index: int, insertion_label: string, error_message: string|null}  $decision
     */
    protected function serializeProductPreview(
        Product $product,
        Collection $existingImages,
        array $uploads,
        array $decision
    ): array {
        $status = (string) ($decision['status'] ?? 'ready');
        $existingCount = (int) $existingImages->count();
        $insertionIndex = (int) ($decision['insertion_index'] ?? 0);

        $previewItems = [];

        if ($status === 'ready') {
            $beforeItems = $existingImages->slice(0, $insertionIndex)->values();
            $afterItems = $existingImages->slice($insertionIndex)->values();
            $positionAfter = 1;

            foreach ($beforeItems as $index => $image) {
                $previewItems[] = $this->serializeExistingPreviewItem(
                    $image,
                    $index + 1,
                    $positionAfter,
                    $positionAfter === 1
                );
                $positionAfter++;
            }

            foreach ($uploads as $upload) {
                $previewItems[] = [
                    'kind' => 'new',
                    'position_before' => null,
                    'position_after' => $positionAfter,
                    'upload_index' => $upload['upload_index'],
                    'file_name' => $upload['file_name'],
                    'file_size' => $upload['file_size'],
                    'is_primary_after' => $positionAfter === 1,
                ];
                $positionAfter++;
            }

            foreach ($afterItems as $index => $image) {
                $previewItems[] = $this->serializeExistingPreviewItem(
                    $image,
                    $insertionIndex + $index + 1,
                    $positionAfter,
                    $positionAfter === 1
                );
                $positionAfter++;
            }
        } else {
            foreach ($existingImages as $index => $image) {
                $position = $index + 1;
                $previewItems[] = $this->serializeExistingPreviewItem(
                    $image,
                    $position,
                    $position,
                    $position === 1
                );
            }
        }

        return [
            'product_id' => (int) $product->id,
            'product_name' => (string) $product->name,
            'product_sku' => (string) ($product->sku ?? ''),
            'existing_image_count' => $existingCount,
            'resulting_image_count' => $status === 'ready'
                ? $existingCount + count($uploads)
                : $existingCount,
            'status' => $status,
            'error_message' => $decision['error_message'],
            'insertion_index' => $insertionIndex,
            'insertion_label' => $decision['insertion_label'],
            'preview_items' => $previewItems,
        ];
    }

    protected function serializeExistingPreviewItem(
        ProductImage $image,
        int $positionBefore,
        int $positionAfter,
        bool $isPrimaryAfter
    ): array {
        return [
            'kind' => 'existing',
            'image_id' => (int) $image->id,
            'position_before' => $positionBefore,
            'position_after' => $positionAfter,
            'file_name' => (string) ($image->file_name ?: ('image-' . $image->id)),
            'thumbnail_url' => (string) ($image->thumbnail_url ?: $image->image_url),
            'image_url' => (string) ($image->large_url ?: $image->image_url),
            'is_primary_before' => (bool) $image->is_primary,
            'is_primary_after' => $isPrimaryAfter,
        ];
    }

    /**
     * @param  array{
     *     product_ids: array<int, int>,
     *     scope_selected_only: bool,
     *     insertion_mode: string,
     *     after_index: int|null,
     *     preview_limit: int
     * }  $options
     * @return array{status: string, insertion_index: int, insertion_label: string, error_message: string|null}
     */
    protected function resolveInsertionDecision(int $existingImageCount, array $options): array
    {
        $mode = (string) $options['insertion_mode'];
        $afterIndex = $options['after_index'];

        if ($mode === 'start') {
            return [
                'status' => 'ready',
                'insertion_index' => 0,
                'insertion_label' => $this->formatInsertionLabel($mode, $afterIndex),
                'error_message' => null,
            ];
        }

        if ($mode === 'end') {
            return [
                'status' => 'ready',
                'insertion_index' => $existingImageCount,
                'insertion_label' => $this->formatInsertionLabel($mode, $afterIndex),
                'error_message' => null,
            ];
        }

        $afterIndex = max(1, (int) $afterIndex);

        if ($existingImageCount < $afterIndex) {
            return [
                'status' => 'insufficient_images',
                'insertion_index' => $existingImageCount,
                'insertion_label' => $this->formatInsertionLabel($mode, $afterIndex),
                'error_message' => $existingImageCount > 0
                    ? sprintf('San pham nay chi co %d anh goc, khong the chen sau anh so %d.', $existingImageCount, $afterIndex)
                    : sprintf('San pham nay chua co anh goc nao, khong the chen sau anh so %d.', $afterIndex),
            ];
        }

        return [
            'status' => 'ready',
            'insertion_index' => $afterIndex,
            'insertion_label' => $this->formatInsertionLabel($mode, $afterIndex),
            'error_message' => null,
        ];
    }

    protected function formatInsertionLabel(string $mode, ?int $afterIndex): string
    {
        return match ($mode) {
            'start' => 'Chen len dau',
            'after_index' => 'Chen sau anh so ' . max(1, (int) $afterIndex),
            default => 'Chen xuong cuoi',
        };
    }

    protected function buildBlockedApplyMessage(array $plan): string
    {
        $blockingProducts = (int) ($plan['summary']['blocking_products'] ?? 0);
        $afterIndex = (int) ($plan['options']['after_index'] ?? 0);
        $supportedMax = (int) ($plan['summary']['supported_after_index_max_for_all_targets'] ?? 0);

        if ($blockingProducts > 0 && $afterIndex > 0) {
            return $supportedMax > 0
                ? sprintf(
                    'Co %d san pham khong du anh goc de chen sau anh so %d. Vi tri dong bo hien tai chi ho tro toi anh so %d.',
                    $blockingProducts,
                    $afterIndex,
                    $supportedMax
                )
                : sprintf(
                    'Co %d san pham khong co du anh goc de chen sau anh so %d. Hay chon chen len dau hoac chen xuong cuoi.',
                    $blockingProducts,
                    $afterIndex
                );
        }

        return 'Khong co san pham hop le de them anh hang loat.';
    }

    /**
     * @param  array<int, array{upload_index: int, file_name: string, file_size: int|null, file: UploadedFile}>  $uploads
     * @param  array<int, \App\Models\MediaAsset>  $seedAssets
     * @param  array<int, bool>  $seedAssetAttached
     */
    protected function appendImagesToProduct(
        Product $product,
        array $uploads,
        int $insertionIndex,
        array $seedAssets,
        array &$seedAssetAttached
    ): int {
        $existingImages = $product->images->values();
        $beforeImages = $existingImages->slice(0, $insertionIndex)->values();
        $afterImages = $existingImages->slice($insertionIndex)->values();
        $newRecordSpecs = [];
        $createdCloneAssetIds = [];

        try {
            foreach ($uploads as $upload) {
                $uploadIndex = (int) $upload['upload_index'];
                $seedAsset = $seedAssets[$uploadIndex] ?? null;

                if (!$seedAsset) {
                    throw ValidationException::withMessages([
                        'images' => ['Khong the khoi tao asset mau de them anh hang loat.'],
                    ]);
                }

                $useSeedAsset = empty($seedAssetAttached[$uploadIndex]);
                $asset = $useSeedAsset
                    ? $seedAsset
                    : $this->mediaService->cloneAssetFromExisting(
                        $seedAsset,
                        [
                            'collection' => 'products',
                            'source' => 'product-image-bulk-append-clone',
                        ],
                        $upload['file_name']
                    );

                if (!$useSeedAsset) {
                    $createdCloneAssetIds[] = (int) $asset->id;
                }

                $newRecordSpecs[] = [
                    'upload_index' => $uploadIndex,
                    'file_name' => $upload['file_name'],
                    'file_size' => $upload['file_size'],
                    'asset' => $asset,
                    'use_seed_asset' => $useSeedAsset,
                ];
            }

            DB::transaction(function () use ($product, $beforeImages, $afterImages, $newRecordSpecs): void {
                $position = 0;

                foreach ($beforeImages as $image) {
                    $image->forceFill([
                        'sort_order' => $position,
                        'is_primary' => $position === 0,
                    ])->save();
                    $position++;
                }

                foreach ($newRecordSpecs as $spec) {
                    ProductImage::query()->create([
                        'product_id' => $product->id,
                        'media_asset_id' => $spec['asset']->id,
                        'image_url' => $this->mediaService->buildAssetUrl($spec['asset'], 'large'),
                        'file_name' => $spec['file_name'],
                        'file_size' => $spec['file_size'],
                        'is_primary' => $position === 0,
                        'sort_order' => $position,
                    ]);
                    $position++;
                }

                foreach ($afterImages as $image) {
                    $image->forceFill([
                        'sort_order' => $position,
                        'is_primary' => $position === 0,
                    ])->save();
                    $position++;
                }
            });

            foreach ($newRecordSpecs as $spec) {
                if (!empty($spec['use_seed_asset'])) {
                    $seedAssetAttached[(int) $spec['upload_index']] = true;
                }
            }

            return count($newRecordSpecs);
        } catch (Throwable $exception) {
            foreach ($createdCloneAssetIds as $assetId) {
                $this->deleteAssetSilently($assetId);
            }

            throw $exception;
        }
    }

    /**
     * @param  array<int, \App\Models\MediaAsset>  $seedAssets
     * @param  array<int, bool>  $seedAssetAttached
     */
    protected function cleanupUnusedSeedAssets(array $seedAssets, array $seedAssetAttached): void
    {
        foreach ($seedAssets as $uploadIndex => $asset) {
            if (!empty($seedAssetAttached[(int) $uploadIndex])) {
                continue;
            }

            $this->deleteAssetSilently((int) $asset->id);
        }
    }

    protected function deleteAssetSilently(int $assetId): void
    {
        try {
            $this->mediaService->deleteAsset($assetId);
        } catch (Throwable) {
            // Ignore cleanup failures so the main bulk operation result is preserved.
        }
    }
}
