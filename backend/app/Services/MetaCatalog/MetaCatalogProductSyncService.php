<?php

namespace App\Services\MetaCatalog;

use App\Services\MetaFeedService;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Throwable;

class MetaCatalogProductSyncService
{
    public function __construct(
        private readonly MetaFeedService $feedService,
    ) {
    }

    public function sync(array $options = []): array
    {
        $dryRun = (bool) ($options['dry_run'] ?? false);
        $deleteStale = (bool) ($options['delete_stale'] ?? config('meta_catalog.delete_stale', true));
        $batchSize = $this->batchSize((int) ($options['batch_size'] ?? config('meta_catalog.batch_size', 500)));
        $pollStatus = (bool) ($options['poll_status'] ?? config('meta_catalog.poll_status', true));
        $checkRemoteUrls = (bool) ($options['check_remote_urls'] ?? false);
        $progress = is_callable($options['progress'] ?? null) ? $options['progress'] : null;

        $this->reportProgress($progress, 'prepare_feed', 5, 'Dang doc du lieu san pham website...');
        $snapshot = $this->feedSnapshot();
        $entries = $snapshot['entries'];
        $skippedEntries = $snapshot['skipped_entries'];
        if ($checkRemoteUrls) {
            $this->reportProgress($progress, 'remote_url_check', 12, 'Dang kiem tra link va anh san pham...');
            [$entries, $remoteSkippedEntries] = $this->skipEntriesWithRemoteUrlErrors($entries, $progress);
            $skippedEntries = array_merge($skippedEntries, $remoteSkippedEntries);
        }

        $currentRetailerIds = $this->retailerIdSet($entries);
        $fallbackEntries = $this->fallbackEntries($entries);
        $validEntries = array_values($entries);
        $this->reportProgress($progress, 'feed_ready', $dryRun ? 90 : 25, 'Da loc san pham du dieu kien sync.', [
            'total_products' => (int) ($snapshot['total_count'] ?? count($validEntries) + count($skippedEntries)),
            'valid_count' => count($validEntries),
            'skipped_count' => count($skippedEntries),
            'fallback_count' => count($fallbackEntries),
        ]);

        if (!$dryRun && (int) ($snapshot['total_count'] ?? 0) === 0 && $deleteStale) {
            throw new MetaCatalogProductSyncException('Website feed has no products; refusing to delete every item from the Meta catalog.');
        }

        if (!$dryRun) {
            $this->reportProgress($progress, 'fetch_meta_existing', 35, 'Dang lay danh sach san pham hien co tren Meta...');
        }
        $existingRetailerIds = $dryRun ? [] : $this->fetchCatalogRetailerIds($progress);
        $upsertRequests = $this->buildUpsertRequests($validEntries, $existingRetailerIds);
        $deleteRequests = $deleteStale
            ? $this->buildDeleteRequests($existingRetailerIds, $currentRetailerIds)
            : [];
        $requests = array_merge($upsertRequests, $deleteRequests);
        $this->reportProgress($progress, 'build_requests', $dryRun ? 95 : 50, 'Da chuan bi request gui sang Meta.', [
            'existing_count' => count($existingRetailerIds),
            'create_count' => $this->countByMethod($upsertRequests, 'CREATE'),
            'update_count' => $this->countByMethod($upsertRequests, 'UPDATE'),
            'delete_count' => count($deleteRequests),
            'request_count' => count($requests),
            'batch_count' => (int) ceil(count($requests) / max($batchSize, 1)),
        ]);

        $batches = [];
        if (!$dryRun) {
            $chunks = array_chunk($requests, $batchSize);
            $totalBatches = count($chunks);
            foreach ($chunks as $index => $chunk) {
                $batchNumber = $index + 1;
                $this->reportProgress($progress, 'send_meta_batch', $this->batchProgressPercent($batchNumber - 1, $totalBatches), sprintf('Dang gui batch %d/%d sang Meta...', $batchNumber, $totalBatches), [
                    'batch_number' => $batchNumber,
                    'batch_count' => $totalBatches,
                    'request_count' => count($chunk),
                ]);
                $batches[] = $this->sendBatch($chunk, $batchNumber, $pollStatus, $progress, $totalBatches);
            }
        }
        $batchErrorCount = $this->countBatchErrors($batches);
        $productSetResult = $dryRun
            ? $this->dryRunProductSets($validEntries)
            : $this->syncProductSets($validEntries, $progress);
        $productSetErrorCount = (int) ($productSetResult['error_count'] ?? 0);
        $pricePreviews = $this->pricePreviewEntries($validEntries);

        $result = [
            'dry_run' => $dryRun,
            'catalog_id' => (string) config('meta_catalog.catalog_id'),
            'feed_count' => (int) ($snapshot['total_count'] ?? count($entries)),
            'valid_count' => count($validEntries),
            'skipped_count' => count($skippedEntries),
            'invalid_count' => $batchErrorCount + $productSetErrorCount,
            'existing_count' => count($existingRetailerIds),
            'create_count' => $this->countByMethod($upsertRequests, 'CREATE'),
            'update_count' => $this->countByMethod($upsertRequests, 'UPDATE'),
            'delete_count' => count($deleteRequests),
            'fallback_count' => count($fallbackEntries),
            'request_count' => count($requests),
            'batch_count' => (int) ceil(count($requests) / max($batchSize, 1)),
            'invalid_entries' => [],
            'skipped_entries' => $skippedEntries,
            'fallback_entries' => $fallbackEntries,
            'price_previews' => $pricePreviews,
            'batches' => $batches,
            'batch_error_count' => $batchErrorCount,
            'product_set_count' => (int) ($productSetResult['total_count'] ?? 0),
            'product_set_create_count' => (int) ($productSetResult['created_count'] ?? 0),
            'product_set_update_count' => (int) ($productSetResult['updated_count'] ?? 0),
            'product_set_unchanged_count' => (int) ($productSetResult['unchanged_count'] ?? 0),
            'product_set_error_count' => $productSetErrorCount,
            'product_sets' => (array) ($productSetResult['sets'] ?? []),
            'product_set_errors' => (array) ($productSetResult['errors'] ?? []),
            'product_set_sort_note' => 'Meta khong dam bao hien thi dung thu tu thu cong trong Product Set; sort_order da duoc gui trong custom_label_3/custom_label_4 de kiem tra.',
        ];

        $this->reportProgress($progress, 'complete', 100, $dryRun ? 'Dry-run hoan tat.' : 'Dong bo Meta hoan tat.', [
            'total_products' => (int) ($result['feed_count'] ?? 0),
            'valid_count' => (int) ($result['valid_count'] ?? 0),
            'skipped_count' => (int) ($result['skipped_count'] ?? 0),
            'invalid_count' => (int) ($result['invalid_count'] ?? 0),
            'create_count' => (int) ($result['create_count'] ?? 0),
            'update_count' => (int) ($result['update_count'] ?? 0),
            'delete_count' => (int) ($result['delete_count'] ?? 0),
            'request_count' => (int) ($result['request_count'] ?? 0),
            'batch_count' => (int) ($result['batch_count'] ?? 0),
            'product_set_count' => (int) ($result['product_set_count'] ?? 0),
            'product_set_create_count' => (int) ($result['product_set_create_count'] ?? 0),
            'product_set_update_count' => (int) ($result['product_set_update_count'] ?? 0),
            'product_set_error_count' => (int) ($result['product_set_error_count'] ?? 0),
        ]);

        return $result;
    }

