<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\GenerateProductReviewsForProductJob;
use App\Jobs\SyncGoogleMerchantProductJob;
use App\Models\Attribute;
use App\Models\AttributeOption;
use App\Models\Category;
use App\Models\InventoryUnit;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Post;
use App\Models\Product;
use App\Models\ProductAttributeValue;
use App\Models\ProductImage;
use App\Models\MediaAsset;
use App\Models\SiteDomain;
use App\Models\BulkUpdateLog;
use App\Services\Inventory\ProductPricingService;
use App\Services\AI\AiExceptionClassifier;
use App\Services\AI\ProductReviewAiGenerationService;
use App\Services\MediaService;
use App\Services\GoogleMerchant\GoogleMerchantSettingsService;
use App\Services\OrderInventorySlipService;
use App\Services\ProductParentRetailPriceSyncService;
use App\Services\ProductSkuService;
use App\Support\InventoryQuantity;
use App\Support\OrderStatusCatalog;
use App\Support\SimpleXlsx;
use Illuminate\Http\Request;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Illuminate\Database\Eloquent\Builder;
use Throwable;

class ProductController extends Controller
{
    private const PRODUCT_DETAIL_PATH = '/san-pham';
    private const BUNDLE_OPTION_STATUS_VISIBLE = 'visible';
    private const BUNDLE_OPTION_STATUS_INTERNAL = 'internal';
    private const ADMIN_PRODUCT_LIST_HIDDEN_PRODUCT_APPENDS = [
        'average_rating',
        'main_image',
        'primary_image',
    ];
    private const ADMIN_PRODUCT_LIST_HIDDEN_IMAGE_APPENDS = [
        'thumbnail_url',
        'medium_url',
        'large_url',
        'width',
        'height',
        'srcset',
        'mediaAsset',
        'media_asset',
    ];

    private function normalizeBundleOptionStatus($value): string
    {
        $status = Str::lower(Str::squish((string) $value));

        return $status === self::BUNDLE_OPTION_STATUS_INTERNAL
            ? self::BUNDLE_OPTION_STATUS_INTERNAL
            : self::BUNDLE_OPTION_STATUS_VISIBLE;
    }

    private function normalizeBundleOptionUid($value): ?string
    {
        $uid = trim((string) $value);

        return preg_match('/^[A-Za-z0-9:_-]{1,64}$/', $uid) === 1 ? $uid : null;
    }

    private function buildBundleOptionGroupKey(array $item): string
    {
        if (!empty($item['option_post_id']) && is_numeric($item['option_post_id'])) {
            return 'post:' . (int) $item['option_post_id'];
        }

        $title = Str::lower(Str::squish((string) ($item['option_title'] ?? '')));

        return 'title:' . ($title !== '' ? $title : 'mac dinh');
    }

    private function loadExistingBundleOptionUids(Product $product): array
    {
        if (!$product->id || !Schema::hasColumn('product_links', 'bundle_option_uid')) {
            return [];
        }

        return DB::table('product_links')
            ->where('product_id', $product->id)
            ->where('link_type', 'bundle')
            ->whereNotNull('bundle_option_uid')
            ->where('bundle_option_uid', '<>', '')
            ->orderBy('position')
            ->orderBy('id')
            ->get(['option_post_id', 'option_title', 'bundle_option_uid'])
            ->reduce(function (array $carry, object $row) {
                $uid = $this->normalizeBundleOptionUid($row->bundle_option_uid ?? null);
                if ($uid === null) {
                    return $carry;
                }

                $groupKey = $this->buildBundleOptionGroupKey([
                    'option_post_id' => $row->option_post_id ?? null,
                    'option_title' => $row->option_title ?? null,
                ]);

                $carry[$groupKey] ??= $uid;

                return $carry;
            }, []);
    }

    private function resolveBundleOptionUidForItem(array $item, array &$bundleOptionUids, array $existingBundleOptionUids = []): ?string
    {
        $groupKey = $this->buildBundleOptionGroupKey($item);
        $submittedUid = $this->normalizeBundleOptionUid($item['bundle_option_uid'] ?? null);

        if ($submittedUid !== null) {
            $bundleOptionUids[$groupKey] = $submittedUid;
            return $submittedUid;
        }

        if (!empty($existingBundleOptionUids[$groupKey])) {
            $bundleOptionUids[$groupKey] = $existingBundleOptionUids[$groupKey];
            return $existingBundleOptionUids[$groupKey];
        }

        $bundleOptionUids[$groupKey] ??= (string) Str::uuid();

        return $bundleOptionUids[$groupKey];
    }

    private function mergeJsonArrayPayloadField(Request $request, string $targetKey, ?string $sourceKey = null): void
    {
        $sourceKey ??= $targetKey . '_json';

        if (!$request->exists($sourceKey)) {
            return;
        }

        $rawValue = $request->input($sourceKey);

        if (is_array($rawValue)) {
            $request->merge([$targetKey => $rawValue]);
            return;
        }

        $decoded = json_decode((string) $rawValue, true);

        if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
            throw ValidationException::withMessages([
                $targetKey => ['Du lieu gui len khong dung dinh dang JSON.'],
            ]);
        }

        $request->merge([$targetKey => $decoded]);
    }

    private function mergeStructuredProductPayloads(Request $request): void
    {
        $this->mergeJsonArrayPayloadField($request, 'grouped_items');
    }

    public function __construct(
        protected ProductSkuService $productSkuService,
        protected ProductPricingService $productPricingService,
        protected OrderInventorySlipService $orderInventorySlipService,
        protected MediaService $mediaService,
        protected ProductParentRetailPriceSyncService $productParentRetailPriceSyncService
    )
    {
    }

    private function queueGoogleMerchantProductSync(Product $product, bool $includeVariants = true): void
    {
        if (!app(GoogleMerchantSettingsService::class)->enabledForAccount((int) $product->account_id ?: null)) {
            return;
        }

        $productIds = collect([(int) $product->id]);

        if ($includeVariants && $product->type === 'configurable') {
            $variantIds = $product->variations()
                ->pluck('products.id')
                ->map(fn ($id) => (int) $id)
                ->filter();

            $productIds = $productIds->merge($variantIds);
        }

        $productIds
            ->filter()
            ->unique()
            ->each(fn (int $productId) => SyncGoogleMerchantProductJob::dispatch($productId)->afterResponse());
    }

    private function queueGoogleMerchantInactiveSyncForIds(array $productIds): void
    {
        collect($productIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->each(fn (int $productId) => SyncGoogleMerchantProductJob::dispatch($productId, 'out_of_stock')->afterResponse());
    }

    private function queueProductReviewAiGeneration(Product $product): void
    {
        if (! (bool) config('product_review_ai.enabled', true)) {
            return;
        }

        $delayMinutes = max(0, (int) config('product_review_ai.delay_minutes', 3));

        GenerateProductReviewsForProductJob::dispatch((int) $product->id)
            ->delay(now()->addMinutes($delayMinutes));
    }

    public function regenerateAiReviews(Request $request, $id)
    {
        @set_time_limit(1200);

        if (! (bool) config('product_review_ai.enabled', true)) {
            return response()->json([
                'message' => 'Tính năng tạo review AI đang tắt.',
            ], 403);
        }

        $validated = $request->validate([
            'replace' => 'nullable|boolean',
            'min' => 'nullable|integer|min:1|max:150',
            'max' => 'nullable|integer|min:1|max:150',
        ]);

        $min = (int) ($validated['min'] ?? config('product_review_ai.min_reviews', 90));
        $max = max($min, (int) ($validated['max'] ?? config('product_review_ai.max_reviews', 100)));

        $product = Product::query()->findOrFail($id);

        try {
            $result = app(ProductReviewAiGenerationService::class)->generateForProduct($product, [
                'replace' => $request->boolean('replace', true),
                'min' => $min,
                'max' => $max,
            ]);

            if (! empty($result['skipped'])) {
                return response()->json([
                    'message' => 'Sản phẩm đã có review AI, chưa tạo lại vì replace=false.',
                    'result' => $result,
                ]);
            }

            return response()->json([
                'message' => sprintf(
                    'Đã tạo %d review AI và %d phản hồi shop cho sản phẩm.',
                    (int) ($result['reviews'] ?? 0),
                    (int) ($result['replies'] ?? 0)
                ),
                'result' => $result,
            ]);
        } catch (Throwable $exception) {
            $error = app(AiExceptionClassifier::class)->classify($exception);
            Log::error('AI product review regeneration failed.', [
                'product_id' => (int) $product->id,
                'error_code' => $error['error_code'] ?? 'AI_INTERNAL_ERROR',
                'status' => $error['status'] ?? 500,
                'exception_class' => $exception::class,
                'message' => $exception->getMessage(),
            ]);

            $message = str_replace(
                ['tạo SEO AI', 'tạo SEO hàng loạt', 'tạo SEO', 'để tạo SEO'],
                ['tạo review AI', 'tạo review AI', 'tạo review', 'để tạo review'],
                (string) ($error['message'] ?? 'Không thể tạo review AI cho sản phẩm.')
            );

            return response()->json([
                'message' => $message,
                'error_code' => $error['error_code'] ?? 'AI_INTERNAL_ERROR',
                'detail' => $error['detail'] ?? null,
                'retryable' => $error['retryable'] ?? false,
            ], (int) ($error['status'] ?? 500));
        }
    }

    private function productImportSelectableFieldIds(): array
    {
        return [
            'name',
            'sku',
            'slug',
            'type',
            'category',
            'price',
            'special_price',
            'expected_cost',
            'stock_quantity',
            'status',
            'is_featured',
            'is_new',
            'description',
            'specifications',
            'additional_info',
            'seo',
            'video_url',
            'bundle_title',
            'component_data',
            'domain',
            'attributes',
            'images',
            'weight',
            'variant_data',
        ];
    }

    private function resolveProductImportOptions(Request $request): array
    {
        $mode = trim((string) $request->input('mode', 'replace_all')) === 'update_selected_fields'
            ? 'update_selected_fields'
            : 'replace_all';

        $allowedFields = array_fill_keys($this->productImportSelectableFieldIds(), true);
        $selectedFields = [];
        $selectedAttributeIds = [];

        foreach ((array) $request->input('update_fields', []) as $rawField) {
            $field = trim((string) $rawField);
            if ($field === '') {
                continue;
                $primary = null;
            }

            if (preg_match('/^attr_(\d+)$/', $field, $matches) === 1) {
                $selectedAttributeIds[(int) $matches[1]] = true;
                continue;
            }

            if (isset($allowedFields[$field])) {
                $selectedFields[$field] = true;
            }
        }

        $defaultMissingAction = $mode === 'update_selected_fields' ? 'skip' : 'create';
        $missingProductAction = trim((string) $request->input('missing_product_action', $defaultMissingAction)) === 'create'
            ? 'create'
            : 'skip';

        return [
            'mode' => $mode,
            'is_selective_update' => $mode === 'update_selected_fields',
            'missing_product_action' => $missingProductAction,
            'allow_create_missing' => $missingProductAction === 'create',
            'selected_fields' => $selectedFields,
            'selected_attribute_ids' => $selectedAttributeIds,
        ];
    }

    private function shouldImportSelectedProductField(array $importOptions, string $field): bool
    {
        return !$importOptions['is_selective_update']
            || !empty($importOptions['selected_fields'][$field]);
    }

    private function shouldImportSelectedAttributeColumn(array $importOptions, ?int $attributeId): bool
    {
        if (!$importOptions['is_selective_update']) {
            return true;
        }

        if (!empty($importOptions['selected_fields']['attributes'])) {
            return true;
        }

        return $attributeId !== null && !empty($importOptions['selected_attribute_ids'][$attributeId]);
    }

    private function shouldImportAnyAttributePayload(array $importOptions): bool
    {
        return !$importOptions['is_selective_update']
            || !empty($importOptions['selected_fields']['attributes'])
            || !empty($importOptions['selected_attribute_ids']);
    }

    private function firstImportValidationErrorMessage(ValidationException $exception, string $fallback): string
    {
        $message = collect($exception->errors())
            ->flatten()
            ->filter(fn ($value) => is_string($value) && trim($value) !== '')
            ->map(fn ($value) => trim((string) $value))
            ->first();

        return $message ?: $fallback;
    }

    private function prepareProductImportRowsV2(array $rows, Request $request, array $importOptions): array
    {
        if (empty($rows)) {
            return [[], [[
                'row' => 1,
                'column' => 'File',
                'message' => 'File Excel không có dữ liệu.',
            ]]];
        }

        $headerMap = $this->resolveProductImportHeaderMap($rows[0] ?? []);
        if (!isset($headerMap['name']) && !isset($headerMap['sku']) && !isset($headerMap['id']) && !isset($headerMap['slug']) && !isset($headerMap['product_link'])) {
            return [[], [[
                'row' => 1,
                'column' => 'Tiêu đề cột',
                'message' => 'File import cần có ít nhất một cột định danh (ID, SKU, Slug, Link sản phẩm) hoặc cột Tên sản phẩm.',
            ]]];
        }

        $products = Product::query()->get([
            'id',
            'sku',
            'slug',
            'name',
            'type',
            'price',
            'expected_cost',
            'stock_quantity',
            'status',
            'is_featured',
            'is_new',
            'video_url',
            'specifications',
            'bundle_title',
        ]);

        $productLookup = [
            'by_id' => $products->keyBy(fn (Product $product) => (int) $product->id),
            'by_sku' => $products
                ->filter(fn (Product $product) => filled($product->sku))
                ->keyBy(fn (Product $product) => $this->normalizeImportLookupValue((string) $product->sku)),
            'by_slug' => $products
                ->filter(fn (Product $product) => filled($product->slug))
                ->keyBy(fn (Product $product) => $this->normalizeImportLookupValue((string) $product->slug)),
        ];

        $attributeLookup = $this->buildAttributeImportLookup(
            Attribute::query()
                ->where('entity_type', 'product')
                ->get(['id', 'name', 'code', 'frontend_type', 'is_variant', 'status'])
        );
        $attributeColumns = $this->resolveProductImportAttributeColumns($rows[0] ?? [], $headerMap, $attributeLookup);

        $records = [];
        $errors = [];

        foreach (array_slice($rows, 1) as $index => $row) {
            $rowNumber = $index + 2;

            if ($this->shouldSkipProductImportRow($row)) {
                continue;
            }

            $rowErrors = [];
            $productId = $this->parseImportedProductId($this->importCellValue($row, $headerMap, 'id'), $rowNumber, $rowErrors);
            $rawSku = trim($this->importCellValue($row, $headerMap, 'sku'));
            $rawSlug = trim($this->importCellValue($row, $headerMap, 'slug'));
            $rawProductLink = trim($this->importCellValue($row, $headerMap, 'product_link'));
            $rawName = trim($this->importCellValue($row, $headerMap, 'name'));
            $rawType = trim($this->importCellValue($row, $headerMap, 'type'));
            $rawCategory = trim($this->importCellValue($row, $headerMap, 'category'));
            $rawPrice = $this->importCellValue($row, $headerMap, 'price');
            $rawSpecialPrice = $this->importCellValue($row, $headerMap, 'special_price');
            $rawExpectedCost = $this->importCellValue($row, $headerMap, 'expected_cost');
            $rawStockQuantity = $this->importCellValue($row, $headerMap, 'stock_quantity');
            $rawStatus = $this->importCellValue($row, $headerMap, 'status');
            $rawFeatured = $this->importCellValue($row, $headerMap, 'is_featured');
            $rawNew = $this->importCellValue($row, $headerMap, 'is_new');
            $rawDomain = trim($this->importCellValue($row, $headerMap, 'domain'));
            $rawDescription = trim($this->importCellValue($row, $headerMap, 'description'));
            $rawVideoUrl = trim($this->importCellValue($row, $headerMap, 'video_url'));
            $rawSpecifications = trim($this->importCellValue($row, $headerMap, 'specifications'));
            $rawAdditionalInfo = trim($this->importCellValue($row, $headerMap, 'additional_info'));
            $rawMetaTitle = trim($this->importCellValue($row, $headerMap, 'meta_title'));
            $rawMetaDescription = trim($this->importCellValue($row, $headerMap, 'meta_description'));
            $rawMetaKeywords = trim($this->importCellValue($row, $headerMap, 'meta_keywords'));
            $rawWeight = trim($this->importCellValue($row, $headerMap, 'weight'));
            $rawBundleTitle = trim($this->importCellValue($row, $headerMap, 'bundle_title'));
            $rawChildSkus = trim($this->importCellValue($row, $headerMap, 'child_skus'));
            $rawComponentData = trim($this->importCellValue($row, $headerMap, 'component_data'));
            $rawAttributes = trim($this->importCellValue($row, $headerMap, 'attributes'));
            $rawPrimaryImageUrl = trim($this->importCellValue($row, $headerMap, 'primary_image_url'));
            $rawGalleryImageUrls = trim($this->importCellValue($row, $headerMap, 'gallery_image_urls'));
            $rawVariantData = trim($this->importCellValue($row, $headerMap, 'variant_data'));

            $linkIdentifier = $this->extractProductIdentifierFromUrl($rawProductLink);
            $slugFromLink = ($rawSlug === '' && $linkIdentifier !== null && !ctype_digit($linkIdentifier))
                ? $linkIdentifier
                : '';

            $existingProduct = $this->resolveImportedProductMatch(
                $productLookup,
                $productId,
                $rawSku,
                $rawSlug !== '' ? $rawSlug : $slugFromLink,
                $linkIdentifier,
                $rowNumber,
                $rowErrors
            );

            if (!$existingProduct && !$importOptions['allow_create_missing']) {
                if (!empty($rowErrors)) {
                    $errors = array_merge($errors, $rowErrors);
                    continue;
                }

                $records[] = [
                    'row_number' => $rowNumber,
                    'existing_id' => null,
                    'status' => 'skipped_missing',
                    'fields' => [],
                    'type' => 'simple',
                    'category_payload' => ['provided' => false, 'clear' => false, 'tokens' => []],
                    'domain_payload' => ['provided' => false, 'clear' => false, 'value' => null],
                    'attributes' => [],
                    'images' => ['provided' => false, 'clear' => false, 'primary' => null, 'gallery' => []],
                    'variants' => ['provided' => false, 'items' => []],
                    'composite' => ['provided' => false, 'clear' => false, 'items' => []],
                ];
                continue;
            }

            $shouldImportVariants = $this->shouldImportSelectedProductField($importOptions, 'variant_data');
            $variantPayload = $shouldImportVariants
                ? $this->parseImportedVariantData($rawVariantData, $rowNumber, $rowErrors)
                : ['provided' => false, 'items' => []];
            $shouldImportCompositeItems = $this->shouldImportSelectedProductField($importOptions, 'component_data');
            $compositePayload = $shouldImportCompositeItems
                ? $this->parseImportedCompositeDataV2($rawComponentData, $rawChildSkus, $rowNumber, $rowErrors)
                : ['provided' => false, 'clear' => false, 'items' => []];

            $resolvedType = $existingProduct?->type ?: 'simple';
            $typeProvided = false;
            if (
                !$existingProduct
                || $this->shouldImportSelectedProductField($importOptions, 'type')
                || !empty($variantPayload['provided'])
            ) {
                [$resolvedType, $typeProvided] = $this->parseImportedProductTypeV2(
                    $rawType,
                    $existingProduct?->type,
                    $rowNumber,
                    $rowErrors,
                    !empty($variantPayload['items'])
                );
            }

            if (!$existingProduct && $rawName === '') {
                $rowErrors[] = $this->importError($rowNumber, 'Tên sản phẩm', 'Tên sản phẩm là bắt buộc khi tạo mới.');
            }

            if (($variantPayload['provided'] ?? false) && $resolvedType !== 'configurable') {
                $rowErrors[] = $this->importError($rowNumber, 'Biến thể', 'Chỉ sản phẩm configurable mới dùng được cột Biến thể.');
            }

            if (!$existingProduct && $resolvedType === 'configurable' && empty($variantPayload['items'])) {
                $rowErrors[] = $this->importError($rowNumber, 'Biến thể', 'Tạo mới sản phẩm configurable qua Excel cần có ít nhất một biến thể hợp lệ.');
            }

            $fields = [];

            if ($rawName !== '' && (!$existingProduct || $this->shouldImportSelectedProductField($importOptions, 'name'))) {
                $fields['name'] = $rawName;
            }

            if ($rawSku !== '' && (!$existingProduct || $this->shouldImportSelectedProductField($importOptions, 'sku'))) {
                $fields['sku'] = $rawSku;
            }

            if (!$existingProduct || $this->shouldImportSelectedProductField($importOptions, 'slug')) {
                if ($rawSlug !== '') {
                    $fields['slug'] = $rawSlug;
                } elseif ($slugFromLink !== '') {
                    $fields['slug'] = $slugFromLink;
                }
            }

            if ($typeProvided && $this->shouldImportSelectedProductField($importOptions, 'type')) {
                $fields['type'] = $resolvedType;
            }

            if ($this->shouldImportSelectedProductField($importOptions, 'price')) {
                [$priceProvided, $priceValue] = $this->parseImportedOptionalNumber(
                    $rawPrice,
                    $rowNumber,
                    'Gia',
                    $rowErrors
                );
                if ($priceProvided) {
                    $fields['price'] = $priceValue;
                }
            }
            if ($this->shouldImportSelectedProductField($importOptions, 'special_price') && trim($rawSpecialPrice) !== '') {
                if ($this->isImportNullishValue($rawSpecialPrice)) {
                    $fields['special_price'] = null;
                } else {
                    [$specialPriceProvided, $specialPriceValue] = $this->parseImportedOptionalNumber(
                        $rawSpecialPrice,
                        $rowNumber,
                        'Gia ban',
                        $rowErrors
                    );
                    if ($specialPriceProvided) {
                        $fields['special_price'] = $specialPriceValue;
                    }
                }
            }

            if ($this->shouldImportSelectedProductField($importOptions, 'expected_cost')) {
                [$expectedCostProvided, $expectedCostValue] = $this->parseImportedOptionalNumber(
                    $rawExpectedCost,
                    $rowNumber,
                    'Gia nhap du kien',
                    $rowErrors
                );
                if ($expectedCostProvided) {
                    $fields['expected_cost'] = $expectedCostValue;
                }
            }

            if ($this->shouldImportSelectedProductField($importOptions, 'stock_quantity')) {
                [$stockProvided, $stockValue] = $this->parseImportedOptionalInteger(
                    $rawStockQuantity,
                    $rowNumber,
                    'Ton kho',
                    $rowErrors
                );
                if ($stockProvided) {
                    $fields['stock_quantity'] = $stockValue;
                }
            }

            if ($this->shouldImportSelectedProductField($importOptions, 'status')) {
                [$statusProvided, $statusValue] = $this->parseImportedOptionalBoolean(
                    $rawStatus,
                    $rowNumber,
                    'Trang thai',
                    $rowErrors
                );
                if ($statusProvided) {
                    $fields['status'] = $statusValue;
                }
            }

            if ($this->shouldImportSelectedProductField($importOptions, 'is_featured')) {
                [$featuredProvided, $featuredValue] = $this->parseImportedOptionalBoolean(
                    $rawFeatured,
                    $rowNumber,
                    'Noi bat',
                    $rowErrors
                );
                if ($featuredProvided) {
                    $fields['is_featured'] = $featuredValue;
                }
            }

            if ($this->shouldImportSelectedProductField($importOptions, 'is_new')) {
                [$newProvided, $newValue] = $this->parseImportedOptionalBoolean(
                    $rawNew,
                    $rowNumber,
                    'Moi',
                    $rowErrors
                );
                if ($newProvided) {
                    $fields['is_new'] = $newValue;
                }
            }

            if ($this->shouldImportSelectedProductField($importOptions, 'description') && $rawDescription !== '') {
                $fields['description'] = $this->isImportNullishValue($rawDescription) ? null : $rawDescription;
            }

            if ($this->shouldImportSelectedProductField($importOptions, 'video_url') && $rawVideoUrl !== '') {
                $fields['video_url'] = $this->isImportNullishValue($rawVideoUrl) ? null : $rawVideoUrl;
            }

            if ($this->shouldImportSelectedProductField($importOptions, 'specifications') && $rawSpecifications !== '') {
                if ($this->isImportNullishValue($rawSpecifications)) {
                    $fields['specifications'] = null;
                } else {
                    try {
                        $normalizedSpecifications = $this->normalizeSpecificationsPayload(
                            $rawSpecifications,
                            'import.specifications'
                        );
                        $fields['specifications'] = !empty($normalizedSpecifications)
                            ? json_encode($normalizedSpecifications, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                            : null;
                    } catch (ValidationException $exception) {
                        $rowErrors[] = $this->importError(
                            $rowNumber,
                            'Thong so ky thuat',
                            $this->firstImportValidationErrorMessage($exception, 'Du lieu thong so ky thuat khong hop le.')
                        );
                    }
                }
            }

            if ($this->shouldImportSelectedProductField($importOptions, 'additional_info') && $rawAdditionalInfo !== '') {
                if ($this->isImportNullishValue($rawAdditionalInfo)) {
                    $fields['additional_info'] = null;
                } else {
                    try {
                        $normalizedAdditionalInfo = $this->normalizeImportedAdditionalInfoPayload(
                            $rawAdditionalInfo,
                            $request,
                            'import.additional_info'
                        );
                        $fields['additional_info'] = !empty($normalizedAdditionalInfo)
                            ? json_encode($normalizedAdditionalInfo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                            : null;
                    } catch (ValidationException $exception) {
                        $rowErrors[] = $this->importError(
                            $rowNumber,
                            'Thong tin bo sung',
                            $this->firstImportValidationErrorMessage($exception, 'Du lieu thong tin bo sung khong hop le.')
                        );
                    }
                }
            }

            if ($this->shouldImportSelectedProductField($importOptions, 'seo')) {
                if ($rawMetaTitle !== '') {
                    $fields['meta_title'] = $this->isImportNullishValue($rawMetaTitle) ? null : $rawMetaTitle;
                }

                if ($rawMetaDescription !== '') {
                    $fields['meta_description'] = $this->isImportNullishValue($rawMetaDescription) ? null : $rawMetaDescription;
                }

                if ($rawMetaKeywords !== '') {
                    $fields['meta_keywords'] = $this->isImportNullishValue($rawMetaKeywords) ? null : $rawMetaKeywords;
                }
            }

            if ($this->shouldImportSelectedProductField($importOptions, 'weight') && $rawWeight !== '') {
                $fields['weight'] = $this->isImportNullishValue($rawWeight) ? null : $rawWeight;
            }

            if ($this->shouldImportSelectedProductField($importOptions, 'bundle_title') && $rawBundleTitle !== '') {
                $fields['bundle_title'] = $this->isImportNullishValue($rawBundleTitle) ? null : $rawBundleTitle;
            }

            $attributePayloads = [];
            if (
                $this->shouldImportSelectedProductField($importOptions, 'attributes')
                && $rawAttributes !== ''
                && !$this->isImportNullishValue($rawAttributes)
            ) {
                $attributePayloads = array_merge(
                    $attributePayloads,
                    $this->parseImportedAttributeCollectionCell($rawAttributes, $rowNumber, 'Thuoc tinh', $rowErrors)
                );
            }

            if ($this->shouldImportAnyAttributePayload($importOptions)) {
                foreach ($attributeColumns as $attributeColumn) {
                    if (!$this->shouldImportSelectedAttributeColumn($importOptions, $attributeColumn['attribute_id'] ?? null)) {
                        continue;
                    }

                    $cellValue = trim((string) ($row[$attributeColumn['index']] ?? ''));
                    if ($cellValue === '') {
                        continue;
                    }

                    $attributePayloads[] = [
                        'token' => $attributeColumn['token'],
                        'value' => $cellValue,
                        'clear' => $this->isImportNullishValue($cellValue),
                        'column' => $attributeColumn['label'],
                    ];
                }
            }

            $imagePayload = $this->shouldImportSelectedProductField($importOptions, 'images')
                ? $this->parseImportedImagePayload(
                    $rawPrimaryImageUrl,
                    $rawGalleryImageUrls,
                    $rowNumber,
                    $rowErrors
                )
                : ['provided' => false, 'clear' => false, 'primary' => null, 'gallery' => []];
            if (!empty($rowErrors)) {
                $errors = array_merge($errors, $rowErrors);
                continue;
            }

            $records[] = [
                'row_number' => $rowNumber,
                'existing_id' => $existingProduct ? (int) $existingProduct->id : null,
                'fields' => $fields,
                'type' => $resolvedType,
                'category_payload' => $this->shouldImportSelectedProductField($importOptions, 'category')
                    ? $this->parseImportedCategoryPayload($rawCategory)
                    : ['provided' => false, 'clear' => false, 'tokens' => []],
                'domain_payload' => $this->shouldImportSelectedProductField($importOptions, 'domain')
                    ? $this->parseImportedDomainPayload($rawDomain)
                    : ['provided' => false, 'clear' => false, 'value' => null],
                'attributes' => $attributePayloads,
                'images' => $imagePayload,
                'variants' => $variantPayload,
                'composite' => $compositePayload,
            ];
        }

        return [$records, $errors];
    }

    private function makeProductImportContextV2(Request $request): array
    {
        $accountId = (int) $request->header('X-Account-Id');
        $categoryQuery = Category::query();
        $attributeQuery = Attribute::query()->where('entity_type', 'product');
        $productQuery = Product::query();
        $postQuery = Post::query();

        if ($accountId > 0) {
            $categoryQuery->where(function (Builder $builder) use ($accountId) {
                $builder
                    ->where('account_id', $accountId)
                    ->orWhereNull('account_id');
            });
            $attributeQuery->where(function (Builder $builder) use ($accountId) {
                $builder
                    ->where('account_id', $accountId)
                    ->orWhereNull('account_id');
            });
            $productQuery->where(function (Builder $builder) use ($accountId) {
                $builder
                    ->where('account_id', $accountId)
                    ->orWhereNull('account_id');
            });
            $postQuery->where('account_id', $accountId);
        }

        $products = $productQuery->get(['id', 'account_id', 'type', 'name', 'sku', 'slug']);
        $posts = $postQuery->get(['id', 'account_id', 'title', 'slug']);

        return [
            'account_id' => $accountId > 0 ? $accountId : null,
            'categories' => $this->buildCategoryImportLookup(
                $categoryQuery->get(['id', 'account_id', 'name', 'code', 'slug'])
            ),
            'attributes' => $this->buildAttributeImportLookup(
                $attributeQuery->get(['id', 'account_id', 'name', 'code', 'frontend_type', 'is_variant', 'status'])
            ),
            'products' => $this->buildProductImportLookup($products),
            'variant_parents' => $this->buildVariantParentImportLookup($products),
            'posts' => $this->buildPostImportLookup($posts),
            'site_domains' => $this->buildSiteDomainImportLookup($this->resolveScopedSiteDomains($request)),
        ];
    }

    private function buildProductImportLookup(Collection $products): array
    {
        return [
            'by_id' => $products->keyBy(fn (Product $product) => (int) $product->id),
            'by_sku' => $products
                ->filter(fn (Product $product) => filled($product->sku))
                ->keyBy(fn (Product $product) => $this->normalizeImportLookupValue((string) $product->sku)),
            'by_slug' => $products
                ->filter(fn (Product $product) => filled($product->slug))
                ->keyBy(fn (Product $product) => $this->normalizeImportLookupValue((string) $product->slug)),
        ];
    }

    private function buildVariantParentImportLookup(Collection $products): array
    {
        $productIds = $products
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->values()
            ->all();

        if (empty($productIds)) {
            return [];
        }

        return DB::table('product_links')
            ->where('link_type', 'super_link')
            ->whereIn('product_id', $productIds)
            ->whereIn('linked_product_id', $productIds)
            ->get(['product_id', 'linked_product_id'])
            ->mapWithKeys(fn ($link) => [
                (int) $link->linked_product_id => (int) $link->product_id,
            ])
            ->all();
    }

    private function buildPostImportLookup(Collection $posts): array
    {
        return [
            'by_id' => $posts->keyBy(fn (Post $post) => (int) $post->id),
            'by_slug' => $posts
                ->filter(fn (Post $post) => filled($post->slug))
                ->keyBy(fn (Post $post) => $this->normalizeImportLookupValue((string) $post->slug)),
        ];
    }

    private function buildCategoryImportLookup(Collection $categories): array
    {
        $lookup = [
            'by_id' => collect(),
            'by_code' => collect(),
            'by_slug' => collect(),
            'by_name' => collect(),
        ];

        foreach ($categories as $category) {
            $this->registerCategoryImportLookup($lookup, $category);
        }

        return $lookup;
    }

    private function registerCategoryImportLookup(array &$lookup, Category $category): void
    {
        $lookup['by_id']->put((int) $category->id, $category);

        if (filled($category->code)) {
            $normalizedCode = Category::normalizeCode((string) $category->code);
            if ($normalizedCode !== null) {
                $lookup['by_code']->put($normalizedCode, $category);
            }
        }

        if (filled($category->slug)) {
            $lookup['by_slug']->put($this->normalizeImportLookupValue((string) $category->slug), $category);
        }

        $nameKey = $this->normalizeImportLookupValue((string) $category->name);
        $existing = $lookup['by_name']->get($nameKey, collect());
        $lookup['by_name']->put($nameKey, $existing->push($category));
    }

    private function buildAttributeImportLookup(Collection $attributes): array
    {
        $lookup = [
            'by_id' => collect(),
            'by_code' => collect(),
            'by_name' => collect(),
            'header_tokens' => [],
        ];

        foreach ($attributes as $attribute) {
            $this->registerAttributeImportLookup($lookup, $attribute);
        }

        return $lookup;
    }

    private function registerAttributeImportLookup(array &$lookup, Attribute $attribute): void
    {
        $lookup['by_id']->put((int) $attribute->id, $attribute);

        $code = trim((string) ($attribute->code ?? ''));
        if ($code !== '') {
            $normalizedCode = $this->normalizeImportLookupValue($code);
            $lookup['by_code']->put($normalizedCode, $attribute);
            $lookup['header_tokens'][$normalizedCode] = 'CODE:' . $code;
        }

        $name = trim((string) $attribute->name);
        if ($name !== '') {
            $nameKey = $this->normalizeImportLookupValue($name);
            $existing = $lookup['by_name']->get($nameKey, collect());
            $lookup['by_name']->put($nameKey, $existing->push($attribute));
            $lookup['header_tokens'][$nameKey] = 'NAME:' . $name;
        }
    }

    private function buildSiteDomainImportLookup(Collection $siteDomains): array
    {
        return [
            'by_id' => $siteDomains->keyBy(fn (SiteDomain $siteDomain) => (int) $siteDomain->id),
            'by_domain' => $siteDomains->keyBy(fn (SiteDomain $siteDomain) => $this->normalizeDomainValue((string) $siteDomain->domain)),
        ];
    }

    private function matchImportedAttributeTokenV2(string $value, array $lookup): ?Attribute
    {
        [$mode, $needle] = $this->splitImportReferenceToken($value);
        $needle = trim($needle);

        if (($mode === 'id' || ($mode === null && ctype_digit($needle))) && $needle !== '') {
            return $lookup['by_id']->get((int) $needle);
        }

        if (($mode === 'code' || $mode === null) && $needle !== '') {
            $attribute = $lookup['by_code']->get($this->normalizeImportLookupValue($needle));
            if ($attribute) {
                return $attribute;
            }
        }

        $candidates = $lookup['by_name']->get($this->normalizeImportLookupValue($needle), collect());
        if ($candidates->count() === 1) {
            return $candidates->first();
        }

        return null;
    }

    private function resolveProductImportAttributeColumns(array $headerRow, array $headerMap, array $attributeLookup): array
    {
        $reservedIndexes = collect($headerMap)->values()->all();
        $columns = [];

        foreach ($headerRow as $index => $cellValue) {
            if (in_array($index, $reservedIndexes, true)) {
                continue;
            }

            $label = trim((string) $cellValue);
            if ($label === '') {
                continue;
            }

            $normalized = $this->normalizeImportHeader($label);
            $token = null;

            if (preg_match('/^(thuoc_tinh|attribute|attr)_(.+)$/', $normalized, $matches) === 1) {
                $token = preg_replace('/^(thuộc tính|thuoc tinh|attribute|attr)\s*[:\-]\s*/iu', '', $label);
                $token = trim((string) $token);

                if ($token === '') {
                    $token = trim(str_replace('_', ' ', $matches[2]));
                }
            } elseif (isset($attributeLookup['header_tokens'][$normalized])) {
                $token = $attributeLookup['header_tokens'][$normalized];
            }

            if ($token === null || $token === '') {
                continue;
            }

            $matchedAttribute = $this->matchImportedAttributeTokenV2($token, $attributeLookup);

            $columns[] = [
                'index' => $index,
                'label' => $label,
                'token' => $token,
                'attribute_id' => $matchedAttribute ? (int) $matchedAttribute->id : null,
            ];
        }

        return $columns;
    }

    private function parseImportedCategoryPayload(string $value): array
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return ['provided' => false, 'clear' => false, 'tokens' => []];
        }

        if ($this->isImportNullishValue($trimmed)) {
            return ['provided' => true, 'clear' => true, 'tokens' => []];
        }

        return [
            'provided' => true,
            'clear' => false,
            'tokens' => $this->splitImportListTokens($trimmed),
        ];
    }

    private function parseImportedDomainPayload(string $value): array
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return ['provided' => false, 'clear' => false, 'value' => null];
        }

        if ($this->isImportNullishValue($trimmed)) {
            return ['provided' => true, 'clear' => true, 'value' => null];
        }

        return ['provided' => true, 'clear' => false, 'value' => $trimmed];
    }

    private function parseImportedImagePayload(string $primaryValue, string $galleryValue, int $rowNumber, array &$errors): array
    {
        $normalizedPrimaryValue = $this->sanitizeImportedImageInput($primaryValue);
        $normalizedGalleryValue = $this->sanitizeImportedImageInput($galleryValue);
        $provided = $normalizedPrimaryValue !== '' || $normalizedGalleryValue !== '';
        if (!$provided) {
            return ['provided' => false, 'clear' => false, 'primary' => null, 'gallery' => []];
        }

        $clearPrimary = $normalizedPrimaryValue !== '' && $this->isImportNullishValue($normalizedPrimaryValue);
        $clearGallery = $normalizedGalleryValue !== '' && $this->isImportNullishValue($normalizedGalleryValue);

        if (($clearPrimary || $normalizedPrimaryValue === '') && ($clearGallery || $normalizedGalleryValue === '')) {
            return ['provided' => true, 'clear' => true, 'primary' => null, 'gallery' => []];
        }

        $primary = null;
        if ($normalizedPrimaryValue !== '' && !$clearPrimary) {
            $primary = $this->normalizeImportedImageUrl($normalizedPrimaryValue);

            if ($primary === null || !$this->isValidImportedImageUrl($primary)) {
                $errors[] = $this->importError($rowNumber, 'Ảnh đại diện', 'Link ảnh đại diện phải là URL http/https hợp lệ.');
            }
        }

        $gallery = $this->parseImportedUrlList($normalizedGalleryValue, $rowNumber, 'Thư viện ảnh', $errors);
        $gallery = collect($gallery)
            ->reject(fn ($url) => $primary !== null && $url === $primary)
            ->values()
            ->all();

        return ['provided' => true, 'clear' => false, 'primary' => $primary, 'gallery' => $gallery];
    }

    private function parseImportedUrlList(mixed $value, int $rowNumber, string $column, array &$errors): array
    {
        if (is_array($value)) {
            $urls = collect($value)
                ->map(fn ($item) => $this->sanitizeImportedImageInput((string) $item))
                ->filter()
                ->values()
                ->all();
        } else {
            $trimmed = $this->sanitizeImportedImageInput((string) $value);
            if ($trimmed === '' || $this->isImportNullishValue($trimmed)) {
                return [];
            }

            $decoded = $this->decodeSpreadsheetJsonValue($trimmed);
            if (is_array($decoded)) {
                $urls = collect($decoded)
                    ->map(fn ($item) => $this->sanitizeImportedImageInput((string) $item))
                    ->filter()
                    ->values()
                    ->all();
            } else {
                $urls = $this->splitImportListTokens($trimmed);
            }
        }

        return collect($urls)
            ->map(function (string $url) use ($rowNumber, $column, &$errors) {
                $normalizedUrl = $this->normalizeImportedImageUrl($url);
                if ($normalizedUrl === null || !$this->isValidImportedImageUrl($normalizedUrl)) {
                    $errors[] = $this->importError($rowNumber, $column, 'Mỗi link ảnh phải là URL http/https hợp lệ.');
                    return null;
                }

                return $normalizedUrl;
            })
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function normalizeImportedImageUrl(string $value): ?string
    {
        $normalized = $this->sanitizeImportedImageInput($value);
        if ($normalized === '') {
            return null;
        }

        if (preg_match('#^https?://#i', $normalized) === 1) {
            return $normalized;
        }

        if (str_starts_with($normalized, '//')) {
            $scheme = request()?->getScheme() ?: (parse_url((string) config('app.url'), PHP_URL_SCHEME) ?: 'https');

            return $scheme . ':' . $normalized;
        }

        if ($this->looksLikeManagedProductImagePath($normalized)) {
            return $this->resolveProductManagedImagePublicUrl($normalized);
        }

        return null;
    }

    private function sanitizeImportedImageInput(string $value): string
    {
        $normalized = html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $normalized = preg_replace('/[\x{200B}-\x{200D}\x{2060}\x{FEFF}]/u', '', $normalized) ?? $normalized;
        $normalized = str_replace("\u{00A0}", ' ', $normalized);
        $normalized = str_replace(["\r\n", "\r", "\xC2\xA0"], ["\n", "\n", ' '], $normalized);
        $normalized = trim($normalized);

        return trim($normalized, " \t\n\r\0\x0B\"'`“”‘’");
    }

    private function isValidImportedImageUrl(string $value): bool
    {
        return filter_var($value, FILTER_VALIDATE_URL) !== false
            && preg_match('#^https?://#i', $value) === 1;
    }

    private function looksLikeManagedProductImagePath(string $value): bool
    {
        $path = parse_url($value, PHP_URL_PATH);
        $normalizedPath = ltrim((string) ($path ?: $value), '/');
        if ($normalizedPath === '') {
            return false;
        }

        return Str::startsWith(Str::lower($normalizedPath), [
            'storage/',
            'products/',
            'uploads/',
        ]);
    }

    private function resolveProductManagedImagePublicUrl(string $value): string
    {
        $path = parse_url($value, PHP_URL_PATH) ?: $value;
        $path = preg_replace('#^/?storage/#i', '', (string) $path) ?? (string) $path;

        return $this->buildAbsoluteStorageUrl('public', ltrim($path, '/'));
    }

    private function buildAbsoluteStorageUrl(string $disk, string $path): string
    {
        $url = Storage::disk($disk)->url($path);

        if (preg_match('#^https?://#i', $url) === 1) {
            return $url;
        }

        if (str_starts_with($url, '//')) {
            return 'https:' . $url;
        }

        $baseUrl = rtrim((string) (request()?->getSchemeAndHttpHost() ?: config('app.url', '')), '/');

        return $baseUrl !== '' && str_starts_with($url, '/')
            ? $baseUrl . $url
            : $url;
    }

    private function splitImportListTokens(string $value): array
    {
        $normalized = str_replace(["\r\n", "\r"], "\n", $this->sanitizeImportedImageInput($value));

        return collect(preg_split('/\n|\||;|\x{2028}|\x{2029}/u', $normalized) ?: [])
            ->map(fn ($item) => $this->sanitizeImportedImageInput((string) $item))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function parseImportedAttributeCollectionCell(string $value, int $rowNumber, string $column, array &$errors): array
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return [];
        }

        $decoded = $this->decodeSpreadsheetJsonValue($trimmed);
        $payloads = [];

        if (is_array($decoded)) {
            if (array_is_list($decoded)) {
                foreach ($decoded as $item) {
                    if (!is_array($item)) {
                        $errors[] = $this->importError($rowNumber, $column, 'Mỗi mục thuộc tính trong JSON phải là object.');
                        continue;
                    }

                    $token = trim((string) ($item['token'] ?? $item['attribute'] ?? $item['name'] ?? ''));
                    if ($token === '' && isset($item['id'])) {
                        $token = 'ID:' . $item['id'];
                    } elseif ($token === '' && isset($item['code'])) {
                        $token = 'CODE:' . trim((string) $item['code']);
                    }

                    if ($token === '') {
                        $errors[] = $this->importError($rowNumber, $column, 'Mỗi thuộc tính phải có tên, code hoặc id.');
                        continue;
                    }

                    $itemValue = $item['value'] ?? null;
                    $payloads[] = [
                        'token' => $token,
                        'value' => $itemValue,
                        'clear' => $itemValue === null || (is_string($itemValue) && $this->isImportNullishValue($itemValue)),
                        'column' => $column,
                    ];
                }

                return $payloads;
            }

            foreach ($decoded as $token => $attributeValue) {
                $payloads[] = [
                    'token' => (string) $token,
                    'value' => $attributeValue,
                    'clear' => $attributeValue === null || (is_string($attributeValue) && $this->isImportNullishValue($attributeValue)),
                    'column' => $column,
                ];
            }

            return $payloads;
        }

        foreach ($this->splitImportListTokens($trimmed) as $pair) {
            $separatorPosition = strpos($pair, '=');
            if ($separatorPosition === false) {
                $separatorPosition = strpos($pair, ':');
            }

            if ($separatorPosition === false) {
                $errors[] = $this->importError($rowNumber, $column, 'Thuộc tính dạng text phải theo mẫu Tên=Giá trị hoặc Tên:Giá trị.');
                continue;
            }

            $token = trim(substr($pair, 0, $separatorPosition));
            $attributeValue = trim(substr($pair, $separatorPosition + 1));

            if ($token === '') {
                $errors[] = $this->importError($rowNumber, $column, 'Tên thuộc tính không được để trống.');
                continue;
            }

            $payloads[] = [
                'token' => $token,
                'value' => $attributeValue,
                'clear' => $attributeValue !== '' && $this->isImportNullishValue($attributeValue),
                'column' => $column,
            ];
        }

        return $payloads;
    }

    private function parseImportedVariantData(string $value, int $rowNumber, array &$errors): array
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return ['provided' => false, 'items' => []];
        }

        if ($this->isImportNullishValue($trimmed)) {
            return ['provided' => true, 'items' => []];
        }

        $decoded = $this->decodeSpreadsheetJsonValue($trimmed);
        if (!is_array($decoded) || !array_is_list($decoded)) {
            $errors[] = $this->importError($rowNumber, 'Biến thể', 'Cột Biến thể phải là JSON array hợp lệ.');
            return ['provided' => true, 'items' => []];
        }

        $items = [];

        foreach ($decoded as $item) {
            if (!is_array($item)) {
                $errors[] = $this->importError($rowNumber, 'Biến thể', 'Mỗi biến thể phải là object JSON hợp lệ.');
                continue;
            }

            $attributes = [];
            if (array_key_exists('attributes', $item)) {
                if (is_string($item['attributes'])) {
                    $attributes = $this->parseImportedAttributeCollectionCell($item['attributes'], $rowNumber, 'Biến thể', $errors);
                } elseif (is_array($item['attributes'])) {
                    $attributes = $this->parseImportedAttributeCollectionCell(
                        json_encode($item['attributes'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                        $rowNumber,
                        'Biến thể',
                        $errors
                    );
                }
            }

            $imagePayload = $this->parseImportedImagePayload(
                trim((string) ($item['primary_image_url'] ?? $item['image_url'] ?? $item['main_image'] ?? '')),
                is_array($item['gallery_image_urls'] ?? null)
                    ? json_encode($item['gallery_image_urls'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                    : trim((string) ($item['gallery_image_urls'] ?? $item['gallery_images'] ?? '')),
                $rowNumber,
                $errors
            );

            if (($item['price'] ?? null) !== null && !is_numeric($item['price'])) {
                $errors[] = $this->importError($rowNumber, 'Biến thể', 'Giá biến thể phải là số hợp lệ.');
            }

            if (($item['expected_cost'] ?? $item['cost_price'] ?? null) !== null && !is_numeric($item['expected_cost'] ?? $item['cost_price'])) {
                $errors[] = $this->importError($rowNumber, 'Biến thể', 'Giá dự kiến của biến thể phải là số hợp lệ.');
            }

            if (($item['stock_quantity'] ?? $item['stock'] ?? null) !== null && !is_numeric($item['stock_quantity'] ?? $item['stock'])) {
                $errors[] = $this->importError($rowNumber, 'Biến thể', 'Tồn kho của biến thể phải là số hợp lệ.');
            }

            if (empty($item['sku']) && empty($item['id'])) {
                $errors[] = $this->importError($rowNumber, 'Biến thể', 'Mỗi biến thể phải có SKU hoặc ID để nhận diện.');
            }

            if (empty($attributes)) {
                $errors[] = $this->importError($rowNumber, 'Biến thể', 'Mỗi biến thể phải có ít nhất một thuộc tính để phân biệt.');
            }

            $items[] = [
                'id' => is_numeric($item['id'] ?? null) ? (int) $item['id'] : null,
                'sku' => trim((string) ($item['sku'] ?? '')),
                'name' => trim((string) ($item['name'] ?? '')),
                'price' => $item['price'] ?? null,
                'expected_cost' => $item['expected_cost'] ?? $item['cost_price'] ?? null,
                'stock_quantity' => $item['stock_quantity'] ?? $item['stock'] ?? null,
                'attributes' => $attributes,
                'images' => $imagePayload,
            ];
        }

        return ['provided' => true, 'items' => $items];
    }

    private function parseImportedCompositeDataV2(string $componentValue, string $childSkusValue, int $rowNumber, array &$errors): array
    {
        $componentTrimmed = trim($componentValue);
        $childSkusTrimmed = trim($childSkusValue);

        if ($componentTrimmed === '' && $childSkusTrimmed === '') {
            return ['provided' => false, 'clear' => false, 'items' => []];
        }

        if ($componentTrimmed !== '') {
            if ($this->isImportNullishValue($componentTrimmed)) {
                return ['provided' => true, 'clear' => true, 'items' => []];
            }

            $decoded = $this->decodeSpreadsheetJsonValue($componentTrimmed);
            if (!is_array($decoded) || !array_is_list($decoded)) {
                $errors[] = $this->importError($rowNumber, 'Thành phần bundle/grouped', 'Cột Thành phần bundle/grouped phải là JSON array hợp lệ.');
                return ['provided' => true, 'clear' => false, 'items' => []];
            }

            $items = [];

            foreach ($decoded as $item) {
                if (!is_array($item)) {
                    $errors[] = $this->importError($rowNumber, 'Thành phần bundle/grouped', 'Mỗi thành phần bundle/grouped phải là object JSON hợp lệ.');
                    continue;
                }

                $quantity = $item['quantity'] ?? 1;
                if (!is_numeric($quantity) || (int) round((float) $quantity) < 1) {
                    $errors[] = $this->importError($rowNumber, 'Thành phần bundle/grouped', 'Số lượng của từng thành phần phải là số nguyên lớn hơn hoặc bằng 1.');
                    continue;
                }

                $isRequired = $this->normalizeImportedCompositeBooleanValue($item['is_required'] ?? true);
                if ($isRequired === null) {
                    $errors[] = $this->importError($rowNumber, 'Thành phần bundle/grouped', 'Trường is_required của từng thành phần phải là true/false hoặc 1/0.');
                    continue;
                }

                $isDefault = $this->normalizeImportedCompositeBooleanValue($item['is_default'] ?? false);
                if ($isDefault === null) {
                    $errors[] = $this->importError($rowNumber, 'Thành phần bundle/grouped', 'Trường is_default của từng thành phần phải là true/false hoặc 1/0.');
                    continue;
                }

                if (($item['price'] ?? null) !== null && $item['price'] !== '' && !is_numeric($item['price'])) {
                    $errors[] = $this->importError($rowNumber, 'Thành phần bundle/grouped', 'Giá của từng thành phần phải là số hợp lệ.');
                    continue;
                }

                $costPrice = $item['cost_price'] ?? $item['expected_cost'] ?? null;
                if ($costPrice !== null && $costPrice !== '' && !is_numeric($costPrice)) {
                    $errors[] = $this->importError($rowNumber, 'Thành phần bundle/grouped', 'Giá nhập của từng thành phần phải là số hợp lệ.');
                    continue;
                }

                $productId = is_numeric($item['product_id'] ?? null) ? (int) $item['product_id'] : null;
                $variantId = is_numeric($item['variant_id'] ?? null) ? (int) $item['variant_id'] : null;
                $optionPostId = is_numeric($item['option_post_id'] ?? null) ? (int) $item['option_post_id'] : null;
                $sku = trim((string) ($item['sku'] ?? ''));
                $slug = trim((string) ($item['slug'] ?? ''));
                $variantSku = trim((string) ($item['variant_sku'] ?? ''));

                if ($productId === null && $sku === '' && $slug === '' && $variantSku === '') {
                    $errors[] = $this->importError($rowNumber, 'Thành phần bundle/grouped', 'Mỗi thành phần phải có ít nhất product_id, sku, slug hoặc variant_sku để nhận diện sản phẩm.');
                    continue;
                }

                $items[] = [
                    'product_id' => $productId,
                    'sku' => $sku,
                    'slug' => $slug,
                    'quantity' => (int) round((float) $quantity),
                    'is_required' => $isRequired,
                    'price' => ($item['price'] ?? null) !== null && $item['price'] !== '' ? (float) $item['price'] : null,
                    'cost_price' => $costPrice !== null && $costPrice !== '' ? (float) $costPrice : null,
                    'variant_id' => $variantId,
                    'variant_sku' => $variantSku,
                    'bundle_option_uid' => $this->normalizeBundleOptionUid($item['bundle_option_uid'] ?? null),
                    'option_title' => trim((string) ($item['option_title'] ?? '')),
                    'option_post_id' => $optionPostId,
                    'option_post_slug' => trim((string) ($item['option_post_slug'] ?? '')),
                    'is_default' => $isDefault,
                ];
            }

            return [
                'provided' => true,
                'clear' => empty($items),
                'items' => $items,
            ];
        }

        if ($this->isImportNullishValue($childSkusTrimmed)) {
            return ['provided' => true, 'clear' => true, 'items' => []];
        }

        $items = collect($this->splitImportListTokens($childSkusTrimmed))
            ->map(fn (string $token) => [
                'product_id' => null,
                'sku' => '',
                'slug' => '',
                'quantity' => 1,
                'is_required' => true,
                'price' => null,
                'cost_price' => null,
                'variant_id' => null,
                'variant_sku' => trim($token),
                'option_title' => '',
                'option_post_id' => null,
                'bundle_option_uid' => null,
                'option_post_slug' => '',
                'is_default' => false,
            ])
            ->values()
            ->all();

        return [
            'provided' => true,
            'clear' => empty($items),
            'items' => $items,
        ];
    }

    private function normalizeImportedCompositeBooleanValue(mixed $value): ?bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if (is_numeric($value)) {
            return ((float) $value) !== 0.0;
        }

        $trimmed = trim((string) $value);
        if ($trimmed === '') {
            return null;
        }

        return match ($this->normalizeImportLookupValue($trimmed)) {
            '1', 'true', 'yes', 'co', 'required', 'default' => true,
            '0', 'false', 'no', 'khong', 'optional' => false,
            default => null,
        };
    }

    private function parseImportedProductTypeV2(
        string $value,
        ?string $existingType,
        int $rowNumber,
        array &$errors,
        bool $hasVariants
    ): array {
        $trimmed = trim($value);
        if ($trimmed === '') {
            if ($existingType !== null) {
                return [$existingType, false];
            }

            return [$hasVariants ? 'configurable' : 'simple', false];
        }

        $normalized = match ($this->normalizeImportLookupValue($trimmed)) {
            'simple', 'don_gian', 'san_pham_don' => 'simple',
            'virtual', 'ao' => 'virtual',
            'downloadable', 'tai_xuong' => 'downloadable',
            'configurable', 'co_bien_the', 'san_pham_co_bien_the' => 'configurable',
            'grouped', 'nhom', 'nhom_san_pham' => 'grouped',
            'bundle', 'bo_combo', 'combo', 'bo' => 'bundle',
            default => null,
        };

        if ($normalized === null) {
            $errors[] = $this->importError($rowNumber, 'Loại sản phẩm', 'Loại sản phẩm không hợp lệ.');
            return [$existingType ?: ($hasVariants ? 'configurable' : 'simple'), false];
        }

        if ($existingType !== null && $normalized !== $existingType) {
            $errors[] = $this->importError($rowNumber, 'Loại sản phẩm', 'Import Excel chưa hỗ trợ đổi loại sản phẩm hiện có.');
            return [$existingType, false];
        }

        if ($existingType === null && in_array($normalized, ['grouped', 'bundle'], true)) {
            return [$normalized, true];
        }

        if ($existingType === null && !in_array($normalized, ['simple', 'virtual', 'downloadable', 'configurable'], true)) {
            $errors[] = $this->importError($rowNumber, 'Loại sản phẩm', 'Tạo mới qua Excel chỉ hỗ trợ simple, virtual, downloadable, configurable, grouped hoặc bundle.');
            return [$hasVariants ? 'configurable' : 'simple', false];
        }

        if ($normalized === 'configurable' && !$hasVariants && $existingType === null) {
            $errors[] = $this->importError($rowNumber, 'Biến thể', 'Sản phẩm configurable mới cần có dữ liệu trong cột Biến thể.');
        }

        return [$normalized, true];
    }

    private function applyProductImportV2(array $records, Request $request, array $initialErrors = []): array
    {
        $summary = [
            'created' => 0,
            'updated' => 0,
            'skipped' => 0,
            'skipped_missing' => 0,
            'failed' => $this->countProductImportErrorRows($initialErrors),
            'categories_created' => 0,
            'attributes_created' => 0,
            'attribute_options_created' => 0,
            'images_imported' => 0,
            'variants_created' => 0,
            'variants_updated' => 0,
            'errors' => $initialErrors,
        ];
        $pendingCompositeSyncs = [];

        foreach ($records as $record) {
            DB::beginTransaction();

            try {
                $context = $this->makeProductImportContextV2($request);
                $result = $this->processProductImportRecordV2($record, $context, $summary);

                if (!empty($result['errors'])) {
                    DB::rollBack();
                    $summary['failed']++;
                    $summary['errors'] = array_merge($summary['errors'], $result['errors']);
                    continue;
                }

                DB::commit();
                if (!empty($result['composite_sync'])) {
                    $pendingCompositeSyncs[] = $result['composite_sync'];
                }

                if (($result['status'] ?? '') === 'created') {
                    $summary['created']++;
                } elseif (($result['status'] ?? '') === 'updated') {
                    $summary['updated']++;
                } else {
                    $summary['skipped']++;
                    if (($result['status'] ?? '') === 'skipped_missing') {
                        $summary['skipped_missing']++;
                    }
                }
            } catch (Throwable $exception) {
                DB::rollBack();
                $summary['failed']++;
                $summary['errors'][] = $this->importError(
                    (int) ($record['row_number'] ?? 0),
                    'Dòng dữ liệu',
                    $exception->getMessage()
                );
            }
        }

        foreach ($pendingCompositeSyncs as $pendingCompositeSync) {
            DB::beginTransaction();

            try {
                $context = $this->makeProductImportContextV2($request);
                $product = Product::query()->findOrFail((int) ($pendingCompositeSync['product_id'] ?? 0));
                $compositeErrors = $this->syncImportedCompositeItemsToProductV2(
                    $product,
                    (array) ($pendingCompositeSync['payload'] ?? []),
                    $context['products'] ?? ['by_id' => collect(), 'by_sku' => collect(), 'by_slug' => collect()],
                    $context['variant_parents'] ?? [],
                    $context['posts'] ?? ['by_id' => collect(), 'by_slug' => collect()],
                    (int) ($pendingCompositeSync['row_number'] ?? 0)
                );

                if (!empty($compositeErrors)) {
                    DB::rollBack();
                    $summary['failed']++;
                    $summary['errors'] = array_merge($summary['errors'], $compositeErrors);
                    continue;
                }

                DB::commit();
            } catch (Throwable $exception) {
                DB::rollBack();
                $summary['failed']++;
                $summary['errors'][] = $this->importError(
                    (int) ($pendingCompositeSync['row_number'] ?? 0),
                    'Thành phần bundle/grouped',
                    $exception->getMessage()
                );
            }
        }

        return $summary;
    }

    private function countProductImportErrorRows(array $errors): int
    {
        if (empty($errors)) {
            return 0;
        }

        $rows = collect($errors)
            ->pluck('row')
            ->map(fn ($row) => is_numeric($row) ? (int) $row : null)
            ->filter()
            ->unique()
            ->values();

        if ($rows->isNotEmpty()) {
            return $rows->count();
        }

        return 1;
    }

    private function processProductImportRecordV2(array $record, array $context, array &$summary): array
    {
        $rowNumber = (int) ($record['row_number'] ?? 0);
        if (($record['status'] ?? '') === 'skipped_missing') {
            return ['status' => 'skipped_missing', 'errors' => []];
        }

        $errors = [];
        $fields = $record['fields'] ?? [];
        $categoryPayload = $record['category_payload'] ?? ['provided' => false, 'clear' => false, 'tokens' => []];
        $domainPayload = $record['domain_payload'] ?? ['provided' => false, 'clear' => false, 'value' => null];
        $attributePayloads = $record['attributes'] ?? [];
        $imagePayload = $record['images'] ?? ['provided' => false, 'clear' => false, 'primary' => null, 'gallery' => []];
        $variantPayload = $record['variants'] ?? ['provided' => false, 'items' => []];
        $compositePayload = $record['composite'] ?? ['provided' => false, 'clear' => false, 'items' => []];

        [$categoryIds, $categoryErrors] = $this->resolveOrCreateCategoryIdsV2(
            $categoryPayload,
            $context['categories'],
            $rowNumber,
            $summary,
            $context['account_id'] ?? null
        );
        $errors = array_merge($errors, $categoryErrors);

        $resolvedDomainId = null;
        if (!empty($domainPayload['provided']) && empty($domainPayload['clear'])) {
            $resolvedDomainId = $this->resolveImportedSiteDomainId(
                (string) $domainPayload['value'],
                $context['site_domains'],
                $rowNumber,
                $errors
            );
        }

        $hasSupplementalChanges = !empty($categoryPayload['provided'])
            || !empty($domainPayload['provided'])
            || !empty($attributePayloads)
            || !empty($imagePayload['provided'])
            || !empty($variantPayload['provided'])
            || !empty($compositePayload['provided']);

        if (!empty($record['existing_id'])) {
            $product = Product::query()
                ->with(['images', 'variations.images', 'variations.attributeValues', 'superAttributes'])
                ->findOrFail((int) $record['existing_id']);

            if (empty($fields) && !$hasSupplementalChanges) {
                return ['status' => 'skipped', 'errors' => []];
            }

            if (array_key_exists('sku', $fields)) {
                $fields['sku'] = $this->productSkuService->ensureUniqueSku(
                    $fields['sku'],
                    $fields['name'] ?? $product->name,
                    $product->id
                );
            }

            if (array_key_exists('slug', $fields)) {
                $slugSeed = $fields['slug'] !== '' ? $fields['slug'] : ($fields['name'] ?? $product->name);
                $fields['slug'] = $this->productSkuService->generateUniqueSlug($slugSeed, $product->id);
            }

            if (array_key_exists('video_url', $fields)) {
                $fields['video_url'] = $this->normalizeVideoUrl($fields['video_url']);
            }

            if (!empty($domainPayload['provided'])) {
                $fields['site_domain_id'] = !empty($domainPayload['clear']) ? null : $resolvedDomainId;
            }

            if (!empty($categoryPayload['provided'])) {
                $fields['category_id'] = $categoryIds[0] ?? null;
            }

            $product->fill($fields);
            $product->save();

            if (!empty($categoryPayload['provided'])) {
                $this->syncProductCategories($product, $categoryIds);
            }

            if (array_key_exists('expected_cost', $fields)) {
                $this->productPricingService->syncExpectedCost(
                    $product,
                    $product->expected_cost,
                    $product->supplier_id,
                    auth()->id()
                );
            }

            $errors = array_merge($errors, $this->syncImportedAttributePayloadsToProductV2($product, $attributePayloads, $context['attributes'], $rowNumber, $summary));
            try {
                $summary['images_imported'] += $this->syncImportedImagePayloadToProductV2($product, $imagePayload);
            } catch (Throwable $exception) {
                $errors[] = $this->importError($rowNumber, 'Ảnh', $exception->getMessage());
                return ['status' => 'failed', 'errors' => $errors];
            }

            if (!empty($variantPayload['provided'])) {
                $errors = array_merge($errors, $this->syncImportedVariantsToProductV2($product, $variantPayload, $context['attributes'], $rowNumber, $summary));
            }

            $this->productParentRetailPriceSyncService->syncProductAndParents($product);

            return [
                'status' => 'updated',
                'errors' => $errors,
                'composite_sync' => !empty($compositePayload['provided'])
                    ? [
                        'product_id' => (int) $product->id,
                        'row_number' => $rowNumber,
                        'payload' => $compositePayload,
                    ]
                    : null,
            ];
        }

        $name = trim((string) ($fields['name'] ?? ''));
        $type = (string) ($record['type'] ?? 'simple');
        $shouldAutoCalculateCompositePrice = !array_key_exists('price', $fields)
            && !empty($compositePayload['provided'])
            && in_array($type, ['grouped', 'bundle'], true);
        $sku = array_key_exists('sku', $fields)
            ? $this->productSkuService->ensureUniqueSku($fields['sku'], $name)
            : $this->productSkuService->ensureUniqueSku(null, $name);
        $slugSeed = trim((string) ($fields['slug'] ?? $name));

        $product = Product::query()->create([
            'account_id' => $context['account_id'] ?? null,
            'type' => $type,
            'name' => $name,
            'sku' => $sku,
            'slug' => $this->productSkuService->generateUniqueSlug($slugSeed),
            'price' => $fields['price'] ?? 0,
            'price_type' => $shouldAutoCalculateCompositePrice ? 'sum' : 'fixed',
            'special_price' => $fields['special_price'] ?? null,
            'expected_cost' => $fields['expected_cost'] ?? null,
            'stock_quantity' => $fields['stock_quantity'] ?? 0,
            'status' => $fields['status'] ?? true,
            'is_featured' => $fields['is_featured'] ?? false,
            'is_new' => $fields['is_new'] ?? true,
            'category_id' => $categoryIds[0] ?? null,
            'site_domain_id' => !empty($domainPayload['provided']) && empty($domainPayload['clear']) ? $resolvedDomainId : null,
            'description' => $fields['description'] ?? null,
            'video_url' => array_key_exists('video_url', $fields) ? $this->normalizeVideoUrl($fields['video_url']) : null,
            'specifications' => $fields['specifications'] ?? null,
            'additional_info' => $fields['additional_info'] ?? null,
            'meta_title' => $fields['meta_title'] ?? null,
            'meta_description' => $fields['meta_description'] ?? null,
            'meta_keywords' => $fields['meta_keywords'] ?? null,
            'weight' => $fields['weight'] ?? null,
            'bundle_title' => $fields['bundle_title'] ?? null,
        ]);

        if (!empty($categoryIds)) {
            $this->syncProductCategories($product, $categoryIds);
        }

        if (array_key_exists('expected_cost', $fields)) {
            $this->productPricingService->syncExpectedCost(
                $product,
                $product->expected_cost,
                $product->supplier_id,
                auth()->id()
            );
        }

        $errors = array_merge($errors, $this->syncImportedAttributePayloadsToProductV2($product, $attributePayloads, $context['attributes'], $rowNumber, $summary));
        try {
            $summary['images_imported'] += $this->syncImportedImagePayloadToProductV2($product, $imagePayload);
        } catch (Throwable $exception) {
            $errors[] = $this->importError($rowNumber, 'Ảnh', $exception->getMessage());
            return ['status' => 'failed', 'errors' => $errors];
        }

        if (!empty($variantPayload['provided'])) {
            $errors = array_merge($errors, $this->syncImportedVariantsToProductV2($product, $variantPayload, $context['attributes'], $rowNumber, $summary));
        }

        $this->productParentRetailPriceSyncService->syncProductAndParents($product);

        return [
            'status' => 'created',
            'errors' => $errors,
            'composite_sync' => !empty($compositePayload['provided'])
                ? [
                    'product_id' => (int) $product->id,
                    'row_number' => $rowNumber,
                    'payload' => $compositePayload,
                ]
                : null,
        ];
    }

    private function resolveOrCreateCategoryIdsV2(
        array $payload,
        array &$lookup,
        int $rowNumber,
        array &$summary,
        ?int $accountId = null
    ): array
    {
        if (empty($payload['provided'])) {
            return [[], []];
        }

        if (!empty($payload['clear'])) {
            return [[], []];
        }

        $ids = [];
        $errors = [];

        foreach ((array) ($payload['tokens'] ?? []) as $token) {
            $canCreate = true;
            $category = $this->findImportedCategoryV2((string) $token, $lookup, $rowNumber, $errors, $canCreate);

            if (!$category && $canCreate) {
                $category = $this->createImportedCategoryV2((string) $token, $accountId);
                $summary['categories_created']++;
                $this->registerCategoryImportLookup($lookup, $category);
            }

            if ($category) {
                $ids[] = (int) $category->id;
            }
        }

        return [array_values(array_unique($ids)), $errors];
    }

    private function findImportedCategoryV2(string $value, array $lookup, int $rowNumber, array &$errors, bool &$canCreate): ?Category
    {
        [$mode, $needle] = $this->splitImportReferenceToken($value);
        $needle = trim($needle);

        if (($mode === 'id' || ($mode === null && ctype_digit($needle))) && $needle !== '') {
            $category = $lookup['by_id']->get((int) $needle);
            if ($category) {
                return $category;
            }

            $errors[] = $this->importError($rowNumber, 'Danh mục', 'Không tìm thấy danh mục theo ID đã nhập.');
            $canCreate = false;
            return null;
        }

        if (($mode === 'code' || $mode === null) && $needle !== '') {
            $normalizedCode = Category::normalizeCode($needle);
            if ($normalizedCode !== null) {
                $category = $lookup['by_code']->get($normalizedCode);
                if ($category) {
                    return $category;
                }
            }
        }

        if (($mode === 'slug' || $mode === null) && $needle !== '') {
            $category = $lookup['by_slug']->get($this->normalizeImportLookupValue($needle));
            if ($category) {
                return $category;
            }
        }

        $candidates = $lookup['by_name']->get($this->normalizeImportLookupValue($needle), collect());
        if ($candidates->count() === 1) {
            return $candidates->first();
        }

        if ($candidates->count() > 1) {
            $errors[] = $this->importError($rowNumber, 'Danh mục', 'Tên danh mục đang bị trùng. Vui lòng dùng CODE:... hoặc ID:... để chỉ rõ.');
            $canCreate = false;
        }

        return null;
    }

    private function createImportedCategoryV2(string $value, ?int $accountId = null): Category
    {
        [$mode, $needle] = $this->splitImportReferenceToken($value);
        $needle = trim($needle);
        $name = $needle !== '' ? $needle : 'Danh mục mới';

        if (in_array($mode, ['code', 'slug'], true)) {
            $name = Str::headline(str_replace(['-', '_'], ' ', $needle));
        }

        $code = $mode === 'code'
            ? (Category::normalizeCode($needle) ?? Category::buildUniqueCode($name))
            : Category::buildUniqueCode($needle !== '' ? $needle : $name);
        $slugSeed = $mode === 'slug' ? $needle : $name;

        return Category::query()->create([
            'account_id' => $accountId,
            'name' => $name !== '' ? $name : 'Danh mục mới',
            'code' => $code,
            'slug' => Category::buildUniqueSlug($slugSeed !== '' ? $slugSeed : $name),
            'status' => true,
            'order' => ((int) (Category::query()->max('order') ?? -1)) + 1,
        ]);
    }

    private function syncImportedAttributePayloadsToProductV2(
        Product $product,
        array $payloads,
        array &$attributeLookup,
        int $rowNumber,
        array &$summary,
        bool $forVariant = false
    ): array {
        $errors = [];

        foreach ($payloads as $payload) {
            $token = trim((string) ($payload['token'] ?? ''));
            if ($token === '') {
                continue;
            }

            $attribute = $this->resolveOrCreateImportedAttributeV2(
                $token,
                $payload['value'] ?? null,
                $attributeLookup,
                $summary,
                $rowNumber,
                $errors,
                $forVariant,
                $product->account_id ? (int) $product->account_id : null
            );

            if (!$attribute) {
                continue;
            }

            if (!empty($payload['clear'])) {
                ProductAttributeValue::query()
                    ->where('product_id', $product->id)
                    ->where('attribute_id', $attribute->id)
                    ->delete();
                continue;
            }

            $normalizedValue = $this->normalizeImportedAttributeValueForStorageV2($payload['value'] ?? null, $attribute, $forVariant);

            if ($forVariant && is_array($normalizedValue)) {
                $errors[] = $this->importError($rowNumber, 'Biến thể', 'Thuộc tính của từng biến thể chỉ được nhận một giá trị duy nhất.');
                continue;
            }

            ProductAttributeValue::query()->updateOrCreate(
                ['product_id' => $product->id, 'attribute_id' => $attribute->id],
                ['value' => is_array($normalizedValue) ? json_encode($normalizedValue, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : $normalizedValue]
            );

            $this->ensureImportedAttributeOptionValuesV2($attribute, $normalizedValue, $summary);
        }

        return $errors;
    }

    private function resolveOrCreateImportedAttributeV2(
        string $value,
        mixed $rawValue,
        array &$lookup,
        array &$summary,
        int $rowNumber,
        array &$errors,
        bool $forVariant = false,
        ?int $accountId = null
    ): ?Attribute {
        $canCreate = true;
        $attribute = $this->findImportedAttributeV2($value, $lookup, $rowNumber, $errors, $canCreate);

        if (!$attribute && $canCreate) {
            $attribute = $this->createImportedAttributeV2($value, $rawValue, $forVariant, $accountId);
            $summary['attributes_created']++;
            $this->registerAttributeImportLookup($lookup, $attribute);
        }

        if ($attribute && $forVariant && (!in_array($attribute->frontend_type, ['select', 'multiselect'], true) || !$attribute->is_variant || !$attribute->status)) {
            $attribute->forceFill([
                'frontend_type' => is_array($this->normalizeImportedAttributeValueForStorageV2($rawValue, $attribute)) ? 'multiselect' : 'select',
                'is_variant' => true,
                'status' => true,
            ])->save();
        }

        return $attribute;
    }

    private function findImportedAttributeV2(string $value, array $lookup, int $rowNumber, array &$errors, bool &$canCreate): ?Attribute
    {
        [$mode, $needle] = $this->splitImportReferenceToken($value);
        $needle = trim($needle);

        if (($mode === 'id' || ($mode === null && ctype_digit($needle))) && $needle !== '') {
            $attribute = $lookup['by_id']->get((int) $needle);
            if ($attribute) {
                return $attribute;
            }

            $errors[] = $this->importError($rowNumber, 'Thuộc tính', 'Không tìm thấy thuộc tính theo ID đã nhập.');
            $canCreate = false;
            return null;
        }

        if (($mode === 'code' || $mode === null) && $needle !== '') {
            $attribute = $lookup['by_code']->get($this->normalizeImportLookupValue($needle));
            if ($attribute) {
                return $attribute;
            }
        }

        $candidates = $lookup['by_name']->get($this->normalizeImportLookupValue($needle), collect());
        if ($candidates->count() === 1) {
            return $candidates->first();
        }

        if ($candidates->count() > 1) {
            $errors[] = $this->importError($rowNumber, 'Thuộc tính', 'Tên thuộc tính đang bị trùng. Vui lòng dùng CODE:... hoặc ID:... để chỉ rõ.');
            $canCreate = false;
        }

        return null;
    }

    private function createImportedAttributeV2(string $value, mixed $rawValue, bool $forVariant = false, ?int $accountId = null): Attribute
    {
        [$mode, $needle] = $this->splitImportReferenceToken($value);
        $needle = trim($needle);
        $normalizedValue = $this->normalizeImportedAttributeValueForStorageV2($rawValue);

        $name = $needle !== '' ? $needle : 'Thuộc tính mới';
        if ($mode === 'code') {
            $name = Str::headline(str_replace(['-', '_'], ' ', $needle));
        }

        $codeSeed = $mode === 'code' ? $needle : $name;

        return Attribute::query()->create([
            'account_id' => $accountId,
            'name' => $name !== '' ? $name : 'Thuộc tính mới',
            'entity_type' => 'product',
            'code' => $this->generateUniqueAttributeCode($codeSeed !== '' ? $codeSeed : 'thuoc-tinh'),
            'frontend_type' => (is_array($normalizedValue) && !$forVariant) ? 'multiselect' : 'select',
            'swatch_type' => null,
            'is_filterable' => false,
            'is_filterable_frontend' => false,
            'is_filterable_backend' => true,
            'is_required' => false,
            'is_variant' => $forVariant,
            'status' => true,
            'sort_order' => Attribute::nextSortOrderFor('product', $accountId),
        ]);
    }

    private function normalizeImportedAttributeValueForStorageV2(mixed $value, ?Attribute $attribute = null, bool $forVariant = false): mixed
    {
        if (is_string($value)) {
            $trimmed = trim($value);
            if ($trimmed === '') {
                return '';
            }

            $decoded = $this->decodeSpreadsheetJsonValue($trimmed);
            if (is_array($decoded)) {
                return collect($decoded)
                    ->map(fn ($item) => trim((string) $item))
                    ->filter()
                    ->values()
                    ->all();
            }

            if (!$forVariant && $attribute?->frontend_type === 'multiselect' && str_contains($trimmed, ',')) {
                return collect(explode(',', $trimmed))
                    ->map(fn ($item) => trim((string) $item))
                    ->filter()
                    ->values()
                    ->all();
            }

            return $trimmed;
        }

        if (is_array($value)) {
            return collect($value)
                ->map(fn ($item) => trim((string) $item))
                ->filter()
                ->values()
                ->all();
        }

        if ($value === null) {
            return '';
        }

        return trim((string) $value);
    }

    private function ensureImportedAttributeOptionValuesV2(Attribute $attribute, mixed $value, array &$summary): void
    {
        $values = is_array($value) ? $value : [$value];

        foreach ($values as $item) {
            $normalized = trim((string) $item);
            if ($normalized === '') {
                continue;
            }

            $existing = AttributeOption::query()
                ->where('attribute_id', $attribute->id)
                ->where('value', $normalized)
                ->first();

            if ($existing) {
                continue;
            }

            AttributeOption::query()->create([
                'attribute_id' => $attribute->id,
                'value' => $normalized,
                'order' => ((int) (AttributeOption::query()->where('attribute_id', $attribute->id)->max('order') ?? -1)) + 1,
            ]);

            $summary['attribute_options_created']++;
        }
    }

    private function syncImportedImagePayloadToProductV2(Product $product, array $payload): int
    {
        if (empty($payload['provided'])) {
            return 0;
        }

        $this->deleteProductImagesForProduct($product);

        if (!empty($payload['clear'])) {
            return 0;
        }

        $urls = collect(array_merge(
            $payload['primary'] ? [$payload['primary']] : [],
            (array) ($payload['gallery'] ?? [])
        ))
            ->map(fn ($url) => trim((string) $url))
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($urls)) {
            return 0;
        }

        $primaryUrl = $payload['primary'] ?: $urls[0];
        $stagedAssets = [];

        try {
            foreach ($urls as $index => $url) {
                $stagedAssets[] = [
                    'asset' => $this->importProductImageAssetFromReference($url),
                    'reference' => $url,
                    'sort_order' => $index,
                    'is_primary' => $url === $primaryUrl,
                ];
            }

            $this->deleteProductImagesForProduct($product);

            foreach ($stagedAssets as $stagedAsset) {
                $this->createProductImageFromAsset(
                    $product,
                    $stagedAsset['asset'],
                    $stagedAsset['reference'],
                    (int) $stagedAsset['sort_order'],
                    (bool) $stagedAsset['is_primary']
                );
            }
        } catch (Throwable $exception) {
            foreach ($stagedAssets as $stagedAsset) {
                $asset = $stagedAsset['asset'] ?? null;
                if ($asset instanceof MediaAsset) {
                    try {
                        $this->mediaService->deleteAsset($asset);
                    } catch (Throwable) {
                        // Best-effort cleanup for assets imported during a failed row.
                    }
                }
            }

            throw $exception;
        }

        return count($stagedAssets);
    }

    private function createProductImageRecord(Product $product, \Illuminate\Http\UploadedFile $file, int $sortOrder, bool $isPrimary): ProductImage
    {
        $asset = $this->mediaService->uploadImage($file, [
            'collection' => 'products',
            'source' => 'product-form-upload',
        ]);

        return ProductImage::query()->create([
            'product_id' => $product->id,
            'media_asset_id' => $asset->id,
            'image_url' => $this->mediaService->buildAssetUrl($asset, 'large'),
            'file_name' => $file->getClientOriginalName(),
            'file_size' => $file->getSize(),
            'is_primary' => $isPrimary,
            'sort_order' => $sortOrder,
        ]);
    }

    private function createProductImageFromReference(Product $product, string $reference, int $sortOrder, bool $isPrimary): ProductImage
    {
        return $this->createProductImageFromAsset(
            $product,
            $this->importProductImageAssetFromReference($reference),
            $reference,
            $sortOrder,
            $isPrimary
        );
    }

    private function importProductImageAssetFromReference(string $reference): MediaAsset
    {
        $asset = $this->mediaService->importFromReference($reference, [
            'collection' => 'products',
            'source' => 'product-import',
            'clone_existing' => true,
        ]);

        if (!$asset) {
            throw new \RuntimeException('Khong the luu anh tu URL: ' . $reference);
        }

        return $asset;
    }

    private function createProductImageFromAsset(Product $product, MediaAsset $asset, string $reference, int $sortOrder, bool $isPrimary): ProductImage
    {
        return ProductImage::query()->create([
            'product_id' => $product->id,
            'media_asset_id' => $asset->id,
            'image_url' => $this->mediaService->buildAssetUrl($asset, 'large'),
            'file_name' => basename(parse_url($reference, PHP_URL_PATH) ?: $reference),
            'file_size' => null,
            'is_primary' => $isPrimary,
            'sort_order' => $sortOrder,
        ]);
    }

    private function syncSubmittedProductImages(Request $request, Product $product): void
    {
        if (!$request->boolean('sync_images')) {
            return;
        }

        $orderedTokens = collect((array) $request->input('image_order', []))
            ->map(fn ($token) => trim((string) $token))
            ->filter()
            ->values();

        $uploadedFiles = array_values(array_filter(
            (array) $request->file('images', []),
            fn ($file) => $file instanceof \Illuminate\Http\UploadedFile
        ));

        $existingImages = $product->images()->get()->keyBy(fn (ProductImage $image) => (int) $image->id);
        $orderedEntries = [];
        $keptExistingIds = [];
        $usedNewIndexes = [];

        foreach ($orderedTokens as $token) {
            if (str_starts_with($token, 'existing:')) {
                $imageId = (int) substr($token, strlen('existing:'));
                $existingImage = $existingImages->get($imageId);

                if (!$existingImage || in_array($imageId, $keptExistingIds, true)) {
                    continue;
                }

                $keptExistingIds[] = $imageId;
                $orderedEntries[] = [
                    'type' => 'existing',
                    'token' => $token,
                    'image' => $existingImage,
                ];
                continue;
            }

            if (str_starts_with($token, 'new:')) {
                $newIndex = (int) substr($token, strlen('new:'));
                if (isset($usedNewIndexes[$newIndex]) || !isset($uploadedFiles[$newIndex])) {
                    continue;
                }

                $usedNewIndexes[$newIndex] = true;
                $orderedEntries[] = [
                    'type' => 'new',
                    'token' => $token,
                    'file' => $uploadedFiles[$newIndex],
                ];
            }
        }

        $imagesToDelete = $existingImages->filter(
            fn (ProductImage $image) => !in_array((int) $image->id, $keptExistingIds, true)
        );
        $this->deleteProductImageCollection($imagesToDelete);

        if (empty($orderedEntries)) {
            return;
        }

        $resolvedPrimaryToken = trim((string) $request->input('primary_image_token', ''));
        if ($resolvedPrimaryToken === '' || !collect($orderedEntries)->contains(fn ($entry) => $entry['token'] === $resolvedPrimaryToken)) {
            $resolvedPrimaryToken = $orderedEntries[0]['token'];
        }

        foreach ($orderedEntries as $sortOrder => $entry) {
            $isPrimary = $entry['token'] === $resolvedPrimaryToken;

            if ($entry['type'] === 'existing') {
                /** @var ProductImage $existingImage */
                $existingImage = $entry['image'];
                if ((int) $existingImage->sort_order !== (int) $sortOrder || (bool) $existingImage->is_primary !== $isPrimary) {
                    $existingImage->forceFill([
                        'sort_order' => (int) $sortOrder,
                        'is_primary' => $isPrimary,
                    ])->save();
                }
                continue;
            }

            /** @var \Illuminate\Http\UploadedFile $imageFile */
            $imageFile = $entry['file'];
            $this->createProductImageRecord($product, $imageFile, (int) $sortOrder, $isPrimary);
        }
    }

    private function applyVariantImageSelection(
        Request $request,
        Product $parentProduct,
        Product $variantProduct,
        array $variantData,
        int $variantIndex
    ): void {
        $referenceUrl = trim((string) ($variantData['image_reference_url'] ?? ''));

        if ($request->hasFile("variants.{$variantIndex}.image")) {
            $this->deleteProductImagesForProduct($variantProduct);
            $imageFile = $request->file("variants.{$variantIndex}.image");
            $this->createProductImageRecord($variantProduct, $imageFile, 0, true);
            return;
        }

        if (!empty($variantData['library_image_id'])) {
            $this->attachVariantLibraryImage(
                $parentProduct,
                $variantProduct,
                $variantData['library_image_id'],
                $variantIndex,
                $referenceUrl !== '' ? $referenceUrl : null
            );
            return;
        }

        if ($referenceUrl !== '') {
            $this->deleteProductImagesForProduct($variantProduct);
            $this->createProductImageFromReference($variantProduct, $referenceUrl, 0, true);
            return;
        }

        if (isset($variantData['remove_image']) && $variantData['remove_image'] == 'true') {
            $this->deleteProductImagesForProduct($variantProduct);
        }
    }

    private function attachVariantLibraryImage(
        Product $parentProduct,
        Product $variantProduct,
        mixed $libraryImageId,
        int $variantIndex,
        ?string $fallbackReference = null
    ): void
    {
        $normalizedImageId = is_numeric($libraryImageId) ? (int) $libraryImageId : null;
        if (!$normalizedImageId) {
            return;
        }

        $libraryImage = ProductImage::query()
            ->where('product_id', $parentProduct->id)
            ->find($normalizedImageId);

        if (!$libraryImage) {
            if ($fallbackReference !== null && trim($fallbackReference) !== '') {
                $this->deleteProductImagesForProduct($variantProduct);
                $this->createProductImageFromReference($variantProduct, $fallbackReference, 0, true);
                return;
            }

            throw ValidationException::withMessages([
                "variants.{$variantIndex}.library_image_id" => ['Ảnh thư viện đã chọn không còn thuộc sản phẩm này.'],
            ]);
        }

        $reference = trim((string) ($libraryImage->image_url ?? ''));
        if ($reference === '') {
            if ($fallbackReference !== null && trim($fallbackReference) !== '') {
                $this->deleteProductImagesForProduct($variantProduct);
                $this->createProductImageFromReference($variantProduct, $fallbackReference, 0, true);
                return;
            }

            throw ValidationException::withMessages([
                "variants.{$variantIndex}.library_image_id" => ['Ảnh thư viện đã chọn không có dữ liệu hợp lệ để sao chép.'],
            ]);
        }

        $this->deleteProductImagesForProduct($variantProduct);
        $this->createProductImageFromReference($variantProduct, $reference, 0, true);
    }

    private function deleteProductImagesForProduct(Product $product): void
    {
        $this->deleteProductImageCollection($product->images()->get());
    }

    private function deleteProductImageCollection(iterable $images): void
    {
        foreach ($images as $image) {
            if ($image instanceof ProductImage) {
                $image->delete();
            }
        }
    }

    private function syncImportedVariantsToProductV2(
        Product $product,
        array $variantPayload,
        array &$attributeLookup,
        int $rowNumber,
        array &$summary
    ): array {
        $errors = [];

        if (empty($variantPayload['provided'])) {
            return [];
        }

        if ($product->type !== 'configurable') {
            return [$this->importError($rowNumber, 'Biến thể', 'Cột Biến thể chỉ áp dụng cho sản phẩm configurable.')];
        }

        $product->loadMissing([
            'variations.images',
            'variations.attributeValues',
            'superAttributes',
        ]);

        $existingById = $product->variations->keyBy(fn (Product $variant) => (int) $variant->id);
        $existingBySku = $product->variations
            ->filter(fn (Product $variant) => filled($variant->sku))
            ->keyBy(fn (Product $variant) => $this->normalizeImportLookupValue((string) $variant->sku));
        $keptVariantIds = [];
        $superAttributeIds = [];

        foreach ((array) ($variantPayload['items'] ?? []) as $index => $variantData) {
            $variant = null;

            if (!empty($variantData['id'])) {
                $variant = $existingById->get((int) $variantData['id']);
            }

            if (!$variant && !empty($variantData['sku'])) {
                $variant = $existingBySku->get($this->normalizeImportLookupValue((string) $variantData['sku']));
            }

            $variantAttributeErrors = [];
            $variantAttributeLookup = [];

            foreach ((array) ($variantData['attributes'] ?? []) as $attributePayload) {
                $attribute = $this->resolveOrCreateImportedAttributeV2(
                    (string) ($attributePayload['token'] ?? ''),
                    $attributePayload['value'] ?? null,
                    $attributeLookup,
                    $summary,
                    $rowNumber,
                    $variantAttributeErrors,
                    true
                );

                if (!$attribute) {
                    continue;
                }

                $normalizedValue = $this->normalizeImportedAttributeValueForStorageV2($attributePayload['value'] ?? null, $attribute, true);
                if (is_array($normalizedValue)) {
                    $variantAttributeErrors[] = $this->importError($rowNumber, 'Biến thể', 'Mỗi thuộc tính biến thể chỉ được có một giá trị.');
                    continue;
                }

                $variantAttributeLookup[(int) $attribute->id] = (string) $normalizedValue;
                $superAttributeIds[] = (int) $attribute->id;
                $this->ensureImportedAttributeOptionValuesV2($attribute, $normalizedValue, $summary);
            }

            if (!empty($variantAttributeErrors)) {
                $errors = array_merge($errors, $variantAttributeErrors);
                continue;
            }

            $variantName = trim((string) ($variantData['name'] ?? ''));
            $variantSku = trim((string) ($variantData['sku'] ?? ''));
            $resolvedSku = $variantSku !== ''
                ? $this->productSkuService->ensureUniqueSku($variantSku, $variantName !== '' ? $variantName : $product->name, $variant?->id)
                : $this->productSkuService->generateVariantSku($product->sku, null, $product->variations->pluck('sku')->all());

            if ($variant) {
                $variant->fill([
                    'name' => $variantName !== '' ? $variantName : $variant->name,
                    'sku' => $resolvedSku,
                    'price' => $variantData['price'] !== null ? (float) $variantData['price'] : $variant->price,
                    'expected_cost' => $variantData['expected_cost'] !== null ? (float) $variantData['expected_cost'] : $variant->expected_cost,
                    'stock_quantity' => $variantData['stock_quantity'] !== null ? InventoryQuantity::normalize($variantData['stock_quantity']) : $variant->stock_quantity,
                    'category_id' => $product->category_id,
                    'status' => $product->status,
                    'site_domain_id' => $product->site_domain_id,
                ]);
                $variant->save();
                $summary['variants_updated']++;
            } else {
                $variant = Product::query()->create([
                    'type' => 'simple',
                    'name' => $variantName !== '' ? $variantName : ($product->name . ' - ' . $resolvedSku),
                    'sku' => $resolvedSku,
                    'slug' => $this->productSkuService->generateUniqueSlug($variantName !== '' ? $variantName : $resolvedSku),
                    'price' => $variantData['price'] !== null ? (float) $variantData['price'] : ($product->price ?? 0),
                    'expected_cost' => $variantData['expected_cost'] !== null ? (float) $variantData['expected_cost'] : null,
                    'stock_quantity' => $variantData['stock_quantity'] !== null ? InventoryQuantity::normalize($variantData['stock_quantity']) : 0,
                    'category_id' => $product->category_id,
                    'status' => $product->status,
                    'site_domain_id' => $product->site_domain_id,
                ]);
                $summary['variants_created']++;
            }

            $keptVariantIds[] = (int) $variant->id;

            ProductAttributeValue::query()->where('product_id', $variant->id)->delete();
            foreach ($variantAttributeLookup as $attributeId => $attributeValue) {
                ProductAttributeValue::query()->create([
                    'product_id' => $variant->id,
                    'attribute_id' => $attributeId,
                    'value' => $attributeValue,
                ]);
            }

            try {
                $summary['images_imported'] += $this->syncImportedImagePayloadToProductV2(
                    $variant,
                    $variantData['images'] ?? ['provided' => false, 'clear' => false, 'primary' => null, 'gallery' => []]
                );
            } catch (Throwable $exception) {
                $variantLabel = $resolvedSku !== '' ? $resolvedSku : ($variantName !== '' ? $variantName : ('#' . ($index + 1)));
                $errors[] = $this->importError(
                    $rowNumber,
                    'Biến thể',
                    'Khong the import anh cho bien the ' . $variantLabel . ': ' . $exception->getMessage()
                );
                continue;
            }

            $product->linkedProducts()->syncWithoutDetaching([
                $variant->id => [
                    'link_type' => 'super_link',
                    'position' => $index,
                ],
            ]);

            DB::table('product_links')
                ->where('product_id', $product->id)
                ->where('linked_product_id', $variant->id)
                ->where('link_type', 'super_link')
                ->update([
                    'position' => $index,
                    'updated_at' => now(),
                ]);
        }

        $variantIdsToDelete = $product->variations
            ->pluck('id')
            ->reject(fn ($variantId) => in_array((int) $variantId, $keptVariantIds, true))
            ->map(fn ($variantId) => (int) $variantId)
            ->values()
            ->all();

        if (!empty($variantIdsToDelete)) {
            $product->linkedProducts()->detach($variantIdsToDelete);
            Product::query()->whereIn('id', $variantIdsToDelete)->delete();
        }

        if (!empty($superAttributeIds)) {
            $syncPayload = [];
            foreach (array_values(array_unique($superAttributeIds)) as $position => $attributeId) {
                $syncPayload[$attributeId] = ['position' => $position];
            }

            $product->superAttributes()->sync($syncPayload);
        }

        $this->productParentRetailPriceSyncService->syncProductAndParents($product);

        return $errors;
    }

    private function syncImportedCompositeItemsToProductV2(
        Product $product,
        array $compositePayload,
        array $productLookup,
        array $variantParentLookup,
        array $postLookup,
        int $rowNumber
    ): array {
        if (empty($compositePayload['provided'])) {
            return [];
        }

        if (!in_array($product->type, ['grouped', 'bundle'], true)) {
            if (empty($compositePayload['clear']) && !empty($compositePayload['items'])) {
                return [$this->importError($rowNumber, 'Thành phần bundle/grouped', 'Cột Thành phần bundle/grouped chỉ áp dụng cho sản phẩm bundle hoặc grouped.')];
            }

            return [];
        }

        $resolvedItems = [];
        $errors = [];

        foreach ((array) ($compositePayload['items'] ?? []) as $index => $item) {
            $resolved = $this->resolveImportedCompositeItemV2(
                (array) $item,
                $productLookup,
                $variantParentLookup,
                $postLookup,
                $rowNumber,
                $index
            );

            if (!empty($resolved['errors'])) {
                $errors = array_merge($errors, $resolved['errors']);
                continue;
            }

            if (!empty($resolved['item'])) {
                $resolvedItems[] = $resolved['item'];
            }
        }

        if (!empty($errors)) {
            return $errors;
        }

        if (!empty($resolvedItems)) {
            try {
                $this->validateGroupedOrBundleItemVariants($resolvedItems);
            } catch (ValidationException $exception) {
                return collect($exception->errors())
                    ->flatten()
                    ->filter()
                    ->map(fn ($message) => $this->importError($rowNumber, 'Thành phần bundle/grouped', (string) $message))
                    ->values()
                    ->all();
            }
        }

        $existingBundleOptionUids = $product->type === 'bundle'
            ? $this->loadExistingBundleOptionUids($product)
            : [];

        if ($product->type === 'bundle') {
            $product->bundleItems()->detach();
        } else {
            $product->groupedItems()->detach();
        }

        $bundleOptionUids = [];

        foreach ($resolvedItems as $index => $item) {
            $bundleOptionUid = null;
            if ($product->type === 'bundle') {
                $bundleOptionUid = $this->resolveBundleOptionUidForItem($item, $bundleOptionUids, $existingBundleOptionUids);
            }

            $pivotData = [
                'quantity' => $item['quantity'],
                'is_required' => $item['is_required'],
                'link_type' => $product->type === 'bundle' ? 'bundle' : 'grouped',
                'position' => $index,
                'option_title' => $item['option_title'] ?? null,
                'option_post_id' => $item['option_post_id'] ?? null,
                'bundle_option_uid' => $bundleOptionUid,
                'is_default' => $item['is_default'] ?? false,
                'variant_id' => $item['variant_id'] ?? null,
                'price' => $item['price'] ?? null,
                'cost_price' => $item['cost_price'] ?? null,
            ];

            if ($product->type === 'bundle') {
                $product->bundleItems()->attach($item['id'], $pivotData);
            } else {
                $product->groupedItems()->attach($item['id'], $pivotData);
            }
        }

        $this->syncCompositeAutoPrice($product);
        $this->productParentRetailPriceSyncService->syncProductAndParents($product);

        return [];
    }

    private function resolveImportedCompositeItemV2(
        array $item,
        array $productLookup,
        array $variantParentLookup,
        array $postLookup,
        int $rowNumber,
        int $index
    ): array {
        $product = $this->findImportedProductReferenceV2(
            $productLookup,
            isset($item['product_id']) && is_numeric($item['product_id']) ? (int) $item['product_id'] : null,
            trim((string) ($item['sku'] ?? '')),
            trim((string) ($item['slug'] ?? ''))
        );
        $variant = null;
        $variantSku = trim((string) ($item['variant_sku'] ?? ''));
        $variantId = isset($item['variant_id']) && is_numeric($item['variant_id']) ? (int) $item['variant_id'] : null;

        if ($product instanceof Product) {
            $possibleParentId = $variantParentLookup[(int) $product->id] ?? null;
            if ($possibleParentId !== null && ($variantSku === '' && $variantId === null)) {
                $variant = $product;
                $product = $productLookup['by_id']->get((int) $possibleParentId);
            }
        }

        if (!$product && ($variantSku !== '' || $variantId !== null)) {
            $variantCandidate = $this->findImportedProductReferenceV2($productLookup, $variantId, $variantSku, '');
            if ($variantCandidate instanceof Product) {
                $parentId = $variantParentLookup[(int) $variantCandidate->id] ?? null;
                if ($parentId !== null) {
                    $variant = $variantCandidate;
                    $product = $productLookup['by_id']->get((int) $parentId);
                } else {
                    $product = $variantCandidate;
                }
            }
        }

        if (!$product instanceof Product) {
            return [
                'item' => null,
                'errors' => [
                    $this->importError(
                        $rowNumber,
                        'Thành phần bundle/grouped',
                        sprintf('Không tìm thấy sản phẩm thành phần ở mục #%d theo SKU, slug hoặc ID đã nhập.', $index + 1)
                    ),
                ],
            ];
        }

        if ($product->type === 'configurable') {
            if (!$variant instanceof Product) {
                $variant = $this->findImportedProductReferenceV2($productLookup, $variantId, $variantSku, '');
            }

            if (!$variant instanceof Product) {
                return [
                    'item' => null,
                    'errors' => [
                        $this->importError(
                            $rowNumber,
                            'Thành phần bundle/grouped',
                            sprintf('Sản phẩm configurable ở mục #%d cần có variant_sku hoặc variant_id hợp lệ.', $index + 1)
                        ),
                    ],
                ];
            }

            $parentId = $variantParentLookup[(int) $variant->id] ?? null;
            if ((int) $parentId !== (int) $product->id) {
                return [
                    'item' => null,
                    'errors' => [
                        $this->importError(
                            $rowNumber,
                            'Thành phần bundle/grouped',
                            sprintf('Biến thể ở mục #%d không thuộc sản phẩm configurable đã chọn.', $index + 1)
                        ),
                    ],
                ];
            }
        } else {
            $variant = null;
        }

        $optionPost = $this->findImportedPostReferenceV2(
            $postLookup,
            isset($item['option_post_id']) && is_numeric($item['option_post_id']) ? (int) $item['option_post_id'] : null,
            trim((string) ($item['option_post_slug'] ?? ''))
        );

        return [
            'item' => [
                'id' => (int) $product->id,
                'quantity' => max(1, (int) ($item['quantity'] ?? 1)),
                'is_required' => array_key_exists('is_required', $item) ? (bool) $item['is_required'] : true,
                'variant_id' => $variant instanceof Product ? (int) $variant->id : null,
                'option_title' => trim((string) ($item['option_title'] ?? '')) !== '' ? trim((string) $item['option_title']) : null,
                'option_post_id' => $optionPost instanceof Post ? (int) $optionPost->id : null,
                'bundle_option_uid' => $this->normalizeBundleOptionUid($item['bundle_option_uid'] ?? null),
                'is_default' => !empty($item['is_default']),
                'price' => array_key_exists('price', $item) && $item['price'] !== null ? (float) $item['price'] : null,
                'cost_price' => array_key_exists('cost_price', $item) && $item['cost_price'] !== null ? (float) $item['cost_price'] : null,
            ],
            'errors' => [],
        ];
    }

    private function findImportedProductReferenceV2(array $lookup, ?int $productId, string $sku = '', string $slug = ''): ?Product
    {
        if ($sku !== '') {
            $matchedBySku = $lookup['by_sku']->get($this->normalizeImportLookupValue($sku));
            if ($matchedBySku instanceof Product) {
                return $matchedBySku;
            }
        }

        if ($slug !== '') {
            $matchedBySlug = $lookup['by_slug']->get($this->normalizeImportLookupValue($slug));
            if ($matchedBySlug instanceof Product) {
                return $matchedBySlug;
            }
        }

        if ($productId !== null && $productId > 0) {
            $matchedById = $lookup['by_id']->get($productId);
            if ($matchedById instanceof Product) {
                return $matchedById;
            }
        }

        return null;
    }

    private function findImportedPostReferenceV2(array $lookup, ?int $postId, string $slug = ''): ?Post
    {
        if ($slug !== '') {
            $matchedBySlug = $lookup['by_slug']->get($this->normalizeImportLookupValue($slug));
            if ($matchedBySlug instanceof Post) {
                return $matchedBySlug;
            }
        }

        if ($postId !== null && $postId > 0) {
            $matchedById = $lookup['by_id']->get($postId);
            if ($matchedById instanceof Post) {
                return $matchedById;
            }
        }

        return null;
    }
    protected function supplierExistsRule(Request $request)
    {
        return Rule::exists('suppliers', 'id')->where(function ($query) {
            $query->whereNull('deleted_at');
        });
    }

    protected function syncProductCategories(Product $product, array $categoryIds, bool $detachMissing = true): void
    {
        $normalizedCategoryIds = collect($categoryIds)
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values()
            ->all();
        $primaryCategoryId = $normalizedCategoryIds[0] ?? null;

        if ((int) ($product->category_id ?? 0) !== (int) ($primaryCategoryId ?? 0)) {
            $product->forceFill(['category_id' => $primaryCategoryId]);
            $product->saveQuietly();
        } else {
            $product->setAttribute('category_id', $primaryCategoryId);
        }

        $syncPayload = Category::buildProductSyncPayload($product, $normalizedCategoryIds);

        if (empty($syncPayload)) {
            if ($detachMissing) {
                $product->categories()->detach();
            }

            $product->unsetRelation('categories');

            return;
        }

        if ($detachMissing) {
            $product->categories()->sync($syncPayload);
            $product->unsetRelation('categories');
            return;
        }

        $product->categories()->syncWithoutDetaching($syncPayload);
        $product->unsetRelation('categories');
    }

    protected function shouldAutoCalculateCompositePrice(Request $request, ?Product $product = null): bool
    {
        $resolvedType = (string) $request->input('type', $product?->type ?? '');
        $resolvedPriceType = (string) $request->input('price_type', $product?->price_type ?? 'fixed');

        return in_array($resolvedType, ['grouped', 'bundle'], true) && $resolvedPriceType === 'sum';
    }

    protected function calculateCompositeRequestPrice(array $groupedItems): float
    {
        $total = 0.0;

        foreach ($groupedItems as $item) {
            if (!is_array($item)) {
                continue;
            }

            $quantity = max(0, (int) ($item['quantity'] ?? 0));
            $unitPrice = is_numeric($item['price'] ?? null) ? (float) $item['price'] : 0.0;
            $total += $unitPrice * $quantity;
        }

        return $total;
    }

    protected function applyCompositeAutoPrice(Request $request, array &$validated, ?Product $product = null): void
    {
        if (!$this->shouldAutoCalculateCompositePrice($request, $product)) {
            return;
        }

        if ($request->has('grouped_items')) {
            $validated['price'] = $this->calculateCompositeRequestPrice((array) $request->input('grouped_items', []));
            return;
        }

        $validated['price'] = $product?->calculateCompositePrice() ?? 0;
    }

    protected function syncCompositeAutoPrice(Product $product): void
    {
        if (!in_array($product->type, ['grouped', 'bundle'], true) || $product->price_type !== 'sum') {
            return;
        }

        $relationName = $product->type === 'bundle' ? 'bundleItems' : 'groupedItems';
        $product->unsetRelation('groupedItems');
        $product->unsetRelation('bundleItems');
        $product->load($relationName);
        $product->forceFill([
            'price' => $product->calculateCompositePrice(),
        ])->save();
    }

    protected function productResourceRelations(bool $includeReviews = true): array
    {
        $attributeSummaryColumns = Attribute::relationColumnString(['id', 'name', 'code']);
        $attributeResourceColumns = Attribute::relationColumnString(['id', 'name', 'code', 'frontend_type']);

        $relations = [
            'category:id,name',
            'categories:id,name',
            'supplier:id,name,code',
            'suppliers:id,name,code',
            'parentConfigurable:id,name,sku,type',
            'unit:id,name',
            'siteDomain:id,domain,is_active,is_default',
            'images:id,product_id,media_asset_id,image_url,is_primary,sort_order,file_name,file_size',
            'superAttributes:' . $attributeResourceColumns,
            'superAttributes.options:id,attribute_id,value,swatch_value,order',
            'attributeValues:id,product_id,attribute_id,value',
            'attributeValues.attribute:' . $attributeResourceColumns,
            'linkedProducts' => function ($q) use ($attributeSummaryColumns) {
                $q->select(['products.id', 'products.sku', 'products.name', 'products.price', 'products.expected_cost', 'products.cost_price', 'products.stock_quantity', 'products.type', 'products.weight', 'products.inventory_unit_id', 'products.status'])
                    ->withPivot(['link_type', 'position', 'quantity', 'is_required', 'is_default'])
                    ->with([
                        'unit:id,name',
                        'images:id,product_id,media_asset_id,image_url,is_primary,sort_order',
                        'attributeValues:id,product_id,attribute_id,value',
                        'attributeValues.attribute:' . $attributeSummaryColumns,
                    ]);
            },
            'groupedItems' => function ($q) use ($attributeSummaryColumns) {
                $q->select(['products.id', 'products.sku', 'products.name', 'products.price', 'products.expected_cost', 'products.cost_price', 'products.stock_quantity', 'products.type', 'products.weight', 'products.inventory_unit_id'])
                    ->withPivot(['link_type', 'position', 'quantity', 'is_required', 'price', 'cost_price'])
                    ->with([
                        'unit:id,name',
                        'images:id,product_id,media_asset_id,image_url,is_primary,sort_order',
                        'attributeValues:id,product_id,attribute_id,value',
                        'attributeValues.attribute:' . $attributeSummaryColumns,
                    ]);
            },
            'bundleItems' => function ($q) use ($attributeSummaryColumns) {
                $q->select(['products.id', 'products.sku', 'products.name', 'products.price', 'products.expected_cost', 'products.cost_price', 'products.stock_quantity', 'products.type', 'products.weight', 'products.inventory_unit_id'])
                    ->withPivot(['link_type', 'position', 'quantity', 'is_required', 'option_title', 'option_post_id', 'bundle_option_uid', 'bundle_option_status', 'option_image_url', 'option_video_url', 'option_video_source', 'is_default', 'variant_id', 'price', 'cost_price'])
                    ->with([
                        'unit:id,name',
                        'images:id,product_id,media_asset_id,image_url,is_primary,sort_order',
                        'attributeValues:id,product_id,attribute_id,value',
                        'attributeValues.attribute:' . $attributeSummaryColumns,
                    ]);
            },
        ];

        if ($includeReviews) {
            $relations[] = 'approvedReviews.user:id,name';
        }

        return $relations;
    }

    protected function isProductEditContext(Request $request): bool
    {
        $context = Str::lower(trim((string) $request->query('context', '')));

        return in_array($context, ['edit', 'admin_edit', 'admin-edit'], true)
            || $request->boolean('admin_edit')
            || $request->boolean('edit');
    }

    protected function trimAdminProductEditPayload(Product $product): Product
    {
        $visited = [];
        $this->hideAdminProductEditComputedFields($product, $visited);

        return $product;
    }

    protected function hideAdminProductEditComputedFields(Product $product, array &$visited): void
    {
        $objectId = spl_object_id($product);
        if (isset($visited[$objectId])) {
            return;
        }

        $visited[$objectId] = true;
        $product->makeHidden(self::ADMIN_PRODUCT_LIST_HIDDEN_PRODUCT_APPENDS);

        if ($product->relationLoaded('images')) {
            $product->images->each(function ($image): void {
                if ($image instanceof ProductImage) {
                    $image->makeHidden(self::ADMIN_PRODUCT_LIST_HIDDEN_IMAGE_APPENDS);
                }
            });
        }

        foreach (['parentConfigurable', 'variations', 'groupedItems', 'bundleItems', 'linkedProducts', 'parentProducts'] as $relation) {
            if (!$product->relationLoaded($relation)) {
                continue;
            }

            $related = $product->getRelation($relation);
            if ($related instanceof Product) {
                $this->hideAdminProductEditComputedFields($related, $visited);
                continue;
            }

            if ($related instanceof Collection) {
                $related->each(function ($item) use (&$visited): void {
                    if ($item instanceof Product) {
                        $this->hideAdminProductEditComputedFields($item, $visited);
                    }
                });
            }
        }
    }

    protected function appendSupplierMeta(Product $product): Product
    {
        if (!$product->relationLoaded('suppliers')) {
            $product->loadMissing('suppliers:id,name,code');
        }

        if (!$product->relationLoaded('categories')) {
            $product->loadMissing('categories:id,name');
        }

        $supplierIds = $product->suppliers
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();
        $categoryIds = collect([$product->category_id])
            ->merge($product->categories->pluck('id'))
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values()
            ->all();

        $product->setAttribute('supplier_ids', $supplierIds);
        $product->setAttribute('supplier_count', count($supplierIds));
        $product->setAttribute('has_multiple_suppliers', count($supplierIds) > 1);
        $product->setAttribute('category_ids', $categoryIds);
        $product->setAttribute('category_count', count($categoryIds));
        $product->setAttribute('has_multiple_categories', count($categoryIds) > 1);

        $this->appendAdditionalInfoPostMeta($product);

        return $this->appendBundleOptionPostMeta($product);
    }

    protected function trimAdminProductListPayload(Product $product): Product
    {
        $visited = [];
        $this->hideAdminProductListComputedFields($product, $visited);

        return $product;
    }

    protected function hideAdminProductListComputedFields(Product $product, array &$visited): void
    {
        $objectId = spl_object_id($product);
        if (isset($visited[$objectId])) {
            return;
        }

        $visited[$objectId] = true;
        $product->makeHidden(self::ADMIN_PRODUCT_LIST_HIDDEN_PRODUCT_APPENDS);

        if ($product->relationLoaded('images')) {
            $product->images->each(function ($image): void {
                if ($image instanceof ProductImage) {
                    $image->makeHidden(self::ADMIN_PRODUCT_LIST_HIDDEN_IMAGE_APPENDS);
                }
            });
        }

        foreach (['parentConfigurable', 'variations', 'groupedItems', 'bundleItems', 'linkedProducts', 'parentProducts'] as $relation) {
            if (!$product->relationLoaded($relation)) {
                continue;
            }

            $related = $product->getRelation($relation);
            if ($related instanceof Product) {
                $this->hideAdminProductListComputedFields($related, $visited);
                continue;
            }

            if ($related instanceof Collection) {
                $related->each(function ($item) use (&$visited): void {
                    if ($item instanceof Product) {
                        $this->hideAdminProductListComputedFields($item, $visited);
                    }
                });
            }
        }
    }

    protected function appendAdditionalInfoPostMeta(Product $product): Product
    {
        if (blank($product->additional_info)) {
            return $product;
        }

        try {
            $items = $this->normalizeAdditionalInfoPayload($product->additional_info);
        } catch (ValidationException) {
            return $product;
        }

        if (empty($items)) {
            return $product;
        }

        $postIds = collect($items)
            ->pluck('post_id')
            ->filter(fn ($postId) => filled($postId))
            ->map(fn ($postId) => (int) $postId)
            ->unique()
            ->values();

        if ($postIds->isEmpty()) {
            $product->setAttribute('additional_info', json_encode($items, JSON_UNESCAPED_UNICODE));

            return $product;
        }

        $query = Post::query()->whereIn('id', $postIds->all());
        $accountId = (int) request()->header('X-Account-Id');

        if ($accountId > 0) {
            $query->where('account_id', $accountId);
        } elseif (filled($product->account_id)) {
            $query->where('account_id', (int) $product->account_id);
        }

        $posts = $query
            ->get(['id', 'title', 'slug'])
            ->keyBy(fn (Post $post) => (int) $post->id);

        $hydrated = collect($items)
            ->map(function (array $item) use ($posts) {
                $postId = filled($item['post_id'] ?? null) ? (int) $item['post_id'] : null;

                if (!$postId) {
                    return $item;
                }

                $post = $posts->get($postId);

                if (!$post) {
                    $item['post_invalid'] = true;
                    $item['post_error'] = 'Bai viet lien ket khong hop le hoac khong thuoc tai khoan hien tai.';

                    return $item;
                }

                $item['post_id'] = (int) $post->id;
                $item['post_title'] = trim((string) ($item['post_title'] ?? '')) !== ''
                    ? $item['post_title']
                    : trim((string) $post->title);
                $item['post_slug'] = trim((string) ($item['post_slug'] ?? '')) !== ''
                    ? $item['post_slug']
                    : trim((string) $post->slug);
                $item['post_invalid'] = false;
                unset($item['post_error']);

                return $item;
            })
            ->values()
            ->all();

        $product->setAttribute('additional_info', json_encode($hydrated, JSON_UNESCAPED_UNICODE));

        return $product;
    }

    protected function appendBundleOptionPostMeta(Product $product): Product
    {
        if (!$product->relationLoaded('bundleItems')) {
            return $product;
        }

        $postIds = $product->bundleItems
            ->pluck('pivot.option_post_id')
            ->filter(fn ($postId) => filled($postId))
            ->map(fn ($postId) => (int) $postId)
            ->unique()
            ->values();

        if ($postIds->isEmpty()) {
            return $product;
        }

        $posts = Post::query()
            ->whereIn('id', $postIds)
            ->get(['id', 'title', 'slug'])
            ->keyBy(fn (Post $post) => (int) $post->id);

        $product->bundleItems->each(function (Product $bundleItem) use ($posts) {
            $postId = filled($bundleItem->pivot?->option_post_id ?? null)
                ? (int) $bundleItem->pivot->option_post_id
                : null;

            if (!$postId) {
                return;
            }

            $post = $posts->get($postId);
            $bundleItem->pivot->setAttribute('option_post_title', $post?->title);
            $bundleItem->pivot->setAttribute('option_post_slug', $post?->slug);
        });

        return $product;
    }

    protected function validateGroupedOrBundleItemVariants(array $items): void
    {
        $indexedItems = collect($items)
            ->map(function ($item, $index) {
                $productId = isset($item['id']) && is_numeric($item['id'])
                    ? (int) $item['id']
                    : 0;
                $variantId = isset($item['variant_id']) && is_numeric($item['variant_id'])
                    ? (int) $item['variant_id']
                    : null;

                return [
                    'index' => $index,
                    'product_id' => $productId,
                    'variant_id' => $variantId,
                ];
            })
            ->filter(fn (array $item) => $item['product_id'] > 0)
            ->values();

        if ($indexedItems->isEmpty()) {
            return;
        }

        $products = Product::query()
            ->whereIn('id', $indexedItems->pluck('product_id')->unique()->all())
            ->get(['id', 'type'])
            ->keyBy(fn (Product $product) => (int) $product->id);

        $configurableIds = $products
            ->filter(fn (Product $product) => $product->type === 'configurable')
            ->keys()
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();

        $indexedVariantItems = $indexedItems
            ->filter(fn (array $item) => $item['variant_id'] !== null)
            ->values();

        $allowedVariantPairs = [];
        if (!empty($configurableIds) && $indexedVariantItems->isNotEmpty()) {
            $allowedVariantPairs = DB::table('product_links')
                ->where('link_type', 'super_link')
                ->whereIn('product_id', $configurableIds)
                ->whereIn('linked_product_id', $indexedVariantItems->pluck('variant_id')->unique()->all())
                ->get(['product_id', 'linked_product_id'])
                ->mapWithKeys(fn ($link) => [
                    ((int) $link->product_id) . ':' . ((int) $link->linked_product_id) => true,
                ])
                ->all();
        }

        $messages = [];

        foreach ($indexedItems as $item) {
            $product = $products->get($item['product_id']);
            if (!$product) {
                continue;
            }

            if ($product->type !== 'configurable') {
                if ($item['variant_id'] === null) {
                    continue;
                }
                $messages["grouped_items.{$item['index']}.variant_id"][] = 'Biến thể chỉ được gắn với sản phẩm cha dạng configurable.';
                continue;
            }

            if ($item['variant_id'] === null) {
                $messages["grouped_items.{$item['index']}.variant_id"][] = 'Sản phẩm configurable trong bundle hoặc grouped phải chọn một biến thể cụ thể để ghi nhận đúng tồn kho.';
                continue;
            }

            if ($item['variant_id'] === null) {
                $messages["grouped_items.{$item['index']}.variant_id"][] = 'Sáº£n pháº©m configurable trong bundle hoáº·c grouped pháº£i chá»n má»™t biáº¿n thá»ƒ cá»¥ thá»ƒ Ä‘á»ƒ ghi nháº­n Ä‘Ãºng tá»“n kho.';
                continue;
            }

            $pairKey = $item['product_id'] . ':' . $item['variant_id'];
            if (!isset($allowedVariantPairs[$pairKey])) {
                $messages["grouped_items.{$item['index']}.variant_id"][] = 'Biến thể đã chọn không thuộc sản phẩm cha này.';
            }
        }

        if (!empty($messages)) {
            throw ValidationException::withMessages($messages);
        }
    }

    protected function loadProductResource(Product $product): Product
    {
        $product = $this->appendSupplierMeta($product->load($this->productResourceRelations()));

        return $this->syncProductResourceInventoryStocks(request(), $product);
    }

    protected function syncProductResourceInventoryStocks(Request $request, Product $product): Product
    {
        $productIds = collect([(int) $product->id]);

        foreach (['variations', 'groupedItems', 'bundleItems', 'linkedProducts'] as $relation) {
            if (!$product->relationLoaded($relation)) {
                continue;
            }

            $productIds = $productIds->merge(
                $product->{$relation}
                    ->pluck('id')
                    ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            );
        }

        $stockMap = $this->buildInventorySnapshotMap(
            $request,
            $productIds->filter()->unique()->values()->all()
        );

        return $this->syncProductStocksFromInventory($product, $stockMap);
    }

    protected function generateUniqueAttributeCode(string $seed): string
    {
        $base = Str::of((string) $seed)
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', '_')
            ->trim('_')
            ->toString();

        $base = $base !== '' ? $base : 'variant_attribute';
        $candidate = Str::limit($base, 64, '');
        $suffix = 1;

        while (Attribute::query()->where('code', $candidate)->exists()) {
            $candidate = Str::limit($base, max(1, 64 - strlen((string) $suffix) - 1), '') . '_' . $suffix;
            $suffix++;
        }

        return $candidate;
    }

    protected function resolveConfigurableConversionAttribute(Product $product, ?int $attributeId, ?string $attributeName): Attribute
    {
        if ($attributeId) {
            $attribute = Attribute::query()->findOrFail($attributeId);

            if (!in_array($attribute->frontend_type, ['select', 'multiselect'], true)) {
                throw ValidationException::withMessages([
                    'attribute_id' => ['Thuộc tính biến thể phải có kiểu chọn danh sách để dùng cho sản phẩm có biến thể.'],
                ]);
            }

            $attribute->forceFill([
                'is_variant' => true,
                'status' => true,
            ])->save();

            return $attribute;
        }

        $resolvedName = trim((string) $attributeName);
        if ($resolvedName === '') {
            $resolvedName = 'Mẫu';
        }

        $existingAttribute = Attribute::query()
            ->where('entity_type', 'product')
            ->where('account_id', $product->account_id)
            ->whereRaw('LOWER(name) = ?', [Str::lower($resolvedName)])
            ->whereIn('frontend_type', ['select', 'multiselect'])
            ->first();

        if ($existingAttribute) {
            $existingAttribute->forceFill([
                'is_variant' => true,
                'status' => true,
            ])->save();

            return $existingAttribute;
        }

        return Attribute::query()->create([
            'account_id' => $product->account_id,
            'name' => $resolvedName,
            'entity_type' => 'product',
            'code' => $this->generateUniqueAttributeCode('variant_' . $resolvedName),
            'frontend_type' => 'select',
            'swatch_type' => null,
            'is_filterable' => false,
            'is_filterable_frontend' => false,
            'is_filterable_backend' => true,
            'is_required' => false,
            'is_variant' => true,
            'status' => true,
            'sort_order' => Attribute::nextSortOrderFor('product', $product->account_id),
        ]);
    }

    protected function ensureVariantAttributeOptions(Attribute $attribute, array $values): void
    {
        $normalizedValues = collect($values)
            ->map(fn ($value) => trim((string) $value))
            ->filter()
            ->unique()
            ->values();

        foreach ($normalizedValues as $index => $value) {
            AttributeOption::query()->firstOrCreate(
                [
                    'attribute_id' => $attribute->id,
                    'value' => $value,
                ],
                [
                    'order' => $index,
                ]
            );
        }
    }

    protected function prepareSimpleToConfigurableVariants(Product $product, array $variants, string $parentSku): array
    {
        $messages = [];
        $prepared = [];
        $reservedSkus = array_values(array_filter([$parentSku]));
        $seenValues = [];

        foreach ($variants as $index => $variantData) {
            $variantValue = trim((string) ($variantData['value'] ?? ''));
            if ($variantValue === '') {
                $messages["variants.{$index}.value"][] = 'Mỗi biến thể cần có giá trị thuộc tính để phân biệt.';
                continue;
            }

            $valueKey = Str::lower(Str::squish($variantValue));
            if (isset($seenValues[$valueKey])) {
                $messages["variants.{$index}.value"][] = 'Giá trị thuộc tính biến thể đang bị trùng.';
                continue;
            }
            $seenValues[$valueKey] = true;

            $isOriginalVariant = $index === 0;
            if ($isOriginalVariant) {
                $resolvedSku = $this->productSkuService->ensureUniqueSku(
                    $variantData['sku'] ?? $product->sku,
                    trim((string) ($variantData['name'] ?? '')) ?: $product->name,
                    $product->id,
                    $reservedSkus
                );
            } else {
                $resolvedSku = $this->productSkuService->normalize($variantData['sku'] ?? null);

                if (
                    $resolvedSku === null
                    || in_array($resolvedSku, $reservedSkus, true)
                    || $this->productSkuService->skuExists($resolvedSku)
                ) {
                    $resolvedSku = $this->productSkuService->generateVariantSku($parentSku, null, $reservedSkus);
                }
            }

            $reservedSkus[] = $resolvedSku;

            $prepared[] = [
                'is_original' => $isOriginalVariant,
                'value' => $variantValue,
                'name' => trim((string) ($variantData['name'] ?? '')) ?: ($isOriginalVariant ? $product->name : ($product->name . ' - ' . $variantValue)),
                'sku' => $resolvedSku,
                'price' => is_numeric($variantData['price'] ?? null) ? (float) $variantData['price'] : null,
                'expected_cost' => is_numeric($variantData['expected_cost'] ?? null) ? (float) $variantData['expected_cost'] : null,
                'weight' => filled($variantData['weight'] ?? null) ? (string) $variantData['weight'] : null,
                'inventory_unit_id' => is_numeric($variantData['inventory_unit_id'] ?? null)
                    ? (int) $variantData['inventory_unit_id']
                    : null,
            ];
        }

        if (empty($prepared)) {
            $messages['variants'][] = 'Cần ít nhất một biến thể để hoàn tất chuyển đổi.';
        }

        if (!empty($messages)) {
            throw ValidationException::withMessages($messages);
        }

        return $prepared;
    }

    protected function cloneProductDecoratorsToParent(Product $source, Product $target, ?int $excludedAttributeId = null): void
    {
        foreach ($source->images as $image) {
            ProductImage::query()->create([
                'product_id' => $target->id,
                'image_url' => $image->image_url,
                'is_primary' => $image->is_primary,
                'sort_order' => $image->sort_order,
                'file_name' => $image->file_name,
                'file_size' => $image->file_size,
            ]);
        }

        foreach ($source->attributeValues as $attributeValue) {
            if ($excludedAttributeId !== null && (int) $attributeValue->attribute_id === $excludedAttributeId) {
                continue;
            }

            ProductAttributeValue::query()->create([
                'product_id' => $target->id,
                'attribute_id' => $attributeValue->attribute_id,
                'value' => $attributeValue->value,
            ]);
        }
    }

    protected function copyRelatedProductsToParent(Product $source, Product $target): void
    {
        foreach ($source->relatedProducts as $relatedProduct) {
            $target->relatedProducts()->syncWithoutDetaching([
                $relatedProduct->id => [
                    'link_type' => 'related',
                    'position' => $relatedProduct->pivot->position ?? 0,
                    'option_title' => $relatedProduct->pivot->option_title ?? null,
                ],
            ]);
        }
    }

    protected function buildConvertedParentPayload(Product $product, string $parentName, string $parentSku): array
    {
        return [
            'account_id' => $product->account_id,
            'type' => 'configurable',
            'name' => $parentName,
            'slug' => $this->productSkuService->generateUniqueSlug($parentName),
            'description' => $product->description,
            'specifications' => $product->specifications,
            'price' => $product->price,
            'price_type' => 'fixed',
            'cost_price' => null,
            'expected_cost' => $product->expected_cost,
            'special_price' => $product->special_price,
            'special_price_from' => $product->special_price_from,
            'special_price_to' => $product->special_price_to,
            'imported_quantity_total' => 0,
            'imported_value_total' => 0,
            'category_id' => $product->category_id,
            'stock_quantity' => 0,
            'damaged_quantity' => 0,
            'status' => $product->status,
            'is_featured' => $product->is_featured,
            'is_new' => $product->is_new,
            'sku' => $parentSku,
            'meta_title' => $product->meta_title,
            'meta_description' => $product->meta_description,
            'meta_keywords' => $product->meta_keywords,
            'weight' => $product->weight,
            'inventory_unit_id' => $product->inventory_unit_id,
            'inventory_import_starred' => $product->inventory_import_starred,
            'supplier_id' => $product->supplier_id,
            'video_url' => $product->video_url,
            'additional_info' => $product->additional_info,
            'bundle_title' => null,
            'site_domain_id' => $product->site_domain_id,
        ];
    }

    protected function prepareProductSku(array &$validated, ?Product $product = null): void
    {
        $normalizedSku = $this->productSkuService->normalize($validated['sku'] ?? $product?->sku);

        if ($normalizedSku === null) {
            $normalizedSku = $this->productSkuService->ensureUniqueSku(
                null,
                $validated['name'] ?? $product?->name,
                $product?->id
            );
        } elseif ($this->productSkuService->skuExists($normalizedSku, $product?->id)) {
            throw ValidationException::withMessages([
                'sku' => ['Mã SKU này đã được sử dụng bởi một sản phẩm khác.'],
            ]);
        }

        $validated['sku'] = $normalizedSku;
    }

    protected function prepareVariantPayloads(array $incomingVariants, string $parentSku, ?Product $product = null): array
    {
        $preparedVariants = [];
        $messages = [];
        $reservedSkus = array_values(array_filter([$parentSku]));
        $ownedVariantIds = $product
            ? array_flip($product->linkedProducts()
                ->wherePivot('link_type', 'super_link')
                ->pluck('products.id')
                ->map(fn ($id) => (int) $id)
                ->all())
            : [];
        $sharedVariantIds = ($product && !empty($ownedVariantIds))
            ? DB::table('product_links')
                ->where('link_type', 'super_link')
                ->whereIn('linked_product_id', array_keys($ownedVariantIds))
                ->where('product_id', '<>', $product->id)
                ->pluck('linked_product_id')
                ->map(fn ($id) => (int) $id)
                ->flip()
                ->all()
            : [];

        foreach ($incomingVariants as $index => $variantData) {
            $variantId = isset($variantData['id']) && is_numeric($variantData['id'])
                ? (int) $variantData['id']
                : null;
            $isExistingVariant = $variantId !== null;

            if ($isExistingVariant && !isset($ownedVariantIds[$variantId])) {
                $messages["variants.{$index}.id"][] = 'Biến thể này không thuộc sản phẩm hiện tại.';
                continue;
            }

            if ($isExistingVariant && isset($sharedVariantIds[$variantId])) {
                $messages["variants.{$index}.id"][] = 'Biến thể này đang được gán cho sản phẩm cha khác. Vui lòng tạo biến thể riêng cho sản phẩm hiện tại.';
                continue;
            }

            $normalizedSku = $this->productSkuService->normalize($variantData['sku'] ?? null);

            if ($isExistingVariant) {
                if ($normalizedSku === null) {
                    $messages["variants.{$index}.sku"][] = 'Mỗi biến thể phải có mã SKU riêng.';
                } elseif ($normalizedSku === $parentSku) {
                    $messages["variants.{$index}.sku"][] = 'Mã biến thể không được trùng với mã sản phẩm cha.';
                } elseif (in_array($normalizedSku, $reservedSkus, true)) {
                    $messages["variants.{$index}.sku"][] = 'Mã biến thể đang bị trùng trong danh sách hiện tại.';
                } elseif ($this->productSkuService->skuExists($normalizedSku, $variantId)) {
                    $messages["variants.{$index}.sku"][] = 'Mã biến thể này đã được sử dụng bởi một sản phẩm khác.';
                }
            } else {
                if (
                    $normalizedSku === null
                    || $normalizedSku === $parentSku
                    || in_array($normalizedSku, $reservedSkus, true)
                    || $this->productSkuService->skuExists($normalizedSku)
                ) {
                    $normalizedSku = $this->productSkuService->generateVariantSku($parentSku, null, $reservedSkus);
                }
            }

            if ($normalizedSku !== null) {
                $reservedSkus[] = $normalizedSku;
            }

            $variantData['sku'] = $normalizedSku;
            if (array_key_exists('stock_quantity', $variantData) && $variantData['stock_quantity'] !== null && $variantData['stock_quantity'] !== '') {
                $variantData['stock_quantity'] = InventoryQuantity::normalize($variantData['stock_quantity']);
            }
            $preparedVariants[] = $variantData;
        }

        if (!empty($messages)) {
            throw ValidationException::withMessages($messages);
        }

        return $preparedVariants;
    }

    protected function resolveDefaultVariantIndex(array $variants): ?int
    {
        foreach ($variants as $index => $variantData) {
            if (filter_var($variantData['is_default'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
                return (int) $index;
            }
        }

        return empty($variants) ? null : 0;
    }

    protected function throwSkuConstraintValidation(QueryException $exception, ?string $message = null): never
    {
        $sqlState = (string) ($exception->errorInfo[0] ?? $exception->getCode());
        $normalizedMessage = Str::lower($exception->getMessage());

        if (in_array($sqlState, ['23000', '23505'], true)) {
            if (Str::contains($normalizedMessage, [
                'product_links_unique_super_link_variant',
                'linked_product_id',
                'super_link',
            ])) {
                throw ValidationException::withMessages([
                    'variants' => ['Mỗi biến thể chỉ được thuộc về một sản phẩm cha. Dữ liệu hiện tại đang bị trùng, vui lòng tải lại và thử lại.'],
                ]);
            }

            if (Str::contains($normalizedMessage, [
                'products_sku_unique',
                'products_sku_key',
                'products.sku',
                ' sku ',
            ])) {
                throw ValidationException::withMessages([
                    'sku' => [$message ?? 'Mã SKU này đã được sử dụng bởi một sản phẩm khác.'],
                ]);
            }
        }

        throw $exception;
    }

    protected function applyLegacyExpectedCostAlias(Request $request, array &$validated): void
    {
        if (array_key_exists('cost_price', $validated)) {
            unset($validated['cost_price']);
        }

        if (array_key_exists('expected_cost', $validated)) {
            return;
        }

        if (!array_key_exists('cost_price', $request->all())) {
            return;
        }

        $validated['expected_cost'] = $request->input('cost_price');
    }

    protected function prepareOptionalStockQuantityForPersistence(
        Request $request,
        array &$payload,
        string $requestKey = 'stock_quantity',
        string $payloadKey = 'stock_quantity'
    ): void
    {
        if (!$request->exists($requestKey) && !array_key_exists($payloadKey, $payload)) {
            return;
        }

        $rawValue = array_key_exists($payloadKey, $payload)
            ? $payload[$payloadKey]
            : $request->input($requestKey);

        if (is_string($rawValue)) {
            $rawValue = trim($rawValue);
        }

        if ($rawValue === '' || $rawValue === null) {
            unset($payload[$payloadKey]);
            return;
        }

        if (is_numeric($rawValue)) {
            $payload[$payloadKey] = InventoryQuantity::normalize($rawValue);
        }
    }

    protected function normalizeSupplierIds(Request $request, array $validated = []): array
    {
        $rawSupplierIds = $validated['supplier_ids'] ?? $request->input('supplier_ids', []);
        $legacySupplierId = $validated['supplier_id'] ?? $request->input('supplier_id');

        if (!is_array($rawSupplierIds)) {
            $rawSupplierIds = is_string($rawSupplierIds) ? explode(',', $rawSupplierIds) : [$rawSupplierIds];
        }

        if ($legacySupplierId !== null && $legacySupplierId !== '' && !in_array($legacySupplierId, $rawSupplierIds, true)) {
            $rawSupplierIds[] = $legacySupplierId;
        }

        return collect($rawSupplierIds)
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    protected function normalizeCategoryIds(Request $request, array $validated = []): array
    {
        $rawCategoryIds = $validated['category_ids'] ?? $request->input('category_ids', []);
        $legacyCategoryId = $validated['category_id'] ?? $request->input('category_id');

        if (!is_array($rawCategoryIds)) {
            $rawCategoryIds = is_string($rawCategoryIds) ? explode(',', $rawCategoryIds) : [$rawCategoryIds];
        }

        if ($legacyCategoryId !== null && $legacyCategoryId !== '') {
            array_unshift($rawCategoryIds, $legacyCategoryId);
        }

        return collect($rawCategoryIds)
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    protected function syncProductSuppliers(Product $product, array $supplierIds): array
    {
        $supplierIds = collect($supplierIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        $syncData = [];
        foreach ($supplierIds as $supplierId) {
            $syncData[$supplierId] = ['account_id' => $product->account_id];
        }

        $resolvedSupplierId = null;
        if ($product->supplier_id && in_array((int) $product->supplier_id, $supplierIds, true)) {
            $resolvedSupplierId = (int) $product->supplier_id;
        } elseif (!empty($supplierIds)) {
            $resolvedSupplierId = $supplierIds[0];
        }

        $product->suppliers()->sync($syncData);
        $product->forceFill([
            'supplier_id' => $resolvedSupplierId,
        ])->save();

        return $supplierIds;
    }

    protected function syncSuppliersToVariants(Product $product, array $supplierIds): void
    {
        $variantIds = $product->linkedProducts()
            ->wherePivot('link_type', 'super_link')
            ->pluck('products.id');

        if ($variantIds->isEmpty()) {
            return;
        }

        Product::query()
            ->whereIn('id', $variantIds)
            ->get()
            ->each(function (Product $variant) use ($supplierIds) {
                $this->syncProductSuppliers($variant, $supplierIds);
            });
    }

    protected function applySupplierFilter(Builder $query, array $supplierIds, bool $includeUnassigned = false): void
    {
        $supplierIds = collect($supplierIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($supplierIds) && !$includeUnassigned) {
            return;
        }

        $query->where(function (Builder $builder) use ($supplierIds, $includeUnassigned) {
            if (!empty($supplierIds)) {
                $builder
                    ->whereHas('suppliers', function (Builder $supplierQuery) use ($supplierIds) {
                        $supplierQuery->whereIn('suppliers.id', $supplierIds);
                    })
                    ->orWhereIn('supplier_id', $supplierIds)
                    ->orWhereHas('supplierPrices', function (Builder $priceQuery) use ($supplierIds) {
                        $priceQuery->whereIn('supplier_id', $supplierIds);
                    });
            }

            if ($includeUnassigned) {
                if (!empty($supplierIds)) {
                    $builder->orWhere(function (Builder $unassignedQuery) {
                        $unassignedQuery
                            ->doesntHave('suppliers')
                            ->whereNull('supplier_id')
                            ->whereDoesntHave('supplierPrices');
                    });
                } else {
                    $builder
                        ->doesntHave('suppliers')
                        ->whereNull('supplier_id')
                        ->whereDoesntHave('supplierPrices');
                }
            }
        });
    }

    protected function usesPostgresSearchDriver(): bool
    {
        return DB::connection()->getDriverName() === 'pgsql';
    }

    protected function loweredSearchExpression(string $column): string
    {
        $column = "COALESCE({$column}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(immutable_unaccent({$column}))";
        }

        return "LOWER({$column})";
    }

    protected function compactSearchExpression(string $column): string
    {
        $column = "COALESCE({$column}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(REGEXP_REPLACE(immutable_unaccent({$column}), '[^a-zA-Z0-9]', '', 'g'))";
        }

        $expression = $column;
        foreach (['-', '_', ' ', '/', '.', '#'] as $character) {
            $expression = "REPLACE({$expression}, '{$character}', '')";
        }

        return "LOWER({$expression})";
    }

    protected function normalizedWordsExpression(string $column): string
    {
        $column = "COALESCE({$column}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(REGEXP_REPLACE(immutable_unaccent({$column}), '[^a-zA-Z0-9]+', ' ', 'g'))";
        }

        return "LOWER({$column})";
    }

    protected function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }

    protected function normalizeCodeSearchText(string $value): string
    {
        return (string) Str::of($value)
            ->lower()
            ->ascii()
            ->replaceMatches('/\s+/', ' ')
            ->trim();
    }

    protected function normalizeNameSearchText(string $value): string
    {
        return (string) Str::of($value)
            ->lower()
            ->ascii()
            ->replaceMatches('/[^a-z0-9]+/', ' ')
            ->squish();
    }

    protected function compactSearchText(string $value): string
    {
        return preg_replace('/[^a-z0-9]+/', '', $this->normalizeNameSearchText($value)) ?? '';
    }

    protected function compactCodeLooseLike(string $compactCode): ?string
    {
        if (!preg_match('/^([a-z]{2,})(\d+)$/', $compactCode, $matches)) {
            return null;
        }

        return '%' . $this->escapeLike($matches[1]) . '%' . $this->escapeLike($matches[2]) . '%';
    }

    protected function codeSearchNameAliases(string $compactCode): array
    {
        if (!preg_match('/^([a-z]{2,})(\d+)$/', $compactCode, $matches)) {
            return [];
        }

        $aliasesByPrefix = [
            'bh' => ['bat huong'],
            'bhr' => ['bat huong rong'],
            'bhl' => ['bat huong lam'],
        ];

        $prefix = $matches[1];
        $digits = $matches[2];
        $aliases = $aliasesByPrefix[$prefix] ?? [];

        if ($aliases === [] && str_starts_with($prefix, 'bh')) {
            $aliases = $aliasesByPrefix['bh'];
        }

        return collect($aliases)
            ->map(fn (string $alias) => [
                'words_like' => '%' . $this->escapeLike($alias) . '%',
                'digit_like' => '%' . $this->escapeLike($digits) . '%',
            ])
            ->values()
            ->all();
    }

    protected function splitCompactNameSearchTokens(string $value): array
    {
        if ($value === '') {
            return [];
        }

        preg_match_all('/[a-z]+|\d+/i', $value, $matches);

        return collect($matches[0] ?? [])
            ->map(fn ($token) => trim((string) $token))
            ->filter(fn ($token) => mb_strlen($token) >= 2)
            ->unique()
            ->values()
            ->all();
    }

    protected function extractNameSearchTokens(string $normalizedName, string $compactName): array
    {
        $normalizedTokens = collect(preg_split('/\s+/', $normalizedName, -1, PREG_SPLIT_NO_EMPTY))
            ->map(fn ($token) => trim((string) $token))
            ->filter(fn ($token) => mb_strlen($token) >= 2)
            ->values();

        if ($normalizedTokens->count() > 1) {
            return $normalizedTokens
                ->unique()
                ->take(12)
                ->values()
                ->all();
        }

        $compactTokens = collect($this->splitCompactNameSearchTokens($compactName));

        if ($compactTokens->count() > 1) {
            return $compactTokens
                ->take(12)
                ->values()
                ->all();
        }

        return $compactTokens
            ->merge($normalizedTokens)
            ->filter(fn ($token) => mb_strlen((string) $token) >= 2)
            ->unique()
            ->take(12)
            ->values()
            ->all();
    }

    protected function attachActualStockSubqueries(Builder $query, Request $request): array
    {
        $accountId = (int) $request->header('X-Account-Id');

        // Compute real-time base stock from inventory_batches (same source of truth
        // as InventoryService::refreshProducts). This avoids stale products.stock_quantity
        // which can diverge when stock is set manually via product import or the edit form.
        $batchStockSub = DB::table('inventory_batches')
            ->selectRaw('product_id')
            ->selectRaw('COALESCE(SUM(remaining_quantity), 0) AS batch_available')
            ->where('remaining_quantity', '>', 0)
            ->where(function ($q) {
                $q->whereNull('source_type')
                    ->orWhere('source_type', '!=', 'oversold_reserve');
            })
            ->groupBy('product_id');

        $oversoldReserveSub = DB::table('inventory_batch_allocations')
            ->join('inventory_batches', 'inventory_batches.id', '=', 'inventory_batch_allocations.inventory_batch_id')
            ->where('inventory_batches.source_type', 'oversold_reserve')
            ->selectRaw('inventory_batch_allocations.product_id')
            ->selectRaw('COALESCE(SUM(inventory_batch_allocations.quantity), 0) AS oversold_qty')
            ->groupBy('inventory_batch_allocations.product_id');

        if ($accountId > 0) {
            $batchStockSub->where('account_id', $accountId);
            $oversoldReserveSub->where('inventory_batch_allocations.account_id', $accountId);
        }

        $pendingOutboundQtySub = $this->buildPendingOutboundQuantitySubquery($request);
        $pendingReturnQtySub = $this->buildPendingReturnQuantitySubquery($request);

        $query->leftJoinSub($batchStockSub, 'inv_batch_stock', function ($join) {
            $join->on('inv_batch_stock.product_id', '=', 'products.id');
        });

        $query->leftJoinSub($oversoldReserveSub, 'inv_oversold_reserve', function ($join) {
            $join->on('inv_oversold_reserve.product_id', '=', 'products.id');
        });

        $query->leftJoinSub($pendingOutboundQtySub, 'pending_outbound', function ($join) {
            $join->on('pending_outbound.product_id', '=', 'products.id');
        });

        $query->leftJoinSub($pendingReturnQtySub, 'pending_returns', function ($join) {
            $join->on('pending_returns.product_id', '=', 'products.id');
        });

        // Base stock = batch available stock minus any oversold reservations
        $baseStockSql = '(COALESCE(inv_batch_stock.batch_available, 0) - COALESCE(inv_oversold_reserve.oversold_qty, 0))';
        $pendingExportQtySql = 'COALESCE(pending_outbound.pending_export_quantity, 0)';
        $pendingReturnQtySql = 'COALESCE(pending_returns.pending_return_quantity, 0)';
        // available_to_sell = base_stock - pending_export (negative allowed for pre-sales / back-orders)
        $availableToSellSql = '(' . $baseStockSql . ' - ' . $pendingExportQtySql . ')';

        return [
            'base_stock_sql' => $baseStockSql,
            'pending_export_sql' => $pendingExportQtySql,
            'pending_return_sql' => $pendingReturnQtySql,
            'available_to_sell_sql' => $availableToSellSql,
            'actual_stock_sql' => $availableToSellSql,
        ];
    }

    protected function buildPendingOutboundQuantitySubquery(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $manualExportScopeSql = "
            CASE
                WHEN inventory_documents.reference_type = 'order'
                    AND inventory_documents.reference_id IS NOT NULL
                    THEN inventory_documents.reference_id
                ELSE -inventory_documents.id
            END
        ";

        $manualExportQtySub = DB::table('inventory_document_items')
            ->join('inventory_documents', 'inventory_documents.id', '=', 'inventory_document_items.inventory_document_id')
            ->selectRaw($manualExportScopeSql . ' AS order_id')
            ->selectRaw('inventory_document_items.product_id')
            ->selectRaw('COALESCE(SUM(inventory_document_items.quantity), 0) AS exported_quantity')
            ->where('inventory_documents.type', 'export')
            ->whereIn('inventory_documents.status', ['draft', 'completed'])
            ->groupByRaw($manualExportScopeSql . ', inventory_document_items.product_id');

        if ($accountId > 0) {
            $manualExportQtySub->where('inventory_documents.account_id', $accountId);
        }

        if (Schema::hasColumn('inventory_documents', 'deleted_at')) {
            $manualExportQtySub->whereNull('inventory_documents.deleted_at');
        }

        $pendingOrderItemsSub = OrderItem::query()
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->selectRaw('order_items.order_id')
            ->selectRaw('COALESCE(order_items.actual_product_id, order_items.product_id) AS product_id')
            ->selectRaw('COALESCE(SUM(order_items.quantity), 0) AS ordered_quantity')
            ->whereNotNull('order_items.product_id')
            ->groupBy('order_items.order_id')
            ->groupByRaw('COALESCE(order_items.actual_product_id, order_items.product_id)');

        $this->applyPendingOutboundEligibleOrderScope($pendingOrderItemsSub, $request);

        return DB::query()
            ->fromSub($pendingOrderItemsSub, 'pending_order_items')
            ->leftJoinSub($manualExportQtySub, 'manual_exports', function ($join) {
                $join
                    ->on('manual_exports.order_id', '=', 'pending_order_items.order_id')
                    ->on('manual_exports.product_id', '=', 'pending_order_items.product_id');
            })
            ->selectRaw('pending_order_items.product_id')
            ->selectRaw('COALESCE(SUM(GREATEST(pending_order_items.ordered_quantity - COALESCE(manual_exports.exported_quantity, 0), 0)), 0) AS pending_export_quantity')
            ->groupBy('pending_order_items.product_id');
    }

    protected function buildPendingReturnQuantitySubquery(Request $request)
    {
        $pendingReturnItemsSub = OrderItem::query()
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->selectRaw('order_items.order_id')
            ->selectRaw('COALESCE(order_items.actual_product_id, order_items.product_id) AS product_id')
            ->selectRaw('COALESCE(SUM(order_items.quantity), 0) AS pending_return_quantity')
            ->whereNotNull('order_items.product_id')
            ->groupBy('order_items.order_id')
            ->groupByRaw('COALESCE(order_items.actual_product_id, order_items.product_id)');

        $this->applyPendingReturnEligibleOrderScope($pendingReturnItemsSub, $request);

        return DB::query()
            ->fromSub($pendingReturnItemsSub, 'pending_return_items')
            ->selectRaw('pending_return_items.product_id')
            ->selectRaw('COALESCE(SUM(pending_return_items.pending_return_quantity), 0) AS pending_return_quantity')
            ->groupBy('pending_return_items.product_id');
    }

    protected function applyPendingOutboundEligibleOrderScope($query, Request $request): void
    {
        $accountId = (int) $request->header('X-Account-Id');

        if ($accountId > 0) {
            $query->where('orders.account_id', $accountId);
        }

        if (Schema::hasColumn('orders', 'deleted_at')) {
            $query->whereNull('orders.deleted_at');
        }

        $query->where(function ($builder) {
            $builder
                ->where('orders.order_kind', Order::KIND_OFFICIAL)
                ->orWhereNull('orders.order_kind')
                ->orWhere('orders.order_kind', '');
        });

        $this->applyPendingOutboundInvalidStatusFilter($query, 'orders.status');

        $query
            ->where(function ($builder) {
                $builder
                    ->whereNull('orders.type')
                    ->orWhere('orders.type', '!=', 'inventory_export');
            })
            ->where(function ($builder) {
                $builder
                    ->whereNull('orders.shipping_tracking_code')
                    ->orWhere('orders.shipping_tracking_code', '');
            })
            ->whereNotExists(function ($shipmentQuery) {
                $shipmentQuery
                    ->select(DB::raw(1))
                    ->from('shipments')
                    ->whereColumn('shipments.order_id', 'orders.id');

                $this->applyActiveShipmentFilters($shipmentQuery, 'shipments');
            });
    }

    protected function applyPendingReturnEligibleOrderScope($query, Request $request): void
    {
        $accountId = (int) $request->header('X-Account-Id');

        if ($accountId > 0) {
            $query->where('orders.account_id', $accountId);
        }

        if (Schema::hasColumn('orders', 'deleted_at')) {
            $query->whereNull('orders.deleted_at');
        }

        $query->where(function ($builder) {
            $builder
                ->where('orders.order_kind', Order::KIND_OFFICIAL)
                ->orWhereNull('orders.order_kind')
                ->orWhere('orders.order_kind', '');
        });

        $query
            ->where(function ($builder) {
                $builder
                    ->whereNull('orders.type')
                    ->orWhere('orders.type', '!=', 'inventory_export');
            })
            ->whereIn('orders.status', [
                'pending_return',
                'returned',
                OrderStatusCatalog::PARTIAL_DELIVERY_CODE,
            ]);

        $this->orderInventorySlipService->applyReturnSlipStateFilter($query, 'missing');
    }

    protected function applyActiveShipmentFilters($query, string $shipmentTable = 'shipments'): void
    {
        if (Schema::hasColumn('shipments', 'deleted_at')) {
            $query->whereNull("{$shipmentTable}.deleted_at");
        }

        $query->whereNotIn("{$shipmentTable}.shipment_status", ['canceled']);
    }

    protected function applyPendingOutboundInvalidStatusFilter($query, string $column): void
    {
        $statusExpression = "LOWER(COALESCE({$column}, ''))";

        foreach ([
            'cancel',
            'canceled',
            'cancelled',
            'return',
            'returned',
            'returning',
            'pending return',
            'pending_return',
            'draft',
            'nhap',
            'huy',
            'hoan',
            'void',
        ] as $keyword) {
            $query->whereRaw($statusExpression . ' NOT LIKE ?', ['%' . $keyword . '%']);
        }
    }

    protected function buildActualStockMap(Request $request, array $productIds): array
    {
        $normalizedIds = collect($productIds)
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values();

        if ($normalizedIds->isEmpty()) {
            return [];
        }

        $stockQuery = Product::withTrashed()
            ->select(['products.id'])
            ->whereIn('products.id', $normalizedIds->all());

        $stockContext = $this->attachActualStockSubqueries($stockQuery, $request);

        return $stockQuery
            ->selectRaw($stockContext['actual_stock_sql'] . ' AS actual_stock')
            ->get()
            ->mapWithKeys(function (Product $product) {
                $actualStock = InventoryQuantity::normalize($product->actual_stock ?? 0);

                return [(int) $product->id => $actualStock];
            })
            ->all();
    }

    protected function buildInventorySnapshotMap(Request $request, array $productIds): array
    {
        $normalizedIds = collect($productIds)
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values();

        if ($normalizedIds->isEmpty()) {
            return [];
        }

        $stockQuery = Product::withTrashed()
            ->select(['products.id'])
            ->whereIn('products.id', $normalizedIds->all());

        $stockContext = $this->attachActualStockSubqueries($stockQuery, $request);

        return $stockQuery
            ->selectRaw($stockContext['base_stock_sql'] . ' AS computed_stock')
            ->selectRaw($stockContext['pending_export_sql'] . ' AS pending_export_quantity')
            ->get()
            ->mapWithKeys(function (Product $product) {
                $computedStock = InventoryQuantity::normalize($product->computed_stock ?? 0);
                $pendingExportQuantity = InventoryQuantity::normalize($product->pending_export_quantity ?? 0);
                // available_to_sell is allowed to be negative (pre-sales / back-orders)
                $availableToSell = $computedStock - $pendingExportQuantity;

                return [(int) $product->id => [
                    'computed_stock' => $computedStock,
                    'pending_export_quantity' => $pendingExportQuantity,
                    'available_to_sell' => $availableToSell,
                ]];
            })
            ->all();
    }

    protected function resolveInventorySnapshotPayload(array $snapshotMap, int $productId): array
    {
        $snapshot = $productId > 0 ? ($snapshotMap[$productId] ?? null) : null;

        return [
            'computed_stock' => $snapshot['computed_stock'] ?? null,
            'pending_export_quantity' => $snapshot['pending_export_quantity'] ?? null,
            'available_to_sell' => $snapshot['available_to_sell'] ?? null,
        ];
    }

    protected function appendInventorySnapshotToPickerPayload(array $productPayload, array $snapshotMap): array
    {
        $productPayload = array_merge(
            $productPayload,
            $this->resolveInventorySnapshotPayload($snapshotMap, (int) ($productPayload['id'] ?? 0))
        );

        $productPayload['variations'] = collect($productPayload['variations'] ?? [])
            ->map(function (array $variation) use ($snapshotMap) {
                return array_merge(
                    $variation,
                    $this->resolveInventorySnapshotPayload($snapshotMap, (int) ($variation['id'] ?? 0))
                );
            })
            ->values()
            ->all();

        $productPayload['bundle_options'] = collect($productPayload['bundle_options'] ?? [])
            ->map(function (array $bundleOption) use ($snapshotMap) {
                $bundleOption['items'] = collect($bundleOption['items'] ?? [])
                    ->map(function (array $bundleItem) use ($snapshotMap) {
                        $targetProductId = (int) ($bundleItem['product_id'] ?? $bundleItem['id'] ?? 0);

                        return array_merge(
                            $bundleItem,
                            $this->resolveInventorySnapshotPayload($snapshotMap, $targetProductId)
                        );
                    })
                    ->values()
                    ->all();

                return $bundleOption;
            })
            ->values()
            ->all();

        return $productPayload;
    }

    protected function syncProductStocksFromInventory(Product $product, array $stockMap): Product
    {
        $applyStock = function (Product $item) use ($stockMap): void {
            $productId = (int) ($item->id ?? 0);
            if ($productId <= 0) {
                return;
            }

            $actualStock = array_key_exists($productId, $stockMap)
                ? InventoryQuantity::normalize($stockMap[$productId])
                : InventoryQuantity::normalize($item->actual_stock ?? $item->stock_quantity ?? 0);
            $item->setAttribute('actual_stock', $actualStock);
            $item->setAttribute('stock_quantity', $actualStock);
        };

        $applyStock($product);

        foreach (['variations', 'groupedItems', 'bundleItems', 'linkedProducts'] as $relation) {
            if (!$product->relationLoaded($relation)) {
                continue;
            }

            $product->{$relation}->each(function ($relatedProduct) use ($applyStock) {
                if ($relatedProduct instanceof Product) {
                    $applyStock($relatedProduct);
                }
            });
        }

        return $product;
    }

    protected function looksLikeProductCodeSearch(string $rawSearch): bool
    {
        $trimmed = trim($rawSearch);
        if ($trimmed === '') {
            return false;
        }

        $compactSearch = $this->compactSearchText($trimmed);
        if ($compactSearch === '') {
            return false;
        }

        $hasDigit = preg_match('/\d/u', $trimmed) === 1;
        $hasSeparator = preg_match('/[-_.\/\\\\]/u', $trimmed) === 1;
        $hasWhitespace = preg_match('/\s/u', $trimmed) === 1;
        $allowedCharactersOnly = preg_match('/^[\pL\pN\s\-_.\/\\\\]+$/u', $trimmed) === 1;

        if (!$allowedCharactersOnly) {
            return false;
        }

        if (!$hasWhitespace && ($hasDigit || $hasSeparator)) {
            return true;
        }

        return ctype_digit($compactSearch) && strlen($compactSearch) >= 3;
    }

    protected function shouldIncludeNameMatchesInCodeSearch(string $rawSearch): bool
    {
        $trimmed = trim($rawSearch);
        if ($trimmed === '') {
            return false;
        }

        if (preg_match('/[\s\-_.\/\\\\]/u', $trimmed) === 1) {
            return false;
        }

        return preg_match('/\pL/u', $trimmed) === 1
            && preg_match('/\d/u', $trimmed) === 1;
    }

    protected function applyProductSearch(Builder $query, string $rawSearch, bool $includeVariationMatches = true): array
    {
        $trimmedSearch = trim($rawSearch);
        if ($trimmedSearch === '') {
            return [null, []];
        }

        if ($this->looksLikeProductCodeSearch($trimmedSearch)) {
            $compactSearch = $this->compactSearchText($trimmedSearch);
            if (
                preg_match('/[a-z]/', $compactSearch) === 1
                && preg_match('/\d/', $compactSearch) === 1
            ) {
                return $this->applyProductCodeSearch($query, $trimmedSearch, $includeVariationMatches);
            }

            $codeProbeQuery = clone $query;
            [$codeSearchRankingSql] = $this->applyProductCodeSearch($codeProbeQuery, $trimmedSearch, $includeVariationMatches);

            if ($codeSearchRankingSql !== null && $codeProbeQuery->exists()) {
                return $this->applyProductCodeSearch($query, $trimmedSearch, $includeVariationMatches);
            }
        }

        return $this->applyProductNameSearch($query, $trimmedSearch, $includeVariationMatches);
    }

    protected function applyProductCodeSearch(Builder $query, string $rawSearch, bool $includeVariationMatches = true): array
    {
        $normalizedCode = $this->normalizeCodeSearchText($rawSearch);
        $compactCode = $this->compactSearchText($rawSearch);
        $includeNameMatches = $this->shouldIncludeNameMatchesInCodeSearch($rawSearch);
        $normalizedName = $includeNameMatches ? $this->normalizeNameSearchText($rawSearch) : '';

        if ($normalizedCode === '' && $compactCode === '') {
            return [null, []];
        }

        $skuExpr = $this->loweredSearchExpression('products.sku');
        $compactSkuExpr = $this->compactSearchExpression('products.sku');
        $nameExpr = $includeNameMatches ? $this->normalizedWordsExpression('products.name') : null;
        $compactNameExpr = $includeNameMatches ? $this->compactSearchExpression('products.name') : null;
        $exactCodeSearch = function (Builder $searchQuery) use ($skuExpr, $compactSkuExpr, $normalizedCode, $compactCode, $includeVariationMatches) {
            $searchQuery
                ->where(function (Builder $directQuery) use ($skuExpr, $compactSkuExpr, $normalizedCode, $compactCode) {
                    $directQuery->whereRaw("{$skuExpr} = ?", [$normalizedCode]);

                    if ($compactCode !== '') {
                        $directQuery->orWhereRaw("{$compactSkuExpr} = ?", [$compactCode]);
                    }
                });

            if ($includeVariationMatches) {
                $searchQuery->orWhereHas('variations', function (Builder $variationQuery) use ($normalizedCode, $compactCode) {
                    $variationSkuExpr = $this->loweredSearchExpression('sku');
                    $variationCompactSkuExpr = $this->compactSearchExpression('sku');

                    $variationQuery->where('status', true)
                        ->where(function (Builder $directVariationQuery) use ($variationSkuExpr, $variationCompactSkuExpr, $normalizedCode, $compactCode) {
                            $directVariationQuery->whereRaw("{$variationSkuExpr} = ?", [$normalizedCode]);

                            if ($compactCode !== '') {
                                $directVariationQuery->orWhereRaw("{$variationCompactSkuExpr} = ?", [$compactCode]);
                            }
                        });
                });
            }
        };

        $hasExactCodeMatch = (clone $query)->where($exactCodeSearch)->exists();
        $codePrefixLike = $this->escapeLike($normalizedCode) . '%';
        $codeContainsLike = '%' . $this->escapeLike($normalizedCode) . '%';
        $compactCodePrefixLike = $compactCode !== '' ? $this->escapeLike($compactCode) . '%' : null;
        $compactCodeContainsLike = $compactCode !== '' ? '%' . $this->escapeLike($compactCode) . '%' : null;
        $compactCodeLooseLike = $compactCode !== '' ? $this->compactCodeLooseLike($compactCode) : null;
        $nameAliasConstraints = $compactCode !== '' ? $this->codeSearchNameAliases($compactCode) : [];
        $useDirectAttributeCodeSearch = $compactCode !== '' && !str_starts_with($compactCode, 'bh');
        $nameContainsLike = ($includeNameMatches && $normalizedName !== '')
            ? '%' . $this->escapeLike($normalizedName) . '%'
            : null;
        if ($hasExactCodeMatch) {
            $searchRankingParts = [
                "CASE WHEN {$skuExpr} = ? THEN 5000 ELSE 0 END",
            ];
            $searchRankingBindings = [$normalizedCode];

            if ($compactCode !== '') {
                $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} = ? THEN 4900 ELSE 0 END";
                $searchRankingBindings[] = $compactCode;
            }

            $searchRankingSql = '(' . implode(' + ', $searchRankingParts) . ')';
            $query->selectRaw("{$searchRankingSql} AS search_score", $searchRankingBindings);
            $query->where($exactCodeSearch);

            return [$searchRankingSql, $searchRankingBindings];
        }

        $searchRankingParts = [
            "CASE WHEN {$skuExpr} = ? THEN 5000 ELSE 0 END",
            "CASE WHEN {$skuExpr} LIKE ? ESCAPE '\\' THEN 2400 ELSE 0 END",
            "CASE WHEN {$skuExpr} LIKE ? ESCAPE '\\' THEN 1800 ELSE 0 END",
        ];
        $searchRankingBindings = [
            $normalizedCode,
            $codePrefixLike,
            $codeContainsLike,
        ];

        if ($compactCode !== '') {
            $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} = ? THEN 4900 ELSE 0 END";
            $searchRankingBindings[] = $compactCode;
        }

        if ($compactCodePrefixLike !== null) {
            $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} LIKE ? ESCAPE '\\' THEN 2300 ELSE 0 END";
            $searchRankingBindings[] = $compactCodePrefixLike;
        }

        if ($compactCodeContainsLike !== null) {
            $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} LIKE ? ESCAPE '\\' THEN 1700 ELSE 0 END";
            $searchRankingBindings[] = $compactCodeContainsLike;
        }

        if ($compactCodeLooseLike !== null) {
            $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} LIKE ? ESCAPE '\\' THEN 1450 ELSE 0 END";
            $searchRankingBindings[] = $compactCodeLooseLike;
        }

        if ($includeNameMatches && $nameExpr !== null && $nameContainsLike !== null) {
            $searchRankingParts[] = "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 1600 ELSE 0 END";
            $searchRankingBindings[] = $nameContainsLike;
        }

        if ($includeNameMatches && $compactNameExpr !== null && $compactCodeContainsLike !== null) {
            $searchRankingParts[] = "CASE WHEN {$compactNameExpr} LIKE ? ESCAPE '\\' THEN 1500 ELSE 0 END";
            $searchRankingBindings[] = $compactCodeContainsLike;
        }

        if ($includeNameMatches && $nameExpr !== null && $compactNameExpr !== null) {
            foreach ($nameAliasConstraints as $constraint) {
                $searchRankingParts[] = "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' AND {$compactNameExpr} LIKE ? ESCAPE '\\' THEN 1350 ELSE 0 END";
                $searchRankingBindings[] = $constraint['words_like'];
                $searchRankingBindings[] = $constraint['digit_like'];
            }
        }

        $searchRankingSql = '(' . implode(' + ', $searchRankingParts) . ')';
        $query->selectRaw("{$searchRankingSql} AS search_score", $searchRankingBindings);
        $query->where(function (Builder $searchQuery) use (
            $skuExpr,
            $compactSkuExpr,
            $codeContainsLike,
            $compactCodeContainsLike,
            $compactCodeLooseLike,
            $includeNameMatches,
            $nameExpr,
            $compactNameExpr,
            $nameContainsLike,
            $nameAliasConstraints,
            $useDirectAttributeCodeSearch,
            $includeVariationMatches
        ) {
            $attributeWordLikes = $useDirectAttributeCodeSearch
                ? collect([$nameContainsLike])
                    ->filter()
                    ->values()
                    ->all()
                : [];
            $attributeCompactLikes = $useDirectAttributeCodeSearch
                ? collect([$compactCodeContainsLike, $compactCodeLooseLike])
                    ->filter()
                    ->unique()
                    ->values()
                    ->all()
                : [];
            $searchQuery
                ->where(function (Builder $directQuery) use (
                    $skuExpr,
                    $compactSkuExpr,
                    $codeContainsLike,
                    $compactCodeContainsLike,
                    $compactCodeLooseLike,
                    $includeNameMatches,
                    $nameExpr,
                    $compactNameExpr,
                    $nameContainsLike,
                    $nameAliasConstraints
                ) {
                    $directQuery->whereRaw("{$skuExpr} LIKE ? ESCAPE '\\'", [$codeContainsLike]);

                    if ($compactCodeContainsLike !== null) {
                        $directQuery->orWhereRaw("{$compactSkuExpr} LIKE ? ESCAPE '\\'", [$compactCodeContainsLike]);
                    }

                    if ($compactCodeLooseLike !== null) {
                        $directQuery->orWhereRaw("{$compactSkuExpr} LIKE ? ESCAPE '\\'", [$compactCodeLooseLike]);
                    }

                    if ($includeNameMatches && $nameExpr !== null && $nameContainsLike !== null) {
                        $directQuery->orWhereRaw("{$nameExpr} LIKE ? ESCAPE '\\'", [$nameContainsLike]);
                    }

                    if ($includeNameMatches && $compactNameExpr !== null && $compactCodeContainsLike !== null) {
                        $directQuery->orWhereRaw("{$compactNameExpr} LIKE ? ESCAPE '\\'", [$compactCodeContainsLike]);
                    }

                    if ($includeNameMatches && $nameExpr !== null && $compactNameExpr !== null) {
                        foreach ($nameAliasConstraints as $constraint) {
                            $directQuery->orWhere(function (Builder $aliasQuery) use ($nameExpr, $compactNameExpr, $constraint) {
                                $aliasQuery
                                    ->whereRaw("{$nameExpr} LIKE ? ESCAPE '\\'", [$constraint['words_like']])
                                    ->whereRaw("{$compactNameExpr} LIKE ? ESCAPE '\\'", [$constraint['digit_like']]);
                            });
                        }
                    }
                });

            if ($includeVariationMatches) {
                $searchQuery->orWhereHas('variations', function (Builder $variationQuery) use (
                    $codeContainsLike,
                    $compactCodeContainsLike,
                    $compactCodeLooseLike,
                    $includeNameMatches,
                    $nameContainsLike,
                    $nameAliasConstraints
                ) {
                    $variationSkuExpr = $this->loweredSearchExpression('sku');
                    $variationCompactSkuExpr = $this->compactSearchExpression('sku');
                    $variationNameExpr = $includeNameMatches ? $this->normalizedWordsExpression('name') : null;
                    $variationCompactNameExpr = $includeNameMatches ? $this->compactSearchExpression('name') : null;

                    $variationQuery->where('status', true)
                        ->where(function (Builder $directVariationQuery) use (
                            $variationSkuExpr,
                            $variationCompactSkuExpr,
                            $variationNameExpr,
                            $variationCompactNameExpr,
                            $codeContainsLike,
                            $compactCodeContainsLike,
                            $compactCodeLooseLike,
                            $includeNameMatches,
                            $nameContainsLike,
                            $nameAliasConstraints
                        ) {
                            $directVariationQuery->whereRaw("{$variationSkuExpr} LIKE ? ESCAPE '\\'", [$codeContainsLike]);

                            if ($compactCodeContainsLike !== null) {
                                $directVariationQuery->orWhereRaw("{$variationCompactSkuExpr} LIKE ? ESCAPE '\\'", [$compactCodeContainsLike]);
                            }

                            if ($compactCodeLooseLike !== null) {
                                $directVariationQuery->orWhereRaw("{$variationCompactSkuExpr} LIKE ? ESCAPE '\\'", [$compactCodeLooseLike]);
                            }

                            if ($includeNameMatches && $variationNameExpr !== null && $nameContainsLike !== null) {
                                $directVariationQuery->orWhereRaw("{$variationNameExpr} LIKE ? ESCAPE '\\'", [$nameContainsLike]);
                            }

                            if ($includeNameMatches && $variationCompactNameExpr !== null && $compactCodeContainsLike !== null) {
                                $directVariationQuery->orWhereRaw("{$variationCompactNameExpr} LIKE ? ESCAPE '\\'", [$compactCodeContainsLike]);
                            }

                            if ($includeNameMatches && $variationNameExpr !== null && $variationCompactNameExpr !== null) {
                                foreach ($nameAliasConstraints as $constraint) {
                                    $directVariationQuery->orWhere(function (Builder $aliasQuery) use ($variationNameExpr, $variationCompactNameExpr, $constraint) {
                                        $aliasQuery
                                            ->whereRaw("{$variationNameExpr} LIKE ? ESCAPE '\\'", [$constraint['words_like']])
                                            ->whereRaw("{$variationCompactNameExpr} LIKE ? ESCAPE '\\'", [$constraint['digit_like']]);
                                    });
                                }
                            }
                        });
                });
            }

            if ($attributeWordLikes !== [] || $attributeCompactLikes !== []) {
                $searchQuery->orWhereHas('attributeValues', function (Builder $attributeValueQuery) use ($attributeWordLikes, $attributeCompactLikes) {
                    $this->applyProductCodeAttributeValueConstraint($attributeValueQuery, $attributeWordLikes, $attributeCompactLikes);
                });

                if ($includeVariationMatches) {
                    $searchQuery->orWhereHas('variations.attributeValues', function (Builder $attributeValueQuery) use ($attributeWordLikes, $attributeCompactLikes) {
                        $attributeValueQuery->whereHas('product', function (Builder $productQuery) {
                            $productQuery->where('status', true);
                        });
                        $this->applyProductCodeAttributeValueConstraint($attributeValueQuery, $attributeWordLikes, $attributeCompactLikes);
                    });
                }
            }

            $this->applyProductCodeNameAliasConstraint($searchQuery, $nameAliasConstraints, $includeVariationMatches);
            $this->applyProductCodeBundleOptionConstraint($searchQuery, $attributeWordLikes, $attributeCompactLikes);

        });

        return [$searchRankingSql, $searchRankingBindings];
    }

    protected function applyProductSearchAttributeValueLikeConstraint(Builder $query, string $likeValue): void
    {
        $valueExpr = $this->normalizedWordsExpression('value');

        $query->whereRaw("{$valueExpr} LIKE ? ESCAPE '\\'", [$likeValue]);
    }

    protected function applyProductSearchAttributeValueCompactLikeConstraint(Builder $query, string $likeValue): void
    {
        $valueExpr = $this->compactSearchExpression('value');

        $query->whereRaw("{$valueExpr} LIKE ? ESCAPE '\\'", [$likeValue]);
    }

    protected function applyProductCodeAttributeValueConstraint(Builder $query, array $wordLikes, array $compactLikes): void
    {
        $valueExpr = $this->normalizedWordsExpression('value');
        $compactValueExpr = $this->compactSearchExpression('value');

        $query->where(function (Builder $valueQuery) use ($valueExpr, $compactValueExpr, $wordLikes, $compactLikes) {
            foreach ($wordLikes as $wordLike) {
                $valueQuery->orWhereRaw("{$valueExpr} LIKE ? ESCAPE '\\'", [$wordLike]);
            }

            foreach ($compactLikes as $compactLike) {
                $valueQuery->orWhereRaw("{$compactValueExpr} LIKE ? ESCAPE '\\'", [$compactLike]);
            }
        });
    }

    protected function applyProductCodeBundleOptionConstraint(Builder $query, array $wordLikes, array $compactLikes): void
    {
        if ($wordLikes === [] && $compactLikes === []) {
            return;
        }

        $query->orWhereHas('bundleItems', function (Builder $bundleQuery) use ($wordLikes, $compactLikes) {
            $bundleOptionExpr = $this->normalizedWordsExpression('product_links.option_title');
            $bundleOptionCompactExpr = $this->compactSearchExpression('product_links.option_title');

            $bundleQuery->where(function (Builder $optionQuery) use ($bundleOptionExpr, $bundleOptionCompactExpr, $wordLikes, $compactLikes) {
                foreach ($wordLikes as $wordLike) {
                    $optionQuery->orWhereRaw("{$bundleOptionExpr} LIKE ? ESCAPE '\\'", [$wordLike]);
                }

                foreach ($compactLikes as $compactLike) {
                    $optionQuery->orWhereRaw("{$bundleOptionCompactExpr} LIKE ? ESCAPE '\\'", [$compactLike]);
                }
            });
        });
    }

    protected function applyProductCodeNameAliasConstraint(
        Builder $query,
        array $nameAliasConstraints,
        bool $includeVariationMatches = true
    ): void {
        if ($nameAliasConstraints === []) {
            return;
        }

        $nameExpr = $this->normalizedWordsExpression('products.name');
        $compactNameExpr = $this->compactSearchExpression('products.name');

        $query->orWhere(function (Builder $aliasQuery) use ($nameAliasConstraints, $nameExpr, $compactNameExpr, $includeVariationMatches) {
            foreach ($nameAliasConstraints as $constraint) {
                $aliasQuery->orWhere(function (Builder $singleAliasQuery) use ($constraint, $nameExpr, $compactNameExpr, $includeVariationMatches) {
                    $wordsLike = $constraint['words_like'] ?? null;
                    $digitLike = $constraint['digit_like'] ?? null;
                    if (!$wordsLike || !$digitLike) {
                        $singleAliasQuery->whereRaw('1 = 0');
                        return;
                    }

                    $singleAliasQuery
                        ->whereRaw("{$nameExpr} LIKE ? ESCAPE '\\'", [$wordsLike])
                        ->where(function (Builder $digitQuery) use ($compactNameExpr, $digitLike, $includeVariationMatches) {
                            $digitQuery->whereRaw("{$compactNameExpr} LIKE ? ESCAPE '\\'", [$digitLike])
                                ->orWhereHas('attributeValues', function (Builder $attributeValueQuery) use ($digitLike) {
                                    $this->applyProductSearchAttributeValueCompactLikeConstraint($attributeValueQuery, $digitLike);
                                });

                            if ($includeVariationMatches) {
                                $digitQuery->orWhereHas('variations.attributeValues', function (Builder $attributeValueQuery) use ($digitLike) {
                                    $attributeValueQuery->whereHas('product', function (Builder $productQuery) {
                                        $productQuery->where('status', true);
                                    });
                                    $this->applyProductSearchAttributeValueCompactLikeConstraint($attributeValueQuery, $digitLike);
                                });
                            }
                        });
                });
            }
        });
    }

    protected function applyBundleNamePhraseConstraint(Builder $query, string $nameContainsLike, ?string $compactNameContainsLike = null): void
    {
        $query->orWhereHas('bundleItems', function (Builder $bundleQuery) use ($nameContainsLike, $compactNameContainsLike) {
            $bundleOptionExpr = $this->normalizedWordsExpression('product_links.option_title');
            $bundleOptionCompactExpr = $this->compactSearchExpression('product_links.option_title');

            $bundleQuery->where(function (Builder $directBundleQuery) use ($bundleOptionExpr, $bundleOptionCompactExpr, $nameContainsLike, $compactNameContainsLike) {
                $directBundleQuery->whereRaw("{$bundleOptionExpr} LIKE ? ESCAPE '\\'", [$nameContainsLike]);

                if ($compactNameContainsLike !== null) {
                    $directBundleQuery->orWhereRaw("{$bundleOptionCompactExpr} LIKE ? ESCAPE '\\'", [$compactNameContainsLike]);
                }
            });
        });
    }

    protected function applyBundleNameTokenConstraint(Builder $query, array $tokenLikes): void
    {
        $query->orWhereHas('bundleItems', function (Builder $bundleQuery) use ($tokenLikes) {
            $bundleOptionExpr = $this->normalizedWordsExpression('product_links.option_title');
            $bundleOptionCompactExpr = $this->compactSearchExpression('product_links.option_title');

            $bundleQuery->where(function (Builder $directBundleQuery) use ($bundleOptionExpr, $bundleOptionCompactExpr, $tokenLikes) {
                foreach ($tokenLikes as $tokenLike) {
                    $directBundleQuery->where(function (Builder $segmentQuery) use ($bundleOptionExpr, $bundleOptionCompactExpr, $tokenLike) {
                        $segmentQuery
                            ->whereRaw("{$bundleOptionExpr} LIKE ? ESCAPE '\\'", [$tokenLike])
                            ->orWhereRaw("{$bundleOptionCompactExpr} LIKE ? ESCAPE '\\'", [$tokenLike]);
                    });
                }
            });
        });
    }

    protected function applyBundleNameAdjacentPhraseConstraint(Builder $query, array $adjacentPhraseLikes): void
    {
        $query->orWhereHas('bundleItems', function (Builder $bundleQuery) use ($adjacentPhraseLikes) {
            $bundleOptionExpr = $this->normalizedWordsExpression('product_links.option_title');

            $bundleQuery->where(function (Builder $directBundleQuery) use ($bundleOptionExpr, $adjacentPhraseLikes) {
                foreach ($adjacentPhraseLikes as $phraseLike) {
                    $directBundleQuery->orWhereRaw("{$bundleOptionExpr} LIKE ? ESCAPE '\\'", [$phraseLike]);
                }
            });
        });
    }

    protected function applyProductNamePhraseConstraint(
        Builder $query,
        string $nameContainsLike,
        ?string $compactNameContainsLike = null,
        bool $includeVariationMatches = true
    ): void
    {
        $nameExpr = $this->normalizedWordsExpression('products.name');
        $compactNameExpr = $this->compactSearchExpression('products.name');

        $query
            ->where(function (Builder $directQuery) use ($nameExpr, $compactNameExpr, $nameContainsLike, $compactNameContainsLike) {
                $directQuery->whereRaw("{$nameExpr} LIKE ? ESCAPE '\\'", [$nameContainsLike]);

                if ($compactNameContainsLike !== null) {
                    $directQuery->orWhereRaw("{$compactNameExpr} LIKE ? ESCAPE '\\'", [$compactNameContainsLike]);
                }
            })
            ->orWhereHas('attributeValues', function (Builder $attributeValueQuery) use ($nameContainsLike) {
                $this->applyProductSearchAttributeValueLikeConstraint($attributeValueQuery, $nameContainsLike);
            });

        if ($includeVariationMatches) {
            $query
                ->orWhereHas('variations', function (Builder $variationQuery) use ($nameContainsLike, $compactNameContainsLike) {
                    $variationNameExpr = $this->normalizedWordsExpression('name');
                    $variationCompactNameExpr = $this->compactSearchExpression('name');

                    $variationQuery->where('status', true)
                        ->where(function (Builder $directVariationQuery) use ($variationNameExpr, $variationCompactNameExpr, $nameContainsLike, $compactNameContainsLike) {
                            $directVariationQuery->whereRaw("{$variationNameExpr} LIKE ? ESCAPE '\\'", [$nameContainsLike]);

                            if ($compactNameContainsLike !== null) {
                                $directVariationQuery->orWhereRaw("{$variationCompactNameExpr} LIKE ? ESCAPE '\\'", [$compactNameContainsLike]);
                            }
                        });
                })
                ->orWhereHas('variations.attributeValues', function (Builder $attributeValueQuery) use ($nameContainsLike) {
                    $attributeValueQuery->whereHas('product', function (Builder $productQuery) {
                        $productQuery->where('status', true);
                    });
                    $this->applyProductSearchAttributeValueLikeConstraint($attributeValueQuery, $nameContainsLike);
                });
        }

        $this->applyBundleNamePhraseConstraint($query, $nameContainsLike, $compactNameContainsLike);
    }

    protected function applyProductNameTokenConstraint(
        Builder $query,
        array $tokenLikes,
        bool $includeSku = false,
        bool $includeVariationMatches = true
    ): void
    {
        $nameExpr = $this->normalizedWordsExpression('products.name');
        $compactNameExpr = $this->compactSearchExpression('products.name');
        $compactSkuExpr = $includeSku ? $this->compactSearchExpression('products.sku') : null;

        $query
            ->where(function (Builder $directQuery) use ($nameExpr, $compactNameExpr, $compactSkuExpr, $tokenLikes) {
                foreach ($tokenLikes as $tokenLike) {
                    $directQuery->where(function (Builder $segmentQuery) use ($nameExpr, $compactNameExpr, $compactSkuExpr, $tokenLike) {
                        $segmentQuery
                            ->whereRaw("{$nameExpr} LIKE ? ESCAPE '\\'", [$tokenLike])
                            ->orWhereRaw("{$compactNameExpr} LIKE ? ESCAPE '\\'", [$tokenLike]);

                        if ($compactSkuExpr !== null) {
                            $segmentQuery->orWhereRaw("{$compactSkuExpr} LIKE ? ESCAPE '\\'", [$tokenLike]);
                        }
                    });
                }
            })
            ->orWhereHas('attributeValues', function (Builder $attributeValueQuery) use ($tokenLikes) {
                foreach ($tokenLikes as $tokenLike) {
                    $this->applyProductSearchAttributeValueLikeConstraint($attributeValueQuery, $tokenLike);
                }
            });

        if ($includeVariationMatches) {
            $query
                ->orWhereHas('variations', function (Builder $variationQuery) use ($tokenLikes, $includeSku) {
                    $variationNameExpr = $this->normalizedWordsExpression('name');
                    $variationCompactNameExpr = $this->compactSearchExpression('name');
                    $variationCompactSkuExpr = $includeSku ? $this->compactSearchExpression('sku') : null;

                    $variationQuery->where('status', true);

                    foreach ($tokenLikes as $tokenLike) {
                        $variationQuery->where(function (Builder $segmentQuery) use ($variationNameExpr, $variationCompactNameExpr, $variationCompactSkuExpr, $tokenLike) {
                            $segmentQuery
                                ->whereRaw("{$variationNameExpr} LIKE ? ESCAPE '\\'", [$tokenLike])
                                ->orWhereRaw("{$variationCompactNameExpr} LIKE ? ESCAPE '\\'", [$tokenLike]);

                            if ($variationCompactSkuExpr !== null) {
                                $segmentQuery->orWhereRaw("{$variationCompactSkuExpr} LIKE ? ESCAPE '\\'", [$tokenLike]);
                            }
                        });
                    }
                })
                ->orWhereHas('variations.attributeValues', function (Builder $attributeValueQuery) use ($tokenLikes) {
                    $attributeValueQuery->whereHas('product', function (Builder $productQuery) {
                        $productQuery->where('status', true);
                    });
                    foreach ($tokenLikes as $tokenLike) {
                        $this->applyProductSearchAttributeValueLikeConstraint($attributeValueQuery, $tokenLike);
                    }
                });
        }

        $this->applyBundleNameTokenConstraint($query, $tokenLikes);
    }

    protected function applyProductNameAdjacentPhraseConstraint(
        Builder $query,
        array $adjacentPhraseLikes,
        bool $includeVariationMatches = true
    ): void
    {
        $nameExpr = $this->normalizedWordsExpression('products.name');

        $query
            ->where(function (Builder $directQuery) use ($nameExpr, $adjacentPhraseLikes) {
                foreach ($adjacentPhraseLikes as $phraseLike) {
                    $directQuery->orWhereRaw("{$nameExpr} LIKE ? ESCAPE '\\'", [$phraseLike]);
                }
            });

        if ($includeVariationMatches) {
            $query->orWhereHas('variations', function (Builder $variationQuery) use ($adjacentPhraseLikes) {
                $variationNameExpr = $this->normalizedWordsExpression('name');

                $variationQuery->where('status', true)
                    ->where(function (Builder $directVariationQuery) use ($variationNameExpr, $adjacentPhraseLikes) {
                        foreach ($adjacentPhraseLikes as $phraseLike) {
                            $directVariationQuery->orWhereRaw("{$variationNameExpr} LIKE ? ESCAPE '\\'", [$phraseLike]);
                        }
                    });
            });
        }

        $this->applyBundleNameAdjacentPhraseConstraint($query, $adjacentPhraseLikes);
    }

    protected function applyProductNameSearch(Builder $query, string $rawSearch, bool $includeVariationMatches = true): array
    {
        $normalizedName = $this->normalizeNameSearchText($rawSearch);
        if ($normalizedName === '') {
            return [null, []];
        }

        $nameExpr = $this->normalizedWordsExpression('products.name');
        $compactNameExpr = $this->compactSearchExpression('products.name');
        $nameExact = $normalizedName;
        $namePrefixLike = $this->escapeLike($normalizedName) . '%';
        $nameContainsLike = '%' . $this->escapeLike($normalizedName) . '%';
        $compactName = $this->compactSearchText($rawSearch);
        $compactNameExact = $compactName !== '' ? $compactName : null;
        $compactNamePrefixLike = $compactName !== '' ? $this->escapeLike($compactName) . '%' : null;
        $compactNameContainsLike = $compactName !== '' ? '%' . $this->escapeLike($compactName) . '%' : null;
        $nameTokens = $this->extractNameSearchTokens($normalizedName, $compactName);
        $isCompactCompositeSearch = !preg_match('/\s/u', trim($rawSearch)) && count($nameTokens) > 1;
        $tokenLikes = array_map(
            fn ($token) => '%' . $this->escapeLike($token) . '%',
            $nameTokens
        );
        $adjacentPhraseLikes = collect($nameTokens)
            ->sliding(2)
            ->map(function ($tokens) {
                $phrase = collect($tokens)->implode(' ');

                return '%' . $this->escapeLike($phrase) . '%';
            })
            ->unique()
            ->values()
            ->all();

        $phraseRankingParts = [
            "CASE WHEN {$nameExpr} = ? THEN 2600 ELSE 0 END",
            "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 2100 ELSE 0 END",
            "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 1700 ELSE 0 END",
        ];
        $phraseRankingBindings = [
            $nameExact,
            $namePrefixLike,
            $nameContainsLike,
        ];

        if ($compactNameExact !== null) {
            $phraseRankingParts[] = "CASE WHEN {$compactNameExpr} = ? THEN 2200 ELSE 0 END";
            $phraseRankingBindings[] = $compactNameExact;
        }

        if ($compactNamePrefixLike !== null) {
            $phraseRankingParts[] = "CASE WHEN {$compactNameExpr} LIKE ? ESCAPE '\\' THEN 1850 ELSE 0 END";
            $phraseRankingBindings[] = $compactNamePrefixLike;
        }

        if ($compactNameContainsLike !== null) {
            $phraseRankingParts[] = "CASE WHEN {$compactNameExpr} LIKE ? ESCAPE '\\' THEN 1550 ELSE 0 END";
            $phraseRankingBindings[] = $compactNameContainsLike;
        }

        $phraseRankingSql = '(' . implode(' + ', $phraseRankingParts) . ')';

        $hasPhraseMatch = (clone $query)
            ->where(function (Builder $searchQuery) use ($nameContainsLike, $compactNameContainsLike, $includeVariationMatches) {
                $this->applyProductNamePhraseConstraint($searchQuery, $nameContainsLike, $compactNameContainsLike, $includeVariationMatches);
            })
            ->exists();

        if ($hasPhraseMatch || empty($tokenLikes)) {
            $query->selectRaw("{$phraseRankingSql} AS search_score", $phraseRankingBindings);
            $query->where(function (Builder $searchQuery) use ($nameContainsLike, $compactNameContainsLike, $includeVariationMatches) {
                $this->applyProductNamePhraseConstraint($searchQuery, $nameContainsLike, $compactNameContainsLike, $includeVariationMatches);
            });

            return [$phraseRankingSql, $phraseRankingBindings];
        }

        $hasAdjacentPhraseMatch = !empty($adjacentPhraseLikes)
            && (clone $query)
                ->where(function (Builder $searchQuery) use ($adjacentPhraseLikes, $includeVariationMatches) {
                    $this->applyProductNameAdjacentPhraseConstraint($searchQuery, $adjacentPhraseLikes, $includeVariationMatches);
                })
                ->exists();

        $searchRankingParts = [
            "CASE WHEN {$nameExpr} = ? THEN 1800 ELSE 0 END",
            "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 1500 ELSE 0 END",
            "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 1200 ELSE 0 END",
        ];
        $searchRankingBindings = [
            $nameExact,
            $namePrefixLike,
            $nameContainsLike,
        ];
        $compactSkuExpr = $isCompactCompositeSearch ? $this->compactSearchExpression('products.sku') : null;

        foreach ($tokenLikes as $tokenLike) {
            $searchRankingParts[] = "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 120 ELSE 0 END";
            $searchRankingBindings[] = $tokenLike;

            if ($compactSkuExpr !== null) {
                $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} LIKE ? ESCAPE '\\' THEN 90 ELSE 0 END";
                $searchRankingBindings[] = $tokenLike;
            }
        }

        if ($hasAdjacentPhraseMatch) {
            foreach ($adjacentPhraseLikes as $phraseLike) {
                $searchRankingParts[] = "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 260 ELSE 0 END";
                $searchRankingBindings[] = $phraseLike;
            }
        }

        $searchRankingSql = '(' . implode(' + ', $searchRankingParts) . ')';
        $query->selectRaw("{$searchRankingSql} AS search_score", $searchRankingBindings);
        $query->where(function (Builder $searchQuery) use ($tokenLikes, $isCompactCompositeSearch, $includeVariationMatches) {
            $this->applyProductNameTokenConstraint($searchQuery, $tokenLikes, $isCompactCompositeSearch, $includeVariationMatches);
        });

        if ($hasAdjacentPhraseMatch) {
            $query->where(function (Builder $searchQuery) use ($adjacentPhraseLikes, $includeVariationMatches) {
                $this->applyProductNameAdjacentPhraseConstraint($searchQuery, $adjacentPhraseLikes, $includeVariationMatches);
            });
        }

        return [$searchRankingSql, $searchRankingBindings];
    }

    protected function normalizedAttributeFilterExpression(string $column): string
    {
        $expression = "TRIM(COALESCE({$column}, ''))";
        $expression = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE({$expression}, '[', ''), ']', ''), '{', ''), '}', ''), '\"', '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(REGEXP_REPLACE(immutable_unaccent({$expression}), '\\s+', ' ', 'g'))";
        }

        return "LOWER({$expression})";
    }

    protected function normalizeAttributeFilterValue(string $value): string
    {
        return (string) Str::of($value)
            ->lower()
            ->ascii()
            ->replace(['[', ']', '{', '}', '"'], ' ')
            ->replaceMatches('/\s+/', ' ')
            ->trim();
    }

    protected function applyAttributeValueConstraint(Builder $query, int $attributeId, array $valueArray): void
    {
        $this->applyAttributeValueColumnsConstraint($query, 'attribute_id', 'value', $attributeId, $valueArray);
    }

    protected function applyAttributeValueColumnsConstraint(
        $query,
        string $attributeIdColumn,
        string $valueColumn,
        int $attributeId,
        array $valueArray
    ): void {
        $exactValueCandidates = $this->buildExactAttributeValueCandidates($valueArray);

        if (empty($exactValueCandidates)) {
            $query->whereRaw('1 = 0');
            return;
        }

        $normalizedValueCandidates = collect($valueArray)
            ->map(fn ($value) => $this->normalizeAttributeFilterValue((string) $value))
            ->filter(fn ($value) => $value !== '')
            ->unique()
            ->values()
            ->all();
        $normalizedValueExpression = $this->normalizedAttributeFilterExpression($valueColumn);

        $query
            ->where($attributeIdColumn, $attributeId)
            ->where(function (Builder $valueQuery) use (
                $exactValueCandidates,
                $normalizedValueCandidates,
                $normalizedValueExpression,
                $valueColumn
            ) {
                foreach ($exactValueCandidates as $candidate) {
                    $valueQuery->orWhere($valueColumn, $candidate);
                }

                foreach ($normalizedValueCandidates as $candidate) {
                    $valueQuery->orWhereRaw("{$normalizedValueExpression} = ?", [$candidate]);
                }
            });
    }

    protected function buildExactAttributeValueCandidates(array $valueArray): array
    {
        return collect($valueArray)
            ->flatMap(function ($value) {
                $normalizedValue = trim((string) $value);
                if ($normalizedValue === '') {
                    return [];
                }

                return array_values(array_unique([
                    $normalizedValue,
                    json_encode([$normalizedValue]),
                    json_encode([$normalizedValue], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                ]));
            })
            ->filter(fn ($value) => is_string($value) && trim($value) !== '')
            ->unique()
            ->values()
            ->all();
    }

    protected function normalizeAttributeFilterInputValues($values): array
    {
        return collect(is_array($values) ? $values : explode(',', (string) $values))
            ->map(function ($value) {
                if (!is_scalar($value)) {
                    return null;
                }

                return trim((string) $value);
            })
            ->filter(fn ($value) => $value !== null && $value !== '')
            ->unique()
            ->values()
            ->all();
    }

    protected function normalizeAttributeFilterGroups($inputAttributes): array
    {
        if (!is_array($inputAttributes) || empty($inputAttributes)) {
            return [];
        }

        $filterGroups = [];

        foreach ($inputAttributes as $attrId => $values) {
            if (!is_numeric($attrId)) {
                continue;
            }

            $valueArray = $this->normalizeAttributeFilterInputValues($values);

            if (empty($valueArray)) {
                continue;
            }

            $filterGroups[] = [
                'attribute_id' => (int) $attrId,
                'values' => $valueArray,
            ];
        }

        return $filterGroups;
    }

    protected function applyOwnAttributeFilterGroups($query, array $filterGroups): void
    {
        foreach ($filterGroups as $filterGroup) {
            $attributeId = (int) $filterGroup['attribute_id'];
            $valueArray = $filterGroup['values'];

            $query->whereHas('attributeValues', function (Builder $attributeValueQuery) use ($attributeId, $valueArray) {
                $this->applyAttributeValueConstraint($attributeValueQuery, $attributeId, $valueArray);
            });
        }
    }

    protected function applyProductAttributeFilters(Builder $query, $inputAttributes, array $options = []): void
    {
        $filterGroups = $this->normalizeAttributeFilterGroups($inputAttributes);

        if (empty($filterGroups)) {
            return;
        }

        $includeVariationMatches = array_key_exists('include_variations', $options)
            ? (bool) $options['include_variations']
            : true;
        $includeBundleItemMatches = array_key_exists('include_bundle_items', $options)
            ? (bool) $options['include_bundle_items']
            : false;

        $query->where(function (Builder $attributeQuery) use (
            $filterGroups,
            $includeVariationMatches,
            $includeBundleItemMatches
        ) {
            $attributeQuery->where(function (Builder $ownAttributeQuery) use ($filterGroups) {
                $this->applyOwnAttributeFilterGroups($ownAttributeQuery, $filterGroups);
            });

            if ($includeVariationMatches) {
                $attributeQuery->orWhereHas('variations', function (Builder $variationQuery) use ($filterGroups) {
                    $variationQuery->where('products.status', true);
                    $this->applyVariationAttributeFilterGroups($variationQuery, $filterGroups);
                });
            }

            if ($includeBundleItemMatches) {
                $attributeQuery->orWhereHas('bundleItems', function (Builder $bundleItemQuery) use ($filterGroups) {
                    $bundleItemQuery->where(function (Builder $resolvedBundleItemQuery) use ($filterGroups) {
                        $resolvedBundleItemQuery
                            ->where(function (Builder $bundleItemAttributeQuery) use ($filterGroups) {
                                $this->applyOwnAttributeFilterGroups($bundleItemAttributeQuery, $filterGroups);
                            })
                            ->orWhereHas('variations', function (Builder $variationQuery) use ($filterGroups) {
                                $variationQuery->where('products.status', true);
                                $this->applyVariationAttributeFilterGroups($variationQuery, $filterGroups);
                            });
                    });
                });
            }
        });
    }

    protected function applyVariationAttributeFilterGroups($query, array $filterGroups): void
    {
        foreach ($filterGroups as $filterGroup) {
            $attributeId = (int) $filterGroup['attribute_id'];
            $valueArray = $filterGroup['values'];

            $query->where(function (Builder $attributeQuery) use ($attributeId, $valueArray) {
                $attributeQuery
                    ->whereHas('attributeValues', function (Builder $attributeValueQuery) use ($attributeId, $valueArray) {
                        $this->applyAttributeValueConstraint($attributeValueQuery, $attributeId, $valueArray);
                    })
                    ->orWhere(function (Builder $inheritedAttributeQuery) use ($attributeId, $valueArray) {
                        $inheritedAttributeQuery
                            ->whereDoesntHave('attributeValues', function (Builder $attributeValueQuery) use ($attributeId) {
                                $attributeValueQuery->where('attribute_id', $attributeId);
                            })
                            ->whereHas('parentConfigurable.attributeValues', function (Builder $attributeValueQuery) use ($attributeId, $valueArray) {
                                $this->applyAttributeValueConstraint($attributeValueQuery, $attributeId, $valueArray);
                            });
                    });
            });
        }
    }

    protected function applyVariationAttributeFilters($query, $inputAttributes): void
    {
        $filterGroups = $this->normalizeAttributeFilterGroups($inputAttributes);

        if (empty($filterGroups)) {
            return;
        }

        $this->applyVariationAttributeFilterGroups($query, $filterGroups);
    }

    protected function applyProductBundleQuickFilters(Builder $query, $inputFilters): void
    {
        if (!is_array($inputFilters) || empty($inputFilters)) {
            return;
        }

        $optionTitleValues = $this->normalizeBundleQuickFilterTextValues(
            $inputFilters['option_title']
            ?? $inputFilters['bundle_option_title']
            ?? null
        );

        if (!empty($optionTitleValues)) {
            $optionTitleExpr = DB::raw("LOWER(TRIM(COALESCE(NULLIF(product_links.option_title, ''), 'Mặc định')))");
            $postTitleExpr = DB::raw("LOWER(TRIM(COALESCE(posts.title, '')))");

            $query
                ->where('products.type', 'bundle')
                ->whereHas('bundleItems', function (Builder $bundleItemQuery) use ($optionTitleValues, $optionTitleExpr, $postTitleExpr) {
                    $bundleItemQuery->where(function (Builder $matchQuery) use ($optionTitleValues, $optionTitleExpr, $postTitleExpr) {
                        $matchQuery
                            ->whereIn($optionTitleExpr, $optionTitleValues)
                            ->orWhereExists(function ($postQuery) use ($optionTitleValues, $postTitleExpr) {
                                $postQuery
                                    ->selectRaw('1')
                                    ->from('posts')
                                    ->whereColumn('posts.id', 'product_links.option_post_id')
                                    ->whereIn($postTitleExpr, $optionTitleValues);
                            });
                    });
                });
        }

        $bundleTitleValues = $this->normalizeBundleQuickFilterTextValues(
            $inputFilters['bundle_title']
            ?? $inputFilters['bundle_config_title']
            ?? null
        );

        if (!empty($bundleTitleValues)) {
            $bundleTitleExpr = DB::raw("LOWER(TRIM(COALESCE(products.bundle_title, '')))");

            $query
                ->where('products.type', 'bundle')
                ->whereIn($bundleTitleExpr, $bundleTitleValues);
        }

        $statusValues = $this->normalizeBundleQuickFilterStatusValues(
            $inputFilters['option_status']
            ?? $inputFilters['bundle_option_status']
            ?? null
        );

        if (!empty($statusValues) && Schema::hasColumn('product_links', 'bundle_option_status')) {
            $statusExpr = DB::raw("LOWER(COALESCE(NULLIF(TRIM(product_links.bundle_option_status), ''), '" . self::BUNDLE_OPTION_STATUS_VISIBLE . "'))");

            $query
                ->where('products.type', 'bundle')
                ->whereHas('bundleItems', function (Builder $bundleItemQuery) use ($statusValues, $statusExpr) {
                    $bundleItemQuery->whereIn($statusExpr, $statusValues);
                });
        }
    }

    protected function normalizeBundleQuickFilterTextValues($values): array
    {
        return collect(is_array($values) ? $values : explode(',', (string) $values))
            ->map(function ($value) {
                if (!is_scalar($value)) {
                    return null;
                }

                $normalized = Str::lower(Str::squish((string) $value));

                return $normalized !== '' ? $normalized : null;
            })
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    protected function normalizeBundleQuickFilterStatusValues($values): array
    {
        return collect(is_array($values) ? $values : explode(',', (string) $values))
            ->map(function ($value) {
                if (!is_scalar($value)) {
                    return null;
                }

                $normalized = Str::of((string) $value)
                    ->lower()
                    ->ascii()
                    ->squish()
                    ->toString();

                if (in_array($normalized, ['visible', 'hien thi website', 'hien thi', 'website'], true)) {
                    return self::BUNDLE_OPTION_STATUS_VISIBLE;
                }

                if (in_array($normalized, ['internal', 'noi bo'], true)) {
                    return self::BUNDLE_OPTION_STATUS_INTERNAL;
                }

                return null;
            })
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    protected function productQuickFiltersEnabled(Request $request): bool
    {
        return ! $request->has('quick_filter_enabled') || $request->boolean('quick_filter_enabled');
    }

    protected function productQuickFilterRankRequested(Request $request): bool
    {
        return $request->boolean('quick_filter_rank') && ! $this->productQuickFiltersEnabled($request);
    }

    protected function sqlPlaceholders(array $values): string
    {
        return implode(', ', array_fill(0, count($values), '?'));
    }

    protected function buildAttributeValueMatchSql(string $alias, int $attributeId, array $valueArray): array
    {
        $exactValueCandidates = $this->buildExactAttributeValueCandidates($valueArray);
        $normalizedValueCandidates = collect($valueArray)
            ->map(fn ($value) => $this->normalizeAttributeFilterValue((string) $value))
            ->filter(fn ($value) => $value !== '')
            ->unique()
            ->values()
            ->all();

        if (empty($exactValueCandidates) && empty($normalizedValueCandidates)) {
            return ['1 = 0', []];
        }

        $valueColumn = "{$alias}.value";
        $attributeIdColumn = "{$alias}.attribute_id";
        $normalizedValueExpression = $this->normalizedAttributeFilterExpression($valueColumn);
        $valueSqlParts = [];
        $bindings = [$attributeId];

        foreach ($exactValueCandidates as $candidate) {
            $valueSqlParts[] = "{$valueColumn} = ?";
            $bindings[] = $candidate;
        }

        foreach ($normalizedValueCandidates as $candidate) {
            $valueSqlParts[] = "{$normalizedValueExpression} = ?";
            $bindings[] = $candidate;
        }

        return [
            "{$attributeIdColumn} = ? AND (" . implode(' OR ', $valueSqlParts) . ')',
            $bindings,
        ];
    }

    protected function buildAttributeValueExistsSql(string $productIdExpression, array $filterGroup, string $alias): array
    {
        [$matchSql, $bindings] = $this->buildAttributeValueMatchSql(
            $alias,
            (int) $filterGroup['attribute_id'],
            $filterGroup['values']
        );

        return [
            "EXISTS (
                SELECT 1
                FROM product_attribute_values AS {$alias}
                WHERE {$alias}.product_id = {$productIdExpression}
                    AND {$matchSql}
            )",
            $bindings,
        ];
    }

    protected function buildOwnAttributeFilterGroupsSql(array $filterGroups, string $productIdExpression, string $aliasPrefix): array
    {
        $parts = [];
        $bindings = [];

        foreach ($filterGroups as $index => $filterGroup) {
            [$existsSql, $existsBindings] = $this->buildAttributeValueExistsSql(
                $productIdExpression,
                $filterGroup,
                "{$aliasPrefix}{$index}"
            );

            $parts[] = $existsSql;
            $bindings = array_merge($bindings, $existsBindings);
        }

        if (empty($parts)) {
            return ['1 = 0', []];
        }

        return ['(' . implode(' AND ', $parts) . ')', $bindings];
    }

    protected function buildVariationAttributeFilterGroupsSql(
        array $filterGroups,
        string $variationIdExpression,
        string $parentIdExpression,
        string $aliasPrefix
    ): array {
        $parts = [];
        $bindings = [];

        foreach ($filterGroups as $index => $filterGroup) {
            $attributeId = (int) $filterGroup['attribute_id'];
            [$ownSql, $ownBindings] = $this->buildAttributeValueExistsSql(
                $variationIdExpression,
                $filterGroup,
                "{$aliasPrefix}own{$index}"
            );
            [$parentSql, $parentBindings] = $this->buildAttributeValueExistsSql(
                $parentIdExpression,
                $filterGroup,
                "{$aliasPrefix}parent{$index}"
            );
            $anyOwnAlias = "{$aliasPrefix}any{$index}";

            $parts[] = "(
                {$ownSql}
                OR (
                    NOT EXISTS (
                        SELECT 1
                        FROM product_attribute_values AS {$anyOwnAlias}
                        WHERE {$anyOwnAlias}.product_id = {$variationIdExpression}
                            AND {$anyOwnAlias}.attribute_id = ?
                    )
                    AND {$parentSql}
                )
            )";
            $bindings = array_merge($bindings, $ownBindings, [$attributeId], $parentBindings);
        }

        if (empty($parts)) {
            return ['1 = 0', []];
        }

        return ['(' . implode(' AND ', $parts) . ')', $bindings];
    }

    protected function buildProductAttributeQuickFilterMatchSql(array $filterGroups): array
    {
        if (empty($filterGroups)) {
            return [null, []];
        }

        [$ownSql, $ownBindings] = $this->buildOwnAttributeFilterGroupsSql(
            $filterGroups,
            'products.id',
            'qfqown'
        );
        [$variationFilterSql, $variationBindings] = $this->buildVariationAttributeFilterGroupsSql(
            $filterGroups,
            'qfqv.id',
            'products.id',
            'qfqvar'
        );
        [$bundleItemSql, $bundleItemBindings] = $this->buildOwnAttributeFilterGroupsSql(
            $filterGroups,
            'qfqbi.id',
            'qfqbiown'
        );
        [$bundleVariationFilterSql, $bundleVariationBindings] = $this->buildVariationAttributeFilterGroupsSql(
            $filterGroups,
            'qfqbv.id',
            'qfqbi.id',
            'qfqbvar'
        );

        $variationSql = "EXISTS (
            SELECT 1
            FROM product_links AS qfqvlink
            INNER JOIN products AS qfqv ON qfqv.id = qfqvlink.linked_product_id
            WHERE qfqvlink.product_id = products.id
                AND qfqvlink.link_type = 'super_link'
                AND qfqv.status = ?
                AND {$variationFilterSql}
        )";
        $bundleSql = "EXISTS (
            SELECT 1
            FROM product_links AS qfqbilink
            INNER JOIN products AS qfqbi ON qfqbi.id = qfqbilink.linked_product_id
            WHERE qfqbilink.product_id = products.id
                AND qfqbilink.link_type = 'bundle'
                AND (
                    {$bundleItemSql}
                    OR EXISTS (
                        SELECT 1
                        FROM product_links AS qfqbvlink
                        INNER JOIN products AS qfqbv ON qfqbv.id = qfqbvlink.linked_product_id
                        WHERE qfqbvlink.product_id = qfqbi.id
                            AND qfqbvlink.link_type = 'super_link'
                            AND qfqbv.status = ?
                            AND {$bundleVariationFilterSql}
                    )
                )
        )";

        return [
            "({$ownSql} OR {$variationSql} OR {$bundleSql})",
            array_merge(
                $ownBindings,
                [true],
                $variationBindings,
                $bundleItemBindings,
                [true],
                $bundleVariationBindings
            ),
        ];
    }

    protected function buildBundleQuickFilterRankingParts($inputFilters): array
    {
        if (!is_array($inputFilters) || empty($inputFilters)) {
            return [[], []];
        }

        $rankingParts = [];
        $bindings = [];
        $score = 10000;
        $optionTitleValues = $this->normalizeBundleQuickFilterTextValues(
            $inputFilters['option_title']
            ?? $inputFilters['bundle_option_title']
            ?? null
        );

        if (!empty($optionTitleValues)) {
            $placeholders = $this->sqlPlaceholders($optionTitleValues);
            $rankingParts[] = "CASE WHEN (
                products.type = 'bundle'
                AND EXISTS (
                    SELECT 1
                    FROM product_links AS qfqbot
                    WHERE qfqbot.product_id = products.id
                        AND qfqbot.link_type = 'bundle'
                        AND (
                            LOWER(TRIM(COALESCE(NULLIF(qfqbot.option_title, ''), 'Mặc định'))) IN ({$placeholders})
                            OR EXISTS (
                                SELECT 1
                                FROM posts AS qfqpost
                                WHERE qfqpost.id = qfqbot.option_post_id
                                    AND LOWER(TRIM(COALESCE(qfqpost.title, ''))) IN ({$placeholders})
                            )
                        )
                )
            ) THEN {$score} ELSE 0 END";
            $bindings = array_merge($bindings, $optionTitleValues, $optionTitleValues);
            $score = max(1000, $score - 1000);
        }

        $bundleTitleValues = $this->normalizeBundleQuickFilterTextValues(
            $inputFilters['bundle_title']
            ?? $inputFilters['bundle_config_title']
            ?? null
        );

        if (!empty($bundleTitleValues)) {
            $placeholders = $this->sqlPlaceholders($bundleTitleValues);
            $rankingParts[] = "CASE WHEN (
                products.type = 'bundle'
                AND LOWER(TRIM(COALESCE(products.bundle_title, ''))) IN ({$placeholders})
            ) THEN {$score} ELSE 0 END";
            $bindings = array_merge($bindings, $bundleTitleValues);
            $score = max(1000, $score - 1000);
        }

        $statusValues = $this->normalizeBundleQuickFilterStatusValues(
            $inputFilters['option_status']
            ?? $inputFilters['bundle_option_status']
            ?? null
        );

        if (!empty($statusValues) && Schema::hasColumn('product_links', 'bundle_option_status')) {
            $placeholders = $this->sqlPlaceholders($statusValues);
            $rankingParts[] = "CASE WHEN (
                products.type = 'bundle'
                AND EXISTS (
                    SELECT 1
                    FROM product_links AS qfqbos
                    WHERE qfqbos.product_id = products.id
                        AND qfqbos.link_type = 'bundle'
                        AND LOWER(COALESCE(NULLIF(TRIM(qfqbos.bundle_option_status), ''), '" . self::BUNDLE_OPTION_STATUS_VISIBLE . "')) IN ({$placeholders})
                )
            ) THEN {$score} ELSE 0 END";
            $bindings = array_merge($bindings, $statusValues);
        }

        return [$rankingParts, $bindings];
    }

    protected function buildProductQuickFilterRankingExpression(Request $request): array
    {
        $rankingParts = [];
        $bindings = [];
        $attributeFilterGroups = $this->normalizeAttributeFilterGroups($request->input('attributes'));

        foreach ($attributeFilterGroups as $index => $filterGroup) {
            [$matchSql, $matchBindings] = $this->buildProductAttributeQuickFilterMatchSql([$filterGroup]);
            if ($matchSql === null) {
                continue;
            }

            $score = max(1000, 10000 - ($index * 1000));
            $rankingParts[] = "CASE WHEN {$matchSql} THEN {$score} ELSE 0 END";
            $bindings = array_merge($bindings, $matchBindings);
        }

        [$bundleRankingParts, $bundleBindings] = $this->buildBundleQuickFilterRankingParts($request->input('bundle_filters'));
        $rankingParts = array_merge($rankingParts, $bundleRankingParts);
        $bindings = array_merge($bindings, $bundleBindings);

        if (empty($rankingParts)) {
            return [null, []];
        }

        return ['(' . implode(' + ', $rankingParts) . ')', $bindings];
    }

    protected function normalizedSortExpression(string $expression): string
    {
        $expression = "COALESCE({$expression}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(immutable_unaccent({$expression}))";
        }

        return "LOWER({$expression})";
    }

    protected function normalizedAttributeSortExpression(string $expression): string
    {
        $expression = "TRIM(COALESCE({$expression}, ''))";
        $expression = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE({$expression}, '[', ''), ']', ''), '{', ''), '}', ''), '\"', '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(immutable_unaccent({$expression}))";
        }

        return "LOWER({$expression})";
    }

    protected function applyTextSort(Builder $query, string $expression, string $direction): void
    {
        $query->orderByRaw("CASE WHEN TRIM(COALESCE({$expression}, '')) = '' THEN 1 ELSE 0 END ASC");
        $query->orderByRaw($this->normalizedSortExpression($expression) . ' ' . $direction);
    }

    protected function resolveProductCategorySortExpression(): string
    {
        return "COALESCE(
            (SELECT categories.name
                FROM categories
                WHERE categories.id = products.category_id
                LIMIT 1),
            (SELECT categories.name
                FROM categories
                INNER JOIN category_product ON category_product.category_id = categories.id
                WHERE category_product.product_id = products.id
                    AND category_product.item_type = 'product'
                ORDER BY category_product.sort_order ASC, categories.id ASC
                LIMIT 1),
            ''
        )";
    }

    protected function resolveProductSupplierCodeSortExpression(): ?string
    {
        if (Schema::hasTable('supplier_product_prices') && Schema::hasColumn('supplier_product_prices', 'supplier_product_code')) {
            return "(SELECT supplier_product_prices.supplier_product_code
                FROM supplier_product_prices
                WHERE supplier_product_prices.product_id = products.id
                    AND supplier_product_prices.supplier_product_code IS NOT NULL
                    AND supplier_product_prices.supplier_product_code <> ''
                ORDER BY CASE WHEN supplier_product_prices.supplier_id = products.supplier_id THEN 0 ELSE 1 END ASC,
                    supplier_product_prices.id ASC
                LIMIT 1)";
        }

        if (Schema::hasTable('products') && Schema::hasColumn('products', 'supplier_product_code')) {
            return 'products.supplier_product_code';
        }

        return null;
    }

    protected function applyRequestedProductSort(Builder $query, string $sortBy, string $direction, string $actualStockSql): bool
    {
        $resolvedSort = match ($sortBy) {
            'stock', 'stock_quantity' => 'actual_stock',
            default => $sortBy,
        };

        if (preg_match('/^attr_(\d+)$/', $resolvedSort, $matches) === 1) {
            $attributeId = (int) $matches[1];
            $attributeValueExpression = "(SELECT product_attribute_values.value
                FROM product_attribute_values
                WHERE product_attribute_values.product_id = products.id
                    AND product_attribute_values.attribute_id = {$attributeId}
                ORDER BY product_attribute_values.id ASC
                LIMIT 1)";

            $query->orderByRaw("CASE WHEN TRIM(COALESCE({$attributeValueExpression}, '')) = '' THEN 1 ELSE 0 END ASC");
            $query->orderByRaw($this->normalizedAttributeSortExpression($attributeValueExpression) . ' ' . $direction);

            return true;
        }

        if ($resolvedSort === 'actual_stock') {
            $query->orderByRaw($actualStockSql . ' ' . $direction);
            return true;
        }

        if ($resolvedSort === 'category') {
            $this->applyTextSort($query, $this->resolveProductCategorySortExpression(), $direction);
            return true;
        }

        if ($resolvedSort === 'supplier_product_code') {
            $supplierCodeExpression = $this->resolveProductSupplierCodeSortExpression();

            if ($supplierCodeExpression !== null) {
                $this->applyTextSort($query, $supplierCodeExpression, $direction);
                return true;
            }

            return false;
        }

        $textSortColumns = [
            'sku' => 'products.sku',
            'name' => 'products.name',
            'type' => 'products.type',
            'specifications' => 'products.specifications',
        ];

        if (isset($textSortColumns[$resolvedSort])) {
            $this->applyTextSort($query, $textSortColumns[$resolvedSort], $direction);
            return true;
        }

        $directSortColumns = [
            'id' => 'products.id',
            'price' => 'products.price',
            'expected_cost' => 'products.expected_cost',
            'cost_price' => 'products.cost_price',
            'sort_order' => 'products.sort_order',
            'created_at' => 'products.created_at',
            'status' => 'products.status',
            'is_featured' => 'products.is_featured',
            'is_new' => 'products.is_new',
            'category_id' => 'products.category_id',
            'stock_quantity' => 'products.stock_quantity',
        ];

        if (isset($directSortColumns[$resolvedSort])) {
            $query->orderBy($directSortColumns[$resolvedSort], $direction);
            return true;
        }

        return false;
    }

    protected function buildProductListSortProjection(string $sortBy, string $actualStockSql): array
    {
        $resolvedSort = match ($sortBy) {
            'stock', 'stock_quantity' => 'actual_stock',
            default => $sortBy,
        };

        if (preg_match('/^attr_(\d+)$/', $resolvedSort, $matches) === 1) {
            $attributeId = (int) $matches[1];
            $attributeValueExpression = "(SELECT product_attribute_values.value
                FROM product_attribute_values
                WHERE product_attribute_values.product_id = products.id
                    AND product_attribute_values.attribute_id = {$attributeId}
                ORDER BY product_attribute_values.id ASC
                LIMIT 1)";

            return [
                'mode' => 'text',
                'empty_rank' => "CASE WHEN TRIM(COALESCE({$attributeValueExpression}, '')) = '' THEN 1 ELSE 0 END",
                'text_value' => $this->normalizedAttributeSortExpression($attributeValueExpression),
                'number_value' => 'NULL',
            ];
        }

        if ($resolvedSort === 'actual_stock') {
            return [
                'mode' => 'number',
                'empty_rank' => '0',
                'text_value' => 'NULL',
                'number_value' => $actualStockSql,
            ];
        }

        if ($resolvedSort === 'category') {
            $categoryExpression = $this->resolveProductCategorySortExpression();

            return [
                'mode' => 'text',
                'empty_rank' => "CASE WHEN TRIM(COALESCE({$categoryExpression}, '')) = '' THEN 1 ELSE 0 END",
                'text_value' => $this->normalizedSortExpression($categoryExpression),
                'number_value' => 'NULL',
            ];
        }

        if ($resolvedSort === 'supplier_product_code') {
            $supplierCodeExpression = $this->resolveProductSupplierCodeSortExpression();

            if ($supplierCodeExpression !== null) {
                return [
                    'mode' => 'text',
                    'empty_rank' => "CASE WHEN TRIM(COALESCE({$supplierCodeExpression}, '')) = '' THEN 1 ELSE 0 END",
                    'text_value' => $this->normalizedSortExpression($supplierCodeExpression),
                    'number_value' => 'NULL',
                ];
            }
        }

        $textSortColumns = [
            'sku' => 'products.sku',
            'name' => 'products.name',
            'type' => 'products.type',
            'specifications' => 'products.specifications',
        ];

        if (isset($textSortColumns[$resolvedSort])) {
            $expression = $textSortColumns[$resolvedSort];

            return [
                'mode' => 'text',
                'empty_rank' => "CASE WHEN TRIM(COALESCE({$expression}, '')) = '' THEN 1 ELSE 0 END",
                'text_value' => $this->normalizedSortExpression($expression),
                'number_value' => 'NULL',
            ];
        }

        $directSortColumns = [
            'id' => 'products.id',
            'price' => 'products.price',
            'expected_cost' => 'products.expected_cost',
            'cost_price' => 'products.cost_price',
            'sort_order' => 'products.sort_order',
            'created_at' => 'products.created_at',
            'status' => 'products.status',
            'is_featured' => 'products.is_featured',
            'is_new' => 'products.is_new',
            'category_id' => 'products.category_id',
            'stock_quantity' => 'products.stock_quantity',
        ];

        return [
            'mode' => 'number',
            'empty_rank' => '0',
            'text_value' => 'NULL',
            'number_value' => $directSortColumns[$resolvedSort] ?? 'products.id',
        ];
    }

    protected function buildAdminProductListBaseQuery(Request $request, bool $includeNestedProducts = true): array
    {
        $relations = [
            'categories:id,name,code,slug',
            'category:id,name,code,slug',
            'supplier:id,name,code',
            'suppliers:id,name,code',
            'parentConfigurable:id,name,sku,type',
            'unit:id,name',
            'siteDomain:id,domain',
            'images:id,product_id,media_asset_id,image_url,is_primary,sort_order',
            'attributeValues:id,product_id,attribute_id,value',
            'attributeValues.attribute:id,name,code,is_filterable,is_filterable_backend',
        ];

        if ($includeNestedProducts) {
            $relations = array_merge($relations, [
                'variations' => fn ($variationQuery) => $variationQuery->where('products.status', true),
                'variations.parentConfigurable:id,name,sku,type',
                'variations.category:id,name,code,slug',
                'variations.categories:id,name,code,slug',
                'variations.supplier:id,name,code',
                'variations.suppliers:id,name,code',
                'variations.attributeValues:id,product_id,attribute_id,value',
                'variations.attributeValues.attribute:id,name,code,frontend_type',
                'variations.unit:id,name',
                'variations.images:id,product_id,media_asset_id,image_url,is_primary,sort_order',
                'groupedItems:id,sku,name,slug,price,expected_cost,cost_price,stock_quantity,type,supplier_id,inventory_unit_id,site_domain_id',
                'groupedItems.category:id,name,code,slug',
                'groupedItems.categories:id,name,code,slug',
                'groupedItems.supplier:id,name,code',
                'groupedItems.suppliers:id,name,code',
                'groupedItems.unit:id,name',
                'groupedItems.images:id,product_id,media_asset_id,image_url,is_primary,sort_order',
                'bundleItems:id,sku,name,slug,price,expected_cost,cost_price,stock_quantity,type,supplier_id,inventory_unit_id,site_domain_id',
                'bundleItems.category:id,name,code,slug',
                'bundleItems.categories:id,name,code,slug',
                'bundleItems.supplier:id,name,code',
                'bundleItems.suppliers:id,name,code',
                'bundleItems.unit:id,name',
                'bundleItems.images:id,product_id,media_asset_id,image_url,is_primary,sort_order',
            ]);
        }

        $query = Product::query()
            ->select([
                'id', 'account_id', 'sku', 'name', 'slug', 'price', 'expected_cost', 'cost_price', 'stock_quantity',
                'supplier_id', 'inventory_unit_id', 'sort_order',
                'type', 'category_id', 'is_featured', 'is_new', 'created_at', 'status', 'specifications', 'video_url', 'video_urls', 'bundle_title', 'site_domain_id', 'meta_title', 'meta_description',
                'google_merchant_sync_status', 'google_merchant_last_synced_at', 'google_merchant_last_attempted_at',
                'google_merchant_last_error', 'google_merchant_offer_id', 'google_merchant_last_action'
            ])
            ->withCount('suppliers')
            ->with($relations);

        $stockContext = $this->attachActualStockSubqueries($query, $request);
        $actualStockSql = $stockContext['actual_stock_sql'];
        $query->selectRaw($actualStockSql . ' AS actual_stock');
        $supplierCodeExpression = $this->resolveProductSupplierCodeSortExpression();
        if ($supplierCodeExpression !== null) {
            $query->selectRaw($supplierCodeExpression . ' AS supplier_product_code');
        }

        return [$query, $actualStockSql];
    }

    protected function sortableAdminProductsQuery(?int $accountId = null): Builder
    {
        $query = Product::query()
            ->whereDoesntHave('parentConfigurable');

        if ($accountId !== null) {
            $query->where('account_id', $accountId);
        }

        return $query;
    }

    protected function resolveAdminProductCategoryCountFilter(?string $rawFilter): ?array
    {
        return match (trim(strtolower((string) $rawFilter))) {
            'exact_2' => ['operator' => '=', 'value' => 2],
            'exact_3' => ['operator' => '=', 'value' => 3],
            'min_2' => ['operator' => '>=', 'value' => 2],
            'min_3' => ['operator' => '>=', 'value' => 3],
            default => null,
        };
    }

    protected function adminProductCategoryCountSql(): string
    {
        return "(SELECT COUNT(*) FROM (
            SELECT category_product.category_id AS category_id
            FROM category_product
            WHERE category_product.product_id = products.id
              AND category_product.item_type = 'product'
            UNION
            SELECT category_primary.category_id AS category_id
            FROM products AS category_primary
            WHERE category_primary.id = products.id
        ) AS product_category_ids
        WHERE category_id IS NOT NULL)";
    }

    protected function applyAdminProductCategoryCountFilter(Builder $query, ?string $rawFilter): void
    {
        $resolvedFilter = $this->resolveAdminProductCategoryCountFilter($rawFilter);
        if ($resolvedFilter === null) {
            return;
        }

        $query->whereRaw(
            $this->adminProductCategoryCountSql() . " {$resolvedFilter['operator']} ?",
            [(int) $resolvedFilter['value']]
        );
    }

    protected function nextProductSortOrder(?int $accountId = null): int
    {
        return (int) $this->sortableAdminProductsQuery($accountId)->max('sort_order') + 1;
    }

    public function sortItems(Request $request)
    {
        $products = $this->sortableAdminProductsQuery()
            ->select([
                'products.id',
                'products.name',
                'products.sku',
                'products.status',
                'products.type',
                'products.category_id',
                'products.sort_order',
            ])
            ->with([
                'category:id,name',
                'categories:id,name',
                'images:id,product_id,media_asset_id,image_url,is_primary,sort_order',
            ])
            ->orderBy('products.sort_order')
            ->orderByDesc('products.id')
            ->get();

        return response()->json([
            'data' => $products->map(function (Product $product) {
                return [
                    'id' => (int) $product->id,
                    'name' => $product->name,
                    'sku' => $product->sku,
                    'status' => (bool) $product->status,
                    'type' => $product->type,
                    'sort_order' => (int) ($product->sort_order ?? 0),
                    'category_name' => $product->category?->name
                        ?? $product->categories->pluck('name')->filter()->first(),
                    'main_image' => $product->main_image,
                ];
            })->values(),
        ]);
    }

    public function reorder(Request $request)
    {
        $validated = $request->validate([
            'product_ids' => 'required|array|min:1',
            'product_ids.*' => 'required|integer|distinct|exists:products,id',
        ]);

        $normalizedIds = collect($validated['product_ids'])
            ->map(fn ($id) => (int) $id)
            ->values();

        $existingIds = $this->sortableAdminProductsQuery()
            ->orderBy('sort_order')
            ->orderByDesc('id')
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values();

        if ($normalizedIds->count() !== $existingIds->count()
            || $normalizedIds->diff($existingIds)->isNotEmpty()
            || $existingIds->diff($normalizedIds)->isNotEmpty()) {
            throw ValidationException::withMessages([
                'product_ids' => 'Danh sach sap xep khong hop le. Vui long tai lai va thu lai.',
            ]);
        }

        DB::transaction(function () use ($normalizedIds) {
            foreach ($normalizedIds as $index => $productId) {
                Product::query()
                    ->whereKey($productId)
                    ->update(['sort_order' => $index + 1]);
            }
        });

        return response()->json([
            'message' => 'Da cap nhat thu tu san pham thanh cong.',
        ]);
    }

    protected function pickerPrimaryImage(?Product $product): ?string
    {
        if (!$product) {
            return null;
        }

        $primaryImage = $product->images->firstWhere('is_primary', true)
            ?: $product->images->sortBy('sort_order')->first();

        return $primaryImage?->image_url;
    }

    protected function pickerAttributePayload(Product $product): array
    {
        return $product->attributeValues
            ->map(fn ($attributeValue) => [
                'attribute_id' => (int) $attributeValue->attribute_id,
                'value' => $attributeValue->value,
            ])
            ->values()
            ->all();
    }

    protected function pickerAttributeSummary(Product $product): string
    {
        return collect($this->pickerAttributePayload($product))
            ->flatMap(function (array $attributeValue) {
                $rawValue = $attributeValue['value'] ?? null;

                if (is_string($rawValue)) {
                    $trimmed = trim($rawValue);
                    if ($trimmed !== '' && (
                        (str_starts_with($trimmed, '[') && str_ends_with($trimmed, ']'))
                        || (str_starts_with($trimmed, '{') && str_ends_with($trimmed, '}'))
                    )) {
                        $decoded = json_decode($trimmed, true);
                        if (is_array($decoded)) {
                            return collect($decoded)->flatten(1)->map(fn ($value) => trim((string) $value))->filter();
                        }
                    }
                }

                return [trim((string) $rawValue)];
            })
            ->filter()
            ->unique()
            ->implode(' / ');
    }

    protected function buildOrderItemDisplayName(Product $product, ?Product $parentProduct = null): string
    {
        $resolvedParent = $parentProduct ?: $product->parentConfigurable->first();
        $productName = trim((string) $product->name);

        if ($productName !== '' || !$resolvedParent) {
            return $productName;
        }

        $parentName = trim((string) $resolvedParent->name);
        $optionLabel = $this->pickerAttributeSummary($product);

        if ($optionLabel !== '') {
            return trim($parentName . ' - ' . $optionLabel);
        }

        return $parentName;
    }

    protected function pickerBundleOptions(Product $product): array
    {
        if ($product->type !== 'bundle' || !$product->relationLoaded('bundleItems')) {
            return [];
        }

        return $product->bundleItems
            ->groupBy(function (Product $bundleItem) {
                $optionUid = $this->normalizeBundleOptionUid($bundleItem->pivot?->bundle_option_uid ?? null);
                if ($optionUid !== null) {
                    return 'uid:' . $optionUid;
                }

                $optionPostId = filled($bundleItem->pivot?->option_post_id ?? null)
                    ? (int) $bundleItem->pivot->option_post_id
                    : null;
                $optionTitle = trim((string) ($bundleItem->pivot?->option_post_title
                    ?? $bundleItem->pivot?->option_title
                    ?? 'Mặc định'));

                return $optionPostId
                    ? 'post:' . $optionPostId
                    : 'title:' . Str::lower($optionTitle);
            })
            ->map(function ($items, string $groupKey) {
                /** @var Product|null $firstItem */
                $firstItem = $items->first();
                if (!$firstItem) {
                    return null;
                }

                $optionPostId = filled($firstItem->pivot?->option_post_id ?? null)
                    ? (int) $firstItem->pivot->option_post_id
                    : null;
                $optionUid = $this->normalizeBundleOptionUid($firstItem->pivot?->bundle_option_uid ?? null);
                $rawOptionTitle = trim((string) ($firstItem->pivot?->option_title ?? ''));
                $optionTitle = trim((string) ($firstItem->pivot?->option_post_title
                    ?? $firstItem->pivot?->option_title
                    ?? 'Mặc định'));

                $optionStatus = $this->normalizeBundleOptionStatus($firstItem->pivot?->bundle_option_status ?? null);

                $resolvedItems = $items->map(function (Product $bundleItem) {
                    $selectedVariantId = filled($bundleItem->pivot?->variant_id ?? null)
                        ? (int) $bundleItem->pivot->variant_id
                        : null;
                    $selectedVariant = $selectedVariantId
                        ? $bundleItem->variations->firstWhere('id', $selectedVariantId)
                        : null;
                    $resolvedProduct = $selectedVariant ?: $bundleItem;

                    return [
                        'base_product_id' => (int) $bundleItem->id,
                        'product_id' => (int) $resolvedProduct->id,
                        'variant_id' => $selectedVariant?->id ? (int) $selectedVariant->id : null,
                        'name' => $resolvedProduct->name,
                        'sku' => $resolvedProduct->sku,
                        'display_name' => $resolvedProduct->name,
                        'display_sku' => $resolvedProduct->sku,
                        'category_id' => $resolvedProduct->category_id !== null ? (int) $resolvedProduct->category_id : null,
                        'inventory_unit_id' => $resolvedProduct->inventory_unit_id !== null
                            ? (int) $resolvedProduct->inventory_unit_id
                            : ($bundleItem->inventory_unit_id !== null ? (int) $bundleItem->inventory_unit_id : null),
                        'unit_name' => $resolvedProduct->unit?->name ?? $bundleItem->unit?->name,
                        'quantity' => max(1, (int) ($bundleItem->pivot->quantity ?? 1)),
                        'price' => (float) ($bundleItem->pivot->price
                            ?? $resolvedProduct->price
                            ?? 0),
                        'expected_cost' => $resolvedProduct->expected_cost !== null ? (float) $resolvedProduct->expected_cost : null,
                        'cost_price' => (float) ($bundleItem->pivot->cost_price
                            ?? $resolvedProduct->cost_price
                            ?? $resolvedProduct->expected_cost
                            ?? 0),
                        'main_image' => $this->pickerPrimaryImage($selectedVariant ?: $bundleItem),
                        'attribute_values' => $this->pickerAttributePayload($resolvedProduct),
                        'option_label' => $this->pickerAttributeSummary($resolvedProduct),
                        'variant_name' => $selectedVariant?->name,
                    ];
                })->values();
                $subtotal = (float) $resolvedItems->sum(fn (array $item) => ((float) $item['price']) * ((int) $item['quantity']));

                return [
                    'key' => $groupKey,
                    'uid' => $optionUid,
                    'bundle_option_uid' => $optionUid,
                    'bundle_option_status' => $optionStatus,
                    'option_title' => $optionTitle,
                    'raw_option_title' => $rawOptionTitle,
                    'option_post_id' => $optionPostId,
                    'option_post_title' => filled($firstItem->pivot?->option_post_title ?? null)
                        ? (string) $firstItem->pivot->option_post_title
                        : null,
                    'subtotal' => $subtotal,
                    'bundle_option_total_price' => $subtotal,
                    'bundle_option_discounted_price' => $subtotal,
                    'bundle_option_discount_amount' => 0.0,
                    'items' => $resolvedItems->all(),
                ];
            })
            ->filter()
            ->values()
            ->all();
    }

    protected function pickerIndex(Request $request)
    {
        $quickFiltersEnabled = $this->productQuickFiltersEnabled($request);
        $query = Product::query()->select([
            'products.id',
            'products.sku',
            'products.name',
            'products.price',
            'products.cost_price',
            'products.expected_cost',
            'products.stock_quantity',
            'products.type',
            'products.bundle_title',
            'products.category_id',
            'products.inventory_unit_id',
        ]);

        $searchRankingSql = null;
        $searchRankingBindings = [];
        $quickFilterRankingSql = null;
        $quickFilterRankingBindings = [];

        // Apply parent variation filter if requested
        if ($request->filled('parent_id')) {
            $parentId = (int) $request->parent_id;
            $childIds = \Illuminate\Support\Facades\DB::table('product_links')
                ->where('product_id', $parentId)
                ->where('link_type', 'super_link')
                ->pluck('linked_product_id');

            if ($childIds->isEmpty()) {
                $query->whereRaw('1 = 0'); // Ensure no results if no siblings exist
            } else {
                $query->whereIn('products.id', $childIds);
            }
        }

        if ($quickFiltersEnabled) {
            $this->applyProductAttributeFilters($query, $request->input('attributes'), [
                'include_variations' => true,
                'include_bundle_items' => true,
            ]);
            $this->applyProductBundleQuickFilters($query, $request->input('bundle_filters'));
        }

        if ($request->filled('search')) {
            [$searchRankingSql, $searchRankingBindings] = $this->applyProductSearch(
                $query,
                (string) $request->input('search')
            );
        }

        if ($this->productQuickFilterRankRequested($request)) {
            [$quickFilterRankingSql, $quickFilterRankingBindings] = $this->buildProductQuickFilterRankingExpression($request);
            if ($quickFilterRankingSql !== null) {
                $query->selectRaw("{$quickFilterRankingSql} AS quick_filter_rank_score", $quickFilterRankingBindings);
            }
        }

        if (!$request->filled('type') && !$request->boolean('allow_variants') && !$request->filled('parent_id')) {
            $query->whereDoesntHave('parentConfigurable');
        }

        $pickerAttributeFilters = $quickFiltersEnabled ? $request->input('attributes') : null;

        $query->with([
            'unit:id,name',
            'images:id,product_id,media_asset_id,image_url,is_primary,sort_order',
            'attributeValues:id,product_id,attribute_id,value',
            'parentConfigurable' => fn ($parentQuery) => $parentQuery
                ->select('products.id', 'products.name', 'products.sku', 'products.inventory_unit_id')
                ->with(['unit:id,name']),
            'variations' => function ($variationQuery) use ($pickerAttributeFilters) {
                $variationQuery->where('products.status', true);
                $this->applyVariationAttributeFilters($variationQuery, $pickerAttributeFilters);
            },
            'variations.unit:id,name',
            'variations.attributeValues:id,product_id,attribute_id,value',
            'variations.images:id,product_id,media_asset_id,image_url,is_primary,sort_order',
            'bundleItems:id,sku,name,price,cost_price,expected_cost,type,inventory_unit_id',
            'bundleItems.unit:id,name',
            'bundleItems.attributeValues:id,product_id,attribute_id,value',
            'bundleItems.images:id,product_id,media_asset_id,image_url,is_primary,sort_order',
            'bundleItems.variations' => function ($variationQuery) use ($pickerAttributeFilters) {
                $variationQuery->where('products.status', true);
                $this->applyVariationAttributeFilters($variationQuery, $pickerAttributeFilters);
            },
            'bundleItems.variations.unit:id,name',
            'bundleItems.variations.attributeValues:id,product_id,attribute_id,value',
            'bundleItems.variations.images:id,product_id,media_asset_id,image_url,is_primary,sort_order',
        ]);

        if ($quickFilterRankingSql !== null) {
            $query->orderByDesc('quick_filter_rank_score');
        }

        if ($searchRankingSql !== null) {
            $query->orderByRaw("{$searchRankingSql} DESC", $searchRankingBindings)
                ->orderByRaw("CASE WHEN type = 'configurable' THEN 0 ELSE 1 END")
                ->orderBy('name', 'asc');
        } else {
            $query->orderByRaw("CASE WHEN type = 'configurable' THEN 0 ELSE 1 END")
                ->orderBy('name', 'asc');
        }

        $maxPerPage = $request->boolean('picker') ? 200 : 100;
        $perPage = min(max((int) $request->get('per_page', 50), 1), $maxPerPage);
        $paginated = $query->paginate($perPage);
        $pickerPayload = $paginated->getCollection()->map(function (Product $product) {
            $product = $this->appendBundleOptionPostMeta($product);
            $parentProduct = $product->parentConfigurable->first();
            $attributeSummary = $this->pickerAttributeSummary($product);
            $displayName = $this->buildOrderItemDisplayName($product, $parentProduct);
            $displayName = trim($displayName) !== '' ? $displayName : $product->name;

            return [
                'id' => (int) $product->id,
                'sku' => $product->sku,
                'display_sku' => $product->sku,
                'name' => $product->name,
                'display_name' => $displayName,
                'entry_kind' => $parentProduct ? 'variation' : 'product',
                'parent_product_id' => $parentProduct?->id ? (int) $parentProduct->id : null,
                'parent_product_name' => $parentProduct?->name,
                'parent_product_sku' => $parentProduct?->sku,
                'option_label' => $parentProduct ? $attributeSummary : '',
                'inventory_unit_id' => $product->inventory_unit_id !== null
                    ? (int) $product->inventory_unit_id
                    : ($parentProduct?->inventory_unit_id !== null ? (int) $parentProduct->inventory_unit_id : null),
                'unit_name' => $product->unit?->name ?? $parentProduct?->unit?->name,
                'price' => (float) ($product->price ?? 0),
                'expected_cost' => $product->expected_cost !== null ? (float) $product->expected_cost : null,
                'cost_price' => (float) ($product->cost_price ?? $product->expected_cost ?? 0),
                'stock_quantity' => (float) ($product->stock_quantity ?? 0),
                'type' => $product->type,
                'bundle_title' => $product->bundle_title,
                'category_id' => $product->category_id !== null ? (int) $product->category_id : null,
                'main_image' => $this->pickerPrimaryImage($product),
                'attribute_values' => $this->pickerAttributePayload($product),
                'attribute_summary' => $attributeSummary,
                'has_variations' => $product->variations->isNotEmpty(),
                'variation_count' => $product->variations->count(),
                'variations' => $product->variations
                    ->map(function (Product $variation) use ($product) {
                        $variationAttributeSummary = $this->pickerAttributeSummary($variation);
                        $variationDisplayName = $this->buildOrderItemDisplayName($variation, $product);
                        $variationDisplayName = trim((string) $variationDisplayName) !== ''
                            ? $variationDisplayName
                            : trim((string) $product->name . ' - ' . ($variationAttributeSummary ?: $variation->name));

                        return [
                            'id' => (int) $variation->id,
                            'sku' => $variation->sku,
                            'display_sku' => $variation->sku,
                            'name' => $variation->name,
                            'display_name' => $variationDisplayName,
                            'entry_kind' => 'variation',
                            'parent_product_id' => (int) $product->id,
                            'parent_product_name' => $product->name,
                            'parent_product_sku' => $product->sku,
                            'option_label' => $variationAttributeSummary,
                            'inventory_unit_id' => $variation->inventory_unit_id !== null
                                ? (int) $variation->inventory_unit_id
                                : ($product->inventory_unit_id !== null ? (int) $product->inventory_unit_id : null),
                            'unit_name' => $variation->unit?->name ?? $product->unit?->name,
                            'price' => (float) ($variation->price ?? 0),
                            'expected_cost' => $variation->expected_cost !== null ? (float) $variation->expected_cost : null,
                            'cost_price' => (float) ($variation->cost_price ?? $variation->expected_cost ?? 0),
                            'stock_quantity' => (float) ($variation->stock_quantity ?? 0),
                            'type' => $variation->type,
                            'category_id' => $variation->category_id !== null ? (int) $variation->category_id : null,
                            'main_image' => $this->pickerPrimaryImage($variation),
                            'attribute_values' => $this->pickerAttributePayload($variation),
                            'attribute_summary' => $variationAttributeSummary,
                        ];
                    })
                    ->values()
                    ->all(),
                'bundle_options' => $this->pickerBundleOptions($product),
            ];
        });

        $inventorySnapshotMap = $this->buildInventorySnapshotMap(
            $request,
            $pickerPayload
                ->flatMap(function (array $product) {
                    $variationIds = collect($product['variations'] ?? [])
                        ->pluck('id')
                        ->all();
                    $bundleItemIds = collect($product['bundle_options'] ?? [])
                        ->flatMap(fn (array $bundleOption) => collect($bundleOption['items'] ?? [])->pluck('product_id'))
                        ->all();

                    return array_merge([(int) ($product['id'] ?? 0)], $variationIds, $bundleItemIds);
                })
                ->all()
        );

        $paginated->setCollection(
            $pickerPayload->map(fn (array $product) => $this->appendInventorySnapshotToPickerPayload($product, $inventorySnapshotMap))
        );

        return response()->json($paginated);
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        if ($request->boolean('picker')) {
            return $this->pickerIndex($request);
        }

        $includeNestedProducts = ! $request->boolean('summary');
        [$query, $actualStockSql] = $this->buildAdminProductListBaseQuery($request, $includeNestedProducts);

        // Handle Trash View
        if ($request->boolean('is_trash')) {
            $query->onlyTrashed();
        }

        $selectedIds = $request->input('selected_ids', []);
        if ($selectedIds !== null && $selectedIds !== '') {
            $normalizedSelectedIds = is_array($selectedIds)
                ? $selectedIds
                : explode(',', (string) $selectedIds);

            $normalizedSelectedIds = collect($normalizedSelectedIds)
                ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
                ->filter()
                ->unique()
                ->values()
                ->all();

            if (!empty($normalizedSelectedIds)) {
                $query->whereIn('products.id', $normalizedSelectedIds);
            }
        }

        // Filter by category
        if ($request->filled('category_id')) {
            if ($request->category_id === 'uncategorized') {
                $query->whereNull('category_id')->doesntHave('categories');
            }
            else {
                $query->where(function ($q) use ($request) {
                    $q->where('category_id', $request->category_id)
                        ->orWhereHas('categories', function ($sub) use ($request) {
                        $sub->where('categories.id', $request->category_id);
                    }
                    );
                });
            }
        }

        if ($request->filled('category_ids')) {
            $catIds = is_array($request->category_ids) ? $request->category_ids : explode(',', $request->category_ids);
            $query->where(function ($q) use ($catIds) {
                $q->whereIn('category_id', $catIds)
                    ->orWhereHas('categories', function ($sub) use ($catIds) {
                    $sub->whereIn('categories.id', $catIds);
                }
                );
            });
        }

        $this->applyAdminProductCategoryCountFilter($query, $request->input('category_count_filter'));

        $rawSupplierIds = $request->input('supplier_ids', $request->input('supplier_id'));
        $includeUnassignedSuppliers = false;
        $supplierIds = [];
        if ($rawSupplierIds !== null && $rawSupplierIds !== '') {
            $normalizedSupplierFilter = is_array($rawSupplierIds) ? $rawSupplierIds : explode(',', (string) $rawSupplierIds);
            $includeUnassignedSuppliers = in_array('unassigned', $normalizedSupplierFilter, true);
            $supplierIds = collect($normalizedSupplierFilter)
                ->reject(fn ($value) => $value === 'unassigned')
                ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
                ->filter()
                ->unique()
                ->values()
                ->all();
            $this->applySupplierFilter($query, $supplierIds, $includeUnassignedSuppliers);
        }

        $inventoryUnitFilter = trim((string) $request->input('inventory_unit_filter', ''));
        if ($inventoryUnitFilter !== '') {
            if ($inventoryUnitFilter === 'assigned') {
                $query->whereNotNull('products.inventory_unit_id');
            } elseif ($inventoryUnitFilter === 'unassigned') {
                $query->whereNull('products.inventory_unit_id');
            } elseif (is_numeric($inventoryUnitFilter)) {
                $query->where('products.inventory_unit_id', (int) $inventoryUnitFilter);
            }
        }

        if ($request->boolean('missing_purchase_price')) {
            $query->whereDoesntHave('supplierPrices', function (Builder $priceQuery) {
                $priceQuery
                    ->whereNotNull('unit_cost')
                    ->where('unit_cost', '>', 0);
            });
        }

        if ($request->boolean('multiple_suppliers')) {
            $query->where(function (Builder $builder) {
                $builder
                    ->has('suppliers', '>', 1)
                    ->orWhereIn('id', function ($subQuery) {
                        $subQuery
                            ->from('supplier_product_prices')
                            ->select('product_id')
                            ->groupBy('product_id')
                            ->havingRaw('COUNT(DISTINCT supplier_id) > 1');
                });
            });
        }

        if ($request->filled('has_images')) {
            if ($request->boolean('has_images')) {
                $query->whereHas('images');
            } else {
                $query->whereDoesntHave('images');
            }
        }

        if ($request->filled('has_description')) {
            $normalizedDescriptionSql = "NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(products.description, ''), '<[^>]*>', '', 'g'), '&nbsp;|&#160;', '', 'gi'), '\\s+', '', 'g'), '')";

            if ($request->boolean('has_description')) {
                $query->whereRaw("{$normalizedDescriptionSql} IS NOT NULL");
            } else {
                $query->whereRaw("{$normalizedDescriptionSql} IS NULL");
            }
        }

        if ($request->filled('has_seo')) {
            if ($request->boolean('has_seo')) {
                $query->whereNotNull('meta_description')
                      ->where('meta_description', '!=', '');
            } else {
                $query->where(function ($q) {
                    $q->whereNull('meta_description')
                      ->orWhere('meta_description', '');
                });
            }
        }

        $searchRankingSql = null;
        $searchRankingBindings = [];

        // Search by name & SKU & more (Advanced Fuzzy & Token Matching)
        if (false && $request->filled('search')) {
            $search = trim($request->search);
            // Split into tokens
            $tokens = preg_split('/\s+/', $search, -1, PREG_SPLIT_NO_EMPTY);

            if (!empty($tokens)) {
                $query->where(function (Builder $q) use ($tokens) {
                    foreach ($tokens as $token) {
                        $q->where(function (Builder $sub) use ($token) {
                                    $escapedToken = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $token) . '%';
                                    $fuzzyToken = '%' . implode('%', preg_split('//u', str_replace(['%', '_'], '', $token), -1, PREG_SPLIT_NO_EMPTY)) . '%';

                                    // Name match
                                    $sub->whereRaw('immutable_unaccent(name) ILIKE immutable_unaccent(?)', [$escapedToken])
                                        // SKU match (substring or compacted substring)
                                        ->orWhereRaw('immutable_unaccent(sku) ILIKE immutable_unaccent(?)', [$escapedToken])
                                        ->orWhereRaw("immutable_unaccent(REGEXP_REPLACE(sku, '[^a-zA-Z0-9]', '', 'g')) ILIKE immutable_unaccent(?)", [$escapedToken])
                                        // SKU fuzzy/subsequence match
                                        ->orWhereRaw("immutable_unaccent(REGEXP_REPLACE(sku, '[^a-zA-Z0-9]', '', 'g')) ILIKE immutable_unaccent(?)", [$fuzzyToken])

                                        // Nếu là sản phẩm cha, hãy kiểm tra xem có biến thể nào khớp không
                                        ->orWhereHas('variations', function (Builder $sq) use ($escapedToken) {
                                $sq->whereRaw('immutable_unaccent(name) ILIKE immutable_unaccent(?)', [$escapedToken])
                                    ->orWhereRaw('immutable_unaccent(sku) ILIKE immutable_unaccent(?)', [$escapedToken]);
                            }
                            );

                        }
                        );
                    }
                });
            }
        }

        if (false && $request->filled('search')) {
            $rawSearch = trim($request->search);
            $normalizedSearch = Str::of($rawSearch)
                ->lower()
                ->ascii()
                ->replaceMatches('/[^a-z0-9\s]+/', ' ')
                ->squish()
                ->toString();
            $strictTokens = collect(preg_split('/\s+/', $normalizedSearch, -1, PREG_SPLIT_NO_EMPTY))
                ->map(fn ($token) => trim($token))
                ->filter(fn ($token) => mb_strlen($token) >= 2)
                ->unique()
                ->take(6)
                ->values()
                ->all();

            if ($rawSearch !== '' || !empty($strictTokens)) {
                $escapeLike = static fn ($value) => str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
                $nameExpr = "immutable_unaccent(COALESCE(products.name, ''))";
                $skuExpr = "immutable_unaccent(COALESCE(products.sku, ''))";
                $compactSkuExpr = "immutable_unaccent(REGEXP_REPLACE(COALESCE(products.sku, ''), '[^a-zA-Z0-9]', '', 'g'))";
                $phraseLike = '%' . $escapeLike($rawSearch) . '%';
                $prefixLike = $escapeLike($rawSearch) . '%';
                $compactSearch = preg_replace('/[^a-z0-9]+/', '', $normalizedSearch);
                $compactPhraseLike = $compactSearch !== '' ? '%' . $escapeLike($compactSearch) . '%' : null;
                $compactPrefixLike = $compactSearch !== '' ? $escapeLike($compactSearch) . '%' : null;
                $strictTokenMatchParts = [];
                $strictTokenMatchBindings = [];

                foreach ($strictTokens as $token) {
                    $tokenLike = '%' . $escapeLike($token) . '%';
                    $compactToken = preg_replace('/[^a-z0-9]+/', '', $token);
                    $compactTokenLike = '%' . $escapeLike($compactToken) . '%';
                    $strictTokenMatchParts[] = "CASE WHEN ({$nameExpr} ILIKE immutable_unaccent(?) OR {$skuExpr} ILIKE immutable_unaccent(?) OR {$compactSkuExpr} ILIKE immutable_unaccent(?)) THEN 1 ELSE 0 END";
                    array_push($strictTokenMatchBindings, $tokenLike, $tokenLike, $compactTokenLike);
                }

                $strictTokenMatchSql = !empty($strictTokenMatchParts) ? '(' . implode(' + ', $strictTokenMatchParts) . ')' : '0';
                $minimumRelevantMatches = count($strictTokens) <= 1 ? 1 : max(2, count($strictTokens) - 1);

                $searchRankingParts = [
                    "CASE WHEN {$skuExpr} = immutable_unaccent(?) THEN 1500 ELSE 0 END",
                    "CASE WHEN {$nameExpr} = immutable_unaccent(?) THEN 1400 ELSE 0 END",
                    "CASE WHEN {$skuExpr} ILIKE immutable_unaccent(?) THEN 950 ELSE 0 END",
                    "CASE WHEN {$nameExpr} ILIKE immutable_unaccent(?) THEN 900 ELSE 0 END",
                    "CASE WHEN {$skuExpr} ILIKE immutable_unaccent(?) THEN 820 ELSE 0 END",
                    "CASE WHEN {$nameExpr} ILIKE immutable_unaccent(?) THEN 780 ELSE 0 END",
                ];
                $searchRankingBindings = [
                    $rawSearch,
                    $rawSearch,
                    $prefixLike,
                    $prefixLike,
                    $phraseLike,
                    $phraseLike,
                ];

                if ($compactPhraseLike !== null) {
                    $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} ILIKE immutable_unaccent(?) THEN 900 ELSE 0 END";
                    $searchRankingBindings[] = $compactPhraseLike;
                }

                if ($compactPrefixLike !== null) {
                    $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} ILIKE immutable_unaccent(?) THEN 880 ELSE 0 END";
                    $searchRankingBindings[] = $compactPrefixLike;
                }

                if (!empty($strictTokenMatchParts)) {
                    $searchRankingParts[] = "({$strictTokenMatchSql} * 140)";
                    $searchRankingBindings = array_merge($searchRankingBindings, $strictTokenMatchBindings);
                }

                $searchRankingSql = '(' . implode(' + ', $searchRankingParts) . ')';
                $query->selectRaw("{$searchRankingSql} AS search_score", $searchRankingBindings);
                $query->where(function (Builder $strictSearchQuery) use (
                    $nameExpr,
                    $skuExpr,
                    $compactSkuExpr,
                    $phraseLike,
                    $compactPhraseLike,
                    $strictTokenMatchSql,
                    $strictTokenMatchBindings,
                    $minimumRelevantMatches
                ) {
                    $strictSearchQuery
                        ->whereRaw("{$nameExpr} ILIKE immutable_unaccent(?)", [$phraseLike])
                        ->orWhereRaw("{$skuExpr} ILIKE immutable_unaccent(?)", [$phraseLike]);

                    if ($compactPhraseLike !== null) {
                        $strictSearchQuery
                            ->orWhereRaw("{$compactSkuExpr} ILIKE immutable_unaccent(?)", [$compactPhraseLike]);
                    }

                    if ($strictTokenMatchSql !== '0') {
                        $strictSearchQuery->orWhereRaw("{$strictTokenMatchSql} >= ?", array_merge($strictTokenMatchBindings, [$minimumRelevantMatches]));
                    }

                    $strictSearchQuery->orWhereHas('variations', function (Builder $variationQuery) use ($phraseLike, $compactPhraseLike) {
                        $variationNameExpr = "immutable_unaccent(COALESCE(products.name, ''))";
                        $variationSkuExpr = "immutable_unaccent(COALESCE(products.sku, ''))";
                        $variationCompactSkuExpr = "immutable_unaccent(REGEXP_REPLACE(COALESCE(products.sku, ''), '[^a-zA-Z0-9]', '', 'g'))";

                        $variationQuery
                            ->whereRaw("{$variationNameExpr} ILIKE immutable_unaccent(?)", [$phraseLike])
                            ->orWhereRaw("{$variationSkuExpr} ILIKE immutable_unaccent(?)", [$phraseLike]);

                        if ($compactPhraseLike !== null) {
                            $variationQuery
                                ->orWhereRaw("{$variationCompactSkuExpr} ILIKE immutable_unaccent(?)", [$compactPhraseLike]);
                        }
                    });
                });
            }
        }

        // Numberic Filters
        if ($request->filled('min_price'))
            $query->where('price', '>=', $request->min_price);
        if ($request->filled('max_price'))
            $query->where('price', '<=', $request->max_price);
        if ($request->filled('min_stock'))
            $query->whereRaw($actualStockSql . ' >= ?', [(int) $request->min_stock]);
        if ($request->filled('max_stock'))
            $query->whereRaw($actualStockSql . ' <= ?', [(int) $request->max_stock]);

        // Filter by date range
        if ($request->filled('start_date'))
            $query->whereDate('created_at', '>=', $request->start_date);
        if ($request->filled('end_date'))
            $query->whereDate('created_at', '<=', $request->end_date);

        // Flags
        if ($request->filled('is_featured'))
            $query->where('is_featured', $request->boolean('is_featured'));
        if ($request->filled('is_new'))
            $query->where('is_new', $request->boolean('is_new'));
        // Type Filtering (Improved for Multiple Types & Variants logic)
        if ($request->filled('type')) {
            $types = is_array($request->type) ? $request->type : explode(',', $request->type);
            $query->where(function ($q) use ($types) {
                foreach ($types as $type) {
                    $q->orWhere(function ($sub) use ($type) {
                        if ($type === 'configurable') {
                            // Trả về sản phẩm cha thực sự có biến thể
                            $sub->where('type', 'configurable')
                                ->whereHas('variations');
                        } elseif ($type === 'simple') {
                            // Trả về sản phẩm đơn độc lập (không phải là biến thể của sản phẩm khác)
                            $sub->where('type', 'simple')
                                ->whereDoesntHave('parentConfigurable');
                        } else {
                            $sub->where('type', $type);
                        }
                    });
                }
            });
        }

        // Filter by EAV Attributes
        if ($this->productQuickFiltersEnabled($request)) {
            $this->applyProductAttributeFilters($query, $request->input('attributes'), [
                'include_variations' => true,
                'include_bundle_items' => false,
            ]);
        }
        // Mặc định luôn ẩn sản phẩm con (biến thể) ở danh sách chính
        // Sản phẩm con chỉ hiển thị khi bấm mở rộng sản phẩm cha ở frontend
        $searchTerm = trim((string) $request->input('search', ''));
        $typeFilterApplied = $request->filled('type');
        if ($searchTerm !== '' && !$typeFilterApplied) {
            $sortBy = $request->input('sort_by', 'created_at');
            $sortOrder = $request->input('sort_order', 'desc');
            $requestedSort = is_string($sortBy) && trim($sortBy) !== '' ? trim($sortBy) : 'created_at';
            $order = strtolower((string) $sortOrder) === 'asc' ? 'asc' : 'desc';

            $topLevelScopeQuery = clone $query;
            $topLevelScopeQuery->whereDoesntHave('parentConfigurable');

            $directMatchQuery = clone $topLevelScopeQuery;
            $directMatchQuery->setEagerLoads([]);
            $directMatchQuery->select('products.id');
            [$directSearchRankingSql, $directSearchRankingBindings] = $this->applyProductSearch(
                $directMatchQuery,
                $searchTerm,
                false
            );
            if ($directSearchRankingSql === null) {
                $directMatchQuery->selectRaw('0 AS search_score');
            }

            $directSortProjection = $this->buildProductListSortProjection($requestedSort, $actualStockSql);
            $directMatchQuery
                ->selectRaw("{$directSortProjection['empty_rank']} AS sort_empty_rank")
                ->selectRaw("{$directSortProjection['text_value']} AS sort_text_value")
                ->selectRaw("{$directSortProjection['number_value']} AS sort_numeric_value");

            $configurableParentIdsQuery = clone $topLevelScopeQuery;
            $configurableParentIdsQuery->setEagerLoads([]);
            $configurableParentIdsQuery
                ->select('products.id')
                ->where('products.type', 'configurable');

            $variantMatchQuery = Product::query()
                ->select('products.id')
                ->distinct()
                ->join('product_links as variant_parent_links', function ($join) {
                    $join->on('variant_parent_links.linked_product_id', '=', 'products.id')
                        ->where('variant_parent_links.link_type', 'super_link');
                });

            if ($request->boolean('is_trash')) {
                $variantMatchQuery->onlyTrashed();
            }

            $variantStockContext = $this->attachActualStockSubqueries($variantMatchQuery, $request);
            $variantActualStockSql = $variantStockContext['actual_stock_sql'];

            // Keep variant rows in the result set by filtering through the
            // parent ids subquery directly, instead of relying on relation
            // aliases inside whereHas that can point back to the child table.
            $variantMatchQuery->whereIn('variant_parent_links.product_id', $configurableParentIdsQuery);

            [$variantSearchRankingSql, $variantSearchRankingBindings] = $this->applyProductSearch(
                $variantMatchQuery,
                $searchTerm,
                false
            );
            if ($variantSearchRankingSql === null) {
                $variantMatchQuery->selectRaw('0 AS search_score');
            }

            $variantSortProjection = $this->buildProductListSortProjection($requestedSort, $variantActualStockSql);
            $variantMatchQuery
                ->selectRaw("{$variantSortProjection['empty_rank']} AS sort_empty_rank")
                ->selectRaw("{$variantSortProjection['text_value']} AS sort_text_value")
                ->selectRaw("{$variantSortProjection['number_value']} AS sort_numeric_value");

            $searchMatches = $directMatchQuery->toBase()->unionAll($variantMatchQuery->toBase());
            $collapsedMatches = DB::query()
                ->fromSub($searchMatches, 'search_matches')
                ->leftJoin('product_links as matched_variant_parent_links', function ($join) use ($configurableParentIdsQuery) {
                    $join->on('matched_variant_parent_links.linked_product_id', '=', 'search_matches.id')
                        ->where('matched_variant_parent_links.link_type', 'super_link')
                        // Only collapse to a parent that is still visible in the
                        // current list scope. If the configurable parent was
                        // soft-deleted, keep the matching child id so search
                        // results do not point at an empty row.
                        ->whereIn('matched_variant_parent_links.product_id', $configurableParentIdsQuery);
                })
                ->selectRaw('COALESCE(matched_variant_parent_links.product_id, search_matches.id) AS id')
                ->selectRaw('search_matches.search_score')
                ->selectRaw('search_matches.sort_empty_rank')
                ->selectRaw('search_matches.sort_text_value')
                ->selectRaw('search_matches.sort_numeric_value');

            $collapsedMatchRows = DB::query()
                ->fromSub($collapsedMatches, 'collapsed_search_matches')
                ->select([
                    'collapsed_search_matches.id',
                    'collapsed_search_matches.search_score',
                    'collapsed_search_matches.sort_empty_rank',
                    'collapsed_search_matches.sort_text_value',
                    'collapsed_search_matches.sort_numeric_value',
                ]);

            // Collapse variant hits back to their configurable parent before pagination.
            // The admin table already renders variants inside the expanded parent row,
            // so keeping child rows at the top level causes duplicate output.
            if ($directSortProjection['mode'] === 'text') {
                $collapsedMatchRows->selectRaw("ROW_NUMBER() OVER (PARTITION BY collapsed_search_matches.id ORDER BY collapsed_search_matches.search_score DESC, collapsed_search_matches.sort_empty_rank ASC, collapsed_search_matches.sort_text_value {$order}, collapsed_search_matches.id DESC) AS match_rank");
            } else {
                $collapsedMatchRows->selectRaw("ROW_NUMBER() OVER (PARTITION BY collapsed_search_matches.id ORDER BY collapsed_search_matches.search_score DESC, collapsed_search_matches.sort_numeric_value {$order}, collapsed_search_matches.id DESC) AS match_rank");
            }

            $deduplicatedMatches = DB::query()
                ->fromSub($collapsedMatchRows, 'collapsed_matches')
                ->where('match_rank', 1);

            $rankedMatches = DB::query()
                ->fromSub($deduplicatedMatches, 'search_matches')
                ->orderByDesc('search_score');

            if ($directSortProjection['mode'] === 'text') {
                $rankedMatches
                    ->orderBy('sort_empty_rank', 'asc')
                    ->orderBy('sort_text_value', $order);
            } else {
                $rankedMatches->orderBy('sort_numeric_value', $order);
            }

            $rankedMatches->orderByDesc('id');

            $perPage = min(max((int) $request->get('per_page', 20), 1), 100);
            $paginatedMatches = $rankedMatches->paginate($perPage);
            $pageIds = collect($paginatedMatches->items())
                ->pluck('id')
                ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
                ->filter()
                ->values();

            if ($pageIds->isEmpty()) {
                $paginatedMatches->setCollection(collect());
                return response()->json($paginatedMatches);
            }

            [$resourceQuery] = $this->buildAdminProductListBaseQuery($request, $includeNestedProducts);
            if ($request->boolean('is_trash')) {
                $resourceQuery->onlyTrashed();
            }

            $orderedIds = $pageIds->all();
            $orderLookup = array_flip($orderedIds);
            $products = $resourceQuery
                ->whereIn('products.id', $orderedIds)
                ->get()
                ->sortBy(fn (Product $product) => $orderLookup[(int) $product->id] ?? PHP_INT_MAX)
                ->values();

            $stockMap = $this->buildActualStockMap(
                $request,
                $products
                    ->flatMap(function (Product $product) {
                        $ids = [$product->id];

                        if ($product->relationLoaded('variations')) {
                            $ids = array_merge($ids, $product->variations->pluck('id')->all());
                        }

                        if ($product->relationLoaded('groupedItems')) {
                            $ids = array_merge($ids, $product->groupedItems->pluck('id')->all());
                        }

                        return $ids;
                    })
                    ->all()
            );

            $paginatedMatches->setCollection(
                $products->map(function (Product $product) use ($stockMap) {
                    return $this->syncProductStocksFromInventory(
                        $this->trimAdminProductListPayload($this->appendSupplierMeta($product)),
                        $stockMap
                    );
                })
            );

            return response()->json($paginatedMatches);
        }

        if ($searchTerm !== '') {
            [$searchRankingSql, $searchRankingBindings] = $this->applyProductSearch(
                $query,
                $searchTerm
            );
        }

        if (!$typeFilterApplied) {
            $query->whereDoesntHave('parentConfigurable');
        }

        // Sorting
        $sortBy = $request->input('sort_by', 'created_at');
        $sortOrder = $request->input('sort_order', 'desc');

        if ($sortBy === 'random') {
            $query->inRandomOrder();
        } else {
            $requestedSort = is_string($sortBy) && trim($sortBy) !== '' ? trim($sortBy) : 'created_at';
            $order = strtolower((string) $sortOrder) === 'asc' ? 'asc' : 'desc';

            // Tôn trọng tiêu chí sắp xếp từ bảng quản lý sản phẩm; mặc định là mới nhất lên đầu.
            if ($searchRankingSql !== null) {
                $query->orderByRaw("{$searchRankingSql} DESC", $searchRankingBindings);
            }

            if (!$this->applyRequestedProductSort($query, $requestedSort, $order, $actualStockSql)) {
                $query->orderByDesc('products.created_at');
            }

            $query->orderByDesc('products.id');
        }

        $perPage = (int)$request->get('per_page', 20);
        // Ensure perPage is reasonable
        $perPage = min(max($perPage, 1), 100);

        $paginated = $query->paginate($perPage);
        $stockMap = $this->buildActualStockMap(
            $request,
            $paginated->getCollection()
                ->flatMap(function (Product $product) {
                    $ids = [$product->id];

                    if ($product->relationLoaded('variations')) {
                        $ids = array_merge($ids, $product->variations->pluck('id')->all());
                    }

                    if ($product->relationLoaded('groupedItems')) {
                        $ids = array_merge($ids, $product->groupedItems->pluck('id')->all());
                    }

                    return $ids;
                })
                ->all()
        );
        $paginated->setCollection(
            $paginated->getCollection()->map(function (Product $product) use ($stockMap) {
                return $this->syncProductStocksFromInventory(
                    $this->trimAdminProductListPayload($this->appendSupplierMeta($product)),
                    $stockMap
                );
            })
        );

        return response()->json($paginated);
    }

    public function downloadImportTemplate()
    {
        return $this->xlsxDownloadResponse(
            'mau-import-san-pham.xlsx',
            [[
                'name' => 'SanPham',
                'rows' => array_merge([$this->productImportHeaders()], $this->productImportTemplateRows()),
            ]]
        );
    }

    public function exportExcel(Request $request)
    {
        $columns = $this->resolveProductExportColumns($request->input('columns'));

        if (empty($columns)) {
            return response()->json([
                'message' => 'Vui lòng chọn ít nhất 1 cột để xuất Excel.',
            ], 422);
        }

        $products = $this->collectProductsForExcelExportV2($request, $columns);
        $domains = $this->resolveScopedSiteDomains($request);
        $fallbackBaseUrl = $this->resolveProductLinkFallbackBaseUrl($request);
        $attributeMap = $this->collectProductExportAttributeMap($products);
        $selectedVariantMap = $this->collectCompositeSelectedVariantMap($products);
        $rows = [
            $this->resolveProductExportColumnLabelsV2($columns),
        ];

        foreach ($products as $product) {
            $rows[] = array_map(
                fn (string $column) => $this->resolveProductExportCellV2($product, $column, $domains, $fallbackBaseUrl, $attributeMap, $selectedVariantMap),
                $columns
            );
        }

        return $this->xlsxDownloadResponse(
            'san-pham-' . now()->format('Ymd-His') . '.xlsx',
            [[
                'name' => 'SanPham',
                'rows' => $rows,
            ]]
        );
    }

    public function importExcel(Request $request)
    {
        $request->validate([
            'file' => 'required|file|mimes:xlsx|max:10240',
            'mode' => 'nullable|string|in:replace_all,update_selected_fields',
            'missing_product_action' => 'nullable|string|in:create,skip',
            'update_fields' => 'nullable|array',
            'update_fields.*' => 'nullable|string|max:120',
        ]);

        $importOptions = $this->resolveProductImportOptions($request);
        if (
            $importOptions['is_selective_update']
            && empty($importOptions['selected_fields'])
            && empty($importOptions['selected_attribute_ids'])
        ) {
            return response()->json([
                'message' => 'Vui long chon it nhat 1 truong can cap nhat truoc khi import.',
                'errors' => [[
                    'row' => 1,
                    'column' => 'Truong cap nhat',
                    'message' => 'Chua co truong nao duoc chon de cap nhat.',
                ]],
            ], 422);
        }

        try {
            $rows = SimpleXlsx::readRows($request->file('file')->getRealPath());
        } catch (Throwable $exception) {
            return response()->json([
                'message' => 'Không thể đọc file Excel. Vui lòng dùng file .xlsx hợp lệ.',
                'errors' => [[
                    'row' => 1,
                    'column' => 'File',
                    'message' => $exception->getMessage(),
                ]],
            ], 422);
        }

        [$records, $errors] = $this->prepareProductImportRowsV2($rows, $request, $importOptions);

        if (empty($records) && !empty($errors)) {
            return response()->json([
                'message' => 'Phát hiện lỗi trong file import. Không có dữ liệu nào được cập nhật.',
                'errors' => $errors,
            ], 422);
        }

        try {
            $summary = $this->applyProductImportV2($records, $request, $errors);
        } catch (Throwable $exception) {
            return response()->json([
                'message' => 'Import sản phẩm thất bại. ' . $exception->getMessage(),
            ], 422);
        }

        $processedCount = (int) $summary['created'] + (int) $summary['updated'] + (int) $summary['skipped'];
        $failedCount = (int) ($summary['failed'] ?? 0);
        $skippedMissingCount = (int) ($summary['skipped_missing'] ?? 0);
        $skippedMessage = $skippedMissingCount > 0
            ? sprintf('%d bỏ qua (%d không tìm thấy sản phẩm)', $summary['skipped'], $skippedMissingCount)
            : sprintf('%d bỏ qua', $summary['skipped']);

        if ($processedCount === 0 && $failedCount > 0) {
            return response()->json([
                'message' => sprintf(
                    'Không thể import file Excel sản phẩm. Có %d dòng lỗi cần kiểm tra lại.',
                    $failedCount
                ),
                'summary' => $summary,
                'errors' => $summary['errors'],
            ], 422);
        }

        $message = $failedCount > 0
            ? sprintf(
                'Import hoàn tất với cảnh báo: %d tạo mới, %d cập nhật, %s, %d dòng lỗi.',
                $summary['created'],
                $summary['updated'],
                $skippedMessage,
                $failedCount
            )
            : sprintf(
                'Import thành công: %d tạo mới, %d cập nhật, %s.',
                $summary['created'],
                $summary['updated'],
                $skippedMessage
            );

        return response()->json([
            'message' => $message,
            'summary' => $summary,
            'errors' => $summary['errors'],
        ]);
    }

    private function productImportHeaders(): array
    {
        return [
            'ID',
            'SKU',
            'Slug',
            'Link sản phẩm',
            'Tên sản phẩm',
            'Loại sản phẩm',
            'Danh mục',
            'Giá',
            'Giá bán',
            'Giá nhập dự kiến',
            'Tồn kho',
            'Đang bán',
            'Nổi bật',
            'Mới',
            'Domain',
            'Mô tả',
            'SEO title',
            'SEO description',
            'SEO keywords',
            'Thông tin bổ sung',
            'Khối lượng',
            'Video URL',
            'Thông số kỹ thuật',
            'Tiêu đề bundle',
            'Mã SP con',
            'Thành phần bundle/grouped',
            'Thuộc tính',
            'Ảnh đại diện',
            'Thư viện ảnh',
            'Biến thể',
        ];
    }

    private function productImportTemplateRows(): array
    {
        return [
            [
                '#ID nếu cập nhật',
                '#SKU để cập nhật hoặc tạo mới',
                '#slug sản phẩm',
                '#https://ten-mien/san-pham/slug-hoac-id',
                '#Tên sản phẩm',
                '#simple / virtual / downloadable / configurable / grouped / bundle',
                '#CODE:ma-danh-muc hoặc ID:12 hoặc NAME:Tên danh mục',
                '#0',
                '#0',
                '#0',
                '#1 hoặc 0',
                '#1 hoặc 0',
                '#1 hoặc 0',
                '#example.com hoặc ID:1',
                '#Mô tả ngắn hoặc nội dung sản phẩm',
                '#Tiêu đề SEO',
                '#Mô tả SEO',
                '#Từ khóa SEO cách nhau bởi dấu phẩy',
                '#JSON [{"post_id":12,"title":"Bảo hành","display_text":"Xem chi tiết"}]',
                '#500g hoặc 1.2kg',
                '#https://youtube.com/watch?v=...',
                '#JSON [{"label":"Chất liệu","value":"Gốm"}] hoặc từng dòng Label: Value',
                '#Tiêu đề bundle nếu cần',
                '#SKU con ngăn cách bởi |, dùng nhanh cho bundle/grouped',
                '#JSON [{"sku":"BOWL-001","quantity":1},{"sku":"OPTION-001","variant_sku":"OPTION-001-RED","quantity":2,"price":150000,"option_title":"Mau men","option_post_slug":"lua-chon-mau-men"}]',
                '#JSON {"CODE:mau-sac":"Đỏ","NAME:Chất liệu":["Gốm","Men lam"]} hoặc Mau sac=Do | Chat lieu=Gom',
                '#https://cdn.example.com/products/main.jpg',
                '#https://cdn.example.com/products/1.jpg | https://cdn.example.com/products/2.jpg',
                '#JSON [{"sku":"SP-RED","name":"San pham - Do","price":120000,"stock_quantity":5,"attributes":{"CODE:mau-sac":"Đỏ"},"primary_image_url":"https://cdn.example.com/products/red.jpg","gallery_image_urls":["https://cdn.example.com/products/red-2.jpg"]}]',
            ],
            [
                '#Dòng bắt đầu bằng # sẽ được bỏ qua',
                '#Để trống để giữ nguyên khi cập nhật',
                '#Có thể sửa slug hoặc sửa cột Link sản phẩm',
                '#Nếu có cả slug và link, hệ thống ưu tiên slug',
                '#Bắt buộc khi tạo mới',
                '#Tạo mới hỗ trợ simple/virtual/downloadable/configurable/grouped/bundle',
                '#Dùng NULL để xóa danh mục',
                '#Giá mặc định 0 khi tạo mới',
                '#Để trống nếu chưa có giá bán ưu đãi',
                '#Để trống nếu chưa có',
                '#Tồn kho mặc định 0 khi tạo mới',
                '#1 = đang bán, 0 = tạm ẩn',
                '#1 = nổi bật, 0 = bình thường',
                '#1 = mới, 0 = không',
                '#Dùng NULL để xóa domain',
                '#Dùng NULL để xóa mô tả',
                '#Dùng NULL để xóa SEO title',
                '#Dùng NULL để xóa SEO description',
                '#Dùng NULL để xóa SEO keywords',
                '#Dùng NULL để xóa thông tin bổ sung',
                '#Dùng NULL để xóa khối lượng',
                '#Dùng NULL để xóa video',
                '#Dùng NULL để xóa thông số kỹ thuật',
                '#Dùng NULL để xóa tiêu đề bundle',
                '#Dùng cho bundle/grouped khi chỉ cần danh sách SKU. Nếu có cả component_data thì component_data được ưu tiên.',
                '#Dùng cho bundle/grouped để khai báo chi tiết số lượng, biến thể, giá, bài viết tùy chọn...',
                '#Hệ thống tự tạo thuộc tính / giá trị còn thiếu. Dữ liệu JSON sẽ giữ được mảng giá trị.',
                '#Link online hợp lệ sẽ được gán làm ảnh đại diện. Dùng NULL để xóa toàn bộ ảnh.',
                '#Cột này chỉ chứa ảnh phụ / gallery. Hệ thống tự gộp với ảnh đại diện khi import.',
                '#Chỉ dùng cho sản phẩm configurable. Hệ thống tự tạo thuộc tính biến thể, giá trị và ảnh online nếu có.',
            ],
        ];
    }

    private function resolveProductExportColumns($value): array
    {
        $columns = is_array($value) ? $value : explode(',', (string) $value);
        $defaultColumns = ['name', 'product_link'];
        $supportedColumns = [
            'id',
            'sku',
            'name',
            'slug',
            'product_link',
            'type',
            'category',
            'price',
            'special_price',
            'cost_price',
            'expected_cost',
            'stock',
            'stock_quantity',
            'status',
            'is_featured',
            'is_new',
            'description',
            'specifications',
            'additional_info',
            'supplier_product_code',
            'meta_title',
            'meta_description',
            'meta_keywords',
            'weight',
            'video_url',
            'bundle_title',
            'child_skus',
            'child_names',
            'component_data',
            'domain',
            'attributes',
            'primary_image_url',
            'gallery_image_urls',
            'variant_data',
        ];

        $normalized = collect($columns)
            ->map(fn ($column) => trim((string) $column))
            ->filter()
            ->reject(fn ($column) => in_array($column, ['actions', 'images'], true))
            ->filter(function (string $column) use ($supportedColumns) {
                return in_array($column, $supportedColumns, true)
                    || preg_match('/^attr_\d+$/', $column) === 1;
            })
            ->unique()
            ->values()
            ->all();

        return !empty($normalized) ? $normalized : $defaultColumns;
    }

    private function resolveProductExportColumnLabels(array $columns): array
    {
        $labels = [
            'id' => 'ID',
            'sku' => 'Mã SP',
            'name' => 'Tên sản phẩm',
            'slug' => 'Slug',
            'product_link' => 'Link sản phẩm',
            'type' => 'Loại sản phẩm',
            'category' => 'Danh mục',
            'price' => 'Giá',
            'special_price' => 'Giá bán',
            'cost_price' => 'Giá nhập dự kiến',
            'expected_cost' => 'Giá nhập dự kiến',
            'stock' => 'Tồn kho',
            'stock_quantity' => 'Tồn kho',
            'status' => 'Đang bán',
            'is_featured' => 'Nổi bật',
            'is_new' => 'Mới',
            'description' => 'Mô tả',
            'specifications' => 'Thông số kỹ thuật',
            'additional_info' => 'Thông tin bổ sung',
            'supplier_product_code' => 'Mã NCC',
            'meta_title' => 'SEO title',
            'meta_description' => 'SEO description',
            'meta_keywords' => 'SEO keywords',
            'weight' => 'Khối lượng',
            'video_url' => 'Video URL',
            'child_skus' => 'Mã SP con',
            'child_names' => 'Tên biến thể / thành phần',
            'component_data' => 'Thành phần bundle/grouped',
            'bundle_title' => 'Tiêu đề bundle',
            'domain' => 'Domain',
            'attributes' => 'Thuộc tính',
            'primary_image_url' => 'Ảnh đại diện',
            'gallery_image_urls' => 'Thư viện ảnh',
            'variant_data' => 'Biến thể',
        ];

        $attributeIds = collect($columns)
            ->map(function (string $column) {
                if (preg_match('/^attr_(\d+)$/', $column, $matches) === 1) {
                    return (int) $matches[1];
                }

                return null;
            })
            ->filter()
            ->values()
            ->all();

        $attributesById = Attribute::query()
            ->whereIn('id', $attributeIds)
            ->get(['id', 'name'])
            ->keyBy(fn (Attribute $attribute) => (int) $attribute->id);

        return array_map(function (string $column) use ($labels, $attributesById) {
            if (preg_match('/^attr_(\d+)$/', $column, $matches) === 1) {
                $attributeId = (int) $matches[1];
                $attributeName = $attributesById->get($attributeId)?->name ?? ('Thuộc tính #' . $attributeId);
                return 'Thuộc tính: ' . $attributeName;
                $attributeName = $attributesById->get($attributeId)?->name ?? ('Thuá»™c tÃ­nh #' . $attributeId);
                return 'Thuá»™c tÃ­nh: ' . $attributeName;
                return $attributesById->get($attributeId)?->name ?? ('Thuộc tính #' . $attributeId);
            }

            return $labels[$column] ?? Str::headline(str_replace('_', ' ', $column));
        }, $columns);
    }

    private function collectProductsForExcelExport(Request $request): array
    {
        $products = [];
        $page = 1;
        $lastPage = 1;

        do {
            $pageRequest = $request->duplicate(array_merge($request->query(), [
                'page' => $page,
                'per_page' => 100,
            ]));

            $payload = $this->index($pageRequest)->getData(true);
            $products = array_merge($products, $payload['data'] ?? []);
            $lastPage = max(1, (int) ($payload['last_page'] ?? 1));
            $page++;
        } while ($page <= $lastPage);

        return $products;
    }

    private function resolveProductExportCell(
        array $product,
        string $column,
        Collection $domains,
        ?string $fallbackBaseUrl,
        array $attributeMap
    ): mixed
    {
        if (preg_match('/^attr_(\d+)$/', $column, $matches) === 1) {
            return $this->resolveProductAttributeExportValue($product, (int) $matches[1]);
        }

        return match ($column) {
            'id' => (int) ($product['id'] ?? 0),
            'sku' => (string) ($product['sku'] ?? ''),
            'name' => (string) ($product['name'] ?? ''),
            'slug' => (string) ($product['slug'] ?? ''),
            'product_link' => $this->buildProductPageUrlFromArray($product, $domains, $fallbackBaseUrl),
            'type' => (string) ($product['type'] ?? ''),
            'category' => $this->resolveProductExportCategory($product),
            'price' => $product['price'] ?? '',
            'cost_price' => $product['expected_cost'] ?? $product['cost_price'] ?? '',
            'stock' => InventoryQuantity::normalize($product['actual_stock'] ?? $product['stock_quantity'] ?? 0),
            'status' => !empty($product['status']) ? 1 : 0,
            'is_featured' => !empty($product['is_featured']) ? 1 : 0,
            'is_new' => !empty($product['is_new']) ? 1 : 0,
            'specifications' => $this->formatProductSpreadsheetValue($product['specifications'] ?? ''),
            'supplier_product_code' => (string) ($product['supplier_product_code'] ?? ''),
            'video_url' => (string) ($product['video_url'] ?? ''),
            'bundle_title' => (string) ($product['bundle_title'] ?? ''),
            'domain' => $this->resolveProductExportDomain($product, $domains),
            'attributes' => $this->resolveProductExportAttributes($product, $attributeMap),
            'primary_image_url' => $this->resolveProductPrimaryImageUrl($product),
            'gallery_image_urls' => $this->resolveProductGalleryImageUrls($product),
            'variant_data' => $this->resolveProductVariantExportData($product, $attributeMap),
            default => '',
        };
    }

    private function resolveProductExportColumnLabelsV2(array $columns): array
    {
        $labels = [
            'child_skus' => 'Mã SP con',
            'child_names' => 'Tên biến thể / thành phần',
            'component_data' => 'Thành phần bundle/grouped',
            'id' => 'ID',
            'sku' => 'Mã SP',
            'name' => 'Tên sản phẩm',
            'slug' => 'Slug',
            'product_link' => 'Link sản phẩm',
            'type' => 'Loại sản phẩm',
            'category' => 'Danh mục',
            'price' => 'Giá',
            'special_price' => 'Giá bán',
            'cost_price' => 'Giá nhập dự kiến',
            'expected_cost' => 'Giá nhập dự kiến',
            'stock' => 'Tồn kho',
            'stock_quantity' => 'Tồn kho',
            'status' => 'Đang bán',
            'is_featured' => 'Nổi bật',
            'is_new' => 'Mới',
            'description' => 'Mô tả',
            'specifications' => 'Thông số kỹ thuật',
            'additional_info' => 'Thông tin bổ sung',
            'supplier_product_code' => 'Mã NCC',
            'meta_title' => 'SEO title',
            'meta_description' => 'SEO description',
            'meta_keywords' => 'SEO keywords',
            'weight' => 'Khối lượng',
            'video_url' => 'Video URL',
            'bundle_title' => 'Tiêu đề bundle',
            'domain' => 'Domain',
            'attributes' => 'Thuộc tính',
            'primary_image_url' => 'Ảnh đại diện',
            'gallery_image_urls' => 'Thư viện ảnh',
            'variant_data' => 'Biến thể',
        ];

        $attributeIds = collect($columns)
            ->map(function (string $column) {
                if (preg_match('/^attr_(\d+)$/', $column, $matches) === 1) {
                    return (int) $matches[1];
                }

                return null;
            })
            ->filter()
            ->values()
            ->all();

        $attributesById = Attribute::query()
            ->whereIn('id', $attributeIds)
            ->get(['id', 'name'])
            ->keyBy(fn (Attribute $attribute) => (int) $attribute->id);

        return array_map(function (string $column) use ($labels, $attributesById) {
            if (preg_match('/^attr_(\d+)$/', $column, $matches) === 1) {
                $attributeId = (int) $matches[1];
                $attributeName = $attributesById->get($attributeId)?->name ?? ('Thuộc tính #' . $attributeId);

                return 'Thuộc tính: ' . $attributeName;
            }

            return $labels[$column] ?? Str::headline(str_replace('_', ' ', $column));
        }, $columns);
    }

    private function collectProductsForExcelExportV2(Request $request, array $columns): array
    {
        $products = [];
        $page = 1;
        $lastPage = 1;

        do {
            $pageRequest = $request->duplicate(array_merge($request->query(), [
                'page' => $page,
                'per_page' => 100,
            ]));

            $payload = $this->index($pageRequest)->getData(true);
            $products = array_merge($products, $payload['data'] ?? []);
            $lastPage = max(1, (int) ($payload['last_page'] ?? 1));
            $page++;
        } while ($page <= $lastPage);

        return $this->hydrateProductsForExcelExportV2($products, $columns);
    }

    private function hydrateProductsForExcelExportV2(array $products, array $columns): array
    {
        $hydratedColumns = array_intersect($columns, [
            'description',
            'special_price',
            'additional_info',
            'meta_title',
            'meta_description',
            'meta_keywords',
            'weight',
        ]);

        if (empty($hydratedColumns) || empty($products)) {
            return $products;
        }

        $productIds = collect($products)
            ->pluck('id')
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($productIds)) {
            return $products;
        }

        $productsById = Product::query()
            ->whereIn('id', $productIds)
            ->get([
                'id',
                'description',
                'special_price',
                'additional_info',
                'meta_title',
                'meta_description',
                'meta_keywords',
                'weight',
            ])
            ->keyBy(fn (Product $product) => (int) $product->id);

        return array_map(function (array $product) use ($productsById) {
            $hydratedProduct = $productsById->get((int) ($product['id'] ?? 0));
            if (!$hydratedProduct) {
                return $product;
            }

            $product['description'] = $hydratedProduct->description;
            $product['special_price'] = $hydratedProduct->special_price;
            $product['additional_info'] = $hydratedProduct->additional_info;
            $product['meta_title'] = $hydratedProduct->meta_title;
            $product['meta_description'] = $hydratedProduct->meta_description;
            $product['meta_keywords'] = $hydratedProduct->meta_keywords;
            $product['weight'] = $hydratedProduct->weight;

            return $product;
        }, $products);
    }

    private function resolveProductExportCellV2(
        array $product,
        string $column,
        Collection $domains,
        ?string $fallbackBaseUrl,
        array $attributeMap,
        array $selectedVariantMap = []
    ): mixed
    {
        if (preg_match('/^attr_(\d+)$/', $column, $matches) === 1) {
            return $this->resolveProductAttributeExportValue($product, (int) $matches[1]);
        }

        return match ($column) {
            'id' => (int) ($product['id'] ?? 0),
            'sku' => (string) ($product['sku'] ?? ''),
            'name' => (string) ($product['name'] ?? ''),
            'slug' => (string) ($product['slug'] ?? ''),
            'product_link' => $this->buildProductPageUrlFromArray($product, $domains, $fallbackBaseUrl),
            'type' => (string) ($product['type'] ?? ''),
            'category' => $this->resolveProductExportCategory($product),
            'price' => $product['price'] ?? '',
            'special_price' => $product['special_price'] ?? '',
            'cost_price' => $product['expected_cost'] ?? $product['cost_price'] ?? '',
            'expected_cost' => $product['expected_cost'] ?? $product['cost_price'] ?? '',
            'stock' => InventoryQuantity::normalize($product['actual_stock'] ?? $product['stock_quantity'] ?? 0),
            'stock_quantity' => InventoryQuantity::normalize($product['actual_stock'] ?? $product['stock_quantity'] ?? 0),
            'status' => !empty($product['status']) ? 1 : 0,
            'is_featured' => !empty($product['is_featured']) ? 1 : 0,
            'is_new' => !empty($product['is_new']) ? 1 : 0,
            'description' => (string) ($product['description'] ?? ''),
            'specifications' => $this->formatProductSpreadsheetJsonValue($product['specifications'] ?? ''),
            'additional_info' => $this->formatProductSpreadsheetJsonValue($product['additional_info'] ?? ''),
            'supplier_product_code' => (string) ($product['supplier_product_code'] ?? ''),
            'meta_title' => (string) ($product['meta_title'] ?? ''),
            'meta_description' => (string) ($product['meta_description'] ?? ''),
            'meta_keywords' => (string) ($product['meta_keywords'] ?? ''),
            'weight' => (string) ($product['weight'] ?? ''),
            'video_url' => (string) ($product['video_url'] ?? ''),
            'bundle_title' => (string) ($product['bundle_title'] ?? ''),
            'child_skus' => $this->resolveProductChildSkuExportValue($product, $selectedVariantMap),
            'child_names' => $this->resolveProductChildNameExportValue($product, $selectedVariantMap),
            'component_data' => $this->resolveProductCompositeExportData($product, $selectedVariantMap),
            'domain' => $this->resolveProductExportDomain($product, $domains),
            'attributes' => $this->resolveProductExportAttributes($product, $attributeMap),
            'primary_image_url' => $this->resolveProductPrimaryImageUrl($product),
            'gallery_image_urls' => $this->resolveProductGalleryImageUrls($product),
            'variant_data' => $this->resolveProductVariantExportData($product, $attributeMap),
            default => '',
        };
    }

    private function formatProductSpreadsheetJsonValue(mixed $value): string
    {
        if ($value === null) {
            return '';
        }

        if (is_array($value)) {
            return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
        }

        if (!is_string($value)) {
            return trim((string) $value);
        }

        $trimmed = trim($value);
        if ($trimmed === '') {
            return '';
        }

        $decoded = $this->decodeSpreadsheetJsonValue($trimmed);
        if (is_array($decoded)) {
            return json_encode($decoded, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
        }

        return $trimmed;
    }

    private function resolveProductExportCategory(array $product): string
    {
        $primaryCategory = data_get($product, 'category');
        $categories = collect($product['categories'] ?? [])
            ->prepend($primaryCategory)
            ->filter(fn ($category) => is_array($category))
            ->unique(function (array $category) {
                $id = (int) ($category['id'] ?? 0);
                if ($id > 0) {
                    return 'id:' . $id;
                }

                return 'name:' . $this->normalizeImportLookupValue((string) ($category['name'] ?? ''));
            });

        return $categories
            ->map(fn (array $category) => $this->buildCategoryExportReference($category))
            ->filter()
            ->implode(' | ');
    }

    private function buildCategoryExportReference(array $category): string
    {
        $code = trim((string) ($category['code'] ?? ''));
        if ($code !== '') {
            return 'CODE:' . $code;
        }

        $slug = trim((string) ($category['slug'] ?? ''));
        if ($slug !== '') {
            return 'SLUG:' . $slug;
        }

        $name = trim((string) ($category['name'] ?? ''));

        return $name !== '' ? ('NAME:' . $name) : '';
    }

    private function collectProductExportAttributeMap(array $products): array
    {
        $attributeIds = collect($products)
            ->flatMap(function (array $product) {
                return collect([
                    $product['attribute_values'] ?? [],
                    ...collect($product['variations'] ?? [])->pluck('attribute_values')->all(),
                ])->flatten(1);
            })
            ->pluck('attribute_id')
            ->map(fn ($attributeId) => is_numeric($attributeId) ? (int) $attributeId : null)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($attributeIds)) {
            return [];
        }

        return Attribute::query()
            ->whereIn('id', $attributeIds)
            ->get(['id', 'name', 'code'])
            ->mapWithKeys(fn (Attribute $attribute) => [
                (int) $attribute->id => [
                    'id' => (int) $attribute->id,
                    'name' => trim((string) $attribute->name),
                    'code' => trim((string) ($attribute->code ?? '')),
                ],
            ])
            ->all();
    }

    private function buildAttributeExportReference(?array $attribute): string
    {
        $code = trim((string) ($attribute['code'] ?? ''));
        if ($code !== '') {
            return 'CODE:' . $code;
        }

        $name = trim((string) ($attribute['name'] ?? ''));

        return $name !== '' ? ('NAME:' . $name) : '';
    }

    private function resolveProductExportAttributes(array $product, array $attributeMap): string
    {
        $payload = [];

        foreach ((array) ($product['attribute_values'] ?? []) as $attributeValue) {
            $attributeId = is_numeric($attributeValue['attribute_id'] ?? null)
                ? (int) $attributeValue['attribute_id']
                : 0;
            $attribute = $attributeMap[$attributeId] ?? data_get($attributeValue, 'attribute');
            $reference = $this->buildAttributeExportReference(is_array($attribute) ? $attribute : null);

            if ($reference === '') {
                continue;
            }

            $payload[$reference] = $this->decodeSpreadsheetJsonValue($attributeValue['value'] ?? null);
        }

        return !empty($payload)
            ? json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            : '';
    }

    private function resolveProductPrimaryImageUrl(array $product): string
    {
        $images = $this->normalizeProductImageArray($product['images'] ?? []);
        $primaryImage = collect($images)->firstWhere('is_primary', true) ?? ($images[0] ?? null);

        return $this->resolveProductExportImageUrl($primaryImage['image_url'] ?? null);
    }

    private function resolveProductGalleryImageUrls(array $product): string
    {
        $images = $this->normalizeProductImageArray($product['images'] ?? []);
        $primaryUrl = $this->resolveProductPrimaryImageUrl($product);

        return collect($images)
            ->pluck('image_url')
            ->map(fn ($url) => $this->resolveProductExportImageUrl($url))
            ->filter()
            ->reject(fn ($url) => $primaryUrl !== '' && $url === $primaryUrl)
            ->values()
            ->implode(' | ');
    }

    private function resolveProductVariantExportData(array $product, array $attributeMap): string
    {
        $variants = collect($product['variations'] ?? [])
            ->map(function (array $variant) use ($attributeMap) {
                $attributePayload = [];

                foreach ((array) ($variant['attribute_values'] ?? []) as $attributeValue) {
                    $attributeId = is_numeric($attributeValue['attribute_id'] ?? null)
                        ? (int) $attributeValue['attribute_id']
                        : 0;
                    $attribute = $attributeMap[$attributeId] ?? data_get($attributeValue, 'attribute');
                    $reference = $this->buildAttributeExportReference(is_array($attribute) ? $attribute : null);

                    if ($reference === '') {
                        continue;
                    }

                    $attributePayload[$reference] = $this->decodeSpreadsheetJsonValue($attributeValue['value'] ?? null);
                }

                $variantImages = $this->normalizeProductImageArray($variant['images'] ?? []);
                $primaryImage = collect($variantImages)->firstWhere('is_primary', true) ?? ($variantImages[0] ?? null);
                $primaryImageUrl = $this->resolveProductExportImageUrl($primaryImage['image_url'] ?? null);
                $galleryImageUrls = collect($variantImages)
                    ->pluck('image_url')
                    ->map(fn ($url) => $this->resolveProductExportImageUrl($url))
                    ->filter()
                    ->reject(fn ($url) => $primaryImageUrl !== '' && $url === $primaryImageUrl)
                    ->values()
                    ->all();

                return array_filter([
                    'id' => (int) ($variant['id'] ?? 0),
                    'sku' => trim((string) ($variant['sku'] ?? '')),
                    'name' => trim((string) ($variant['name'] ?? '')),
                    'price' => $variant['price'] ?? null,
                    'expected_cost' => $variant['expected_cost'] ?? $variant['cost_price'] ?? null,
                    'stock_quantity' => InventoryQuantity::normalize($variant['actual_stock'] ?? $variant['stock_quantity'] ?? 0),
                    'attributes' => !empty($attributePayload) ? $attributePayload : null,
                    'primary_image_url' => $primaryImageUrl !== '' ? $primaryImageUrl : null,
                    'gallery_image_urls' => !empty($galleryImageUrls) ? $galleryImageUrls : null,
                ], static fn ($value) => $value !== null && $value !== '');
            })
            ->filter(fn (array $variant) => !empty($variant['sku']) || !empty($variant['attributes']))
            ->values()
            ->all();

        return !empty($variants)
            ? json_encode($variants, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            : '';
    }

    private function collectCompositeSelectedVariantMap(array $products): array
    {
        $variantIds = collect($products)
            ->flatMap(function (array $product) {
                return array_merge(
                    (array) ($product['grouped_items'] ?? []),
                    (array) ($product['bundle_items'] ?? [])
                );
            })
            ->map(function ($item) {
                $variantId = data_get($item, 'pivot.variant_id');

                return is_numeric($variantId) ? (int) $variantId : null;
            })
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($variantIds)) {
            return [];
        }

        return Product::withTrashed()
            ->whereIn('id', $variantIds)
            ->get(['id', 'sku', 'name', 'price', 'expected_cost', 'cost_price', 'stock_quantity'])
            ->mapWithKeys(function (Product $variant) {
                return [
                    (int) $variant->id => [
                        'id' => (int) $variant->id,
                        'sku' => trim((string) ($variant->sku ?? '')),
                        'name' => trim((string) ($variant->name ?? '')),
                        'price' => $variant->price,
                        'expected_cost' => $variant->expected_cost ?? $variant->cost_price,
                        'stock_quantity' => InventoryQuantity::normalize($variant->stock_quantity ?? 0),
                    ],
                ];
            })
            ->all();
    }

    private function resolveProductChildSkuExportValue(array $product, array $selectedVariantMap = []): string
    {
        $type = (string) ($product['type'] ?? '');

        if ($type === 'configurable') {
            return collect($product['variations'] ?? [])
                ->pluck('sku')
                ->map(fn ($sku) => trim((string) $sku))
                ->filter()
                ->unique()
                ->values()
                ->implode(' | ');
        }

        if (!in_array($type, ['grouped', 'bundle'], true)) {
            return '';
        }

        $relationKey = $type === 'bundle' ? 'bundle_items' : 'grouped_items';

        return collect($product[$relationKey] ?? [])
            ->map(function (array $item) use ($selectedVariantMap) {
                $variantId = data_get($item, 'pivot.variant_id');
                $variantId = is_numeric($variantId) ? (int) $variantId : 0;

                if ($variantId > 0 && !empty($selectedVariantMap[$variantId]['sku'])) {
                    return trim((string) $selectedVariantMap[$variantId]['sku']);
                }

                return trim((string) ($item['sku'] ?? ''));
            })
            ->filter()
            ->unique()
            ->values()
            ->implode(' | ');
    }

    private function resolveProductChildNameExportValue(array $product, array $selectedVariantMap = []): string
    {
        $type = (string) ($product['type'] ?? '');

        if ($type === 'configurable') {
            return collect($product['variations'] ?? [])
                ->pluck('name')
                ->map(fn ($name) => trim((string) $name))
                ->filter()
                ->unique()
                ->values()
                ->implode(' | ');
        }

        if (!in_array($type, ['grouped', 'bundle'], true)) {
            return '';
        }

        $relationKey = $type === 'bundle' ? 'bundle_items' : 'grouped_items';

        return collect($product[$relationKey] ?? [])
            ->map(function (array $item) use ($selectedVariantMap) {
                $variantId = data_get($item, 'pivot.variant_id');
                $variantId = is_numeric($variantId) ? (int) $variantId : 0;

                if ($variantId > 0 && !empty($selectedVariantMap[$variantId]['name'])) {
                    return trim((string) $selectedVariantMap[$variantId]['name']);
                }

                return trim((string) ($item['name'] ?? ''));
            })
            ->filter()
            ->unique()
            ->values()
            ->implode(' | ');
    }

    private function resolveProductCompositeExportData(array $product, array $selectedVariantMap = []): string
    {
        $type = (string) ($product['type'] ?? '');
        if (!in_array($type, ['grouped', 'bundle'], true)) {
            return '';
        }

        $relationKey = $type === 'bundle' ? 'bundle_items' : 'grouped_items';

        $items = collect($product[$relationKey] ?? [])
            ->map(function (array $item) use ($selectedVariantMap, $type) {
                $variantId = data_get($item, 'pivot.variant_id');
                $variantId = is_numeric($variantId) ? (int) $variantId : null;
                $selectedVariant = $variantId !== null ? ($selectedVariantMap[$variantId] ?? null) : null;
                $optionPostId = data_get($item, 'pivot.option_post_id');
                $optionPostId = is_numeric($optionPostId) ? (int) $optionPostId : null;
                $quantity = data_get($item, 'pivot.quantity');

                return array_filter([
                    'product_id' => (int) ($item['id'] ?? 0),
                    'sku' => trim((string) ($item['sku'] ?? '')),
                    'name' => trim((string) ($item['name'] ?? '')),
                    'type' => trim((string) ($item['type'] ?? '')),
                    'quantity' => $quantity !== null ? (int) round((float) $quantity) : 1,
                    'is_required' => data_get($item, 'pivot.is_required') !== null ? (bool) data_get($item, 'pivot.is_required') : null,
                    'price' => data_get($item, 'pivot.price') ?? ($item['price'] ?? null),
                    'expected_cost' => data_get($item, 'pivot.cost_price') ?? ($item['expected_cost'] ?? $item['cost_price'] ?? null),
                    'variant_id' => $variantId,
                    'variant_sku' => $selectedVariant['sku'] ?? null,
                    'variant_name' => $selectedVariant['name'] ?? null,
                    'option_title' => $type === 'bundle' ? (trim((string) (data_get($item, 'pivot.option_title') ?? '')) ?: null) : null,
                    'option_post_id' => $type === 'bundle' ? $optionPostId : null,
                    'option_post_title' => $type === 'bundle' ? (trim((string) (data_get($item, 'pivot.option_post_title') ?? '')) ?: null) : null,
                    'option_post_slug' => $type === 'bundle' ? (trim((string) (data_get($item, 'pivot.option_post_slug') ?? '')) ?: null) : null,
                    'is_default' => $type === 'bundle' && data_get($item, 'pivot.is_default') !== null ? (bool) data_get($item, 'pivot.is_default') : null,
                ], static fn ($value) => $value !== null && $value !== '');
            })
            ->filter(fn (array $item) => !empty($item['product_id']) || !empty($item['sku']))
            ->values()
            ->all();

        return !empty($items)
            ? json_encode($items, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            : '';
    }

    private function resolveProductExportImageUrl(mixed $value): string
    {
        $rawValue = trim((string) $value);
        if ($rawValue === '') {
            return '';
        }

        if (preg_match('#^https?://#i', $rawValue) === 1) {
            return $rawValue;
        }

        if (str_starts_with($rawValue, '//')) {
            return 'https:' . $rawValue;
        }

        if ($this->looksLikeManagedProductImagePath($rawValue)) {
            return $this->resolveProductManagedImagePublicUrl($rawValue);
        }

        return $rawValue;
    }

    private function normalizeProductImageArray(array $images): array
    {
        return collect($images)
            ->filter(fn ($image) => is_array($image))
            ->sortBy([
                fn (array $image) => empty($image['is_primary']) ? 1 : 0,
                fn (array $image) => (int) ($image['sort_order'] ?? 0),
                fn (array $image) => (int) ($image['id'] ?? 0),
            ])
            ->values()
            ->all();
    }

    private function decodeSpreadsheetJsonValue(mixed $value): mixed
    {
        if (!is_string($value)) {
            return $value;
        }

        $trimmed = trim($value);
        if ($trimmed === '') {
            return '';
        }

        try {
            return json_decode($trimmed, true, 512, JSON_THROW_ON_ERROR);
        } catch (Throwable $exception) {
            return $trimmed;
        }
    }

    private function resolveProductExportDomain(array $product, Collection $domains): string
    {
        $domain = $this->normalizeDomainValue((string) data_get($product, 'site_domain.domain', ''));
        if ($domain !== '') {
            return $domain;
        }

        $requestedDomainId = (int) ($product['site_domain_id'] ?? 0);
        if ($requestedDomainId > 0) {
            $matchedDomain = $domains->first(fn (SiteDomain $siteDomain) => (int) $siteDomain->id === $requestedDomainId);
            if ($matchedDomain) {
                return $this->normalizeDomainValue($matchedDomain->domain);
            }
        }

        return $this->normalizeDomainValue($this->resolveDefaultDomainForProduct($product, $domains)?->domain);
    }

    private function buildProductPageUrlFromArray(array $product, Collection $domains, ?string $fallbackBaseUrl): string
    {
        $slug = trim((string) ($product['slug'] ?? ''));
        $identifier = $slug !== '' ? $slug : trim((string) ($product['id'] ?? ''));

        if ($identifier === '') {
            return '';
        }

        $path = self::PRODUCT_DETAIL_PATH . '/' . rawurlencode($identifier);
        $domain = $this->resolveProductExportDomain($product, $domains);

        if ($domain !== '') {
            return 'https://' . $domain . $path;
        }

        if ($fallbackBaseUrl) {
            return rtrim($fallbackBaseUrl, '/') . $path;
        }

        return $path;
    }

    private function resolveDefaultDomainForProduct(array $product, Collection $domains): ?SiteDomain
    {
        $accountId = (int) ($product['account_id'] ?? 0);
        $relevantDomains = $domains
            ->filter(function (SiteDomain $siteDomain) use ($accountId) {
                if ($accountId <= 0) {
                    return true;
                }

                return (int) $siteDomain->account_id === $accountId;
            })
            ->values();

        return $relevantDomains->first(fn (SiteDomain $siteDomain) => (bool) $siteDomain->is_default)
            ?? $relevantDomains->first();
    }

    private function resolveProductAttributeExportValue(array $product, int $attributeId): string
    {
        return collect($product['attribute_values'] ?? [])
            ->filter(fn ($value) => (int) ($value['attribute_id'] ?? 0) === $attributeId)
            ->map(fn ($value) => $this->formatProductSpreadsheetValue($value['value'] ?? ''))
            ->filter()
            ->implode(', ');
    }

    private function formatProductSpreadsheetValue(mixed $value): string
    {
        if ($value === null) {
            return '';
        }

        if (is_array($value)) {
            return collect($value)
                ->map(function ($item) {
                    if (is_array($item)) {
                        if (array_key_exists('label', $item) || array_key_exists('value', $item)) {
                            $label = trim((string) ($item['label'] ?? ''));
                            $cellValue = trim((string) ($item['value'] ?? ''));
                            return trim($label . ($label !== '' && $cellValue !== '' ? ': ' : '') . $cellValue);
                        }

                        return json_encode($item, JSON_UNESCAPED_UNICODE);
                    }

                    return trim((string) $item);
                })
                ->filter()
                ->implode(', ');
        }

        if (!is_string($value)) {
            return trim((string) $value);
        }

        $trimmed = trim($value);
        if ($trimmed === '') {
            return '';
        }

        try {
            $decoded = json_decode($trimmed, true, 512, JSON_THROW_ON_ERROR);
            if (is_array($decoded)) {
                return $this->formatProductSpreadsheetValue($decoded);
            }
        } catch (Throwable $exception) {
            // Keep original plain-text value.
        }

        return $trimmed;
    }

    private function resolveProductImportHeaderMap(array $headerRow): array
    {
        $aliases = [
            'id' => ['id'],
            'sku' => ['sku', 'ma_sp', 'ma_san_pham'],
            'slug' => ['slug', 'duong_dan', 'url_key'],
            'product_link' => ['link_san_pham', 'link_sp', 'duong_link_san_pham', 'url_san_pham'],
            'name' => ['ten_san_pham', 'ten_sp', 'name'],
            'type' => ['loai_san_pham', 'loai_hinh', 'type'],
            'category' => ['danh_muc', 'category'],
            'price' => ['gia', 'price'],
            'special_price' => ['gia_ban_uu_dai', 'gia_khuyen_mai', 'special_price', 'sale_price'],
            'expected_cost' => ['gia_du_kien', 'gia_nhap_du_kien', 'expected_cost', 'cost_price'],
            'stock_quantity' => ['ton_kho', 'so_luong_ton', 'stock_quantity'],
            'status' => ['dang_ban', 'trang_thai_ban', 'status'],
            'is_featured' => ['noi_bat', 'featured', 'is_featured'],
            'is_new' => ['moi', 'is_new'],
            'domain' => ['domain', 'ten_mien', 'site_domain'],
            'description' => ['mo_ta', 'description', 'noi_dung'],
            'video_url' => ['video_url', 'video', 'link_video'],
            'specifications' => ['thong_so', 'thong_so_ky_thuat', 'specifications'],
            'additional_info' => ['thong_tin_bo_sung', 'additional_info'],
            'meta_title' => ['seo_title', 'meta_title'],
            'meta_description' => ['seo_description', 'meta_description'],
            'meta_keywords' => ['seo_keywords', 'meta_keywords'],
            'weight' => ['khoi_luong', 'weight'],
            'bundle_title' => ['tieu_de_bundle', 'bundle_title'],
            'child_skus' => ['ma_sp_con', 'child_skus', 'sku_con'],
            'component_data' => ['thanh_phan_bundle_grouped', 'component_data', 'grouped_items', 'bundle_items'],
            'attributes' => ['thuoc_tinh', 'attributes', 'custom_attributes'],
            'primary_image_url' => ['anh_dai_dien', 'anh_chinh', 'main_image', 'primary_image', 'primary_image_url'],
            'gallery_image_urls' => ['thu_vien_anh', 'gallery_images', 'gallery_image_urls', 'anh_thu_vien'],
            'variant_data' => ['bien_the', 'variants', 'variant_data', 'du_lieu_bien_the'],
        ];

        $normalizedHeaders = array_map(
            fn ($cellValue) => $this->normalizeImportHeader((string) $cellValue),
            $headerRow
        );
        $hasExplicitRegularPriceHeader = !empty(array_intersect($normalizedHeaders, ['gia', 'price']));
        $headerMap = [];

        foreach ($normalizedHeaders as $index => $normalized) {
            if ($normalized === '') {
                continue;
            }

            // Legacy templates used "Gia ban" for the base price, while newer export files
            // use "Gia" for base price and "Gia ban" for sale price. Support both layouts.
            if ($normalized === 'gia_ban') {
                $targetField = $hasExplicitRegularPriceHeader ? 'special_price' : 'price';

                if (!isset($headerMap[$targetField])) {
                    $headerMap[$targetField] = $index;
                }

                continue;
            }

            foreach ($aliases as $field => $patterns) {
                if (in_array($normalized, $patterns, true) && !isset($headerMap[$field])) {
                    $headerMap[$field] = $index;
                }
            }
        }

        return $headerMap;
    }

    private function validateProductImportRows(array $rows, Request $request): array
    {
        if (empty($rows)) {
            return [[], [[
                'row' => 1,
                'column' => 'File',
                'message' => 'File Excel không có dữ liệu.',
            ]]];
        }

        $headerMap = $this->resolveProductImportHeaderMap($rows[0] ?? []);
        if (!isset($headerMap['name']) && !isset($headerMap['sku']) && !isset($headerMap['id']) && !isset($headerMap['slug']) && !isset($headerMap['product_link'])) {
            return [[], [[
                'row' => 1,
                'column' => 'Tiêu đề cột',
                'message' => 'File import cần có ít nhất một cột định danh (ID, SKU, Slug, Link sản phẩm) hoặc cột Tên sản phẩm.',
            ]]];
        }

        $products = Product::query()
            ->get([
                'id',
                'sku',
                'slug',
                'name',
                'type',
                'category_id',
                'site_domain_id',
                'price',
                'expected_cost',
                'stock_quantity',
                'status',
                'is_featured',
                'is_new',
                'video_url',
                'specifications',
                'bundle_title',
            ]);

        $productLookup = [
            'by_id' => $products->keyBy(fn (Product $product) => (int) $product->id),
            'by_sku' => $products
                ->filter(fn (Product $product) => filled($product->sku))
                ->keyBy(fn (Product $product) => $this->normalizeImportLookupValue((string) $product->sku)),
            'by_slug' => $products
                ->filter(fn (Product $product) => filled($product->slug))
                ->keyBy(fn (Product $product) => $this->normalizeImportLookupValue((string) $product->slug)),
        ];

        $categories = Category::query()->get(['id', 'name', 'code', 'slug']);
        $categoryLookup = [
            'by_id' => $categories->keyBy(fn (Category $category) => (int) $category->id),
            'by_code' => $categories
                ->filter(fn (Category $category) => filled($category->code))
                ->keyBy(fn (Category $category) => Category::normalizeCode((string) $category->code)),
            'by_slug' => $categories
                ->filter(fn (Category $category) => filled($category->slug))
                ->keyBy(fn (Category $category) => $this->normalizeImportLookupValue((string) $category->slug)),
            'by_name' => $categories->groupBy(fn (Category $category) => $this->normalizeImportLookupValue((string) $category->name)),
        ];

        $siteDomains = $this->resolveScopedSiteDomains($request);
        $siteDomainLookup = [
            'by_id' => $siteDomains->keyBy(fn (SiteDomain $siteDomain) => (int) $siteDomain->id),
            'by_domain' => $siteDomains->keyBy(fn (SiteDomain $siteDomain) => $this->normalizeDomainValue((string) $siteDomain->domain)),
        ];

        $records = [];
        $errors = [];

        foreach (array_slice($rows, 1) as $index => $row) {
            $rowNumber = $index + 2;

            if ($this->shouldSkipProductImportRow($row)) {
                continue;
            }

            $rowErrors = [];
            $productId = $this->parseImportedProductId($this->importCellValue($row, $headerMap, 'id'), $rowNumber, $rowErrors);
            $rawSku = trim($this->importCellValue($row, $headerMap, 'sku'));
            $rawSlug = trim($this->importCellValue($row, $headerMap, 'slug'));
            $rawProductLink = trim($this->importCellValue($row, $headerMap, 'product_link'));
            $rawName = trim($this->importCellValue($row, $headerMap, 'name'));
            $rawType = trim($this->importCellValue($row, $headerMap, 'type'));
            $rawCategory = trim($this->importCellValue($row, $headerMap, 'category'));
            $rawDomain = trim($this->importCellValue($row, $headerMap, 'domain'));
            $rawVideoUrl = trim($this->importCellValue($row, $headerMap, 'video_url'));
            $rawSpecifications = trim($this->importCellValue($row, $headerMap, 'specifications'));
            $rawBundleTitle = trim($this->importCellValue($row, $headerMap, 'bundle_title'));
            $linkIdentifier = $this->extractProductIdentifierFromUrl($rawProductLink);
            $slugFromLink = ($rawSlug === '' && $linkIdentifier !== null && !ctype_digit($linkIdentifier))
                ? $linkIdentifier
                : '';

            $existingProduct = $this->resolveImportedProductMatch(
                $productLookup,
                $productId,
                $rawSku,
                $rawSlug !== '' ? $rawSlug : $slugFromLink,
                $linkIdentifier,
                $rowNumber,
                $rowErrors
            );

            [$resolvedType, $typeProvided] = $this->parseImportedProductType(
                $rawType,
                $existingProduct?->type,
                $rowNumber,
                $rowErrors
            );

            if (!$existingProduct && $rawName === '') {
                $rowErrors[] = $this->importError($rowNumber, 'Tên sản phẩm', 'Tên sản phẩm là bắt buộc khi tạo mới.');
            }

            $fields = [];

            if ($rawName !== '') {
                $fields['name'] = $rawName;
            }

            if ($rawSku !== '') {
                $fields['sku'] = $rawSku;
            }

            if ($rawSlug !== '') {
                $fields['slug'] = $rawSlug;
            } elseif ($slugFromLink !== '') {
                $fields['slug'] = $slugFromLink;
            }

            if ($typeProvided) {
                $fields['type'] = $resolvedType;
            }

            if ($rawCategory !== '') {
                $fields['category_id'] = $this->isImportNullishValue($rawCategory)
                    ? null
                    : $this->resolveImportedCategoryId($rawCategory, $categoryLookup, $rowNumber, $rowErrors);
            }

            if ($rawDomain !== '') {
                $fields['site_domain_id'] = $this->isImportNullishValue($rawDomain)
                    ? null
                    : $this->resolveImportedSiteDomainId($rawDomain, $siteDomainLookup, $rowNumber, $rowErrors);
            }

            [$priceProvided, $priceValue] = $this->parseImportedOptionalNumber(
                $this->importCellValue($row, $headerMap, 'price'),
                $rowNumber,
                'Giá bán',
                $rowErrors
            );
            if ($priceProvided) {
                $fields['price'] = $priceValue;
            }

            [$expectedCostProvided, $expectedCostValue] = $this->parseImportedOptionalNumber(
                $this->importCellValue($row, $headerMap, 'expected_cost'),
                $rowNumber,
                'Giá dự kiến',
                $rowErrors
            );
            if ($expectedCostProvided) {
                $fields['expected_cost'] = $expectedCostValue;
            }

            [$stockProvided, $stockValue] = $this->parseImportedOptionalInteger(
                $this->importCellValue($row, $headerMap, 'stock_quantity'),
                $rowNumber,
                'Tồn kho',
                $rowErrors
            );
            if ($stockProvided) {
                $fields['stock_quantity'] = $stockValue;
            }

            [$statusProvided, $statusValue] = $this->parseImportedOptionalBoolean(
                $this->importCellValue($row, $headerMap, 'status'),
                $rowNumber,
                'Đang bán',
                $rowErrors
            );
            if ($statusProvided) {
                $fields['status'] = $statusValue;
            }

            [$featuredProvided, $featuredValue] = $this->parseImportedOptionalBoolean(
                $this->importCellValue($row, $headerMap, 'is_featured'),
                $rowNumber,
                'Nổi bật',
                $rowErrors
            );
            if ($featuredProvided) {
                $fields['is_featured'] = $featuredValue;
            }

            [$newProvided, $newValue] = $this->parseImportedOptionalBoolean(
                $this->importCellValue($row, $headerMap, 'is_new'),
                $rowNumber,
                'Mới',
                $rowErrors
            );
            if ($newProvided) {
                $fields['is_new'] = $newValue;
            }

            if ($rawVideoUrl !== '') {
                $fields['video_url'] = $this->isImportNullishValue($rawVideoUrl) ? null : $rawVideoUrl;
            }

            if ($rawSpecifications !== '') {
                $fields['specifications'] = $this->isImportNullishValue($rawSpecifications) ? null : $rawSpecifications;
            }

            if ($rawBundleTitle !== '') {
                $fields['bundle_title'] = $this->isImportNullishValue($rawBundleTitle) ? null : $rawBundleTitle;
            }

            if (!empty($rowErrors)) {
                $errors = array_merge($errors, $rowErrors);
                continue;
            }

            $records[] = [
                'row_number' => $rowNumber,
                'existing_id' => $existingProduct ? (int) $existingProduct->id : null,
                'fields' => $fields,
                'type' => $resolvedType,
            ];
        }

        return [$records, $errors];
    }

    private function applyProductImport(array $records): array
    {
        $summary = [
            'created' => 0,
            'updated' => 0,
            'skipped' => 0,
        ];

        foreach ($records as $record) {
            $fields = $record['fields'];

            if ($record['existing_id']) {
                $product = Product::query()->findOrFail((int) $record['existing_id']);

                if (empty($fields)) {
                    $summary['skipped']++;
                    continue;
                }

                if (array_key_exists('sku', $fields)) {
                    $fields['sku'] = $this->productSkuService->ensureUniqueSku(
                        $fields['sku'],
                        $fields['name'] ?? $product->name,
                        $product->id
                    );
                }

                if (array_key_exists('slug', $fields)) {
                    $slugSeed = $fields['slug'] !== '' ? $fields['slug'] : ($fields['name'] ?? $product->name);
                    $fields['slug'] = $this->productSkuService->generateUniqueSlug($slugSeed, $product->id);
                }

                if (array_key_exists('video_url', $fields)) {
                    $fields['video_url'] = $this->normalizeVideoUrl($fields['video_url']);
                }

                $fillableFields = collect($fields)
                    ->except(['category_id'])
                    ->all();

                if (!empty($fillableFields)) {
                    $product->fill($fillableFields);
                }

                if (array_key_exists('category_id', $fields)) {
                    $product->category_id = $fields['category_id'];
                }

                $product->save();

                if (array_key_exists('category_id', $fields)) {
                    $categoryId = $fields['category_id'];
                    $this->syncProductCategories($product, $categoryId ? [(int) $categoryId] : []);
                }

                if (array_key_exists('expected_cost', $fields)) {
                    $this->productPricingService->syncExpectedCost(
                        $product,
                        $product->expected_cost,
                        $product->supplier_id,
                        auth()->id()
                    );
                }

                $summary['updated']++;
                continue;
            }

            $name = trim((string) ($fields['name'] ?? ''));
            $type = (string) ($record['type'] ?? 'simple');
            $sku = array_key_exists('sku', $fields)
                ? $this->productSkuService->ensureUniqueSku($fields['sku'], $name)
                : $this->productSkuService->ensureUniqueSku(null, $name);
            $slugSeed = trim((string) ($fields['slug'] ?? $name));

            $product = Product::query()->create([
                'type' => $type,
                'name' => $name,
                'sku' => $sku,
                'slug' => $this->productSkuService->generateUniqueSlug($slugSeed),
                'price' => $fields['price'] ?? 0,
                'expected_cost' => $fields['expected_cost'] ?? null,
                'stock_quantity' => $fields['stock_quantity'] ?? 0,
                'status' => $fields['status'] ?? true,
                'is_featured' => $fields['is_featured'] ?? false,
                'is_new' => $fields['is_new'] ?? true,
                'category_id' => $fields['category_id'] ?? null,
                'site_domain_id' => $fields['site_domain_id'] ?? null,
                'video_url' => array_key_exists('video_url', $fields) ? $this->normalizeVideoUrl($fields['video_url']) : null,
                'specifications' => $fields['specifications'] ?? null,
                'bundle_title' => $fields['bundle_title'] ?? null,
            ]);

            if (array_key_exists('category_id', $fields) && !empty($fields['category_id'])) {
                $this->syncProductCategories($product, [(int) $fields['category_id']]);
            }

            if (array_key_exists('expected_cost', $fields)) {
                $this->productPricingService->syncExpectedCost(
                    $product,
                    $product->expected_cost,
                    $product->supplier_id,
                    auth()->id()
                );
            }

            $summary['created']++;
        }

        return $summary;
    }

    private function resolveImportedProductMatch(
        array $lookup,
        ?int $productId,
        string $sku,
        string $slug,
        ?string $linkIdentifier,
        int $rowNumber,
        array &$errors
    ): ?Product {
        $candidates = [];

        if ($productId !== null) {
            $matchedById = $lookup['by_id']->get($productId);
            if (!$matchedById) {
                $errors[] = $this->importError($rowNumber, 'ID', 'Không tìm thấy sản phẩm theo ID đã nhập.');
            } else {
                $candidates[(int) $matchedById->id] = $matchedById;
            }
        }

        if ($sku !== '') {
            $matchedBySku = $lookup['by_sku']->get($this->normalizeImportLookupValue($sku));
            if ($matchedBySku) {
                $candidates[(int) $matchedBySku->id] = $matchedBySku;
            }
        }

        if ($slug !== '') {
            $matchedBySlug = $lookup['by_slug']->get($this->normalizeImportLookupValue($slug));
            if ($matchedBySlug) {
                $candidates[(int) $matchedBySlug->id] = $matchedBySlug;
            }
        }

        if ($linkIdentifier !== null && $linkIdentifier !== '') {
            $matchedByLink = null;

            if (ctype_digit($linkIdentifier)) {
                $matchedByLink = $lookup['by_id']->get((int) $linkIdentifier);
            }

            if (!$matchedByLink) {
                $matchedByLink = $lookup['by_slug']->get($this->normalizeImportLookupValue($linkIdentifier));
            }

            if ($matchedByLink) {
                $candidates[(int) $matchedByLink->id] = $matchedByLink;
            }
        }

        if (count($candidates) > 1) {
            $errors[] = $this->importError(
                $rowNumber,
                'ID / SKU / Slug / Link sản phẩm',
                'Các định danh đang trỏ tới nhiều sản phẩm khác nhau. Vui lòng giữ lại đúng một định danh hợp lệ cho mỗi dòng.'
            );
            return null;
        }

        return !empty($candidates) ? array_values($candidates)[0] : null;
    }

    private function resolveImportedCategoryId(string $value, array $lookup, int $rowNumber, array &$errors): ?int
    {
        [$mode, $needle] = $this->splitImportReferenceToken($value);

        if (($mode === 'id' || ($mode === null && ctype_digit($needle))) && $needle !== '') {
            $category = $lookup['by_id']->get((int) $needle);
            if ($category) {
                return (int) $category->id;
            }

            $errors[] = $this->importError($rowNumber, 'Danh mục', 'Không tìm thấy danh mục theo ID đã nhập.');
            return null;
        }

        if (($mode === 'code' || $mode === null) && $needle !== '') {
            $normalizedCode = Category::normalizeCode($needle);
            if ($normalizedCode !== null) {
                $category = $lookup['by_code']->get($normalizedCode);
                if ($category) {
                    return (int) $category->id;
                }

                if ($mode === 'code') {
                    $errors[] = $this->importError($rowNumber, 'Danh mục', 'Không tìm thấy danh mục theo mã đã nhập.');
                    return null;
                }
            }
        }

        if (($mode === 'slug' || $mode === null) && $needle !== '') {
            $category = $lookup['by_slug']->get($this->normalizeImportLookupValue($needle));
            if ($category) {
                return (int) $category->id;
            }

            if ($mode === 'slug') {
                $errors[] = $this->importError($rowNumber, 'Danh mục', 'Không tìm thấy danh mục theo slug đã nhập.');
                return null;
            }
        }

        $candidates = $lookup['by_name']->get($this->normalizeImportLookupValue($needle), collect());
        if ($candidates->count() === 1) {
            return (int) $candidates->first()->id;
        }

        if ($candidates->count() > 1) {
            $errors[] = $this->importError($rowNumber, 'Danh mục', 'Tên danh mục đang bị trùng. Vui lòng dùng CODE:... hoặc ID:... để chỉ rõ.');
            return null;
        }

        $errors[] = $this->importError($rowNumber, 'Danh mục', 'Không tìm thấy danh mục phù hợp.');
        return null;
    }

    private function resolveImportedSiteDomainId(string $value, array $lookup, int $rowNumber, array &$errors): ?int
    {
        [$mode, $needle] = $this->splitImportReferenceToken($value);
        $normalizedDomain = $this->normalizeDomainValue($needle);

        if (($mode === 'id' || ($mode === null && ctype_digit($needle))) && $needle !== '') {
            $siteDomain = $lookup['by_id']->get((int) $needle);
            if ($siteDomain) {
                return (int) $siteDomain->id;
            }

            $errors[] = $this->importError($rowNumber, 'Domain', 'Không tìm thấy domain theo ID đã nhập.');
            return null;
        }

        if ($normalizedDomain !== '') {
            $siteDomain = $lookup['by_domain']->get($normalizedDomain);
            if ($siteDomain) {
                return (int) $siteDomain->id;
            }

            if ($mode === null) {
                return null;
            }
        }

        $errors[] = $this->importError($rowNumber, 'Domain', 'Không tìm thấy domain phù hợp trong hệ thống.');
        return null;
    }

    private function resolveScopedSiteDomains(Request $request): Collection
    {
        $query = SiteDomain::query()->where('is_active', true);
        $accountId = $request->header('X-Account-Id');

        if (is_numeric($accountId) && (int) $accountId > 0) {
            $query->where('account_id', (int) $accountId);
        }

        return $query
            ->orderByDesc('is_default')
            ->orderBy('id')
            ->get(['id', 'account_id', 'domain', 'is_active', 'is_default']);
    }

    private function parseImportedProductType(
        string $value,
        ?string $existingType,
        int $rowNumber,
        array &$errors
    ): array {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return [$existingType ?: 'simple', false];
        }

        $normalized = match ($this->normalizeImportLookupValue($trimmed)) {
            'simple', 'don_gian', 'san_pham_don' => 'simple',
            'virtual', 'ao' => 'virtual',
            'downloadable', 'tai_xuong' => 'downloadable',
            'configurable', 'co_bien_the', 'san_pham_co_bien_the' => 'configurable',
            'grouped', 'nhom', 'nhom_san_pham' => 'grouped',
            'bundle', 'bo_combo', 'combo', 'bo' => 'bundle',
            default => null,
        };

        if ($normalized === null) {
            $errors[] = $this->importError(
                $rowNumber,
                'Loại sản phẩm',
                'Loại sản phẩm chỉ hỗ trợ simple, virtual, downloadable, configurable, grouped hoặc bundle khi import.'
            );
            return [$existingType ?: 'simple', false];
        }

        if ($existingType !== null && $normalized !== $existingType) {
            $errors[] = $this->importError(
                $rowNumber,
                'Loại sản phẩm',
                'Import Excel chưa hỗ trợ đổi loại sản phẩm hiện có. Hãy để trống cột này hoặc giữ đúng loại hiện tại.'
            );
            return [$existingType, false];
        }

        if ($existingType === null && in_array($normalized, ['configurable', 'grouped', 'bundle'], true)) {
            return [$normalized, true];
        }

        if ($existingType === null && !in_array($normalized, ['simple', 'virtual', 'downloadable'], true)) {
            $errors[] = $this->importError(
                $rowNumber,
                'Loại sản phẩm',
                'Tạo mới qua Excel hiện hỗ trợ simple, virtual, downloadable, configurable, grouped hoặc bundle.'
            );
            return ['simple', false];
        }

        return [$normalized, true];
    }

    private function parseImportedOptionalNumber(string $value, int $rowNumber, string $column, array &$errors): array
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return [false, null];
        }

        $normalized = str_replace([',', ' '], '', $trimmed);
        if (!is_numeric($normalized)) {
            $errors[] = $this->importError($rowNumber, $column, 'Giá trị phải là số hợp lệ.');
            return [false, null];
        }

        return [true, (float) $normalized];
    }

    private function parseImportedOptionalInteger(string $value, int $rowNumber, string $column, array &$errors): array
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return [false, null];
        }

        $normalized = str_replace(' ', '', $trimmed);
        if (str_contains($normalized, ',') && !str_contains($normalized, '.')) {
            $normalized = str_replace(',', '.', $normalized);
        } else {
            $normalized = str_replace(',', '', $normalized);
        }

        if (!is_numeric($normalized)) {
            $errors[] = $this->importError($rowNumber, $column, 'Giá trị phải là số hợp lệ.');
            return [false, null];
        }

        return [true, InventoryQuantity::normalize($normalized)];
    }

    private function parseImportedOptionalBoolean(string $value, int $rowNumber, string $column, array &$errors): array
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return [false, null];
        }

        $normalized = $this->normalizeImportLookupValue($trimmed);
        $resolved = match ($normalized) {
            '1', 'true', 'yes', 'co', 'dang_ban', 'ban', 'active', 'noi_bat', 'moi' => true,
            '0', 'false', 'no', 'khong', 'tam_an', 'an', 'inactive' => false,
            default => null,
        };

        if ($resolved === null) {
            $errors[] = $this->importError($rowNumber, $column, 'Giá trị chỉ hợp lệ với 1 hoặc 0.');
            return [false, null];
        }

        return [true, $resolved];
    }

    private function parseImportedProductId(string $value, int $rowNumber, array &$errors): ?int
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return null;
        }

        if (!ctype_digit($trimmed)) {
            $errors[] = $this->importError($rowNumber, 'ID', 'ID phải là số nguyên dương.');
            return null;
        }

        return (int) $trimmed;
    }

    private function extractProductIdentifierFromUrl(?string $value): ?string
    {
        $trimmed = trim((string) $value);
        if ($trimmed === '') {
            return null;
        }

        $path = parse_url($trimmed, PHP_URL_PATH);
        if (!is_string($path) || trim($path) === '') {
            $path = $trimmed;
        }

        $segments = array_values(array_filter(explode('/', trim($path, '/')), fn ($segment) => $segment !== ''));
        if (empty($segments)) {
            return null;
        }

        $productSegment = trim(self::PRODUCT_DETAIL_PATH, '/');
        $productIndex = array_search($productSegment, $segments, true);
        $identifier = $productIndex !== false && isset($segments[$productIndex + 1])
            ? $segments[$productIndex + 1]
            : end($segments);

        $identifier = urldecode((string) $identifier);

        return $identifier !== '' ? $identifier : null;
    }

    private function normalizeDomainValue(?string $value): string
    {
        $trimmed = trim((string) $value);
        if ($trimmed === '') {
            return '';
        }

        $host = parse_url($trimmed, PHP_URL_HOST);
        if (is_string($host) && $host !== '') {
            $trimmed = $host;
        }

        $trimmed = preg_replace('#^https?://#i', '', $trimmed) ?? '';
        $trimmed = explode('/', $trimmed)[0] ?? $trimmed;

        return trim($trimmed, " \t\n\r\0\x0B/");
    }

    private function resolveProductLinkFallbackBaseUrl(Request $request): ?string
    {
        $origin = trim((string) $request->headers->get('origin', ''));
        if ($origin !== '' && preg_match('#^https?://#i', $origin) === 1) {
            return rtrim($origin, '/');
        }

        $appUrl = trim((string) config('app.url'));
        if ($appUrl !== '' && preg_match('#^https?://#i', $appUrl) === 1) {
            return rtrim($appUrl, '/');
        }

        return null;
    }

    private function shouldSkipProductImportRow(array $row): bool
    {
        $values = array_map(fn ($value) => trim((string) $value), $row);
        $nonEmptyValues = array_values(array_filter($values, fn ($value) => $value !== ''));

        if (empty($nonEmptyValues)) {
            return true;
        }

        return str_starts_with($nonEmptyValues[0], '#');
    }

    private function importCellValue(array $row, array $headerMap, string $field): string
    {
        $index = $headerMap[$field] ?? null;
        return $index === null ? '' : trim((string) ($row[$index] ?? ''));
    }

    private function splitImportReferenceToken(string $value): array
    {
        $trimmed = trim($value);
        if (preg_match('/^(id|code|name|slug)\s*:\s*(.+)$/i', $trimmed, $matches) === 1) {
            return [Str::lower($matches[1]), trim($matches[2])];
        }

        return [null, $trimmed];
    }

    private function normalizeImportHeader(string $value): string
    {
        return trim((string) Str::of(Str::ascii($value))
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', '_'), '_');
    }

    private function normalizeImportLookupValue(string $value): string
    {
        return trim((string) Str::of(Str::ascii($value))
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', '_'), '_');
    }

    private function isImportNullishValue(string $value): bool
    {
        return in_array($this->normalizeImportLookupValue($value), ['null', 'none', 'clear', 'xoa'], true);
    }

    private function importError(int $row, string $column, string $message): array
    {
        return [
            'row' => $row,
            'column' => $column,
            'message' => $message,
        ];
    }

    private function xlsxDownloadResponse(string $filename, array $sheets)
    {
        $binary = SimpleXlsx::buildWorkbook($sheets);

        return response($binary, 200, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'Cache-Control' => 'no-store, no-cache, must-revalidate',
        ]);
    }

    protected function normalizeVideoUrlCandidate(?string $value): string
    {
        $normalized = trim(html_entity_decode((string) $value, ENT_QUOTES | ENT_HTML5, 'UTF-8'));

        if ($normalized === '') {
            return '';
        }

        if (Str::startsWith($normalized, '//')) {
            return 'https:' . $normalized;
        }

        if (preg_match('/^(?:www\.|m\.youtube\.com|youtube\.com|youtu\.be|youtube-nocookie\.com)/i', $normalized)) {
            return 'https://' . ltrim($normalized, '/');
        }

        return $normalized;
    }

    protected function extractYouTubeVideoId(?string $value): ?string
    {
        $normalized = $this->normalizeVideoUrlCandidate($value);

        if ($normalized === '') {
            return null;
        }

        $fallbackMatch = [];
        preg_match(
            '/(?:youtube(?:-nocookie)?\.com\/(?:watch\?.*?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i',
            $normalized,
            $fallbackMatch
        );

        $parts = parse_url($normalized);

        if ($parts !== false) {
            $host = Str::lower((string) ($parts['host'] ?? ''));
            $path = trim((string) ($parts['path'] ?? ''), '/');

            if (Str::contains($host, 'youtu.be') && $path !== '') {
                $segments = explode('/', $path);

                return $segments[0] ?: ($fallbackMatch[1] ?? null);
            }

            if (Str::contains($host, 'youtube.com') || Str::contains($host, 'youtube-nocookie.com')) {
                if (!empty($parts['query'])) {
                    parse_str($parts['query'], $queryParams);

                    if (!empty($queryParams['v'])) {
                        return (string) $queryParams['v'];
                    }
                }

                $segments = array_values(array_filter(explode('/', $path)));
                $embedIndex = array_search('embed', $segments, true);
                $liveIndex = array_search('live', $segments, true);
                $shortsIndex = array_search('shorts', $segments, true);
                $targetIndex = $embedIndex !== false ? $embedIndex : ($liveIndex !== false ? $liveIndex : $shortsIndex);

                if ($targetIndex !== false && !empty($segments[$targetIndex + 1])) {
                    return $segments[$targetIndex + 1];
                }
            }
        }

        return $fallbackMatch[1] ?? null;
    }

    protected function normalizeVideoUrl(?string $value): ?string
    {
        $normalized = $this->normalizeVideoUrlCandidate($value);

        if ($normalized === '') {
            return null;
        }

        $videoId = $this->extractYouTubeVideoId($normalized);

        if ($videoId) {
            return 'https://www.youtube.com/watch?v=' . $videoId;
        }

        return $normalized;
    }

    protected function normalizeVideoUrlsPayload($rawValue, ?string $legacyVideoUrl = null): array
    {
        if (is_string($rawValue)) {
            $trimmed = trim($rawValue);
            if ($trimmed !== '' && str_starts_with($trimmed, '[')) {
                $decoded = json_decode($trimmed, true);
                $rawValue = is_array($decoded) ? $decoded : [];
            } elseif ($trimmed !== '') {
                $rawValue = preg_split('/\r\n|\r|\n/', $trimmed) ?: [];
            } else {
                $rawValue = [];
            }
        }

        $items = is_array($rawValue) ? $rawValue : [];
        if (empty($items) && filled($legacyVideoUrl)) {
            $items = [$legacyVideoUrl];
        }

        $seen = [];
        return collect($items)
            ->map(function ($item, int $index) {
                $title = '';
                if (is_array($item)) {
                    $title = trim((string) ($item['title'] ?? $item['name'] ?? ''));
                    $item = $item['url'] ?? $item['video_url'] ?? '';
                }

                $url = $this->normalizeVideoUrl(is_string($item) ? $item : (string) $item);
                if (!$url) {
                    return null;
                }

                return [
                    'title' => $title !== '' ? $title : 'Video ' . ($index + 1),
                    'url' => $url,
                ];
            })
            ->filter()
            ->filter(function (array $video) use (&$seen) {
                $key = Str::lower($video['url']);
                if (isset($seen[$key])) {
                    return false;
                }

                $seen[$key] = true;
                return true;
            })
            ->values()
            ->all();
    }

    protected function prepareVideoUrlsForPersistence(Request $request, array &$validated): void
    {
        if ($request->has('video_urls')) {
            $videoUrls = $this->normalizeVideoUrlsPayload(
                $request->input('video_urls'),
                $request->input('video_url')
            );

            $validated['video_urls'] = !empty($videoUrls) ? $videoUrls : null;
            $validated['video_url'] = $videoUrls[0]['url'] ?? null;
            return;
        }

        if ($request->has('video_url') || array_key_exists('video_url', $validated)) {
            $videoUrl = $this->normalizeVideoUrl($validated['video_url'] ?? null);
            $validated['video_url'] = $videoUrl;
            $validated['video_urls'] = $videoUrl ? [['title' => 'Video 1', 'url' => $videoUrl]] : null;
        }
    }

    protected function normalizeAdditionalInfoItem($item, string $attribute = 'additional_info'): ?array
    {
        if (is_object($item)) {
            $item = (array) $item;
        }

        if (!is_array($item)) {
            throw ValidationException::withMessages([
                $attribute => ['Du lieu "Thong tin bo sung" khong hop le.'],
            ]);
        }

        $rawPostId = $item['post_id'] ?? null;
        if (filled($rawPostId) && !is_numeric($rawPostId)) {
            throw ValidationException::withMessages([
                $attribute => ['Bai viet lien ket khong hop le.'],
            ]);
        }

        $postId = filled($rawPostId) ? (int) $rawPostId : null;

        return [
            'title' => trim((string) ($item['title'] ?? '')),
            'display_text' => trim((string) ($item['display_text'] ?? '')),
            'post_id' => $postId,
            'post_title' => trim((string) ($item['post_title'] ?? '')),
            'post_slug' => trim((string) ($item['post_slug'] ?? '')),
        ];
    }

    protected function normalizeAdditionalInfoPayload($rawValue, string $attribute = 'additional_info'): array
    {
        if ($rawValue === null || $rawValue === '' || $rawValue === []) {
            return [];
        }

        if (is_string($rawValue)) {
            $decoded = json_decode($rawValue, true);

            if (json_last_error() !== JSON_ERROR_NONE) {
                throw ValidationException::withMessages([
                    $attribute => ['Du lieu "Thong tin bo sung" khong dung dinh dang JSON.'],
                ]);
            }

            $rawValue = $decoded;
        }

        if (!is_array($rawValue)) {
            throw ValidationException::withMessages([
                $attribute => ['Du lieu "Thong tin bo sung" khong hop le.'],
            ]);
        }

        return collect($rawValue)
            ->map(fn ($item) => $this->normalizeAdditionalInfoItem($item, $attribute))
            ->filter(fn ($item) => $this->hasMeaningfulAdditionalInfoItem($item))
            ->values()
            ->all();
    }

    protected function hasMeaningfulAdditionalInfoItem(?array $item): bool
    {
        if (!is_array($item)) {
            return false;
        }

        if (!empty($item['post_id'])) {
            return true;
        }

        foreach (['title', 'display_text', 'post_title', 'post_slug'] as $field) {
            if (filled($item[$field] ?? null)) {
                return true;
            }
        }

        return false;
    }

    protected function normalizeImportedAdditionalInfoPayload(
        $rawValue,
        Request $request,
        string $attribute = 'additional_info'
    ): array {
        $items = $this->normalizeAdditionalInfoPayload($rawValue, $attribute);

        if (empty($items)) {
            return [];
        }

        $accountId = (int) $request->header('X-Account-Id');
        $postIds = collect($items)
            ->pluck('post_id')
            ->filter()
            ->map(fn ($postId) => (int) $postId)
            ->unique()
            ->values()
            ->all();
        $postSlugs = collect($items)
            ->map(fn (array $item) => trim((string) ($item['post_slug'] ?? '')))
            ->filter()
            ->unique()
            ->values()
            ->all();

        $postsById = Post::query()
            ->when($accountId > 0, fn (Builder $query) => $query->where('account_id', $accountId))
            ->whereIn('id', $postIds)
            ->get(['id', 'title', 'slug'])
            ->keyBy(fn (Post $post) => (int) $post->id);
        $postsBySlug = Post::query()
            ->when($accountId > 0, fn (Builder $query) => $query->where('account_id', $accountId))
            ->whereIn('slug', $postSlugs)
            ->get(['id', 'title', 'slug'])
            ->keyBy(fn (Post $post) => $this->normalizeImportLookupValue((string) $post->slug));

        return collect($items)
            ->map(function (array $item) use ($postsById, $postsBySlug) {
                $postId = filled($item['post_id'] ?? null) ? (int) $item['post_id'] : null;

                if ($postId && $postsById->has($postId)) {
                    $matchedPost = $postsById->get($postId);
                    $item['post_id'] = (int) $matchedPost->id;
                    $item['post_title'] = trim((string) ($item['post_title'] ?? '')) !== ''
                        ? $item['post_title']
                        : trim((string) $matchedPost->title);
                    $item['post_slug'] = trim((string) ($item['post_slug'] ?? '')) !== ''
                        ? $item['post_slug']
                        : trim((string) $matchedPost->slug);

                    return $item;
                }

                $normalizedPostSlug = $this->normalizeImportLookupValue((string) ($item['post_slug'] ?? ''));
                if ($normalizedPostSlug !== '' && $postsBySlug->has($normalizedPostSlug)) {
                    $matchedPost = $postsBySlug->get($normalizedPostSlug);
                    $item['post_id'] = (int) $matchedPost->id;
                    $item['post_title'] = trim((string) $matchedPost->title);
                    $item['post_slug'] = trim((string) $matchedPost->slug);

                    return $item;
                }

                $item['post_id'] = null;

                return $item;
            })
            ->filter(fn (array $item) => $this->hasMeaningfulAdditionalInfoItem($item))
            ->values()
            ->all();
    }

    protected function stripInvalidAdditionalInfoPostLinks(array $items, Request $request): array
    {
        $postIds = collect($items)
            ->pluck('post_id')
            ->filter()
            ->map(fn ($postId) => (int) $postId)
            ->unique()
            ->values();

        if ($postIds->isEmpty()) {
            return $items;
        }

        $query = Post::query()->whereIn('id', $postIds->all());
        $accountId = (int) $request->header('X-Account-Id');

        if ($accountId > 0) {
            $query->where('account_id', $accountId);
        }

        $resolvedIds = $query
            ->pluck('id')
            ->map(fn ($postId) => (int) $postId)
            ->unique()
            ->flip();

        return collect($items)
            ->map(function (array $item) use ($resolvedIds) {
                $postId = filled($item['post_id'] ?? null) ? (int) $item['post_id'] : null;

                if ($postId && !$resolvedIds->has($postId)) {
                    $item['post_id'] = null;
                    $item['post_slug'] = '';
                }

                unset($item['post_invalid'], $item['post_error']);

                return $item;
            })
            ->filter(fn (array $item) => $this->hasMeaningfulAdditionalInfoItem($item))
            ->values()
            ->all();
    }

    protected function prepareAdditionalInfoForPersistence(Request $request, array &$payload, string $requestKey = 'additional_info', string $attribute = 'additional_info'): void
    {
        if (!$request->exists($requestKey) && !array_key_exists($requestKey, $payload)) {
            return;
        }

        $rawValue = array_key_exists($requestKey, $payload)
            ? $payload[$requestKey]
            : $request->input($requestKey);

        $normalized = $this->normalizeAdditionalInfoPayload($rawValue, $attribute);
        $normalized = $this->stripInvalidAdditionalInfoPostLinks($normalized, $request);

        $payload[$requestKey] = !empty($normalized)
            ? json_encode($normalized, JSON_UNESCAPED_UNICODE)
            : null;
    }

    protected function normalizeSpecificationItem($item, string $attribute = 'specifications'): ?array
    {
        if (is_object($item)) {
            $item = (array) $item;
        }

        if (!is_array($item)) {
            throw ValidationException::withMessages([
                $attribute => ['Du lieu "Bang thong so ky thuat" khong hop le.'],
            ]);
        }

        return [
            'label' => trim((string) ($item['label'] ?? '')),
            'value' => trim((string) ($item['value'] ?? '')),
        ];
    }

    protected function normalizeSpecificationsPayload(
        $rawValue,
        string $attribute = 'specifications',
        bool $allowLegacyText = true
    ): array {
        if ($rawValue === null || $rawValue === '' || $rawValue === []) {
            return [];
        }

        if (is_string($rawValue)) {
            $trimmed = trim($rawValue);

            if ($trimmed === '') {
                return [];
            }

            $decoded = json_decode($trimmed, true);

            if (json_last_error() === JSON_ERROR_NONE) {
                $rawValue = $decoded;
            } elseif ($allowLegacyText) {
                return collect(preg_split('/\r\n|\r|\n/u', $trimmed) ?: [])
                    ->map(function ($line) use ($attribute) {
                        $line = trim((string) $line);

                        if ($line === '') {
                            return null;
                        }

                        [$labelPart, $valuePart] = array_pad(explode(':', $line, 2), 2, '');

                        return $this->normalizeSpecificationItem([
                            'label' => $labelPart,
                            'value' => $valuePart,
                        ], $attribute);
                    })
                    ->filter(fn ($item) => !empty($item['label']) || !empty($item['value']))
                    ->values()
                    ->all();
            } else {
                throw ValidationException::withMessages([
                    $attribute => ['Du lieu "Bang thong so ky thuat" khong dung dinh dang JSON.'],
                ]);
            }
        }

        if (!is_array($rawValue)) {
            throw ValidationException::withMessages([
                $attribute => ['Du lieu "Bang thong so ky thuat" khong hop le.'],
            ]);
        }

        return collect($rawValue)
            ->map(fn ($item) => $this->normalizeSpecificationItem($item, $attribute))
            ->filter(fn ($item) => !empty($item['label']) || !empty($item['value']))
            ->values()
            ->all();
    }

    protected function parsePersistedSpecificationsPayload($rawValue): array
    {
        try {
            return $this->normalizeSpecificationsPayload($rawValue, 'specifications', true);
        } catch (ValidationException $exception) {
            return [];
        }
    }

    protected function parsePersistedAdditionalInfoPayload($rawValue): array
    {
        try {
            return $this->normalizeAdditionalInfoPayload($rawValue, 'additional_info');
        } catch (ValidationException $exception) {
            return [];
        }
    }

    protected function normalizeStructuredMergeKey($value): string
    {
        return (string) Str::of((string) $value)
            ->ascii()
            ->lower()
            ->replaceMatches('/\s+/u', ' ')
            ->trim();
    }

    protected function resolveSpecificationMergeKey(array $item): string
    {
        $labelKey = $this->normalizeStructuredMergeKey($item['label'] ?? '');

        if ($labelKey !== '') {
            return 'label:' . $labelKey;
        }

        $valueKey = $this->normalizeStructuredMergeKey($item['value'] ?? '');

        return $valueKey !== '' ? 'value:' . $valueKey : '';
    }

    protected function mergeSpecificationsPayload($rawExistingValue, array $incomingItems): ?string
    {
        $merged = $this->parsePersistedSpecificationsPayload($rawExistingValue);
        $indexByKey = [];

        foreach ($merged as $index => $item) {
            $mergeKey = $this->resolveSpecificationMergeKey($item);

            if ($mergeKey !== '' && !array_key_exists($mergeKey, $indexByKey)) {
                $indexByKey[$mergeKey] = $index;
            }
        }

        foreach ($incomingItems as $item) {
            $mergeKey = $this->resolveSpecificationMergeKey($item);

            if ($mergeKey !== '' && array_key_exists($mergeKey, $indexByKey)) {
                $merged[$indexByKey[$mergeKey]] = $item;
                continue;
            }

            $merged[] = $item;

            if ($mergeKey !== '') {
                $indexByKey[$mergeKey] = array_key_last($merged);
            }
        }

        return !empty($merged)
            ? json_encode(array_values($merged), JSON_UNESCAPED_UNICODE)
            : null;
    }

    protected function resolveAdditionalInfoMergeKey(array $item): string
    {
        $postId = isset($item['post_id']) ? (int) $item['post_id'] : 0;

        if ($postId > 0) {
            return 'post:' . $postId;
        }

        $titleKey = $this->normalizeStructuredMergeKey($item['title'] ?? '');
        $displayKey = $this->normalizeStructuredMergeKey($item['display_text'] ?? '');

        if ($titleKey === '' && $displayKey === '') {
            return '';
        }

        return 'fallback:' . $titleKey . '|' . $displayKey;
    }

    protected function mergeAdditionalInfoPayload($rawExistingValue, array $incomingItems): ?string
    {
        $merged = $this->parsePersistedAdditionalInfoPayload($rawExistingValue);
        $indexByKey = [];

        foreach ($merged as $index => $item) {
            $mergeKey = $this->resolveAdditionalInfoMergeKey($item);

            if ($mergeKey !== '' && !array_key_exists($mergeKey, $indexByKey)) {
                $indexByKey[$mergeKey] = $index;
            }
        }

        foreach ($incomingItems as $item) {
            $mergeKey = $this->resolveAdditionalInfoMergeKey($item);

            if ($mergeKey !== '' && array_key_exists($mergeKey, $indexByKey)) {
                $merged[$indexByKey[$mergeKey]] = $item;
                continue;
            }

            $merged[] = $item;

            if ($mergeKey !== '') {
                $indexByKey[$mergeKey] = array_key_last($merged);
            }
        }

        return !empty($merged)
            ? json_encode(array_values($merged), JSON_UNESCAPED_UNICODE)
            : null;
    }


    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $this->mergeStructuredProductPayloads($request);

        $validated = $request->validate([
            'type' => 'required|string|in:simple,configurable,grouped,virtual,bundle,downloadable',
            'name' => 'required|string|max:255',
            'category_id' => 'nullable|exists:categories,id',
            'category_ids' => 'nullable|array',
            'category_ids.*' => 'exists:categories,id',
            'clear_category_ids' => 'nullable|boolean',
            'price' => $this->shouldAutoCalculateCompositePrice($request)
                ? 'nullable|numeric|min:0'
                : 'required|numeric|min:0',
            'price_type' => 'nullable|string|in:fixed,sum',
            'expected_cost' => 'nullable|numeric|min:0',
            'cost_price' => 'nullable|numeric|min:0',
            'special_price' => 'nullable|numeric|min:0',
            'special_price_from' => 'nullable|date',
            'special_price_to' => 'nullable|date',
            'description' => 'nullable|string',
            'is_featured' => 'boolean',
            'is_new' => 'boolean',
            'stock_quantity' => 'numeric|min:0',
            'weight' => 'nullable|string',
            'inventory_unit_id' => 'nullable|exists:inventory_units,id',
            'sku' => 'nullable|string|max:120',
            'meta_title' => 'nullable|string',
            'meta_description' => 'nullable|string',
            'meta_keywords' => 'nullable|string',
            'specifications' => 'nullable|string',
            'additional_info' => 'nullable',
            'status' => 'nullable|boolean',
            'video_url' => 'nullable|string|max:2048',
            'video_urls' => 'nullable',
            'slug' => 'nullable|string|max:255|unique:products,slug',
            'bundle_title' => 'nullable|string|max:255',
            'site_domain_id' => 'nullable|exists:site_domains,id',
            'supplier_id' => ['nullable', $this->supplierExistsRule($request)],
            'supplier_ids' => 'nullable|array',
            'supplier_ids.*' => ['nullable', $this->supplierExistsRule($request)],
            'linked_product_ids' => 'nullable|array',
            'link_type' => 'nullable|string',
            'grouped_items' => 'nullable|array',
            'grouped_items.*.id' => 'required|exists:products,id',
            'grouped_items.*.quantity' => 'required|integer|min:1',
            'grouped_items.*.is_required' => 'required|boolean',
            'grouped_items.*.variant_id' => 'nullable|exists:products,id',
            'grouped_items.*.option_title' => 'nullable|string',
            'grouped_items.*.option_post_id' => 'nullable|exists:posts,id',
            'grouped_items.*.bundle_option_uid' => 'nullable|string|max:64',
            'grouped_items.*.bundle_option_status' => 'nullable|string|in:visible,internal',
            'grouped_items.*.option_image_url' => 'nullable|string|max:2048',
            'grouped_items.*.option_video_url' => 'nullable|string|max:2048',
            'grouped_items.*.option_video_source' => 'nullable|string|max:32',
            'grouped_items.*.is_default' => 'nullable|boolean',
            'grouped_items.*.price' => 'nullable|numeric|min:0',
            'grouped_items.*.cost_price' => 'nullable|numeric|min:0',
            'super_attribute_ids' => 'nullable|array',
            'super_attribute_ids.*' => 'exists:attributes,id',
            'custom_attributes' => 'nullable|array',
            'main_image' => 'nullable|image',
            'images' => 'nullable|array',
            'images.*' => 'image',
            'variants' => 'nullable|array',
            'variants.*.id' => 'nullable|integer',
            'variants.*.sku' => 'nullable|string|max:120',
            'variants.*.name' => 'nullable|string|max:255',
            'variants.*.price' => 'nullable|numeric|min:0',
            'variants.*.expected_cost' => 'nullable|numeric|min:0',
            'variants.*.weight' => 'nullable|string',
            'variants.*.inventory_unit_id' => 'nullable|exists:inventory_units,id',
            'variants.*.stock_quantity' => 'nullable|numeric|min:0',
            'variants.*.status' => 'nullable|boolean',
            'variants.*.is_default' => 'nullable|boolean',
            'variants.*.image' => 'nullable|image|mimes:jpeg,png,jpg,gif,webp|max:5120',
            'variants.*.library_image_id' => 'nullable|integer',
            'variants.*.image_reference_url' => 'nullable|string|max:2048',
            'variants.*.remove_image' => 'nullable|boolean',
            'variants.*.attributes' => 'nullable|array',
        ], [
            'type.required' => 'Vui lòng chọn loại sản phẩm.',
            'name.required' => 'Vui lòng nhập tên tác phẩm nghệ thuật.',
            'price.required' => 'Vui lòng nhập giá bán.',
            'stock_quantity.numeric' => 'Số lượng tồn kho phải là số hợp lệ.',
            'slug.unique' => 'Đường dẫn (slug) này đã tồn tại, vui lòng chọn tên khác.',
        ]);
        $this->applyLegacyExpectedCostAlias($request, $validated);
        $this->applyCompositeAutoPrice($request, $validated);
        $this->prepareAdditionalInfoForPersistence($request, $validated);
        $this->prepareOptionalStockQuantityForPersistence($request, $validated);

        $validated['slug'] = $this->productSkuService->generateUniqueSlug(
            !empty($validated['slug']) ? $validated['slug'] : $validated['name']
        );
        $this->prepareVideoUrlsForPersistence($request, $validated);

        $categoryIds = $request->boolean('clear_category_ids')
            ? []
            : $this->normalizeCategoryIds($request, $validated);
        $validated['category_id'] = $categoryIds[0] ?? null;

        $supplierIds = $this->normalizeSupplierIds($request, $validated);
        $validated['supplier_id'] = $supplierIds[0] ?? null;
        unset($validated['category_ids'], $validated['clear_category_ids'], $validated['supplier_ids']);

        if (!empty($validated['grouped_items']) && in_array($validated['type'] ?? null, ['grouped', 'bundle'], true)) {
            $this->validateGroupedOrBundleItemVariants($validated['grouped_items']);
        }

        try {
            $product = DB::transaction(function () use ($request, $validated, $categoryIds, $supplierIds) {
                $accountId = $request->header('X-Account-Id');
                $this->prepareProductSku($validated);
                $preparedVariants = $validated['type'] === 'configurable'
                    ? $this->prepareVariantPayloads($request->input('variants', []), $validated['sku'])
                    : [];
                $defaultVariantIndex = $this->resolveDefaultVariantIndex($preparedVariants);

                $product = Product::create(array_merge($validated, [
                    'account_id' => $accountId,
                    'sort_order' => $this->nextProductSortOrder(is_numeric($accountId) ? (int) $accountId : null),
                ]));
                $this->syncProductSuppliers($product, $supplierIds);
                $this->productPricingService->syncExpectedCost(
                    $product,
                    $validated['expected_cost'] ?? null,
                    $product->supplier_id,
                    auth()->id()
                );

                $this->syncProductCategories($product, $categoryIds);

                if ($request->hasFile('main_image')) {
                    $imageFile = $request->file('main_image');
                    $this->createProductImageRecord($product, $imageFile, 0, true);
                }

                if ($request->hasFile('images')) {
                    foreach ($request->file('images') as $idx => $image) {
                        $isPrimary = (!$request->hasFile('main_image')) && ($idx === 0);
                        $sortOrder = $request->hasFile('main_image') ? $idx + 1 : $idx;

                        $this->createProductImageRecord($product, $image, $sortOrder, $isPrimary);
                    }
                }

                if ($request->has('custom_attributes')) {
                    $validAttrIds = \App\Models\Attribute::whereIn('id', array_keys($request->custom_attributes))->pluck('id')->toArray();
                    foreach ($request->custom_attributes as $attrId => $val) {
                        if (!in_array($attrId, $validAttrIds)) {
                            continue;
                        }

                        $rawValue = is_array($val) ? json_encode($val) : $val;
                        \App\Models\ProductAttributeValue::create([
                            'product_id' => $product->id,
                            'attribute_id' => $attrId,
                            'value' => $rawValue,
                        ]);
                    }
                }

                if ($request->has('linked_product_ids')) {
                    $type = $request->get('link_type', 'related');
                    $links = [];
                    foreach ($request->linked_product_ids as $idx => $idOrObj) {
                        if (is_array($idOrObj)) {
                            if (!empty($idOrObj['id'])) {
                                $links[$idOrObj['id']] = [
                                    'link_type' => $type,
                                    'position' => $idx,
                                    'option_title' => $idOrObj['option_title'] ?? null,
                                ];
                            }
                        } elseif (!empty($idOrObj)) {
                            $links[$idOrObj] = ['link_type' => $type, 'position' => $idx];
                        }
                    }

                    if (!empty($links)) {
                        $product->linkedProducts()->syncWithoutDetaching($links);
                    }
                }

                if ($request->has('grouped_items') && in_array($product->type, ['grouped', 'bundle'], true)) {
                    $linkType = $product->type === 'bundle' ? 'bundle' : 'grouped';
                    $existingBundleOptionUids = $product->type === 'bundle'
                        ? $this->loadExistingBundleOptionUids($product)
                        : [];

                    if ($product->type === 'bundle') {
                        $product->bundleItems()->detach();
                    } else {
                        $product->groupedItems()->detach();
                    }

                    $bundleOptionUids = [];

                    foreach ($request->grouped_items as $idx => $item) {
                        $bundleOptionUid = null;
                        if ($product->type === 'bundle') {
                            $bundleOptionUid = $this->resolveBundleOptionUidForItem($item, $bundleOptionUids, $existingBundleOptionUids);
                        }

                        $pivotData = [
                            'quantity' => $item['quantity'],
                            'is_required' => $item['is_required'],
                            'link_type' => $linkType,
                            'position' => $idx,
                            'option_title' => $item['option_title'] ?? null,
                            'option_post_id' => $item['option_post_id'] ?? null,
                            'bundle_option_uid' => $bundleOptionUid,
                            'bundle_option_status' => $product->type === 'bundle'
                                ? $this->normalizeBundleOptionStatus($item['bundle_option_status'] ?? null)
                                : self::BUNDLE_OPTION_STATUS_VISIBLE,
                            'option_image_url' => $item['option_image_url'] ?? null,
                            'option_video_url' => $this->normalizeVideoUrl($item['option_video_url'] ?? null),
                            'option_video_source' => $item['option_video_source'] ?? null,
                            'is_default' => $item['is_default'] ?? false,
                            'variant_id' => $item['variant_id'] ?? null,
                            'price' => $item['price'] ?? null,
                            'cost_price' => $item['cost_price'] ?? null,
                        ];

                        if ($product->type === 'bundle') {
                            $product->bundleItems()->attach($item['id'], $pivotData);
                        } else {
                            $product->groupedItems()->attach($item['id'], $pivotData);
                        }
                    }
                }

                $this->syncCompositeAutoPrice($product);

                if ($request->has('super_attribute_ids') && $product->type === 'configurable') {
                    $attrs = [];
                    foreach ($request->super_attribute_ids as $idx => $id) {
                        $attrs[$id] = ['position' => $idx];
                    }
                    $product->superAttributes()->sync($attrs);
                }

                if (!empty($preparedVariants) && $product->type === 'configurable') {
                    foreach ($preparedVariants as $idx => $vData) {
                        $variantProduct = Product::create([
                            'account_id' => $product->account_id,
                            'type' => 'simple',
                            'name' => $vData['name'] ?? ($product->name . ' - ' . ($vData['sku'] ?? 'Variant')),
                            'sku' => $vData['sku'],
                            'price' => $vData['price'] ?? $product->price,
                            'expected_cost' => $vData['expected_cost'] ?? null,
                            'weight' => $vData['weight'] ?? null,
                            'inventory_unit_id' => $vData['inventory_unit_id'] ?? $product->inventory_unit_id,
                            'supplier_id' => $product->supplier_id,
                            'stock_quantity' => $vData['stock_quantity'] ?? 0,
                            'category_id' => $product->category_id,
                            'status' => array_key_exists('status', $vData)
                                ? (filter_var($vData['status'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false)
                                : ($product->status ?? true),
                        ]);
                        $this->syncProductSuppliers($variantProduct, $supplierIds);
                        $this->productPricingService->syncExpectedCost(
                            $variantProduct,
                            $vData['expected_cost'] ?? null,
                            $variantProduct->supplier_id,
                            auth()->id()
                        );

                        $this->applyVariantImageSelection($request, $product, $variantProduct, $vData, $idx);

                        $product->linkedProducts()->attach($variantProduct->id, [
                            'link_type' => 'super_link',
                            'position' => $idx,
                            'is_default' => $defaultVariantIndex !== null && $idx === $defaultVariantIndex,
                        ]);

                        if (isset($vData['attributes'])) {
                            $validVariantAttrIds = \App\Models\Attribute::whereIn('id', array_keys($vData['attributes']))->pluck('id')->toArray();
                            foreach ($vData['attributes'] as $attrId => $val) {
                                if (!in_array($attrId, $validVariantAttrIds)) {
                                    continue;
                                }

                                \App\Models\ProductAttributeValue::create([
                                    'product_id' => $variantProduct->id,
                                    'attribute_id' => $attrId,
                                    'value' => $val,
                                ]);
                            }
                        }
                    }
                }

                $this->syncSuppliersToVariants($product, $supplierIds);
                $this->productParentRetailPriceSyncService->syncProductAndParents($product);
                $product->refresh();

                return $product;
            });
        } catch (QueryException $exception) {
            $this->throwSkuConstraintValidation($exception, 'Đã phát hiện mã SKU bị trùng trong quá trình lưu. Vui lòng kiểm tra lại mã sản phẩm và biến thể.');
        }

        $this->queueGoogleMerchantProductSync($product);
        $this->queueProductReviewAiGeneration($product);

        return response()->json($this->loadProductResource($product), 201);
    }

    /**
     * Display the specified resource.
     */
    public function show(Request $request, $id)
    {
        $isEditContext = $this->isProductEditContext($request);
        $relations = $this->productResourceRelations(! $isEditContext);
        $product = Product::with($relations)->findOrFail($id);

        if (in_array($product->type, ['configurable', 'bundle'], true)
            && $this->productParentRetailPriceSyncService->syncParentProduct($product)
        ) {
            $product = Product::with($relations)->findOrFail($id);
        }

        if ($product->type === 'configurable') {
            // Use all linked variants for the admin edit screen, including out-of-stock rows.
            $variations = $product->linkedProducts()
                ->wherePivot('link_type', 'super_link')
                ->with('attributeValues')
                ->get();

            $usedValuesByAttr = [];
            foreach ($variations as $v) {
                foreach ($v->attributeValues as $av) {
                    $usedValuesByAttr[$av->attribute_id][] = $av->value;
                }
            }

            // Keep only options that are actually used by linked variants.
            $filteredSuperAttributes = $product->superAttributes->filter(function($attribute) use ($usedValuesByAttr) {
                $relevantValues = array_unique($usedValuesByAttr[$attribute->id] ?? []);
                if (empty($relevantValues)) return false;

                $filteredOptions = $attribute->options->filter(function($opt) use ($relevantValues) {
                    return in_array($opt->value, $relevantValues);
                })->values();

                $attribute->setRelation('options', $filteredOptions);
                return $filteredOptions->count() > 0;
            })->values();

            $product->setRelation('superAttributes', $filteredSuperAttributes);

            // Also expose ALL variations (including out of stock ones if needed,
            // but for filtering we might want to know about them, or just keep what's returned by linkedProducts)
            // Re-fetch all variations to ensure we have the full list for frontend logic if it needs to show "out of stock" instead of hiding
            // But user said "không có hàng... phải ẩn hẳn", so let's stick to in-stock variations for selection logic.
            $product->setRelation('variations', $variations);
        }

        $product = $this->appendSupplierMeta($product);

        if ($isEditContext) {
            $product = $this->trimAdminProductEditPayload($product);
        }

        return response()->json(
            $this->syncProductResourceInventoryStocks($request, $product)
        );
    }

    public function refreshOrderItems(Request $request)
    {
        $validated = $request->validate([
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|integer',
            'items.*.sku' => 'nullable|string|max:120',
            'items.*.name' => 'nullable|string|max:255',
        ]);

        $requestedItems = collect($validated['items'])
            ->map(function (array $item) {
                return [
                    'product_id' => (int) $item['product_id'],
                    'sku' => trim((string) ($item['sku'] ?? '')),
                    'name' => trim((string) ($item['name'] ?? '')),
                ];
            })
            ->filter(fn (array $item) => $item['product_id'] > 0)
            ->unique('product_id')
            ->values();

        $products = Product::withTrashed()
            ->select(['id', 'sku', 'name', 'price', 'cost_price', 'expected_cost', 'status', 'deleted_at', 'inventory_unit_id'])
            ->with([
                'unit:id,name',
                'attributeValues:id,product_id,attribute_id,value',
                'parentConfigurable' => fn ($query) => $query
                    ->withTrashed()
                    ->select('products.id', 'products.name', 'products.inventory_unit_id')
                    ->with(['unit:id,name']),
            ])
            ->whereIn('id', $requestedItems->pluck('product_id')->all())
            ->get()
            ->keyBy('id');
        $inventorySnapshotMap = $this->buildInventorySnapshotMap(
            $request,
            $requestedItems->pluck('product_id')->all()
        );

        $items = [];
        $issues = [];

        foreach ($requestedItems as $requestedItem) {
            $productId = $requestedItem['product_id'];
            /** @var Product|null $product */
            $product = $products->get($productId);

            if (!$product) {
                $issues[] = [
                    'product_id' => $productId,
                    'sku' => $requestedItem['sku'] ?: null,
                    'name' => $requestedItem['name'] ?: "Sản phẩm #{$productId}",
                    'reason' => 'missing',
                    'message' => 'Sản phẩm không còn tồn tại hoặc không thuộc tài khoản hiện tại.',
                ];
                continue;
            }

            $parentProduct = $product->parentConfigurable->first();
            $optionLabel = $parentProduct ? $this->pickerAttributeSummary($product) : '';
            $displayName = $this->buildOrderItemDisplayName($product, $parentProduct);

            $items[] = [
                'product_id' => (int) $product->id,
                'sku' => $product->sku,
                'display_sku' => $product->sku,
                'name' => $product->name,
                'display_name' => $displayName,
                'entry_kind' => $parentProduct ? 'variation' : 'product',
                'parent_product_id' => $parentProduct?->id ? (int) $parentProduct->id : null,
                'parent_product_name' => $parentProduct ? (string) $parentProduct->name : '',
                'inventory_unit_id' => $product->inventory_unit_id !== null
                    ? (int) $product->inventory_unit_id
                    : ($parentProduct?->inventory_unit_id !== null ? (int) $parentProduct->inventory_unit_id : null),
                'unit_name' => $product->unit?->name ?? $parentProduct?->unit?->name,
                'option_label' => $optionLabel,
                'variant_name' => $product->name,
                'price' => (float) ($product->price ?? 0),
                'expected_cost' => $product->expected_cost !== null ? (float) $product->expected_cost : null,
                'cost_price' => (float) ($product->cost_price ?? $product->expected_cost ?? 0),
                'status' => (bool) $product->status,
                'deleted' => $product->trashed(),
            ] + $this->resolveInventorySnapshotPayload($inventorySnapshotMap, (int) $product->id);

            if ($product->trashed()) {
                $issues[] = [
                    'product_id' => (int) $product->id,
                    'sku' => $product->sku,
                    'name' => $displayName !== '' ? $displayName : $product->name,
                    'reason' => 'deleted',
                    'message' => 'Sản phẩm đã bị xóa khỏi kho.',
                ];
                continue;
            }

            if (!(bool) $product->status) {
                $issues[] = [
                    'product_id' => (int) $product->id,
                    'sku' => $product->sku,
                    'name' => $product->name,
                    'reason' => 'inactive',
                    'message' => 'Sản phẩm đang ở trạng thái ngừng hoạt động.',
                ];
            }
        }
        return response()->json([
            'items' => $items,
            'issues' => $issues,
            'requested_count' => $requestedItems->count(),
            'refreshed_count' => count($items),
        ]);
    }

    public function convertToConfigurable(Request $request, $id)
    {
        $validated = $request->validate([
            'attribute_id' => 'nullable|exists:attributes,id',
            'attribute_name' => 'nullable|string|max:255',
            'parent_name' => 'nullable|string|max:255',
            'parent_sku' => 'nullable|string|max:120',
            'variants' => 'required|array|min:1',
            'variants.*.value' => 'required|string|max:255',
            'variants.*.name' => 'nullable|string|max:255',
            'variants.*.sku' => 'nullable|string|max:120',
            'variants.*.price' => 'nullable|numeric|min:0',
            'variants.*.expected_cost' => 'nullable|numeric|min:0',
            'variants.*.weight' => 'nullable|string|max:255',
            'variants.*.inventory_unit_id' => 'nullable|exists:inventory_units,id',
        ], [
            'variants.required' => 'Cần ít nhất một biến thể để chuyển đổi sản phẩm.',
            'variants.min' => 'Cần ít nhất một biến thể để chuyển đổi sản phẩm.',
        ]);

        $parent = DB::transaction(function () use ($request, $validated, $id) {
            $product = Product::query()
                ->with([
                    'images',
                    'attributeValues',
                    'categories:id',
                    'relatedProducts:id',
                    'suppliers:id',
                ])
                ->lockForUpdate()
                ->findOrFail($id);

            if ($product->type !== 'simple') {
                throw ValidationException::withMessages([
                    'product' => ['Chỉ có thể chuyển sản phẩm đơn thành sản phẩm có biến thể từ màn hình này.'],
                ]);
            }

            if ($product->parentConfigurable()->exists()) {
                throw ValidationException::withMessages([
                    'product' => ['Sản phẩm này đã là biến thể con của một sản phẩm cha khác.'],
                ]);
            }

            $parentName = trim((string) ($validated['parent_name'] ?? '')) ?: $product->name;
            $parentSkuSeed = $validated['parent_sku'] ?? ($product->sku ? ($product->sku . '-CFG') : null);
            $parentSku = $this->productSkuService->ensureUniqueSku(
                $parentSkuSeed,
                $parentName,
                null,
                array_values(array_filter([$product->sku]))
            );
            $preparedVariants = $this->prepareSimpleToConfigurableVariants(
                $product,
                (array) $request->input('variants', []),
                $parentSku
            );
            $attribute = $this->resolveConfigurableConversionAttribute(
                $product,
                isset($validated['attribute_id']) ? (int) $validated['attribute_id'] : null,
                $validated['attribute_name'] ?? null
            );
            $this->ensureVariantAttributeOptions($attribute, array_column($preparedVariants, 'value'));

            $supplierIds = $product->suppliers
                ->pluck('id')
                ->map(fn ($supplierId) => (int) $supplierId)
                ->filter()
                ->values()
                ->all();
            $categoryIds = $product->categories
                ->pluck('id')
                ->map(fn ($categoryId) => (int) $categoryId)
                ->filter()
                ->values()
                ->all();

            $parent = Product::query()->create(
                $this->buildConvertedParentPayload($product, $parentName, $parentSku)
            );

            if (!empty($supplierIds)) {
                $this->syncProductSuppliers($parent, $supplierIds);
            }

            if (!empty($categoryIds)) {
                $this->syncProductCategories($parent, $categoryIds);
            } elseif ($product->category_id) {
                $this->syncProductCategories($parent, [(int) $product->category_id]);
            }

            $this->cloneProductDecoratorsToParent($product, $parent, $attribute->id);
            $this->copyRelatedProductsToParent($product, $parent);
            $parent->superAttributes()->sync([
                $attribute->id => ['position' => 0],
            ]);

            $firstVariant = $preparedVariants[0];
            $product->forceFill([
                'name' => $firstVariant['name'],
                'sku' => $firstVariant['sku'],
                'price' => $firstVariant['price'] ?? $product->price,
                'expected_cost' => $firstVariant['expected_cost'] ?? $product->expected_cost,
                'weight' => $firstVariant['weight'] ?? $product->weight,
                'inventory_unit_id' => $firstVariant['inventory_unit_id'] ?? $product->inventory_unit_id,
            ])->save();

            if (!empty($supplierIds) || $firstVariant['expected_cost'] !== null) {
                $this->productPricingService->syncExpectedCost(
                    $product,
                    $firstVariant['expected_cost'] ?? $product->expected_cost,
                    $product->supplier_id,
                    auth()->id()
                );
                $product->refresh();
            }

            ProductAttributeValue::query()->updateOrCreate(
                [
                    'product_id' => $product->id,
                    'attribute_id' => $attribute->id,
                ],
                [
                    'value' => $firstVariant['value'],
                ]
            );

            $parent->linkedProducts()->attach($product->id, [
                'link_type' => 'super_link',
                'position' => 0,
            ]);

            foreach (array_slice($preparedVariants, 1) as $index => $variantData) {
                $variant = Product::query()->create([
                    'account_id' => $product->account_id,
                    'type' => 'simple',
                    'name' => $variantData['name'],
                    'slug' => $this->productSkuService->generateUniqueSlug($variantData['name']),
                    'description' => $product->description,
                    'specifications' => $product->specifications,
                    'price' => $variantData['price'] ?? $product->price,
                    'price_type' => 'fixed',
                    'cost_price' => null,
                    'expected_cost' => $variantData['expected_cost'] ?? $product->expected_cost,
                    'special_price' => null,
                    'special_price_from' => null,
                    'special_price_to' => null,
                    'imported_quantity_total' => 0,
                    'imported_value_total' => 0,
                    'category_id' => $product->category_id,
                    'stock_quantity' => 0,
                    'damaged_quantity' => 0,
                    'status' => $product->status,
                    'is_featured' => false,
                    'is_new' => false,
                    'sku' => $variantData['sku'],
                    'meta_title' => null,
                    'meta_description' => null,
                    'meta_keywords' => null,
                    'weight' => $variantData['weight'] ?? $product->weight,
                    'inventory_unit_id' => $variantData['inventory_unit_id'] ?? $product->inventory_unit_id,
                    'inventory_import_starred' => false,
                    'supplier_id' => $product->supplier_id,
                    'video_url' => null,
                    'additional_info' => null,
                    'bundle_title' => null,
                    'site_domain_id' => $product->site_domain_id,
                ]);

                if (!empty($supplierIds)) {
                    $this->syncProductSuppliers($variant, $supplierIds);
                }

                if (!empty($categoryIds)) {
                    $this->syncProductCategories($variant, $categoryIds);
                } elseif ($product->category_id) {
                    $this->syncProductCategories($variant, [(int) $product->category_id]);
                }

                $this->productPricingService->syncExpectedCost(
                    $variant,
                    $variantData['expected_cost'] ?? $product->expected_cost,
                    $variant->supplier_id,
                    auth()->id()
                );

                ProductAttributeValue::query()->create([
                    'product_id' => $variant->id,
                    'attribute_id' => $attribute->id,
                    'value' => $variantData['value'],
                ]);

                $parent->linkedProducts()->attach($variant->id, [
                    'link_type' => 'super_link',
                    'position' => $index + 1,
                ]);
            }

            $this->productParentRetailPriceSyncService->syncProductAndParents($parent);

            return $this->loadProductResource($parent->fresh());
        });

        return response()->json([
            'message' => 'Sản phẩm đã được chuyển thành sản phẩm có biến thể.',
            'data' => $parent,
            'parent_product_id' => (int) $parent->id,
        ]);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, $id)
    {
        $this->mergeStructuredProductPayloads($request);

        $product = Product::findOrFail($id);

        $validated = $request->validate([
            'type' => 'sometimes|required|string|in:simple,configurable,grouped,virtual,bundle,downloadable',
            'name' => 'sometimes|required|string|max:255',
            'category_id' => 'nullable|exists:categories,id',
            'category_ids' => 'nullable|array',
            'category_ids.*' => 'exists:categories,id',
            'clear_category_ids' => 'nullable|boolean',
            'price' => $this->shouldAutoCalculateCompositePrice($request, $product)
                ? 'nullable|numeric|min:0'
                : 'sometimes|required|numeric|min:0',
            'price_type' => 'nullable|string|in:fixed,sum',
            'expected_cost' => 'nullable|numeric|min:0',
            'cost_price' => 'nullable|numeric|min:0',
            'special_price' => 'nullable|numeric|min:0',
            'special_price_from' => 'nullable|date',
            'special_price_to' => 'nullable|date',
            'description' => 'nullable|string',
            'is_featured' => 'boolean',
            'is_new' => 'boolean',
            'stock_quantity' => 'sometimes|nullable|numeric|min:0',
            'weight' => 'nullable|string',
            'inventory_unit_id' => 'nullable|exists:inventory_units,id',
            'sku' => 'nullable|string|max:120',
            'status' => 'nullable|boolean',
            'meta_title' => 'nullable|string',
            'meta_description' => 'nullable|string',
            'meta_keywords' => 'nullable|string',
            'specifications' => 'nullable|string',
            'additional_info' => 'nullable',
            'video_url' => 'nullable|string|max:2048',
            'video_urls' => 'nullable',
            'slug' => 'nullable|string|max:255|unique:products,slug,' . $id,
            'bundle_title' => 'nullable|string|max:255',
            'site_domain_id' => 'nullable|exists:site_domains,id',
            'supplier_id' => ['nullable', $this->supplierExistsRule($request)],
            'supplier_ids' => 'nullable|array',
            'supplier_ids.*' => ['nullable', $this->supplierExistsRule($request)],
            'clear_supplier_ids' => 'nullable|boolean',
            'linked_product_ids' => 'nullable|array',
            'link_type' => 'nullable|string',
            'grouped_items' => 'nullable|array',
            'grouped_items.*.id' => 'required|exists:products,id',
            'grouped_items.*.quantity' => 'required|integer|min:1',
            'grouped_items.*.is_required' => 'required|boolean',
            'grouped_items.*.variant_id' => 'nullable|exists:products,id',
            'grouped_items.*.option_title' => 'nullable|string',
            'grouped_items.*.option_post_id' => 'nullable|exists:posts,id',
            'grouped_items.*.bundle_option_uid' => 'nullable|string|max:64',
            'grouped_items.*.bundle_option_status' => 'nullable|string|in:visible,internal',
            'grouped_items.*.option_image_url' => 'nullable|string|max:2048',
            'grouped_items.*.option_video_url' => 'nullable|string|max:2048',
            'grouped_items.*.option_video_source' => 'nullable|string|max:32',
            'grouped_items.*.is_default' => 'nullable|boolean',
            'grouped_items.*.price' => 'nullable|numeric|min:0',
            'grouped_items.*.cost_price' => 'nullable|numeric|min:0',
            'super_attribute_ids' => 'nullable|array',
            'super_attribute_ids.*' => 'exists:attributes,id',
            'sync_images' => 'nullable|boolean',
            'image_order' => 'nullable|array',
            'image_order.*' => 'nullable|string|max:80',
            'primary_image_token' => 'nullable|string|max:80',
            'images' => 'nullable|array',
            'images.*' => 'image|mimes:jpeg,png,jpg,gif,webp|max:5120',
            // EAV custom values
            'custom_attributes' => 'nullable|array',
            'variants' => 'nullable|array',
            'variants.*.id' => 'nullable|integer',
            'variants.*.sku' => 'nullable|string|max:120',
            'variants.*.name' => 'nullable|string|max:255',
            'variants.*.price' => 'nullable|numeric|min:0',
            'variants.*.expected_cost' => 'nullable|numeric|min:0',
            'variants.*.weight' => 'nullable|string',
            'variants.*.inventory_unit_id' => 'nullable|exists:inventory_units,id',
            'variants.*.stock_quantity' => 'nullable|numeric|min:0',
            'variants.*.status' => 'nullable|boolean',
            'variants.*.is_default' => 'nullable|boolean',
            'variants.*.image' => 'nullable|image|mimes:jpeg,png,jpg,gif,webp|max:5120',
            'variants.*.library_image_id' => 'nullable|integer',
            'variants.*.image_reference_url' => 'nullable|string|max:2048',
            'variants.*.remove_image' => 'nullable|boolean',
            'variants.*.attributes' => 'nullable|array',
        ], [
            'name.required' => 'Tên sản phẩm không được để trống.',
            'price.required' => 'Giá bán không được để trống.',
            'sku.unique' => 'Mã SKU này đã được sử dụng.',
            'slug.unique' => 'Đường dẫn (slug) này đã tồn tại, vui lòng chọn tên khác.',
            'slug.regex' => 'Đường dẫn chỉ được chứa chữ cái thường, số và dấu gạch ngang (VD: san-pham-1).',
        ]);
        $this->applyLegacyExpectedCostAlias($request, $validated);
        $this->applyCompositeAutoPrice($request, $validated, $product);
        $this->prepareAdditionalInfoForPersistence($request, $validated);
        $this->prepareOptionalStockQuantityForPersistence($request, $validated);

        $incomingCategoryIds = $request->has('category_ids') || $request->has('category_id') || $request->boolean('clear_category_ids');
        $categoryIds = $incomingCategoryIds
            ? ($request->boolean('clear_category_ids') ? [] : $this->normalizeCategoryIds($request, $validated))
            : collect([$product->category_id])
                ->merge($product->categories()->pluck('categories.id'))
                ->map(fn ($value) => is_numeric($value) ? (int) $value : null)
                ->filter()
                ->unique()
                ->values()
                ->all();

        if ($incomingCategoryIds) {
            $validated['category_id'] = $categoryIds[0] ?? null;
        }

        $incomingSupplierIds = $request->has('supplier_ids') || $request->has('supplier_id') || $request->boolean('clear_supplier_ids');
        $supplierIds = $incomingSupplierIds
            ? ($request->boolean('clear_supplier_ids') ? [] : $this->normalizeSupplierIds($request, $validated))
            : $product->suppliers()->pluck('suppliers.id')->map(fn ($value) => (int) $value)->values()->all();

        if ($incomingSupplierIds) {
            $validated['supplier_id'] = ($product->supplier_id && in_array((int) $product->supplier_id, $supplierIds, true))
                ? (int) $product->supplier_id
                : ($supplierIds[0] ?? null);
        }

        unset($validated['category_ids'], $validated['clear_category_ids'], $validated['supplier_ids'], $validated['clear_supplier_ids']);

        if (isset($validated['slug'])) {
            $validated['slug'] = $this->productSkuService->generateUniqueSlug(
                !empty($validated['slug']) ? $validated['slug'] : ($validated['name'] ?? $product->name),
                $product->id
            );
        }

        $this->prepareVideoUrlsForPersistence($request, $validated);

        $resolvedType = $validated['type'] ?? $product->type;
        if ($resolvedType === 'configurable' && $product->type !== 'configurable') {
            throw ValidationException::withMessages([
                'type' => ['Để chuyển sản phẩm hiện có thành sản phẩm có biến thể mà không làm lệch tồn kho và đơn hàng cũ, vui lòng dùng thao tác "Chuyển thành sản phẩm có biến thể".'],
            ]);
        }

        if (!empty($validated['grouped_items']) && in_array($resolvedType, ['grouped', 'bundle'], true)) {
            $this->validateGroupedOrBundleItemVariants($validated['grouped_items']);
        }

        $originalRetailPrice = $product->price;

        try {
            $product = DB::transaction(function () use ($request, $validated, $product, $incomingCategoryIds, $categoryIds, $incomingSupplierIds, $supplierIds, $originalRetailPrice) {
                $this->prepareProductSku($validated, $product);
                $resolvedType = $validated['type'] ?? $product->type;
                $preparedVariants = ($request->has('variants') && $resolvedType === 'configurable')
                    ? $this->prepareVariantPayloads($request->input('variants', []), $validated['sku'], $product)
                    : [];
                $defaultVariantIndex = $this->resolveDefaultVariantIndex($preparedVariants);

                $product->fill($validated);
                $nameChanged = $product->isDirty('name');
                $skuChanged = $product->isDirty('sku');
                $product->save();

                if ($incomingSupplierIds) {
                    $this->syncProductSuppliers($product, $supplierIds);
                }

                if ($incomingSupplierIds || array_key_exists('expected_cost', $validated)) {
                    $this->productPricingService->syncExpectedCost(
                        $product,
                        $validated['expected_cost'] ?? $product->expected_cost,
                        $product->supplier_id,
                        auth()->id()
                    );
                    $product->refresh();
                }

        // ─── Sync snapshots on all linked order_items (batch UPDATE) ────────────
        // Runs one SQL query regardless of how many orders reference this product.
        if ($nameChanged || $skuChanged) {
            $product->loadMissing([
                'attributeValues:id,product_id,attribute_id,value',
                'parentConfigurable' => fn ($query) => $query
                    ->withTrashed()
                    ->select('products.id', 'products.name'),
            ]);
            $snapshotName = $product->name;
            $parentProduct = $product->parentConfigurable->first();

            if ($parentProduct) {
                $snapshotName = $this->buildOrderItemDisplayName($product, $parentProduct);
            }

            // Cập nhật snapshot cho chính sản phẩm này
            \App\Models\OrderItem::where('product_id', $product->id)
                ->update([
                    'product_name_snapshot' => $snapshotName,
                    'product_sku_snapshot' => $product->sku,
                ]);
            \App\Models\OrderSupplementItem::where('product_id', $product->id)
                ->update([
                    'product_name_snapshot' => $snapshotName,
                    'product_sku_snapshot' => $product->sku,
                ]);

            // Nếu là sản phẩm cha, cần cập nhật lại snapshot cho tất cả con (vì tên con phụ thuộc tên cha)
            if ($product->type === 'configurable') {
                $product->variations()->chunk(100, function ($variants) use ($product) {
                    foreach ($variants as $v) {
                        $vSnapshotName = $this->buildOrderItemDisplayName($v, $product);
                        \App\Models\OrderItem::where('product_id', $v->id)->update([
                            'product_name_snapshot' => $vSnapshotName,
                            'product_sku_snapshot' => $v->sku,
                        ]);
                        \App\Models\OrderSupplementItem::where('product_id', $v->id)->update([
                            'product_name_snapshot' => $vSnapshotName,
                            'product_sku_snapshot' => $v->sku,
                        ]);
                    }
                });
            }
        }
        // ────────────────────────────────────────────────────────────────────────
        // Sync categories
        if ($incomingCategoryIds) {
            $this->syncProductCategories($product, $categoryIds);
        }
        // Sync EAV custom attributes
        if ($request->has('custom_attributes')) {
            $validAttrIds = \App\Models\Attribute::whereIn('id', array_keys($request->custom_attributes))->pluck('id')->toArray();
            foreach ($request->custom_attributes as $attrId => $val) {
                if (!in_array($attrId, $validAttrIds)) continue;
                // $val could be string, or array (for multiselect)
                $rawValue = is_array($val) ? json_encode($val) : $val;

                \App\Models\ProductAttributeValue::updateOrCreate(
                    ['product_id' => $product->id, 'attribute_id' => $attrId],
                    ['value' => $rawValue]
                );
            }
        }

        if ($request->has('linked_product_ids')) {
            $links = [];
            foreach (array_values($request->linked_product_ids) as $idx => $idOrObj) {
                if (is_array($idOrObj)) {
                    if (!empty($idOrObj['id'])) {
                        $links[$idOrObj['id']] = ['link_type' => 'related', 'position' => $idx, 'option_title' => $idOrObj['option_title'] ?? null];
                    }
                } else {
                    if (!empty($idOrObj)) {
                        $links[$idOrObj] = ['link_type' => 'related', 'position' => $idx];
                    }
                }
            }

            \Illuminate\Support\Facades\DB::table('product_links')
                ->where('product_id', $product->id)
                ->where('link_type', 'related')
                ->delete();

            if (!empty($links)) {
                $product->relatedProducts()->attach($links);
            }
        } elseif ($request->get('clear_linked_products') == '1') {
            \Illuminate\Support\Facades\DB::table('product_links')
                ->where('product_id', $product->id)
                ->where('link_type', 'related')
                ->delete();
        }

        if ($request->has('grouped_items') && in_array($product->type, ['grouped', 'bundle'])) {
            $linkType = $product->type === 'bundle' ? 'bundle' : 'grouped';
            $existingBundleOptionUids = $product->type === 'bundle'
                ? $this->loadExistingBundleOptionUids($product)
                : [];

            if ($product->type === 'bundle') {
                $product->bundleItems()->detach();
            } else {
                $product->groupedItems()->detach();
            }

            $bundleOptionUids = [];

            foreach ($request->grouped_items as $idx => $item) {
                $bundleOptionUid = null;
                if ($product->type === 'bundle') {
                    $bundleOptionUid = $this->resolveBundleOptionUidForItem($item, $bundleOptionUids, $existingBundleOptionUids);
                }

                $pivotData = [
                    'quantity' => $item['quantity'],
                    'is_required' => $item['is_required'],
                    'link_type' => $linkType,
                    'position' => $idx,
                    'option_title' => $item['option_title'] ?? null,
                    'option_post_id' => $item['option_post_id'] ?? null,
                    'bundle_option_uid' => $bundleOptionUid,
                    'bundle_option_status' => $product->type === 'bundle'
                        ? $this->normalizeBundleOptionStatus($item['bundle_option_status'] ?? null)
                        : self::BUNDLE_OPTION_STATUS_VISIBLE,
                    'option_image_url' => $item['option_image_url'] ?? null,
                    'option_video_url' => $this->normalizeVideoUrl($item['option_video_url'] ?? null),
                    'option_video_source' => $item['option_video_source'] ?? null,
                    'is_default' => $item['is_default'] ?? false,
                    'variant_id' => $item['variant_id'] ?? null,
                    'price' => $item['price'] ?? null,
                    'cost_price' => $item['cost_price'] ?? null,
                ];

                if ($product->type === 'bundle') {
                    $product->bundleItems()->attach($item['id'], $pivotData);
                } else {
                    $product->groupedItems()->attach($item['id'], $pivotData);
                }
            }
        }

        $this->syncCompositeAutoPrice($product);
        $this->syncSubmittedProductImages($request, $product);

        if ($request->has('super_attribute_ids') && $product->type === 'configurable') {
            $attrs = [];
            foreach ($request->super_attribute_ids as $idx => $id) {
                $attrs[$id] = ['position' => $idx];
            }
            $product->superAttributes()->sync($attrs);
        }

        // Handle variants sync
        if ($request->has('variants') && $product->type === 'configurable') {
            $incomingVariants = $preparedVariants;
            $incomingVariantIds = [];

            // 1. Identify which variants to keep vs delete
            foreach ($incomingVariants as $vData) {
                if (isset($vData['id'])) {
                    $incomingVariantIds[] = $vData['id'];
                }
            }

            // 2. Remove variants that are no longer in the list (Clean up orphans) FIRST
            // This prevents duplicate SKU errors if a variant is recreated with the same SKU
            $existingVariantIds = $product->linkedProducts()
                ->wherePivot('link_type', 'super_link')
                ->pluck('products.id')
                ->toArray();

            $toDelete = array_diff($existingVariantIds, $incomingVariantIds);
            if (!empty($toDelete)) {
                $product->linkedProducts()->detach($toDelete);
                Product::whereIn('id', $toDelete)->delete();
            }

            DB::table('product_links')
                ->where('product_id', $product->id)
                ->where('link_type', 'super_link')
                ->update([
                    'is_default' => false,
                    'updated_at' => now(),
                ]);

            // 3. Process remaining variants (Update or Create)
            foreach ($incomingVariants as $idx => $vData) {
                if (isset($vData['id'])) {
                    $variant = Product::findOrFail($vData['id']);
                    $variantPayload = [
                        'name' => $vData['name'] ?? $variant->name,
                        'sku' => $vData['sku'],
                        'price' => $vData['price'] ?? $variant->price,
                        'expected_cost' => $vData['expected_cost'] ?? null,
                        'weight' => $vData['weight'] ?? null,
                        'inventory_unit_id' => $vData['inventory_unit_id'] ?? $product->inventory_unit_id,
                        'supplier_id' => $variant->supplier_id ?? $product->supplier_id,
                        'status' => array_key_exists('status', $vData)
                            ? (filter_var($vData['status'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false)
                            : $variant->status,
                    ];

                    if (array_key_exists('stock_quantity', $vData)) {
                        $variantPayload['stock_quantity'] = $vData['stock_quantity'];
                    }

                    $variant->update($variantPayload);

                    if ($incomingSupplierIds) {
                        $this->syncProductSuppliers($variant, $supplierIds);
                    }

                    if ($incomingSupplierIds || array_key_exists('expected_cost', $vData)) {
                        $this->productPricingService->syncExpectedCost(
                            $variant,
                            $vData['expected_cost'] ?? $variant->expected_cost,
                            $variant->supplier_id,
                            auth()->id()
                        );
                        $variant->refresh();
                    }

                    $this->applyVariantImageSelection($request, $product, $variant, $vData, $idx);

                    // Save/Update variant attribute values
                    if (isset($vData['attributes'])) {
                        $vValidAttrIds = \App\Models\Attribute::whereIn('id', array_keys($vData['attributes']))->pluck('id')->toArray();
                        foreach ($vData['attributes'] as $attrId => $val) {
                            if (!in_array($attrId, $vValidAttrIds)) continue;
                            \App\Models\ProductAttributeValue::updateOrCreate(
                                ['product_id' => $variant->id, 'attribute_id' => $attrId],
                                ['value' => $val]
                            );
                        }
                        // Xóa các thuộc tính cũ không còn trong tổ hợp mới
                        \App\Models\ProductAttributeValue::where('product_id', $variant->id)
                            ->whereNotIn('attribute_id', $vValidAttrIds)
                            ->delete();
                    }

                    DB::table('product_links')
                        ->where('product_id', $product->id)
                        ->where('linked_product_id', $variant->id)
                        ->where('link_type', 'super_link')
                        ->update([
                            'position' => $idx,
                            'is_default' => $defaultVariantIndex !== null && $idx === $defaultVariantIndex,
                            'updated_at' => now(),
                        ]);

                    // Sync OrderItem snapshots if variant was changed
                    if ($variant->wasChanged('name') || $variant->wasChanged('sku')) {
                        $vSnapshotName = $this->buildOrderItemDisplayName($variant, $product);
                        \App\Models\OrderItem::where('product_id', $variant->id)->update([
                            'product_name_snapshot' => $vSnapshotName,
                            'product_sku_snapshot' => $variant->sku,
                        ]);
                        \App\Models\OrderSupplementItem::where('product_id', $variant->id)->update([
                            'product_name_snapshot' => $vSnapshotName,
                            'product_sku_snapshot' => $variant->sku,
                        ]);
                    }
                }
                else {
                    // It's a "new" variant from frontend's perspective.
                    // But maybe it's actually an existing simple product by SKU?
                    // (Optional: can try to find by SKU if you want to be extra safe,
                    // but usually create is fine as long as toDelete happened)
                    $variant = Product::create([
                        'account_id' => $product->account_id,
                        'type' => 'simple',
                        'name' => $vData['name'] ?? ($product->name . ' - ' . ($vData['sku'] ?? 'Variant')),
                        'sku' => $vData['sku'],
                        'price' => $vData['price'] ?? $product->price,
                        'expected_cost' => $vData['expected_cost'] ?? null,
                        'weight' => $vData['weight'] ?? null,
                        'inventory_unit_id' => $vData['inventory_unit_id'] ?? $product->inventory_unit_id,
                        'supplier_id' => $product->supplier_id,
                        'stock_quantity' => $vData['stock_quantity'] ?? 0,
                        'category_id' => $product->category_id,
                        'status' => array_key_exists('status', $vData)
                            ? (filter_var($vData['status'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false)
                            : ($product->status ?? true),
                    ]);

                    $this->syncProductSuppliers($variant, $supplierIds);
                    $this->productPricingService->syncExpectedCost(
                        $variant,
                        $vData['expected_cost'] ?? null,
                        $variant->supplier_id,
                        auth()->id()
                    );

                    $this->applyVariantImageSelection($request, $product, $variant, $vData, $idx);

                    $product->linkedProducts()->attach($variant->id, [
                        'link_type' => 'super_link',
                        'position' => $idx,
                        'is_default' => $defaultVariantIndex !== null && $idx === $defaultVariantIndex,
                    ]);

                    if (isset($vData['attributes'])) {
                        $vValidAttrIds = \App\Models\Attribute::whereIn('id', array_keys($vData['attributes']))->pluck('id')->toArray();
                        foreach ($vData['attributes'] as $attrId => $val) {
                            if (!in_array($attrId, $vValidAttrIds)) continue;
                            \App\Models\ProductAttributeValue::create([
                                'product_id' => $variant->id,
                                'attribute_id' => $attrId,
                                'value' => $val
                            ]);
                        }
                    }
                }
            }
        }

                if ($incomingSupplierIds) {
                    $this->syncSuppliersToVariants($product, $supplierIds);
                }

                $retailPriceSync = $this->productParentRetailPriceSyncService->syncProductAndParents($product);
                if (
                    $product->type === 'bundle'
                    && $product->price_type === 'sum'
                    && $request->has('grouped_items')
                    && empty($retailPriceSync['self_synced'])
                ) {
                    $product->forceFill(['price' => $originalRetailPrice])->saveQuietly();
                }
                $product->refresh();

                return $product;
            });
        } catch (QueryException $exception) {
            $this->throwSkuConstraintValidation($exception, 'Đã phát hiện mã SKU bị trùng trong quá trình cập nhật. Vui lòng kiểm tra lại mã sản phẩm và biến thể.');
        }

        $this->queueGoogleMerchantProductSync($product);

        return response()->json($this->loadProductResource($product));
    }

    /**
     * Duplicate the specified resource.
     */
    public function duplicate($id)
    {
        try {
            $clone = DB::transaction(function () use ($id) {
                $original = Product::with([
                    'attributeValues',
                    'images',
                    'superAttributes',
                    'suppliers:id,name,code',
                    'supplierPrices',
                    'categories:id,name',
                    'relatedProducts',
                    'groupedItems',
                    'bundleItems',
                    'variations.images',
                    'variations.attributeValues',
                    'variations.suppliers:id,name,code',
                    'variations.supplierPrices',
                ])->where('id', $id)->firstOrFail();
                $originalSupplierIds = $original->suppliers
                    ->pluck('id')
                    ->map(fn ($value) => (int) $value)
                    ->values()
                    ->all();

                $clone = $original->replicate();
                $clone->name = $original->name . ' (Copy)';
                $clone->sku = $this->productSkuService->generateCopySku($original->sku, $original->name);
                $clone->slug = $this->productSkuService->generateUniqueSlug($clone->name);
                $clone->status = false;
                $clone->is_new = true;
                $clone->sort_order = $this->nextProductSortOrder($original->account_id ? (int) $original->account_id : null);
                $this->productSkuService->resetInventoryDerivedState($clone);
                $clone->save();

                $this->syncProductSuppliers($clone, $originalSupplierIds);
                $this->productSkuService->copyProductDecorators($original, $clone);

                if ($original->type === 'configurable') {
                    foreach ($original->superAttributes as $superAttribute) {
                        $clone->superAttributes()->attach($superAttribute->id, [
                            'position' => $superAttribute->pivot->position,
                        ]);
                    }

                    foreach ($original->variations as $index => $variation) {
                        $this->productSkuService->cloneVariantForParent($variation, $clone, [
                            'position' => $variation->pivot->position ?? $index,
                            'is_default' => (bool) ($variation->pivot->is_default ?? false),
                        ]);
                    }
                }

                foreach ($original->relatedProducts as $relatedProduct) {
                    $clone->relatedProducts()->attach($relatedProduct->id, [
                        'link_type' => 'related',
                        'position' => $relatedProduct->pivot->position ?? 0,
                        'option_title' => $relatedProduct->pivot->option_title ?? null,
                    ]);
                }

                foreach ($original->groupedItems as $groupedItem) {
                    $clone->groupedItems()->attach($groupedItem->id, [
                        'link_type' => 'grouped',
                        'position' => $groupedItem->pivot->position ?? 0,
                        'quantity' => $groupedItem->pivot->quantity ?? 1,
                        'is_required' => $groupedItem->pivot->is_required ?? true,
                        'variant_id' => $groupedItem->pivot->variant_id ?? null,
                        'price' => $groupedItem->pivot->price ?? null,
                        'cost_price' => null,
                    ]);
                }

                foreach ($original->bundleItems as $bundleItem) {
                    $clone->bundleItems()->attach($bundleItem->id, [
                        'link_type' => 'bundle',
                        'position' => $bundleItem->pivot->position ?? 0,
                        'quantity' => $bundleItem->pivot->quantity ?? 1,
                        'is_required' => $bundleItem->pivot->is_required ?? true,
                        'option_title' => $bundleItem->pivot->option_title ?? null,
                        'option_post_id' => $bundleItem->pivot->option_post_id ?? null,
                        'bundle_option_uid' => $bundleItem->pivot->bundle_option_uid ?? null,
                        'bundle_option_status' => $this->normalizeBundleOptionStatus($bundleItem->pivot->bundle_option_status ?? null),
                        'option_image_url' => $bundleItem->pivot->option_image_url ?? null,
                        'option_video_url' => $bundleItem->pivot->option_video_url ?? null,
                        'option_video_source' => $bundleItem->pivot->option_video_source ?? null,
                        'is_default' => $bundleItem->pivot->is_default ?? false,
                        'variant_id' => $bundleItem->pivot->variant_id ?? null,
                        'price' => $bundleItem->pivot->price ?? null,
                        'cost_price' => null,
                    ]);
                }

                $this->syncProductCategories($clone, $original->categories->pluck('id')->toArray());
                $this->productParentRetailPriceSyncService->syncProductAndParents($clone);
                $clone->refresh();

                return $this->loadProductResource($clone);
            });
        } catch (QueryException $exception) {
            $this->throwSkuConstraintValidation($exception, 'Không thể nhân bản sản phẩm vì mã SKU vừa phát sinh bị trùng. Vui lòng thử lại.');
        }

        return response()->json([
            'message' => 'Sản phẩm đã được nhân bản thành công',
            'data' => $clone,
        ]);

        $clone = DB::transaction(function () use ($id) {
            $original = Product::with([
                'attributeValues',
                'images',
                'superAttributes',
                'suppliers:id,name,code',
                'supplierPrices',
                'categories:id,name',
                'relatedProducts',
                'groupedItems',
                'bundleItems',
                'variations.images',
                'variations.attributeValues',
                'variations.suppliers:id,name,code',
                'variations.supplierPrices',
            ])->where('id', $id)->firstOrFail();
            $originalSupplierIds = $original->suppliers->pluck('id')->map(fn ($value) => (int) $value)->values()->all();

            $clone = $original->replicate();
            $clone->name = $original->name . ' (Copy)';
            $clone->sku = $this->productSkuService->generateCopySku($original->sku, $original->name);
            $clone->slug = $this->productSkuService->generateUniqueSlug($clone->name);
            $clone->status = false;
            $clone->is_new = true;
            $clone->save();
            $this->syncProductSuppliers($clone, $originalSupplierIds);
            $this->productSkuService->copyProductDecorators($original, $clone);

            if ($original->type === 'configurable') {
                foreach ($original->superAttributes as $sa) {
                    $clone->superAttributes()->attach($sa->id, ['position' => $sa->pivot->position]);
                }
            }

            if (in_array($original->type, ['grouped', 'bundle', 'configurable'], true)) {
                foreach ($original->linkedProducts as $linkedProduct) {
                    if ($linkedProduct->pivot->link_type === 'super_link') {
                        $this->productSkuService->cloneVariantForParent($linkedProduct, $clone, [
                            'position' => $linkedProduct->pivot->position,
                            'is_default' => (bool) ($linkedProduct->pivot->is_default ?? false),
                        ]);
                        continue;
                    }

                    $clone->linkedProducts()->attach($linkedProduct->id, [
                        'link_type' => $linkedProduct->pivot->link_type,
                        'position' => $linkedProduct->pivot->position,
                        'quantity' => $linkedProduct->pivot->quantity ?? 1,
                        'is_required' => $linkedProduct->pivot->is_required ?? true,
                    ]);
                }
            }

            $this->syncProductCategories($clone, $original->categories->pluck('id')->toArray());

            return $this->loadProductResource($clone);
        });

        return response()->json([
            'message' => 'Sản phẩm đã được nhân bản thành công',
            'data' => $clone,
        ]);

        /*

            $this->productSkuService->copyProductDecorators($original, $clone);

            if ($original->type === 'configurable') {
                foreach ($original->superAttributes as $superAttribute) {
                    $clone->superAttributes()->attach($superAttribute->id, ['position' => $superAttribute->pivot->position]);
                }

                foreach ($original->variations as $index => $variation) {
                    $this->productSkuService->cloneVariantForParent($variation, $clone, [
                        'position' => $variation->pivot->position ?? $index,
                        'is_default' => (bool) ($variation->pivot->is_default ?? false),
                    ]);
                }
            }

            foreach ($original->relatedProducts as $relatedProduct) {
                $clone->relatedProducts()->attach($relatedProduct->id, [
                    'link_type' => 'related',
                    'position' => $relatedProduct->pivot->position ?? 0,
                    'option_title' => $relatedProduct->pivot->option_title ?? null,
                ]);
            }

            foreach ($original->groupedItems as $groupedItem) {
                $clone->groupedItems()->attach($groupedItem->id, [
                    'link_type' => 'grouped',
                    'position' => $groupedItem->pivot->position ?? 0,
                    'quantity' => $groupedItem->pivot->quantity ?? 1,
                    'is_required' => $groupedItem->pivot->is_required ?? true,
                    'variant_id' => $groupedItem->pivot->variant_id ?? null,
                    'price' => $groupedItem->pivot->price ?? null,
                    'cost_price' => $groupedItem->pivot->cost_price ?? null,
                ]);
            }

            foreach ($original->bundleItems as $bundleItem) {
                $clone->bundleItems()->attach($bundleItem->id, [
                    'link_type' => 'bundle',
                    'position' => $bundleItem->pivot->position ?? 0,
                    'quantity' => $bundleItem->pivot->quantity ?? 1,
                    'is_required' => $bundleItem->pivot->is_required ?? true,
                    'option_title' => $bundleItem->pivot->option_title ?? null,
                    'option_post_id' => $bundleItem->pivot->option_post_id ?? null,
                    'bundle_option_uid' => $bundleItem->pivot->bundle_option_uid ?? null,
                    'bundle_option_status' => $this->normalizeBundleOptionStatus($bundleItem->pivot->bundle_option_status ?? null),
                    'option_image_url' => $bundleItem->pivot->option_image_url ?? null,
                    'option_video_url' => $bundleItem->pivot->option_video_url ?? null,
                    'option_video_source' => $bundleItem->pivot->option_video_source ?? null,
                    'is_default' => $bundleItem->pivot->is_default ?? false,
                    'variant_id' => $bundleItem->pivot->variant_id ?? null,
                    'price' => $bundleItem->pivot->price ?? null,
                    'cost_price' => $bundleItem->pivot->cost_price ?? null,
                ]);
            }

        // Copy categories
            $this->syncProductCategories($clone, $original->categories->pluck('id')->toArray());

            return $clone;
        });

        return response()->json($this->loadProductResource($clone)); /*
            'message' => 'Sản phẩm đã được nhân bản thành công',
        ]);
        */
    }


    protected function resolveSuperLinkVariantIds(array $productIds): array
    {
        $normalizedIds = collect($productIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($normalizedIds)) {
            return [];
        }

        return DB::table('product_links')
            ->whereIn('product_id', $normalizedIds)
            ->where('link_type', 'super_link')
            ->pluck('linked_product_id')
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    protected function resolveProductTrashCascadeIds(array $productIds): array
    {
        return collect(array_merge($productIds, $this->resolveSuperLinkVariantIds($productIds)))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    protected function trashProductsWithVariants(array $productIds): array
    {
        $targetIds = $this->resolveProductTrashCascadeIds($productIds);

        if (!empty($targetIds)) {
            Product::query()->whereIn('id', $targetIds)->delete();
        }

        return $targetIds;
    }

    protected function restoreProductsWithVariants(array $productIds): array
    {
        $targetIds = $this->resolveProductTrashCascadeIds($productIds);

        if (!empty($targetIds)) {
            Product::onlyTrashed()->whereIn('id', $targetIds)->restore();
        }

        return $targetIds;
    }

    protected function forceDeleteProductsWithVariants(array $productIds): array
    {
        $targetIds = $this->resolveProductTrashCascadeIds($productIds);

        if (empty($targetIds)) {
            return [];
        }

        DB::table('product_links')
            ->where(function ($query) use ($targetIds) {
                $query
                    ->whereIn('product_id', $targetIds)
                    ->orWhereIn('linked_product_id', $targetIds);
            })
            ->delete();

        $images = ProductImage::query()->whereIn('product_id', $targetIds)->get();
        $this->deleteProductImageCollection($images);

        Product::onlyTrashed()->whereIn('id', $targetIds)->forceDelete();

        return $targetIds;
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy($id)
    {
        $product = Product::findOrFail($id);
        $trashedIds = [];
        DB::transaction(function () use ($product, &$trashedIds) {
            $trashedIds = $this->trashProductsWithVariants([$product->id]);
        });
        $this->productParentRetailPriceSyncService->syncAffectedParentsForProductIds($trashedIds);
        $this->queueGoogleMerchantInactiveSyncForIds($trashedIds);

        return response()->json(['message' => 'Sản phẩm đã được chuyển vào thùng rác']);
    }

    /**
     * Restore the specified resource from trash.
     */
    public function restore($id)
    {
        $product = Product::onlyTrashed()->findOrFail($id);
        $restoredIds = [];
        DB::transaction(function () use ($product, &$restoredIds) {
            $restoredIds = $this->restoreProductsWithVariants([$product->id]);
        });
        $this->productParentRetailPriceSyncService->syncAffectedParentsForProductIds($restoredIds);

        return response()->json(['message' => 'Sản phẩm đã được khôi phục thành công']);
    }

    /**
     * Permanently remove the specified resource from storage.
     */
    public function forceDelete($id)
    {
        $product = Product::onlyTrashed()->findOrFail($id);
        $targetIds = $this->resolveProductTrashCascadeIds([$product->id]);
        $affectedParentIds = $this->productParentRetailPriceSyncService->affectedParentIdsForProductIds($targetIds);
        DB::transaction(function () use ($product) {
            $this->forceDeleteProductsWithVariants([$product->id]);
        });
        $this->productParentRetailPriceSyncService->syncParentProductsByIds($affectedParentIds);

        return response()->json(['message' => 'Sản phẩm đã được xóa vĩnh viễn']);
    }

    /**
     * Bulk restore resources from trash.
     */
    public function bulkRestore(Request $request)
    {
        $ids = collect($request->input('ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        $restoredIds = [];
        DB::transaction(function () use ($ids, &$restoredIds) {
            $restoredIds = $this->restoreProductsWithVariants($ids);
        });
        $this->productParentRetailPriceSyncService->syncAffectedParentsForProductIds($restoredIds);
        return response()->json(['message' => 'Đã khôi phục các sản phẩm đã chọn']);
    }

    /**
     * Bulk permanently remove resources.
     */
    public function bulkForceDelete(Request $request)
    {
        $ids = collect($request->input('ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        $targetIds = $this->resolveProductTrashCascadeIds($ids);
        $affectedParentIds = $this->productParentRetailPriceSyncService->affectedParentIdsForProductIds($targetIds);
        DB::transaction(function () use ($ids) {
            $this->forceDeleteProductsWithVariants($ids);
        });
        $this->productParentRetailPriceSyncService->syncParentProductsByIds($affectedParentIds);
        return response()->json(['message' => 'Đã xóa vĩnh viễn các sản phẩm đã chọn']);
    }

    /**
     * Bulk move resources to trash.
     */
    public function bulkDelete(Request $request)
    {
        $ids = collect($request->input('ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        $trashedIds = [];
        DB::transaction(function () use ($ids, &$trashedIds) {
            $trashedIds = $this->trashProductsWithVariants($ids);
        });
        $this->productParentRetailPriceSyncService->syncAffectedParentsForProductIds($trashedIds);
        $this->queueGoogleMerchantInactiveSyncForIds($trashedIds);
        return response()->json(['message' => 'Đã chuyển các sản phẩm đã chọn vào thùng rác']);
    }

    /**
     * Bulk update attributes.
     */
    public function bulkUpdateAttributes(Request $request)
    {
        $basicUpdateFields = ['category_id', 'price', 'expected_cost', 'stock_quantity', 'supplier_id', 'inventory_unit_id', 'is_featured', 'is_new', 'status', 'type', 'specifications', 'additional_info'];

        $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'exists:products,id',
            'basic_info' => 'nullable|array',
            'basic_info.cost_price' => 'nullable|numeric|min:0',
            'basic_info.expected_cost' => 'nullable|numeric|min:0',
            'basic_info.stock_quantity' => 'sometimes|nullable|numeric|min:0',
            'basic_info.inventory_unit_id' => 'nullable|exists:inventory_units,id',
            'basic_info.specifications' => 'nullable|string',
            'basic_info.additional_info' => 'nullable',
            'basic_info.category_id' => 'nullable|exists:categories,id',
            'basic_info.category_ids' => 'nullable|array',
            'basic_info.category_ids.*' => 'exists:categories,id',
            'basic_info.clear_category_ids' => 'nullable|boolean',
            'basic_info.supplier_id' => ['nullable', $this->supplierExistsRule($request)],
            'basic_info.supplier_ids' => 'nullable|array',
            'basic_info.supplier_ids.*' => ['nullable', $this->supplierExistsRule($request)],
            'merge_fields' => 'nullable|array',
            'merge_fields.*' => 'in:specifications,additional_info',
            'attributes' => 'nullable|array',
        ]);

        $ids = $request->input('ids');
        $basicInfo = $request->input('basic_info', []);
        $mergeFields = collect($request->input('merge_fields', []))
            ->map(fn ($field) => trim((string) $field))
            ->filter()
            ->intersect(['specifications', 'additional_info'])
            ->values()
            ->all();
        $mergeFieldLookup = array_fill_keys($mergeFields, true);
        $structuredMergePayloads = [];

        if (array_key_exists('specifications', $basicInfo) && isset($mergeFieldLookup['specifications'])) {
            $normalizedSpecifications = $this->normalizeSpecificationsPayload(
                $basicInfo['specifications'] ?? $request->input('basic_info.specifications'),
                'basic_info.specifications'
            );

            $structuredMergePayloads['specifications'] = $normalizedSpecifications;
            $basicInfo['specifications'] = !empty($normalizedSpecifications)
                ? json_encode($normalizedSpecifications, JSON_UNESCAPED_UNICODE)
                : null;
        }

        if ($request->exists('basic_info.additional_info') || array_key_exists('additional_info', $basicInfo)) {
            $normalizedAdditionalInfo = $this->normalizeAdditionalInfoPayload(
                $basicInfo['additional_info'] ?? $request->input('basic_info.additional_info'),
                'basic_info.additional_info'
            );
            $normalizedAdditionalInfo = $this->stripInvalidAdditionalInfoPostLinks($normalizedAdditionalInfo, $request);
            if (isset($mergeFieldLookup['additional_info'])) {
                $structuredMergePayloads['additional_info'] = $normalizedAdditionalInfo;
            }
            $basicInfo['additional_info'] = !empty($normalizedAdditionalInfo)
                ? json_encode($normalizedAdditionalInfo, JSON_UNESCAPED_UNICODE)
                : null;
        }

        $this->prepareOptionalStockQuantityForPersistence($request, $basicInfo, 'basic_info.stock_quantity', 'stock_quantity');

        if (!array_key_exists('expected_cost', $basicInfo) && array_key_exists('cost_price', $basicInfo)) {
            $basicInfo['expected_cost'] = $basicInfo['cost_price'];
        }
        $hasCategorySelectionUpdate = array_key_exists('category_ids', $basicInfo)
            || array_key_exists('category_id', $basicInfo)
            || $request->boolean('basic_info.clear_category_ids');
        if ($hasCategorySelectionUpdate) {
            $basicInfo['category_ids'] = $request->boolean('basic_info.clear_category_ids')
                ? []
                : $this->normalizeCategoryIds($request, $basicInfo);
            $basicInfo['category_id'] = $basicInfo['category_ids'][0] ?? null;
        }
        if (array_key_exists('supplier_ids', $basicInfo) || array_key_exists('supplier_id', $basicInfo)) {
            $normalizedSupplierIds = $this->normalizeSupplierIds($request, $basicInfo);
            $preferredSupplierId = filled($basicInfo['supplier_id'] ?? null)
                ? (int) $basicInfo['supplier_id']
                : null;

            if ($preferredSupplierId) {
                $normalizedSupplierIds = array_values(array_unique([$preferredSupplierId, ...$normalizedSupplierIds]));
            }

            $basicInfo['supplier_ids'] = $normalizedSupplierIds;
            $basicInfo['supplier_id'] = $preferredSupplierId && in_array($preferredSupplierId, $normalizedSupplierIds, true)
                ? $preferredSupplierId
                : ($normalizedSupplierIds[0] ?? null);
        }
        $attributesData = $request->input('attributes', []);

        if (empty($basicInfo) && empty($attributesData)) {
            return response()->json(['message' => 'Không có dữ liệu để cập nhật'], 422);
        }

        // --- Logging original data for BACKUP/UNDO ---
        $originalDataLog = [];
        $products = Product::with(['attributeValues', 'categories', 'suppliers:id,name,code'])->whereIn('id', $ids)->get();

        foreach ($products as $product) {
            $pData = [
                'id' => $product->id,
                'basic' => [],
                'attributes' => [],
                'category_ids' => $product->categories->pluck('id')->toArray(),
                'supplier_ids' => $product->suppliers->pluck('id')->map(fn ($value) => (int) $value)->values()->all(),
            ];

            // Store original basic fields that ARE being updated
            foreach ($basicUpdateFields as $field) {
                if (array_key_exists($field, $basicInfo) && $basicInfo[$field] !== '' && $basicInfo[$field] !== null) {
                    $pData['basic'][$field] = $product->{ $field};
                }
            }

            if (array_key_exists('supplier_ids', $basicInfo) && is_array($basicInfo['supplier_ids'])) {
                $pData['basic']['supplier_id'] = $product->supplier_id;
            }

            // Store original EAV attributes that ARE being updated
            foreach ($attributesData as $attrId => $val) {
                if ($val !== null && $val !== '') {
                    $av = $product->attributeValues->where('attribute_id', $attrId)->first();
                    $pData['attributes'][$attrId] = $av ? $av->value : null;
                }
            }

            $originalDataLog[] = $pData;
        }

        $log = BulkUpdateLog::create([
            'batch_name' => 'Cập nhật hàng loạt ' . now()->format('d/m/Y H:i'),
            'product_count' => count($ids),
            'original_data' => $originalDataLog,
        ]);
        // ---------------------------------------------

        foreach ($ids as $productId) {
            $product = $products->find($productId);
            if (!$product)
                continue;

            // 1. Update basic info (direct columns)
            if (!empty($basicInfo)) {
                $toUpdate = [];
                foreach ($basicUpdateFields as $field) {
                    if (array_key_exists($field, $basicInfo) && $basicInfo[$field] !== '' && $basicInfo[$field] !== null) {
                        if (isset($mergeFieldLookup[$field]) && isset($structuredMergePayloads[$field])) {
                            $toUpdate[$field] = $field === 'specifications'
                                ? $this->mergeSpecificationsPayload($product->specifications, $structuredMergePayloads[$field])
                                : $this->mergeAdditionalInfoPayload($product->additional_info, $structuredMergePayloads[$field]);
                            continue;
                        }

                        $toUpdate[$field] = $basicInfo[$field];
                    }
                }
                if (!empty($toUpdate)) {
                    $product->update($toUpdate);
                }
                if ($hasCategorySelectionUpdate) {
                    $this->syncProductCategories($product, $basicInfo['category_ids'] ?? []);
                }

                if (array_key_exists('supplier_ids', $basicInfo) && is_array($basicInfo['supplier_ids'])) {
                    $this->syncProductSuppliers($product, $basicInfo['supplier_ids']);
                    $this->syncSuppliersToVariants($product, $basicInfo['supplier_ids']);
                }

                if (
                    array_key_exists('expected_cost', $basicInfo)
                    || (array_key_exists('supplier_ids', $basicInfo) && is_array($basicInfo['supplier_ids']))
                ) {
                    $this->productPricingService->syncExpectedCost(
                        $product,
                        $basicInfo['expected_cost'] ?? $product->expected_cost,
                        $product->supplier_id,
                        auth()->id()
                    );
                }
            }

            // 2. Update EAV attributes
            if (!empty($attributesData)) {
                foreach ($attributesData as $attrId => $val) {
                    if ($val === null || $val === '')
                        continue;
                    $rawValue = is_array($val) ? json_encode($val) : $val;
                    \App\Models\ProductAttributeValue::updateOrCreate(
                    ['product_id' => $productId, 'attribute_id' => $attrId],
                    ['value' => $rawValue]
                    );
                }
            }
        }

        $this->productParentRetailPriceSyncService->syncAffectedParentsForProductIds($ids);

        return response()->json([
            'message' => 'Cập nhật hàng loạt thành công',
            'log_id' => $log->id
        ]);
    }

    /**
     * Undo a bulk update operation.
     */
    public function undoBulkUpdate(Request $request)
    {
        $request->validate(['log_id' => 'required|exists:bulk_update_logs,id']);

        $log = BulkUpdateLog::findOrFail($request->log_id);
        $originalData = $log->original_data;

        foreach ($originalData as $pData) {
            $product = Product::find($pData['id']);
            if (!$product)
                continue;

            // Restore basic info
            if (!empty($pData['basic'])) {
                $product->update($pData['basic']);
            }

            if (array_key_exists('supplier_ids', $pData)) {
                $this->syncProductSuppliers($product, $pData['supplier_ids'] ?? []);
                $this->syncSuppliersToVariants($product, $pData['supplier_ids'] ?? []);
            }

            if (array_key_exists('expected_cost', $pData['basic'] ?? []) || array_key_exists('supplier_ids', $pData)) {
                $this->productPricingService->syncExpectedCost(
                    $product,
                    $pData['basic']['expected_cost'] ?? $product->expected_cost,
                    $product->supplier_id,
                    auth()->id()
                );
            }

            // Restore category sync
            if (isset($pData['category_ids'])) {
                $this->syncProductCategories($product, (array) $pData['category_ids']);
            }

            // Restore EAV attributes
            if (!empty($pData['attributes'])) {
                foreach ($pData['attributes'] as $attrId => $originalValue) {
                    if ($originalValue === null) {
                        \App\Models\ProductAttributeValue::where('product_id', $product->id)
                            ->where('attribute_id', $attrId)
                            ->delete();
                    }
                    else {
                        \App\Models\ProductAttributeValue::updateOrCreate(
                        ['product_id' => $product->id, 'attribute_id' => $attrId],
                        ['value' => $originalValue]
                        );
                    }
                }
            }
        }

        // Optional: delete the log after undoing
        $log->delete();
        $this->productParentRetailPriceSyncService->syncAffectedParentsForProductIds(
            collect($originalData)->pluck('id')->all()
        );
        collect($originalData)
            ->pluck('id')
            ->each(function ($productId) {
                $product = Product::query()->find((int) $productId);
                if ($product) {
                    $this->queueGoogleMerchantProductSync($product, false);
                }
            });

        return response()->json(['message' => 'Đã hoàn tác cập nhật thành công']);
    }
}
