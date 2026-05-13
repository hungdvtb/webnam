<?php

namespace App\Services\GoogleMerchant;

use App\Models\GoogleMerchantSyncLog;
use App\Models\Product;
use App\Models\ProductImage;
use App\Models\SiteDomain;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

class GoogleMerchantProductSyncService
{
    private const SCOPE = 'https://www.googleapis.com/auth/content';
    private const INSERT_ENDPOINT = 'https://merchantapi.googleapis.com/products/v1/accounts/%s/productInputs:insert';
    private const DELETE_ENDPOINT = 'https://merchantapi.googleapis.com/products/v1/%s';
    private const DATA_SOURCES_ENDPOINT = 'https://merchantapi.googleapis.com/datasources/v1/accounts/%s/dataSources';
    private const REGISTER_GCP_ENDPOINT = 'https://merchantapi.googleapis.com/accounts/v1/accounts/%s/developerRegistration:registerGcp';

    public function __construct(
        private readonly GoogleMerchantSettingsService $settingsService,
    ) {
    }

    public function enabled(?int $accountId = null): bool
    {
        return $this->settingsService->enabledForAccount($accountId);
    }

    public function syncProduct(Product $product, ?string $action = null): array
    {
        $settings = $this->settingsService->settingsFor((int) $product->account_id ?: null);

        if (empty($settings['enabled'])) {
            return [
                'status' => 'skipped',
                'reason' => 'Google Merchant sync is disabled.',
            ];
        }

        $accountId = $this->accountId($settings);
        $dataSourceName = $this->dataSourceName($settings, $accountId);
        $offerId = $this->resolveOfferId($product, $settings);
        $resolvedAction = $this->resolveSyncAction($product, $settings, $action);

        if ($resolvedAction === 'delete') {
            $result = $this->deleteProductInput($product, $settings, $accountId, $dataSourceName, $offerId);
            $bundleOptionResults = $this->deleteBundleOptionInputs($product, $settings, $accountId, $dataSourceName, $offerId);

            if (!empty($bundleOptionResults)) {
                $result['bundle_options'] = $bundleOptionResults;
            }

            return $result;
        }

        $payload = $this->buildProductInputPayload($product, $settings, [
            'force_out_of_stock' => $resolvedAction === 'out_of_stock',
        ]);
        $payloadHash = hash('sha256', json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        $url = sprintf(self::INSERT_ENDPOINT, rawurlencode($accountId))
            . '?dataSource=' . rawurlencode($dataSourceName);

        $this->markProductAttempt($product, $resolvedAction, $offerId, $payloadHash);

        try {
            $response = $this->sendMerchantRequest('post', $url, $payload, $product, $offerId, $resolvedAction, $settings);

            if ($response->failed()) {
                throw new GoogleMerchantProductSyncException($this->responseErrorMessage($response, 'Google Merchant API rejected the product.'));
            }

            $body = $response->json() ?: [];
            $bundleOptionResults = $this->syncBundleOptionInputs($product, $settings, $accountId, $dataSourceName, $offerId);
            $this->markProductSuccess($product, $resolvedAction, $offerId, $payloadHash, $body);

            $result = [
                'status' => 'synced',
                'action' => $resolvedAction,
                'product_id' => (int) $product->id,
                'offer_id' => $offerId,
                'response' => $body,
            ];

            if (!empty($bundleOptionResults)) {
                $result['bundle_options'] = $bundleOptionResults;
            }

            return $result;
        } catch (Throwable $exception) {
            $this->markProductFailure($product, $resolvedAction, $offerId, $exception);
            throw $exception;
        }
    }

    public function deleteProductInput(Product $product, array $settings, string $accountId, string $dataSourceName, string $offerId): array
    {
        if ($offerId === '') {
            throw new GoogleMerchantProductSyncException('Product has no stable offer ID.');
        }

        $name = $product->google_merchant_product_input_name
            ?: $this->productInputName($accountId, (string) $settings['content_language'], (string) $settings['feed_label'], $offerId);
        $url = sprintf(self::DELETE_ENDPOINT, $name)
            . '?dataSource=' . rawurlencode($dataSourceName);

        $this->markProductAttempt($product, 'delete', $offerId, null);

        try {
            $response = $this->sendMerchantRequest('delete', $url, null, $product, $offerId, 'delete', $settings);

            if ($response->failed() && $response->status() !== 404) {
                throw new GoogleMerchantProductSyncException($this->responseErrorMessage($response, 'Google Merchant API rejected the product delete request.'));
            }

            $this->markProductDeleted($product, $offerId);

            return [
                'status' => 'deleted',
                'action' => 'delete',
                'product_id' => (int) $product->id,
                'offer_id' => $offerId,
                'response' => $response->json() ?: [],
            ];
        } catch (Throwable $exception) {
            $this->markProductFailure($product, 'delete', $offerId, $exception);
            throw $exception;
        }
    }

    public function listDataSources(?int $accountId = null): array
    {
        $settings = $this->settingsService->settingsFor($accountId);
        $merchantId = $this->accountId($settings);
        $dataSources = [];
        $pageToken = null;

        do {
            $query = ['pageSize' => 1000];
            if ($pageToken) {
                $query['pageToken'] = $pageToken;
            }

            $url = sprintf(self::DATA_SOURCES_ENDPOINT, rawurlencode($merchantId));
            $response = $this->baseRequest($settings)
                ->withToken($this->accessToken($settings))
                ->get($url, $query);

            if ($response->failed()) {
                throw new GoogleMerchantProductSyncException($this->responseErrorMessage($response, 'Google Merchant API rejected the data source list request.'));
            }

            $body = $response->json();
            $dataSources = array_merge($dataSources, (array) ($body['dataSources'] ?? []));
            $pageToken = trim((string) ($body['nextPageToken'] ?? ''));
        } while ($pageToken !== '');

        return $dataSources;
    }

    public function testConnection(?int $accountId = null): array
    {
        $settings = $this->settingsService->settingsFor($accountId);

        return [
            'merchant_id' => $this->accountId($settings),
            'data_sources' => $this->listDataSources($accountId),
            'has_credentials' => $this->settingsService->hasCredentials($settings),
        ];
    }

    public function registerGcpProject(string $developerEmail, ?int $accountId = null): array
    {
        $developerEmail = trim($developerEmail);

        if ($developerEmail === '' || !filter_var($developerEmail, FILTER_VALIDATE_EMAIL)) {
            throw new GoogleMerchantProductSyncException('Developer email must be a valid Google account email.');
        }

        $settings = $this->settingsService->settingsFor($accountId);
        $merchantId = $this->accountId($settings);
        $response = $this->baseRequest($settings)
            ->withToken($this->accessToken($settings))
            ->post(sprintf(self::REGISTER_GCP_ENDPOINT, rawurlencode($merchantId)), [
                'developerEmail' => $developerEmail,
            ]);

        if ($response->failed()) {
            throw new GoogleMerchantProductSyncException($this->responseErrorMessage($response, 'Google Merchant API rejected the GCP project registration request.'));
        }

        return $response->json() ?: [];
    }

    public function buildProductInputPayload(Product $product, ?array $settings = null, array $options = []): array
    {
        $settings ??= $this->settingsService->settingsFor((int) $product->account_id ?: null);

        $this->loadProductMerchantRelations($product);

        $offerId = $this->resolveOfferId($product, $settings);
        $title = $this->cleanText((string) $product->name, 150);
        $description = $this->resolveDescription($product);
        $link = $this->resolveProductUrl($product, $settings);
        $imageLink = $this->resolveImageUrl($product);
        $additionalImages = $this->resolveAdditionalImageUrls($product, $imageLink);
        $regularPrice = $this->resolveRegularPrice($product);
        $salePrice = $this->resolveSalePrice($product, $regularPrice);
        $googleProductCategory = $this->resolveGoogleProductCategory($product, $settings);
        $productTypes = $this->resolveProductTypes($product);

        if ($offerId === '') {
            throw new GoogleMerchantProductSyncException('Product has no stable offer ID.');
        }

        if ($title === '') {
            throw new GoogleMerchantProductSyncException('Product title is empty.');
        }

        if ($link === '') {
            throw new GoogleMerchantProductSyncException('Product link is empty.');
        }

        if ($imageLink === '') {
            throw new GoogleMerchantProductSyncException('Product image link is empty.');
        }

        if ($regularPrice <= 0) {
            throw new GoogleMerchantProductSyncException('Product price must be greater than 0.');
        }

        $attributes = [
            'title' => $title,
            'description' => $description !== '' ? $description : $title,
            'link' => $link,
            'imageLink' => $imageLink,
            'availability' => !empty($options['force_out_of_stock']) ? 'OUT_OF_STOCK' : $this->resolveAvailability($product),
            'price' => $this->pricePayload($regularPrice, $settings),
            'condition' => 'NEW',
        ];

        if (!empty($additionalImages)) {
            $attributes['additionalImageLinks'] = $additionalImages;
        }

        if ($salePrice !== null) {
            $attributes['salePrice'] = $this->pricePayload($salePrice, $settings);
        }

        if ($googleProductCategory !== '') {
            $attributes['googleProductCategory'] = $googleProductCategory;
        }

        if (!empty($productTypes)) {
            $attributes['productTypes'] = $productTypes;
        }

        $parent = $this->productUrlOwner($product);
        if ((int) $parent->id !== (int) $product->id) {
            $attributes['itemGroupId'] = $this->resolveOfferId($parent, $settings);
        }

        return [
            'offerId' => $offerId,
            'contentLanguage' => (string) $settings['content_language'],
            'feedLabel' => (string) $settings['feed_label'],
            'productAttributes' => $attributes,
        ];
    }

    public function buildProductInputPayloads(Product $product, ?array $settings = null): array
    {
        $settings ??= $this->settingsService->settingsFor((int) $product->account_id ?: null);
        $parentPayload = $this->buildProductInputPayload($product, $settings);
        $payloads = [$parentPayload];

        foreach ($this->bundleOptionPayloadEntries($product, $settings, (string) $parentPayload['offerId']) as $entry) {
            $payloads[] = $entry['payload'];
        }

        return $payloads;
    }

    private function syncBundleOptionInputs(Product $product, array $settings, string $accountId, string $dataSourceName, string $parentOfferId): array
    {
        $results = [];
        foreach ($this->bundleOptionPayloadEntries($product, $settings, $parentOfferId) as $entry) {
            $payload = $entry['payload'];
            $offerId = (string) $payload['offerId'];
            $url = sprintf(self::INSERT_ENDPOINT, rawurlencode($accountId))
                . '?dataSource=' . rawurlencode($dataSourceName);
            $response = $this->sendMerchantRequest('post', $url, $payload, $product, $offerId, 'bundle_option_upsert', $settings);

            if ($response->failed()) {
                throw new GoogleMerchantProductSyncException($this->responseErrorMessage($response, 'Google Merchant API rejected the bundle option.'));
            }

            $results[] = [
                'status' => 'synced',
                'action' => 'bundle_option_upsert',
                'offer_id' => $offerId,
                'title' => $entry['title'],
                'price' => $entry['price'],
                'response' => $response->json() ?: [],
            ];
        }

        return $results;
    }

    private function deleteBundleOptionInputs(Product $product, array $settings, string $accountId, string $dataSourceName, string $parentOfferId): array
    {
        $results = [];
        foreach ($this->bundleOptionGroups($product) as $option) {
            $offerId = $this->bundleOptionOfferId($parentOfferId, $option);
            $name = $this->productInputName(
                $accountId,
                (string) $settings['content_language'],
                (string) $settings['feed_label'],
                $offerId
            );
            $url = sprintf(self::DELETE_ENDPOINT, $name)
                . '?dataSource=' . rawurlencode($dataSourceName);
            $response = $this->sendMerchantRequest('delete', $url, null, $product, $offerId, 'bundle_option_delete', $settings);

            if ($response->failed() && $response->status() !== 404) {
                throw new GoogleMerchantProductSyncException($this->responseErrorMessage($response, 'Google Merchant API rejected the bundle option delete request.'));
            }

            $results[] = [
                'status' => 'deleted',
                'action' => 'bundle_option_delete',
                'offer_id' => $offerId,
                'title' => $option['title'],
                'response' => $response->json() ?: [],
            ];
        }

        return $results;
    }

    private function bundleOptionPayloadEntries(Product $product, array $settings, string $parentOfferId): array
    {
        return collect($this->bundleOptionGroups($product))
            ->map(function (array $option) use ($product, $settings, $parentOfferId) {
                return [
                    ...$option,
                    'payload' => $this->buildBundleOptionInputPayload($product, $option, $settings, $parentOfferId),
                ];
            })
            ->values()
            ->all();
    }

    private function buildBundleOptionInputPayload(Product $product, array $option, array $settings, string $parentOfferId): array
    {
        $title = $this->cleanText((string) $option['title'], 150);
        $description = $this->resolveDescription($product);
        $link = $this->resolveProductUrl($product, $settings);
        $imageLink = $this->resolveImageUrl($product);
        $additionalImages = $this->resolveAdditionalImageUrls($product, $imageLink);
        $price = (float) $option['price'];
        $googleProductCategory = $this->resolveGoogleProductCategory($product, $settings);
        $productTypes = $this->resolveProductTypes($product);

        if ($title === '') {
            throw new GoogleMerchantProductSyncException('Bundle option title is empty.');
        }

        if ($link === '') {
            throw new GoogleMerchantProductSyncException('Bundle option product link is empty.');
        }

        if ($imageLink === '') {
            throw new GoogleMerchantProductSyncException('Bundle option image link is empty.');
        }

        if ($price <= 0) {
            throw new GoogleMerchantProductSyncException("Bundle option price must be greater than 0: {$title}");
        }

        $attributes = [
            'title' => $title,
            'description' => $description !== '' ? $description : $title,
            'link' => $link,
            'imageLink' => $imageLink,
            'availability' => 'IN_STOCK',
            'price' => $this->pricePayload($price, $settings),
            'condition' => 'NEW',
            'itemGroupId' => $parentOfferId,
        ];

        if (!empty($additionalImages)) {
            $attributes['additionalImageLinks'] = $additionalImages;
        }

        if ($googleProductCategory !== '') {
            $attributes['googleProductCategory'] = $googleProductCategory;
        }

        if (!empty($productTypes)) {
            $attributes['productTypes'] = $productTypes;
        }

        return [
            'offerId' => $this->bundleOptionOfferId($parentOfferId, $option),
            'contentLanguage' => (string) $settings['content_language'],
            'feedLabel' => (string) $settings['feed_label'],
            'productAttributes' => $attributes,
        ];
    }

    private function bundleOptionGroups(Product $product): array
    {
        if ((string) $product->type !== 'bundle') {
            return [];
        }

        $this->loadProductMerchantRelations($product);
        $items = $product->relationLoaded('bundleItems') ? $product->bundleItems : $product->bundleItems()->get();

        return $items
            ->groupBy(fn (Product $item) => $this->bundleOptionGroupKey($item))
            ->map(function ($optionItems, string $key) use ($product) {
                $first = $optionItems->first();
                $uid = trim((string) ($first?->pivot?->bundle_option_uid ?? ''));
                $title = $optionItems
                    ->map(fn (Product $item) => trim((string) ($item->pivot?->option_title ?? '')))
                    ->first(fn (string $value) => $value !== '')
                    ?: trim((string) ($product->bundle_title ?: $product->name));

                return [
                    'key' => $key,
                    'uid' => $uid,
                    'title' => $title,
                    'price' => $this->resolveBundleOptionPrice($optionItems),
                ];
            })
            ->values()
            ->all();
    }

    private function bundleOptionGroupKey(Product $item): string
    {
        $uid = trim((string) ($item->pivot?->bundle_option_uid ?? ''));
        if ($uid !== '') {
            return 'uid:' . $uid;
        }

        $postId = trim((string) ($item->pivot?->option_post_id ?? ''));
        $title = $this->cleanText((string) ($item->pivot?->option_title ?? ''), 190);

        return 'fallback:' . sha1($postId . '|' . $title);
    }

    private function resolveBundleOptionPrice($items): float
    {
        return (float) collect($items)->sum(function (Product $item) {
            $quantity = (float) ($item->pivot?->quantity ?? 1);
            $quantity = $quantity > 0 ? $quantity : 1;
            $pivotPrice = $item->pivot?->price;
            $unitPrice = is_numeric($pivotPrice) && (float) $pivotPrice > 0
                ? (float) $pivotPrice
                : $this->resolveRegularPrice($item);

            return $unitPrice * $quantity;
        });
    }

    private function bundleOptionOfferId(string $parentOfferId, array $option): string
    {
        $hash = substr(sha1((string) ($option['uid'] ?: $option['key'] ?: $option['title'])), 0, 10);
        $prefix = Str::limit($parentOfferId, 35, '');

        return "{$prefix}-opt-{$hash}";
    }

    private function sendMerchantRequest(
        string $method,
        string $url,
        ?array $payload,
        ?Product $product,
        ?string $offerId,
        string $action,
        array $settings
    ): Response {
        $startedAt = microtime(true);
        $response = null;
        $error = null;

        try {
            $request = $this->baseRequest($settings)->withToken($this->accessToken($settings));
            $response = $method === 'delete'
                ? $request->delete($url)
                : $request->post($url, $payload ?? []);

            return $response;
        } catch (Throwable $exception) {
            $error = $exception;
            throw $exception;
        } finally {
            $this->recordApiLog(
                product: $product,
                offerId: $offerId,
                action: $action,
                method: Str::upper($method),
                url: $url,
                payload: $payload,
                response: $response,
                error: $error,
                durationMs: (int) round((microtime(true) - $startedAt) * 1000)
            );
        }
    }

    private function loadProductMerchantRelations(Product $product): void
    {
        try {
            $product->loadMissing([
                'images',
                'siteDomain',
                'supplier',
                'category',
                'categories',
                'attributeValues.attribute',
                'parentConfigurable.siteDomain',
                'parentConfigurable.images',
                'parentConfigurable.categories',
                'bundleItems',
            ]);
        } catch (Throwable $exception) {
            if (!app()->runningUnitTests()) {
                throw $exception;
            }
        }
    }

    private function baseRequest(array $settings): PendingRequest
    {
        return Http::acceptJson()
            ->asJson()
            ->timeout(max((int) config('google_merchant.timeout', 30), 1))
            ->connectTimeout(max((int) config('google_merchant.connect_timeout', 10), 1))
            ->withOptions([
                'verify' => (bool) config('google_merchant.verify_ssl', true),
            ]);
    }

    private function accessToken(array $settings): string
    {
        $credentialType = (string) ($settings['credential_type'] ?? 'service_account');
        $staticAccessToken = trim((string) ($settings['access_token'] ?? ''));

        if ($credentialType === 'access_token' && $staticAccessToken !== '') {
            return $staticAccessToken;
        }

        if ($credentialType === 'oauth2') {
            return $this->oauthAccessToken($settings);
        }

        return $this->serviceAccountAccessToken($settings);
    }

    private function oauthAccessToken(array $settings): string
    {
        $clientId = trim((string) ($settings['oauth_client_id'] ?? ''));
        $clientSecret = trim((string) ($settings['oauth_client_secret'] ?? ''));
        $refreshToken = trim((string) ($settings['oauth_refresh_token'] ?? ''));

        if ($clientId === '' || $clientSecret === '' || $refreshToken === '') {
            throw new GoogleMerchantProductSyncException('Missing OAuth client_id, client_secret or refresh_token.');
        }

        $cacheKey = 'google_merchant_oauth_access_token:' . sha1($clientId . '|' . $refreshToken);

        return Cache::remember($cacheKey, now()->addMinutes(50), function () use ($clientId, $clientSecret, $refreshToken) {
            $response = Http::asForm()
                ->timeout(max((int) config('google_merchant.timeout', 30), 1))
                ->connectTimeout(max((int) config('google_merchant.connect_timeout', 10), 1))
                ->withOptions([
                    'verify' => (bool) config('google_merchant.verify_ssl', true),
                ])
                ->post('https://oauth2.googleapis.com/token', [
                    'client_id' => $clientId,
                    'client_secret' => $clientSecret,
                    'refresh_token' => $refreshToken,
                    'grant_type' => 'refresh_token',
                ]);

            if ($response->failed()) {
                throw new GoogleMerchantProductSyncException($this->responseErrorMessage($response, 'Unable to refresh Google OAuth token.'));
            }

            $token = trim((string) $response->json('access_token', ''));
            if ($token === '') {
                throw new GoogleMerchantProductSyncException('Google OAuth token response did not include access_token.');
            }

            return $token;
        });
    }

    private function serviceAccountAccessToken(array $settings): string
    {
        $credentials = $this->serviceAccountCredentials($settings);
        $clientEmail = trim((string) ($credentials['client_email'] ?? ''));
        $cacheKey = 'google_merchant_access_token:' . sha1($clientEmail . '|' . self::SCOPE);

        return Cache::remember($cacheKey, now()->addMinutes(50), function () use ($credentials) {
            return $this->fetchServiceAccountAccessToken($credentials);
        });
    }

    private function fetchServiceAccountAccessToken(array $credentials): string
    {
        $tokenUri = trim((string) ($credentials['token_uri'] ?? 'https://oauth2.googleapis.com/token'));
        $clientEmail = trim((string) ($credentials['client_email'] ?? ''));
        $privateKey = (string) ($credentials['private_key'] ?? '');
        $privateKey = str_replace('\n', "\n", $privateKey);

        if ($clientEmail === '' || $privateKey === '') {
            throw new GoogleMerchantProductSyncException('Google service account JSON is missing client_email or private_key.');
        }

        $now = time();
        $header = ['alg' => 'RS256', 'typ' => 'JWT'];
        $claims = [
            'iss' => $clientEmail,
            'scope' => self::SCOPE,
            'aud' => $tokenUri,
            'iat' => $now,
            'exp' => $now + 3600,
        ];

        $unsignedJwt = $this->base64UrlEncode(json_encode($header, JSON_THROW_ON_ERROR))
            . '.'
            . $this->base64UrlEncode(json_encode($claims, JSON_THROW_ON_ERROR));

        $signature = '';
        if (!openssl_sign($unsignedJwt, $signature, $privateKey, OPENSSL_ALGO_SHA256)) {
            throw new GoogleMerchantProductSyncException('Unable to sign Google service account JWT.');
        }

        $assertion = $unsignedJwt . '.' . $this->base64UrlEncode($signature);
        $response = Http::asForm()
            ->timeout(max((int) config('google_merchant.timeout', 30), 1))
            ->connectTimeout(max((int) config('google_merchant.connect_timeout', 10), 1))
            ->withOptions([
                'verify' => (bool) config('google_merchant.verify_ssl', true),
            ])
            ->post($tokenUri, [
                'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                'assertion' => $assertion,
            ]);

        if ($response->failed()) {
            throw new GoogleMerchantProductSyncException($this->responseErrorMessage($response, 'Unable to fetch Google access token.'));
        }

        $token = trim((string) $response->json('access_token', ''));
        if ($token === '') {
            throw new GoogleMerchantProductSyncException('Google token response did not include access_token.');
        }

        return $token;
    }

    private function serviceAccountCredentials(array $settings): array
    {
        $json = trim((string) ($settings['service_account_json'] ?? ''));

        if ($json === '') {
            $path = trim((string) config('google_merchant.service_account_json_path', ''));

            if ($path === '') {
                throw new GoogleMerchantProductSyncException('Missing Google service account credentials.');
            }

            if (!is_file($path) || !is_readable($path)) {
                throw new GoogleMerchantProductSyncException("Google service account JSON file is not readable: {$path}");
            }

            $json = (string) file_get_contents($path);
        }

        try {
            $credentials = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        } catch (Throwable $exception) {
            throw new GoogleMerchantProductSyncException('Invalid Google service account JSON.', 0, $exception);
        }

        if (!is_array($credentials)) {
            throw new GoogleMerchantProductSyncException('Google service account JSON must decode to an object.');
        }

        return $credentials;
    }

    private function accountId(array $settings): string
    {
        $accountId = trim((string) ($settings['merchant_id'] ?? ''));

        if ($accountId === '') {
            throw new GoogleMerchantProductSyncException('Missing Google Merchant Center ID.');
        }

        return $accountId;
    }

    private function dataSourceName(array $settings, string $accountId): string
    {
        $configuredName = trim((string) ($settings['data_source_name'] ?? ''));
        if ($configuredName !== '') {
            return $configuredName;
        }

        $dataSourceId = trim((string) ($settings['data_source_id'] ?? ''));
        if ($dataSourceId === '') {
            throw new GoogleMerchantProductSyncException('Missing Google Merchant dataSource ID.');
        }

        return "accounts/{$accountId}/dataSources/{$dataSourceId}";
    }

    private function resolveSyncAction(Product $product, array $settings, ?string $action): string
    {
        if ($action === 'delete') {
            return 'delete';
        }

        if (!$this->isProductBusinessActive($product)) {
            return 'delete';
        }

        return 'upsert';
    }

    private function resolveOfferId(Product $product, array $settings): string
    {
        $field = Str::lower(trim((string) ($settings['offer_id_field'] ?? 'sku')));

        if ($field === 'id') {
            return 'product-' . (int) $product->id;
        }

        $sku = trim((string) $product->sku);

        return $sku !== '' ? Str::limit($sku, 50, '') : 'product-' . (int) $product->id;
    }

    private function resolveDescription(Product $product): string
    {
        foreach ([$product->description, $product->meta_description, $product->additional_info, $product->specifications] as $value) {
            $text = $this->cleanText($this->decodeStructuredText($value), 5000);
            if ($text !== '') {
                return $text;
            }
        }

        return '';
    }

    private function decodeStructuredText(mixed $value): string
    {
        if ($value === null) {
            return '';
        }

        if (is_array($value)) {
            return collect($value)->map(fn ($item) => $this->decodeStructuredText($item))->filter()->implode(' ');
        }

        $text = trim((string) $value);
        if ($text === '') {
            return '';
        }

        try {
            $decoded = json_decode($text, true, 512, JSON_THROW_ON_ERROR);
            if (is_array($decoded)) {
                return $this->decodeStructuredText($decoded);
            }
        } catch (Throwable) {
            // Plain text or HTML; keep processing below.
        }

        return $text;
    }

    private function cleanText(string $value, int $limit): string
    {
        $text = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = Str::squish($text);

        return Str::limit($text, $limit, '');
    }

    private function resolveProductUrl(Product $product, array $settings): string
    {
        $targetProduct = $this->productUrlOwner($product);
        $identifier = trim((string) ($targetProduct->slug ?: $targetProduct->id));

        if ($identifier === '') {
            return '';
        }

        $baseUrl = $this->resolveProductBaseUrl($targetProduct, $settings);

        return $this->normalizeUrl($baseUrl, '/san-pham/' . rawurlencode($identifier));
    }

    private function productUrlOwner(Product $product): Product
    {
        $parent = $product->parentConfigurable->first();

        return $parent instanceof Product ? $parent : $product;
    }

    private function resolveProductBaseUrl(Product $product, array $settings): string
    {
        $domain = $product->siteDomain?->domain ?: $this->defaultDomainForProduct($product)?->domain;
        $domain = $this->normalizeDomain((string) $domain);

        if ($domain !== '') {
            return 'https://' . $domain;
        }

        return trim((string) ($settings['product_url_base'] ?? ''));
    }

    private function defaultDomainForProduct(Product $product): ?SiteDomain
    {
        $accountId = (int) $product->account_id;
        if ($accountId <= 0) {
            return null;
        }

        return SiteDomain::query()
            ->where('account_id', $accountId)
            ->where('is_active', true)
            ->orderByDesc('is_default')
            ->orderBy('id')
            ->first();
    }

    private function normalizeDomain(string $domain): string
    {
        $domain = trim($domain);
        $domain = preg_replace('#^https?://#i', '', $domain) ?? $domain;
        $domain = trim($domain, "/ \t\n\r\0\x0B");

        return $domain;
    }

    private function normalizeUrl(string $baseUrl, string $pathOrUrl): string
    {
        $value = trim($pathOrUrl);
        if ($value === '') {
            return '';
        }

        if (Str::startsWith($value, ['http://', 'https://'])) {
            return $value;
        }

        if (Str::startsWith($value, '//')) {
            return 'https:' . $value;
        }

        $baseUrl = trim($baseUrl);
        if ($baseUrl === '') {
            return '';
        }

        return rtrim($baseUrl, '/') . '/' . ltrim($value, '/');
    }

    private function resolveImageUrl(Product $product): string
    {
        $image = $this->primaryImageForProduct($product);
        if (!$image && $product !== $this->productUrlOwner($product)) {
            $image = $this->primaryImageForProduct($this->productUrlOwner($product));
        }

        return $this->imageUrl($image);
    }

    private function resolveAdditionalImageUrls(Product $product, string $primaryUrl): array
    {
        $urls = $this->imagesForProduct($product)
            ->map(fn (ProductImage $image) => $this->imageUrl($image))
            ->filter(fn (string $url) => $url !== '' && $url !== $primaryUrl)
            ->unique()
            ->values();

        return $urls->take(10)->all();
    }

    private function imageUrl(?ProductImage $image): string
    {
        $url = trim((string) ($image?->large_url ?: $image?->image_url ?: ''));

        if ($url === '') {
            return '';
        }

        return $this->normalizeUrl($this->mediaBaseUrl(), $url);
    }

    private function primaryImageForProduct(Product $product): ?ProductImage
    {
        return $this->imagesForProduct($product)->firstWhere('is_primary', true)
            ?: $this->imagesForProduct($product)->sortBy('sort_order')->first();
    }

    private function imagesForProduct(Product $product)
    {
        $images = $product->relationLoaded('images') ? $product->images : $product->images()->get();

        return $images->sortBy([
            ['is_primary', 'desc'],
            ['sort_order', 'asc'],
            ['id', 'asc'],
        ])->values();
    }

    private function mediaBaseUrl(): string
    {
        return trim((string) config('media.public_base_url', '')) ?: trim((string) config('app.url', ''));
    }

    private function resolveRegularPrice(Product $product): float
    {
        $price = (float) ($product->price ?: 0);

        return $price > 0 ? $price : (float) ($product->current_price ?: 0);
    }

    private function resolveSalePrice(Product $product, float $regularPrice): ?float
    {
        $currentPrice = (float) ($product->current_price ?: 0);
        if ($currentPrice > 0 && $regularPrice > 0 && $currentPrice < $regularPrice) {
            return $currentPrice;
        }

        return null;
    }

    private function resolveAvailability(Product $product): string
    {
        return 'IN_STOCK';
    }

    private function isProductBusinessActive(Product $product): bool
    {
        if (method_exists($product, 'trashed') && $product->trashed()) {
            return false;
        }

        return (bool) $product->status;
    }

    private function resolveGoogleProductCategory(Product $product, array $settings): string
    {
        $value = $this->productAttributeValue($product, [
            'google_product_category',
            'google product category',
            'google_category',
            'google category',
        ]);

        return $this->cleanText($value !== '' ? $value : (string) ($settings['default_google_product_category'] ?? ''), 750);
    }

    private function resolveProductTypes(Product $product): array
    {
        $primaryCategory = $product->relationLoaded('category') ? $product->category : null;
        $categories = $product->relationLoaded('categories') ? $product->categories : collect();

        return collect([$primaryCategory])
            ->merge($categories)
            ->filter()
            ->map(fn ($category) => $this->cleanText((string) ($category->name ?? ''), 750))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function productAttributeValue(Product $product, array $keys): string
    {
        if (!$product->relationLoaded('attributeValues')) {
            return '';
        }

        $lookup = collect($keys)->map(fn (string $key) => $this->normalizeAttributeKey($key))->all();

        foreach ($product->attributeValues ?? [] as $attributeValue) {
            $attribute = $attributeValue->attribute;
            $candidates = [
                $this->normalizeAttributeKey((string) ($attribute->code ?? '')),
                $this->normalizeAttributeKey((string) ($attribute->name ?? '')),
            ];

            if (count(array_intersect($lookup, $candidates)) > 0) {
                return trim((string) $attributeValue->value);
            }
        }

        return '';
    }

    private function normalizeAttributeKey(string $value): string
    {
        return Str::of($value)
            ->ascii()
            ->lower()
            ->replace(['_', '-'], ' ')
            ->squish()
            ->toString();
    }

    private function pricePayload(float $amount, array $settings): array
    {
        return [
            'amountMicros' => $this->toMicros($amount),
            'currencyCode' => (string) ($settings['currency'] ?? 'VND'),
        ];
    }

    private function toMicros(float $amount): string
    {
        return (string) (int) round($amount * 1_000_000);
    }

    private function productInputName(string $accountId, string $contentLanguage, string $feedLabel, string $offerId): string
    {
        $decodedName = "{$contentLanguage}~{$feedLabel}~{$offerId}";

        return "accounts/{$accountId}/productInputs/" . $this->base64UrlEncode($decodedName);
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function responseErrorMessage(Response $response, string $fallback): string
    {
        return $response->json('error.message')
            ?: $response->json('error_description')
            ?: $response->json('error')
            ?: $response->body()
            ?: $fallback;
    }

    private function markProductAttempt(Product $product, string $action, ?string $offerId, ?string $payloadHash): void
    {
        $product->forceFill([
            'google_merchant_last_attempted_at' => now(),
            'google_merchant_last_action' => $action,
            'google_merchant_offer_id' => $offerId,
            'google_merchant_last_payload_hash' => $payloadHash ?: $product->google_merchant_last_payload_hash,
        ])->saveQuietly();
    }

    private function markProductSuccess(Product $product, string $action, string $offerId, string $payloadHash, array $response): void
    {
        $product->forceFill([
            'google_merchant_sync_status' => 'synced',
            'google_merchant_last_synced_at' => now(),
            'google_merchant_last_attempted_at' => now(),
            'google_merchant_last_error' => null,
            'google_merchant_offer_id' => $offerId,
            'google_merchant_product_input_name' => $response['base64EncodedName'] ?? $response['name'] ?? $product->google_merchant_product_input_name,
            'google_merchant_last_payload_hash' => $payloadHash,
            'google_merchant_last_action' => $action,
        ])->saveQuietly();
    }

    private function markProductDeleted(Product $product, string $offerId): void
    {
        $product->forceFill([
            'google_merchant_sync_status' => 'not_synced',
            'google_merchant_last_synced_at' => now(),
            'google_merchant_last_attempted_at' => now(),
            'google_merchant_last_error' => null,
            'google_merchant_offer_id' => $offerId,
            'google_merchant_product_input_name' => null,
            'google_merchant_last_payload_hash' => null,
            'google_merchant_last_action' => 'delete',
        ])->saveQuietly();
    }

    private function markProductFailure(Product $product, string $action, ?string $offerId, Throwable $exception): void
    {
        $product->forceFill([
            'google_merchant_sync_status' => 'error',
            'google_merchant_last_attempted_at' => now(),
            'google_merchant_last_error' => Str::limit($exception->getMessage(), 5000, ''),
            'google_merchant_offer_id' => $offerId,
            'google_merchant_last_action' => $action,
        ])->saveQuietly();
    }

    private function recordApiLog(
        ?Product $product,
        ?string $offerId,
        string $action,
        string $method,
        string $url,
        ?array $payload,
        ?Response $response,
        ?Throwable $error,
        int $durationMs
    ): void {
        try {
            GoogleMerchantSyncLog::create([
                'account_id' => $product?->account_id,
                'product_id' => $product?->id,
                'offer_id' => $offerId,
                'action' => $action,
                'status' => $error ? 'error' : ($response?->successful() ? 'success' : 'error'),
                'request_method' => $method,
                'request_url' => $url,
                'request_payload' => $payload,
                'response_status' => $response?->status(),
                'response_body' => $this->loggableResponseBody($response),
                'error_message' => $error?->getMessage() ?: ($response?->failed() ? $this->responseErrorMessage($response, 'Google Merchant API error.') : null),
                'duration_ms' => $durationMs,
            ]);
        } catch (Throwable $loggingException) {
            Log::warning('Unable to write Google Merchant sync log.', [
                'product_id' => $product?->id,
                'offer_id' => $offerId,
                'message' => $loggingException->getMessage(),
            ]);
        }
    }

    private function loggableResponseBody(?Response $response): ?array
    {
        if (!$response) {
            return null;
        }

        $json = $response->json();
        if (is_array($json)) {
            return $json;
        }

        $body = trim($response->body());

        return $body !== '' ? ['raw' => Str::limit($body, 20000, '')] : null;
    }

    public function logFailure(Product $product, Throwable $exception): void
    {
        Log::warning('Google Merchant product sync failed.', [
            'product_id' => $product->id,
            'sku' => $product->sku,
            'message' => $exception->getMessage(),
        ]);
    }
}