    public function buildUpsertRequests(iterable $entries, array $existingRetailerIds = []): array
    {
        $existingSet = array_fill_keys(array_map('strval', $existingRetailerIds), true);
        $requests = [];

        foreach ($entries as $entry) {
            $retailerId = trim((string) ($entry['id'] ?? ''));
            if ($retailerId === '') {
                continue;
            }

            $requests[] = [
                'method' => isset($existingSet[$retailerId]) ? 'UPDATE' : 'CREATE',
                'retailer_id' => $retailerId,
                'data' => $this->catalogData($entry),
            ];
        }

        return $requests;
    }

    public function buildDeleteRequests(array $existingRetailerIds, array $currentRetailerIds): array
    {
        $currentSet = array_fill_keys(array_map('strval', $currentRetailerIds), true);
        $requests = [];

        foreach ($existingRetailerIds as $retailerId) {
            $retailerId = trim((string) $retailerId);
            if ($retailerId === '' || isset($currentSet[$retailerId])) {
                continue;
            }

            $requests[] = [
                'method' => 'DELETE',
                'retailer_id' => $retailerId,
            ];
        }

        return $requests;
    }

    private function feedSnapshot(): array
    {
        $snapshot = $this->feedService->catalogSnapshot();
        $entries = [];
        foreach ((array) ($snapshot['entries'] ?? []) as $entry) {
            $entry = collect($entry)
                ->mapWithKeys(function ($value, $key) {
                    if (is_scalar($value)) {
                        return [$key => trim((string) $value)];
                    }

                    return [((string) $key) => str_starts_with((string) $key, '_') ? $value : ''];
                })
                ->all();
            if (($entry['id'] ?? '') !== '') {
                $entries[] = $entry;
            }
        }

        $skippedEntries = array_map(
            fn (array $entry) => $this->normalizeSkippedEntry($entry),
            (array) ($snapshot['skipped_entries'] ?? [])
        );

        return [
            'total_count' => (int) ($snapshot['total_count'] ?? count($entries) + count($skippedEntries)),
            'entries' => $entries,
            'skipped_entries' => $skippedEntries,
        ];
    }

