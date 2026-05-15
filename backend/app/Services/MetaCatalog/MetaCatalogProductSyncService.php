<?php

namespace App\Services\MetaCatalog;

use App\Services\MetaFeedService;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Throwable;

class MetaCatalogProductSyncService
{
    private const ZERO_DECIMAL_CURRENCIES = [
        'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF',
        'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
    ];

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

        $snapshot = $this->feedSnapshot();
        $entries = $snapshot['entries'];
        $skippedEntries = $snapshot['skipped_entries'];
        if ($checkRemoteUrls) {
            [$entries, $remoteSkippedEntries] = $this->skipEntriesWithRemoteUrlErrors($entries);
            $skippedEntries = array_merge($skippedEntries, $remoteSkippedEntries);
        }

        $currentRetailerIds = $this->retailerIdSet($entries);
        $fallbackEntries = $this->fallbackEntries($entries);
        $validEntries = array_values($entries);

        if (!$dryRun && (int) ($snapshot['total_count'] ?? 0) === 0 && $deleteStale) {
            throw new MetaCatalogProductSyncException('Website feed has no products; refusing to delete every item from the Meta catalog.');
        }

        $existingRetailerIds = $dryRun ? [] : $this->fetchCatalogRetailerIds();
        $upsertRequests = $this->buildUpsertRequests($validEntries, $existingRetailerIds);
        $deleteRequests = $deleteStale
            ? $this->buildDeleteRequests($existingRetailerIds, $currentRetailerIds)
            : [];
        $requests = array_merge($upsertRequests, $deleteRequests);

        $batches = [];
        if (!$dryRun) {
            foreach (array_chunk($requests, $batchSize) as $index => $chunk) {
                $batches[] = $this->sendBatch($chunk, $index + 1, $pollStatus);
            }
        }
        $batchErrorCount = $this->countBatchErrors($batches);

        return [
            'dry_run' => $dryRun,
            'catalog_id' => (string) config('meta_catalog.catalog_id'),
            'feed_count' => (int) ($snapshot['total_count'] ?? count($entries)),
            'valid_count' => count($validEntries),
            'skipped_count' => count($skippedEntries),
            'invalid_count' => $batchErrorCount,
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
            'batches' => $batches,
            'batch_error_count' => $batchErrorCount,
        ];
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
            $entry = array_map(fn ($value) => is_scalar($value) ? trim((string) $value) : '', $entry);
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

    private function skipEntriesWithRemoteUrlErrors(array $entries): array
    {
        $validEntries = [];
        $skippedEntries = [];

        foreach ($entries as $entry) {
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
                continue;
            }

            $validEntries[] = $entry;
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
        $categoryName = trim((string) ($entry['product_type'] ?? $entry['custom_label_0'] ?? ''));
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

        if ($categoryName !== '') {
            $data['product_type'] = $categoryName;
            $data['custom_label_0'] = $categoryName;
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

    private function parsePrice(string $value): array
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
        $minorUnits = in_array($currency, self::ZERO_DECIMAL_CURRENCIES, true)
            ? (int) round($amount)
            : (int) round($amount * 100);

        return [(string) $minorUnits, $currency];
    }

    private function fetchCatalogRetailerIds(): array
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
            $response = $this->request()->get($url, $query);
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
        }

        return collect($ids)->unique()->values()->all();
    }

    private function sendBatch(array $requests, int $batchNumber, bool $pollStatus): array
    {
        if (empty($requests)) {
            return [
                'batch_number' => $batchNumber,
                'request_count' => 0,
                'handles' => [],
                'statuses' => [],
            ];
        }

        $response = $this->request()
            ->asForm()
            ->post($this->endpoint('batch'), [
                'requests' => json_encode($requests, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            ]);

        if ($response->failed()) {
            throw new MetaCatalogProductSyncException($this->responseErrorMessage($response, 'Meta Catalog API rejected the batch request.'));
        }

        $body = $response->json() ?: [];
        $handles = $this->handlesFromBatchResponse($body);

        return [
            'batch_number' => $batchNumber,
            'request_count' => count($requests),
            'handles' => $handles,
            'response' => $body,
            'statuses' => $pollStatus ? $this->pollBatchStatuses($handles) : [],
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

    private function pollBatchStatuses(array $handles): array
    {
        $statuses = [];
        foreach ($handles as $handle) {
            $statuses[] = $this->pollBatchStatus($handle);
        }

        return $statuses;
    }

    private function pollBatchStatus(string $handle): array
    {
        $attempts = max((int) config('meta_catalog.status_poll_attempts', 8), 1);
        $delayMs = max((int) config('meta_catalog.status_poll_delay_ms', 1000), 0);
        $lastBody = [];

        for ($attempt = 1; $attempt <= $attempts; $attempt++) {
            $response = $this->request()->get($this->endpoint('check_batch_request_status'), [
                'handle' => $handle,
                'load_ids_of_invalid_requests' => true,
            ]);

            if ($response->failed()) {
                throw new MetaCatalogProductSyncException($this->responseErrorMessage($response, 'Meta Catalog API rejected the batch status request.'));
            }

            $lastBody = $response->json() ?: [];
            $status = Str::lower((string) (data_get($lastBody, 'data.0.status') ?: data_get($lastBody, 'status', '')));
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
            ->timeout(max((int) config('meta_catalog.timeout', 60), 1))
            ->connectTimeout(max((int) config('meta_catalog.connect_timeout', 15), 1))
            ->withOptions([
                'verify' => (bool) config('meta_catalog.verify_ssl', true),
            ]);
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

    private function responseErrorMessage(Response $response, string $fallback): string
    {
        return $response->json('error.message')
            ?: $response->json('error_description')
            ?: $response->json('error')
            ?: $response->body()
            ?: $fallback;
    }
}
