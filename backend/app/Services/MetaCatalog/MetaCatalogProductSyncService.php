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

        $entries = $this->feedEntries();
        $currentRetailerIds = $this->retailerIdSet($entries);
        $invalidEntries = $this->invalidEntries($entries, $checkRemoteUrls);
        $fallbackEntries = $this->fallbackEntries($entries);
        $validEntries = array_values(array_filter(
            $entries,
            fn (array $entry) => !isset($invalidEntries[$entry['id'] ?? ''])
        ));

        if (!$dryRun && empty($entries) && $deleteStale) {
            throw new MetaCatalogProductSyncException('Website feed has no products; refusing to delete every item from the Meta catalog.');
        }

        if (!$dryRun && !empty($invalidEntries)) {
            throw new MetaCatalogProductSyncException('Dry-run still has invalid products; refusing to sync live to Meta.');
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

        return [
            'dry_run' => $dryRun,
            'catalog_id' => (string) config('meta_catalog.catalog_id'),
            'feed_count' => count($entries),
            'valid_count' => count($validEntries),
            'invalid_count' => count($invalidEntries),
            'existing_count' => count($existingRetailerIds),
            'create_count' => $this->countByMethod($upsertRequests, 'CREATE'),
            'update_count' => $this->countByMethod($upsertRequests, 'UPDATE'),
            'delete_count' => count($deleteRequests),
            'fallback_count' => count($fallbackEntries),
            'request_count' => count($requests),
            'batch_count' => (int) ceil(count($requests) / max($batchSize, 1)),
            'invalid_entries' => array_values($invalidEntries),
            'fallback_entries' => $fallbackEntries,
            'batches' => $batches,
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

    private function feedEntries(): array
    {
        $entries = [];
        foreach ($this->feedService->entries() as $entry) {
            $entry = array_map(fn ($value) => is_scalar($value) ? trim((string) $value) : '', $entry);
            if (($entry['id'] ?? '') !== '') {
                $entries[] = $entry;
            }
        }

        return $entries;
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

    private function invalidEntries(array $entries, bool $checkRemoteUrls): array
    {
        $invalid = [];
        foreach ($entries as $entry) {
            $errors = $this->validationErrors($entry, $checkRemoteUrls);
            if (!empty($errors)) {
                $invalid[(string) $entry['id']] = [
                    'id' => (string) $entry['id'],
                    'title' => (string) ($entry['title'] ?? ''),
                    'product_type' => (string) ($entry['product_type'] ?? ''),
                    'errors' => $errors,
                ];
            }
        }

        return $invalid;
    }

    private function validationErrors(array $entry, bool $checkRemoteUrls): array
    {
        $required = [
            'id',
            'title',
            'description',
            'price',
            'link',
            'image_link',
            'product_type',
            'custom_label_0',
        ];

        $errors = [];
        foreach ($required as $field) {
            if (trim((string) ($entry[$field] ?? '')) === '') {
                $errors[] = "{$field} is empty";
            }
        }

        try {
            $this->parsePrice((string) ($entry['price'] ?? ''));
        } catch (Throwable $exception) {
            $errors[] = $exception->getMessage();
        }

        $link = trim((string) ($entry['link'] ?? ''));
        if ($link !== '' && !filter_var($link, FILTER_VALIDATE_URL)) {
            $errors[] = 'link is not a valid URL';
        }

        $imageLink = trim((string) ($entry['image_link'] ?? ''));
        if ($imageLink !== '' && !filter_var($imageLink, FILTER_VALIDATE_URL)) {
            $errors[] = 'image_link is not a valid URL';
        }

        if ($checkRemoteUrls) {
            if ($link !== '' && filter_var($link, FILTER_VALIDATE_URL) && !$this->remoteUrlLooksReachable($link, false)) {
                $errors[] = 'link URL is not reachable';
            }

            if ($imageLink !== '' && filter_var($imageLink, FILTER_VALIDATE_URL) && !$this->remoteUrlLooksReachable($imageLink, true)) {
                $errors[] = 'image_link URL is not reachable or not an image';
            }
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