    private function retailerIdSet(array $entries): array
    {
        return collect($entries)
            ->pluck('id')
            ->map(fn ($id) => trim((string) $id))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function fallbackEntries(array $entries): array
    {
        return collect($entries)
            ->filter(fn (array $entry) => in_array((string) ($entry['_used_fallback_image'] ?? ''), ['1', 'true'], true))
            ->map(fn (array $entry) => [
                'id' => (string) ($entry['id'] ?? ''),
                'title' => (string) ($entry['title'] ?? ''),
                'image_link' => (string) ($entry['image_link'] ?? ''),
            ])
            ->values()
            ->all();
    }

    private function normalizeSkippedEntry(array $entry): array
    {
        return [
            'id' => (string) ($entry['id'] ?? ''),
            'product_id' => (int) ($entry['product_id'] ?? 0),
            'title' => (string) ($entry['title'] ?? ''),
            'product_type' => (string) ($entry['product_type'] ?? ''),
            'admin_edit_url' => (string) ($entry['admin_edit_url'] ?? ''),
            'errors' => array_values(array_filter(array_map(
                fn ($error) => trim((string) $error),
                (array) ($entry['errors'] ?? [])
            ))),
        ];
    }

    private function skipEntriesWithRemoteUrlErrors(array $entries, ?callable $progress = null): array
    {
        $validEntries = [];
        $skippedEntries = [];
        $totalEntries = max(count($entries), 1);

        foreach ($entries as $index => $entry) {
            $errors = $this->remoteValidationErrors($entry);
            if (!empty($errors)) {
                $skippedEntries[] = [
                    'id' => (string) $entry['id'],
                    'product_id' => (int) ($entry['_product_id'] ?? 0),
                    'title' => (string) ($entry['title'] ?? ''),
                    'product_type' => (string) ($entry['product_type'] ?? ''),
                    'admin_edit_url' => (string) ($entry['_admin_edit_url'] ?? ''),
                    'errors' => $errors,
                ];
            } else {
                $validEntries[] = $entry;
            }

            $current = $index + 1;
            if ($current % 10 === 0 || $current === $totalEntries) {
                $percent = 12 + (int) floor(($current / $totalEntries) * 10);
                $this->reportProgress($progress, 'remote_url_check', min($percent, 22), sprintf('Dang kiem tra link/anh %d/%d...', $current, $totalEntries), [
                    'checked_count' => $current,
                    'total_to_check' => $totalEntries,
                    'remote_skipped_count' => count($skippedEntries),
                ]);
            }
        }

        return [$validEntries, $skippedEntries];
    }

    private function remoteValidationErrors(array $entry): array
    {
        $errors = [];

        $link = trim((string) ($entry['link'] ?? ''));
        if ($link !== '' && filter_var($link, FILTER_VALIDATE_URL) && !$this->remoteUrlLooksReachable($link, false)) {
            $errors[] = 'link lỗi hoặc không truy cập được';
        }

        $imageLink = trim((string) ($entry['image_link'] ?? ''));
        if ($imageLink !== '' && filter_var($imageLink, FILTER_VALIDATE_URL) && !$this->remoteUrlLooksReachable($imageLink, true)) {
            $errors[] = 'ảnh lỗi hoặc không phải ảnh';
        }

        return $errors;
    }

    private function remoteUrlLooksReachable(string $url, bool $expectImage): bool
    {
        try {
            $response = Http::timeout(8)
                ->connectTimeout(4)
                ->withOptions(['verify' => (bool) config('meta_catalog.verify_ssl', true)])
                ->head($url);

            if ($response->status() === 405) {
                $response = Http::timeout(8)
                    ->connectTimeout(4)
                    ->withOptions(['verify' => (bool) config('meta_catalog.verify_ssl', true)])
                    ->get($url);
            }

            if (!$response->successful()) {
                return false;
            }

            if (!$expectImage) {
                return true;
            }

            $contentType = Str::lower((string) $response->header('Content-Type', ''));

            return $contentType === '' || str_starts_with($contentType, 'image/');
        } catch (Throwable) {
            return false;
        }
    }

    private function catalogData(array $entry): array
    {
        [$price, $currency] = $this->parsePrice((string) $entry['price']);
        $productType = trim((string) ($entry['product_type'] ?? ''));
        $directCategoryName = trim((string) ($entry['custom_label_0'] ?? $productType));
        $brand = trim((string) config('meta_catalog.brand', 'Gốm Đại Thành'));

        $data = [
            'name' => Str::limit((string) $entry['title'], 200, ''),
            'description' => Str::limit((string) $entry['description'], 9999, ''),
            'availability' => 'in stock',
            'condition' => 'new',
            'price' => $price,
            'currency' => $currency,
            'image_url' => (string) $entry['image_link'],
            'url' => (string) $entry['link'],
            'brand' => $brand !== '' ? $brand : 'Gốm Đại Thành',
        ];

        if ($productType !== '') {
            $data['product_type'] = $productType;
        }

        if ($directCategoryName !== '') {
            $data['custom_label_0'] = $directCategoryName;
        }

        foreach (['custom_label_1', 'custom_label_2', 'custom_label_3', 'custom_label_4'] as $labelField) {
            $labelValue = trim((string) ($entry[$labelField] ?? ''));
            if ($labelValue !== '') {
                $data[$labelField] = Str::limit($labelValue, 100, '');
            }
        }

        return $data;
    }

    private function countBatchErrors(array $batches): int
    {
        $count = 0;
        foreach ($batches as $batch) {
            foreach ((array) ($batch['statuses'] ?? []) as $status) {
                $errors = data_get($status, 'response.data.0.errors', data_get($status, 'response.errors', []));
                if (is_array($errors)) {
                    $count += count($errors);
                }
            }
        }

        return $count;
    }

    private function dryRunProductSets(array $entries): array
    {
        $sets = collect($this->productSetDescriptorsFromEntries($entries))
            ->map(fn (array $descriptor) => [
                'id' => '',
                'name' => $descriptor['name'],
                'type' => $descriptor['type'],
                'path' => $descriptor['path'],
                'product_count' => (int) $descriptor['product_count'],
                'action' => 'planned',
                'filter' => $this->productSetFilter($descriptor),
                'sort_orders' => $descriptor['sort_orders'],
            ])
            ->values()
            ->all();

        return [
            'total_count' => count($sets),
            'created_count' => 0,
            'updated_count' => 0,
            'unchanged_count' => 0,
            'error_count' => 0,
            'sets' => $sets,
            'errors' => [],
        ];
    }

    private function syncProductSets(array $entries, ?callable $progress = null): array
    {
        $descriptors = $this->productSetDescriptorsFromEntries($entries);
        $result = [
            'total_count' => count($descriptors),
            'created_count' => 0,
            'updated_count' => 0,
            'unchanged_count' => 0,
            'error_count' => 0,
            'sets' => [],
            'errors' => [],
        ];

        if (empty($descriptors)) {
            return $result;
        }

        $this->reportProgress($progress, 'product_sets_fetch', 92, 'Dang lay danh sach Product Set hien co tren Meta...', [
            'product_set_count' => count($descriptors),
        ]);

        try {
            $existingSets = $this->fetchProductSets($progress);
        } catch (Throwable $exception) {
            $message = $exception instanceof MetaCatalogProductSyncException
                ? $exception->getMessage()
                : Str::limit($exception->getMessage(), 1000, '');

            return array_merge($result, [
                'error_count' => count($descriptors),
                'errors' => collect($descriptors)->map(fn (array $descriptor) => [
                    'name' => $descriptor['name'],
                    'type' => $descriptor['type'],
                    'error' => $message,
                ])->values()->all(),
            ]);
        }

        $existingByName = [];
        foreach ($existingSets as $existingSet) {
            $name = trim((string) ($existingSet['name'] ?? ''));
            $key = $this->normalizeProductSetName($name);
            if ($key !== '' && !isset($existingByName[$key])) {
                $existingByName[$key] = $existingSet;
            }
        }

        $totalCategories = max(count($descriptors), 1);
        foreach ($descriptors as $index => $descriptor) {
            $filter = $this->productSetFilter($descriptor);
            $key = $this->normalizeProductSetName((string) $descriptor['name']);
            $existingSet = $existingByName[$key] ?? null;
            $percent = 93 + (int) floor((($index + 1) / $totalCategories) * 5);
            $this->reportProgress($progress, 'product_sets_sync', min(98, $percent), sprintf('Dang dong bo Product Set %d/%d...', $index + 1, count($descriptors)), [
                'product_set_count' => count($descriptors),
                'product_set_create_count' => (int) $result['created_count'],
                'product_set_update_count' => (int) $result['updated_count'],
                'product_set_error_count' => (int) $result['error_count'],
            ]);

            try {
                if ($existingSet) {
                    $entry = $this->updateProductSetIfNeeded($existingSet, $descriptor, $filter);
                } else {
                    $entry = $this->createProductSet($descriptor, $filter);
                }

                $action = (string) ($entry['action'] ?? 'unchanged');
                if ($action === 'created') {
                    $result['created_count']++;
                } elseif ($action === 'updated') {
                    $result['updated_count']++;
                } else {
                    $result['unchanged_count']++;
                }

                $result['sets'][] = $entry;
            } catch (Throwable $exception) {
                $message = $exception instanceof MetaCatalogProductSyncException
                    ? $exception->getMessage()
                    : Str::limit($exception->getMessage(), 1000, '');
                $result['error_count']++;
                $result['errors'][] = [
                    'name' => $descriptor['name'],
                    'type' => $descriptor['type'],
                    'error' => $message,
                ];
                $result['sets'][] = [
                    'id' => (string) ($existingSet['id'] ?? ''),
                    'name' => $descriptor['name'],
                    'type' => $descriptor['type'],
                    'path' => $descriptor['path'],
                    'product_count' => (int) $descriptor['product_count'],
                    'action' => 'error',
                    'filter' => $filter,
                    'sort_orders' => $descriptor['sort_orders'],
                    'error' => $message,
                ];
            }
        }

        return $result;
    }

    private function fetchProductSets(?callable $progress = null): array
    {
        $url = $this->endpoint('product_sets');
        $query = [
            'fields' => 'id,name,filter,product_count',
            'limit' => max(min((int) config('meta_catalog.product_set_page_limit', 1000), 5000), 1),
        ];
        $sets = [];
        $page = 0;
        $maxPages = max((int) config('meta_catalog.max_catalog_pages', 1000), 1);

        while ($url !== '' && $page < $maxPages) {
            $response = $this->metaGet($url, $query);
            if ($response->failed()) {
                throw new MetaCatalogProductSyncException($this->responseErrorMessage($response, 'Meta Catalog API rejected the product set list request.'));
            }

            $body = $response->json() ?: [];
            foreach ((array) ($body['data'] ?? []) as $item) {
                $sets[] = [
                    'id' => (string) ($item['id'] ?? ''),
                    'name' => (string) ($item['name'] ?? ''),
                    'filter' => $this->normalizeProductSetFilter($item['filter'] ?? []),
                    'product_count' => (int) ($item['product_count'] ?? 0),
                ];
            }

            $url = trim((string) data_get($body, 'paging.next', ''));
            $query = [];
            $page++;
            $this->reportProgress($progress, 'product_sets_fetch', min(94, 92 + $page), sprintf('Dang lay Product Set Meta: trang %d, da co %d nhom...', $page, count($sets)), [
                'existing_product_set_count' => count($sets),
            ]);
        }

        return $sets;
    }

    private function updateProductSetIfNeeded(array $existingSet, array $descriptor, array $filter): array
    {
        $category = (string) $descriptor['name'];
        $existingFilter = $this->normalizeProductSetFilter($existingSet['filter'] ?? []);
        $needsUpdate = $this->canonicalFilter($existingFilter) !== $this->canonicalFilter($filter)
            || trim((string) ($existingSet['name'] ?? '')) !== $category;

        if (!$needsUpdate) {
            return [
                'id' => (string) ($existingSet['id'] ?? ''),
                'name' => $category,
                'type' => $descriptor['type'],
                'path' => $descriptor['path'],
                'action' => 'unchanged',
                'filter' => $filter,
                'product_count' => (int) $descriptor['product_count'],
                'meta_product_count' => (int) ($existingSet['product_count'] ?? 0),
                'sort_orders' => $descriptor['sort_orders'],
            ];
        }

        $productSetId = trim((string) ($existingSet['id'] ?? ''));
        if ($productSetId === '') {
            throw new MetaCatalogProductSyncException('Existing Product Set is missing id.');
        }

        $response = $this->metaPostForm($this->nodeEndpoint($productSetId), [
            'name' => $category,
            'filter' => json_encode($filter, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        ]);

        if ($response->failed()) {
            throw new MetaCatalogProductSyncException($this->responseErrorMessage($response, 'Meta Catalog API rejected the product set update request.'));
        }

        return [
            'id' => $productSetId,
            'name' => $category,
            'type' => $descriptor['type'],
            'path' => $descriptor['path'],
            'action' => 'updated',
            'filter' => $filter,
            'product_count' => (int) $descriptor['product_count'],
            'meta_product_count' => (int) ($existingSet['product_count'] ?? 0),
            'sort_orders' => $descriptor['sort_orders'],
            'response' => $response->json() ?: [],
        ];
    }

    private function createProductSet(array $descriptor, array $filter): array
    {
        $category = (string) $descriptor['name'];
        $response = $this->metaPostForm($this->endpoint('product_sets'), [
            'name' => $category,
            'filter' => json_encode($filter, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        ]);

        if ($response->failed()) {
            throw new MetaCatalogProductSyncException($this->responseErrorMessage($response, 'Meta Catalog API rejected the product set create request.'));
        }

        $body = $response->json() ?: [];

        return [
            'id' => (string) ($body['id'] ?? ''),
            'name' => $category,
            'type' => $descriptor['type'],
            'path' => $descriptor['path'],
            'action' => 'created',
            'filter' => $filter,
            'product_count' => (int) $descriptor['product_count'],
            'sort_orders' => $descriptor['sort_orders'],
            'response' => $body,
        ];
    }

    private function productSetDescriptorsFromEntries(array $entries): array
    {
        $descriptors = [];
        foreach ($entries as $entry) {
            $productId = trim((string) ($entry['id'] ?? ''));
            $sortOrder = (int) ($entry['_meta_sort_order'] ?? $entry['custom_label_3'] ?? 0);
            $entrySets = (array) ($entry['_meta_product_sets'] ?? []);

            if (empty($entrySets)) {
                $directCategory = trim((string) ($entry['custom_label_0'] ?? ''));
                $parentCategory = trim((string) ($entry['custom_label_1'] ?? ''));
                $path = trim((string) ($entry['custom_label_2'] ?? $entry['product_type'] ?? $directCategory));
                if ($parentCategory !== '') {
                    $entrySets[] = [
                        'name' => $parentCategory,
                        'type' => 'parent',
                        'path' => $parentCategory,
                        'filter_field' => 'custom_label_1',
                        'filter_value' => $parentCategory,
                    ];
                }
                if ($directCategory !== '') {
                    $entrySets[] = [
                        'name' => $directCategory,
                        'type' => $parentCategory !== '' && $parentCategory !== $directCategory ? 'child' : 'parent',
                        'path' => $path,
                        'filter_field' => $parentCategory !== '' && $parentCategory !== $directCategory ? 'custom_label_0' : 'custom_label_1',
                        'filter_value' => $directCategory,
                    ];
                }
            }

            foreach ($entrySets as $entrySet) {
                $name = trim((string) ($entrySet['name'] ?? ''));
                $key = $this->normalizeProductSetName($name);
                if ($key === '') {
                    continue;
                }

                if (!isset($descriptors[$key])) {
                    $descriptors[$key] = [
                        'id' => (int) ($entrySet['id'] ?? 0),
                        'name' => Str::limit($name, 255, ''),
                        'type' => in_array((string) ($entrySet['type'] ?? ''), ['parent', 'child'], true) ? (string) $entrySet['type'] : 'parent',
                        'path' => trim((string) ($entrySet['path'] ?? $name)),
                        'filter_field' => trim((string) ($entrySet['filter_field'] ?? 'custom_label_0')),
                        'filter_value' => trim((string) ($entrySet['filter_value'] ?? $name)),
                        'product_count' => 0,
                        'product_ids' => [],
                        'sort_orders' => [],
                    ];
                }

                if ($productId !== '' && !isset($descriptors[$key]['product_ids'][$productId])) {
                    $descriptors[$key]['product_ids'][$productId] = true;
                    $descriptors[$key]['product_count']++;
                }

                if ($productId !== '' && $sortOrder > 0) {
                    $descriptors[$key]['sort_orders'][] = [
                        'id' => $productId,
                        'sort_order' => $sortOrder,
                    ];
                }
            }
        }

        return collect($descriptors)
            ->map(function (array $descriptor) {
                unset($descriptor['product_ids']);
                $descriptor['sort_orders'] = collect($descriptor['sort_orders'])
                    ->sortBy('sort_order')
                    ->values()
                    ->all();

                return $descriptor;
            })
            ->sortBy([
                ['type', 'desc'],
                ['name', 'asc'],
            ])
            ->values()
            ->all();
    }

    private function productSetFilter(array $descriptor): array
    {
        $category = (string) ($descriptor['filter_value'] ?? $descriptor['name'] ?? '');
        $field = (string) ($descriptor['filter_field'] ?? 'custom_label_0');

        if (($descriptor['type'] ?? '') === 'parent') {
            return [
                'or' => [
                    ['custom_label_1' => ['eq' => $category]],
                    ['custom_label_0' => ['eq' => $category]],
                ],
            ];
        }

        return [
            $field => ['eq' => $category],
        ];
    }

    private function normalizeProductSetName(string $name): string
    {
        return Str::lower(trim(preg_replace('/\s+/u', ' ', $name) ?: ''));
    }

    private function normalizeProductSetFilter(mixed $filter): array
    {
        if (is_string($filter)) {
            $decoded = json_decode($filter, true);
            return is_array($decoded) ? $decoded : [];
        }

        return is_array($filter) ? $filter : [];
    }

    private function canonicalFilter(array $filter): string
    {
        $this->sortFilterRecursive($filter);

        return json_encode($filter, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '';
    }

    private function sortFilterRecursive(array &$value): void
    {
        foreach ($value as &$child) {
            if (is_array($child)) {
                $this->sortFilterRecursive($child);
            }
        }

        if (!array_is_list($value)) {
            ksort($value);
        }
    }

    private function parsePrice(string $value): array
    {
        [$amount, $currency] = $this->parseFeedPrice($value);

        return [(string) ((int) round($amount * 100)), $currency];
    }

    private function parseFeedPrice(string $value): array
    {
        $value = trim($value);
        if (!preg_match('/^([0-9]+(?:\.[0-9]+)?)\s+([A-Z]{3})$/i', $value, $matches)) {
            throw new MetaCatalogProductSyncException('price must use "<amount> <ISO currency>" format');
        }

        $amount = (float) $matches[1];
        if ($amount <= 0) {
            throw new MetaCatalogProductSyncException('price must be greater than 0');
        }

        $currency = strtoupper($matches[2]);

        return [$amount, $currency];
    }

    private function pricePreviewEntries(array $entries): array
    {
        return collect($entries)
            ->map(function (array $entry) {
                [$websiteAmount, $currency] = $this->parseFeedPrice((string) ($entry['price'] ?? ''));
                [$apiPrice] = $this->parsePrice((string) ($entry['price'] ?? ''));

                return [
                    'id' => trim((string) ($entry['id'] ?? '')),
                    'title' => Str::limit((string) ($entry['title'] ?? ''), 200, ''),
                    'website_price' => $this->formatPlainAmount($websiteAmount),
                    'feed_price' => trim((string) ($entry['price'] ?? '')),
                    'api_price' => $apiPrice,
                    'currency' => $currency,
                    'expected_meta_display' => $this->formatExpectedMetaPrice($websiteAmount, $currency),
                ];
            })
            ->values()
            ->all();
    }

    private function formatPlainAmount(float $amount): string
    {
        if (floor($amount) === $amount) {
            return (string) ((int) round($amount));
        }

        return rtrim(rtrim(number_format($amount, 2, '.', ''), '0'), '.');
    }

    private function formatExpectedMetaPrice(float $amount, string $currency): string
    {
        if ($currency === 'VND') {
            return number_format($amount, 0, ',', '.') . ' đ';
        }

        return number_format($amount, 2, '.', ',') . ' ' . $currency;
    }

    private function fetchCatalogRetailerIds(?callable $progress = null): array
    {
        $url = $this->endpoint('products');
        $query = [
            'fields' => 'retailer_id',
            'limit' => max(min((int) config('meta_catalog.catalog_page_limit', 1000), 5000), 1),
        ];
        $ids = [];
        $page = 0;
        $maxPages = max((int) config('meta_catalog.max_catalog_pages', 1000), 1);

        while ($url !== '' && $page < $maxPages) {
            $response = $this->metaGet($url, $query);
            if ($response->failed()) {
                throw new MetaCatalogProductSyncException($this->responseErrorMessage($response, 'Meta Catalog API rejected the product list request.'));
            }

            $body = $response->json() ?: [];
            foreach ((array) ($body['data'] ?? []) as $item) {
                $retailerId = trim((string) ($item['retailer_id'] ?? ''));
                if ($retailerId !== '') {
                    $ids[] = $retailerId;
                }
            }

            $url = trim((string) data_get($body, 'paging.next', ''));
            $query = [];
            $page++;
            $this->reportProgress($progress, 'fetch_meta_existing', min(45, 35 + $page), sprintf('Dang lay san pham Meta: trang %d, da co %d SKU...', $page, count($ids)), [
                'page' => $page,
                'existing_count' => count($ids),
            ]);
        }

        return collect($ids)->unique()->values()->all();
    }

    private function sendBatch(array $requests, int $batchNumber, bool $pollStatus, ?callable $progress = null, int $totalBatches = 1): array
    {
        if (empty($requests)) {
            return [
                'batch_number' => $batchNumber,
                'request_count' => 0,
                'handles' => [],
                'statuses' => [],
            ];
        }

        $response = $this->metaPostForm($this->endpoint('batch'), [
            'requests' => json_encode($requests, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        ]);

        if ($response->failed()) {
            throw new MetaCatalogProductSyncException($this->responseErrorMessage($response, 'Meta Catalog API rejected the batch request.'));
        }

        $body = $response->json() ?: [];
        $handles = $this->handlesFromBatchResponse($body);
        $this->reportProgress($progress, 'meta_batch_submitted', $this->batchProgressPercent($batchNumber, $totalBatches), sprintf('Da gui batch %d/%d sang Meta.', $batchNumber, max($totalBatches, 1)), [
            'batch_number' => $batchNumber,
            'batch_count' => max($totalBatches, 1),
            'request_count' => count($requests),
            'handle_count' => count($handles),
        ]);

        return [
            'batch_number' => $batchNumber,
            'request_count' => count($requests),
            'handles' => $handles,
            'response' => $body,
            'statuses' => $pollStatus ? $this->pollBatchStatuses($handles, $progress, $batchNumber, $totalBatches) : [],
        ];
    }

    private function handlesFromBatchResponse(array $body): array
    {
        $handles = $body['handles'] ?? $body['handle'] ?? [];
        if (is_string($handles)) {
            $handles = [$handles];
        }

        return collect($handles)
            ->map(fn ($handle) => trim((string) $handle))
            ->filter()
            ->values()
            ->all();
    }

    private function pollBatchStatuses(array $handles, ?callable $progress = null, int $batchNumber = 1, int $totalBatches = 1): array
    {
        $statuses = [];
        $totalHandles = max(count($handles), 1);
        foreach ($handles as $index => $handle) {
            $statuses[] = $this->pollBatchStatus($handle, $progress, $batchNumber, $totalBatches, $index + 1, $totalHandles);
        }

        return $statuses;
    }

    private function pollBatchStatus(string $handle, ?callable $progress = null, int $batchNumber = 1, int $totalBatches = 1, int $handleNumber = 1, int $totalHandles = 1): array
    {
        $attempts = max((int) config('meta_catalog.status_poll_attempts', 8), 1);
        $delayMs = max((int) config('meta_catalog.status_poll_delay_ms', 1000), 0);
        $lastBody = [];

        for ($attempt = 1; $attempt <= $attempts; $attempt++) {
            $response = $this->metaGet($this->endpoint('check_batch_request_status'), [
                'handle' => $handle,
                'load_ids_of_invalid_requests' => true,
            ]);

            if ($response->failed()) {
                throw new MetaCatalogProductSyncException($this->responseErrorMessage($response, 'Meta Catalog API rejected the batch status request.'));
            }

            $lastBody = $response->json() ?: [];
            $status = Str::lower((string) (data_get($lastBody, 'data.0.status') ?: data_get($lastBody, 'status', '')));
            $this->reportProgress($progress, 'meta_batch_status', min(95, $this->batchProgressPercent($batchNumber, $totalBatches) + 3), sprintf('Dang cho Meta xu ly batch %d/%d, handle %d/%d, lan %d/%d...', $batchNumber, max($totalBatches, 1), $handleNumber, $totalHandles, $attempt, $attempts), [
                'batch_number' => $batchNumber,
                'batch_count' => max($totalBatches, 1),
                'handle_number' => $handleNumber,
                'handle_count' => $totalHandles,
                'attempt' => $attempt,
                'attempts' => $attempts,
                'meta_status' => $status ?: 'pending',
            ]);
            if (in_array($status, ['finished', 'completed', 'complete', 'success'], true)) {
                return [
                    'handle' => $handle,
                    'attempts' => $attempt,
                    'response' => $lastBody,
                ];
            }

            if ($attempt < $attempts && $delayMs > 0) {
                usleep($delayMs * 1000);
            }
        }

        return [
            'handle' => $handle,
            'attempts' => $attempts,
            'response' => $lastBody,
        ];
    }

    private function request(): PendingRequest
    {
        return Http::withToken($this->accessToken())
            ->acceptJson()
            ->retry(
                $this->retryTimes(),
                max((int) config('meta_catalog.retry_sleep_ms', 2000), 0),
                null,
                false
            )
            ->timeout(max((int) config('meta_catalog.timeout', 60), 1))
            ->connectTimeout(max((int) config('meta_catalog.connect_timeout', 15), 1))
            ->withOptions([
                'verify' => (bool) config('meta_catalog.verify_ssl', true),
            ]);
    }

    private function metaGet(string $url, array $query = []): Response
    {
        try {
            return $this->request()->get($url, $query);
        } catch (ConnectionException $exception) {
            throw new MetaCatalogProductSyncException($this->connectionErrorMessage($exception), previous: $exception);
        }
    }

    private function metaPostForm(string $url, array $payload): Response
    {
        try {
            return $this->request()->asForm()->post($url, $payload);
        } catch (ConnectionException $exception) {
            throw new MetaCatalogProductSyncException($this->connectionErrorMessage($exception), previous: $exception);
        }
    }

    private function endpoint(string $path): string
    {
        $catalogId = trim((string) config('meta_catalog.catalog_id'));
        if ($catalogId === '') {
            throw new MetaCatalogProductSyncException('Missing META_CATALOG_ID.');
        }

        $version = trim((string) config('meta_catalog.graph_api_version', 'v25.0')) ?: 'v25.0';
        if (!str_starts_with($version, 'v')) {
            $version = 'v' . $version;
        }

        return 'https://graph.facebook.com/' . trim($version, '/') . '/' . rawurlencode($catalogId) . '/' . ltrim($path, '/');
    }

    private function nodeEndpoint(string $id): string
    {
        $version = trim((string) config('meta_catalog.graph_api_version', 'v25.0')) ?: 'v25.0';
        if (!str_starts_with($version, 'v')) {
            $version = 'v' . $version;
        }

        return 'https://graph.facebook.com/' . trim($version, '/') . '/' . rawurlencode($id);
    }

    private function accessToken(): string
    {
        $token = trim((string) config('meta_catalog.access_token'));
        if ($token === '') {
            throw new MetaCatalogProductSyncException('Missing META_CATALOG_ACCESS_TOKEN.');
        }

        return $token;
    }

    private function batchSize(int $value): int
    {
        return max(min($value > 0 ? $value : 500, 5000), 1);
    }

    private function countByMethod(array $requests, string $method): int
    {
        return collect($requests)
            ->filter(fn (array $request) => ($request['method'] ?? null) === $method)
            ->count();
    }

    private function batchProgressPercent(int $batchNumber, int $totalBatches): int
    {
        if ($totalBatches <= 0) {
            return 90;
        }

        return min(90, 50 + (int) floor(($batchNumber / $totalBatches) * 40));
    }

    private function reportProgress(?callable $progress, string $phase, int $percent, string $message, array $context = []): void
    {
        if (!$progress) {
            return;
        }

        $progress([
            'phase' => $phase,
            'percent' => max(0, min(100, $percent)),
            'message' => $message,
            'context' => $context,
            'updated_at' => now()->toIso8601String(),
        ]);
    }

    private function responseErrorMessage(Response $response, string $fallback): string
    {
        return $response->json('error.message')
            ?: $response->json('error_description')
            ?: $response->json('error')
            ?: $response->body()
            ?: $fallback;
    }

    private function connectionErrorMessage(ConnectionException $exception): string
    {
        $connectTimeout = max((int) config('meta_catalog.connect_timeout', 15), 1);
        $timeout = max((int) config('meta_catalog.timeout', 60), 1);
        $attempts = $this->retryTimes();

        return sprintf(
            'Server khong ket noi duoc Meta Graph API (graph.facebook.com:443) sau %d lan thu. Kiem tra hosting/firewall/DNS outbound HTTPS. Timeout hien tai: connect %ds, request %ds. Chi tiet: %s',
            $attempts,
            $connectTimeout,
            $timeout,
            Str::limit($exception->getMessage(), 500, '')
        );
    }

    private function retryTimes(): int
    {
        return max((int) config('meta_catalog.retry_times', 3), 1);
    }
}
