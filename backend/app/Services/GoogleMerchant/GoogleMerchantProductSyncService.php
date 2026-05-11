<?php

namespace App\Services\GoogleMerchant;

use App\Models\Product;
use App\Models\ProductImage;
use App\Models\SiteDomain;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

class GoogleMerchantProductSyncService
{
    private const SCOPE = 'https://www.googleapis.com/auth/content';
    private const INSERT_ENDPOINT = 'https://merchantapi.googleapis.com/products/v1/accounts/%s/productInputs:insert';
    private const DATA_SOURCES_ENDPOINT = 'https://merchantapi.googleapis.com/datasources/v1/accounts/%s/dataSources';
    private const REGISTER_GCP_ENDPOINT = 'https://merchantapi.googleapis.com/accounts/v1/accounts/%s/developerRegistration:registerGcp';

    public function enabled(): bool
    {
        return (bool) config('google_merchant.enabled', false);
    }

    public function syncProduct(Product $product): array
    {
        if (!$this->enabled()) {
            return [
                'status' => 'skipped',
                'reason' => 'Google Merchant sync is disabled.',
            ];
        }

        $accountId = $this->accountId();
        $dataSourceName = $this->dataSourceName($accountId);
        $payload = $this->buildProductInputPayload($product);
        $url = sprintf(self::INSERT_ENDPOINT, rawurlencode($accountId))
            . '?dataSource=' . rawurlencode($dataSourceName);

        $response = $this->baseRequest()
            ->withToken($this->accessToken())
            ->post($url, $payload);

        if ($response->failed()) {
            $message = $response->json('error.message')
                ?: $response->body()
                ?: 'Google Merchant API rejected the product.';

            throw new GoogleMerchantProductSyncException($message);
        }

        return [
            'status' => 'synced',
            'product_id' => (int) $product->id,
            'offer_id' => $payload['offerId'] ?? null,
            'response' => $response->json(),
        ];
    }

    public function listDataSources(): array
    {
        $accountId = $this->accountId();
        $dataSources = [];
        $pageToken = null;

        do {
            $query = ['pageSize' => 1000];
            if ($pageToken) {
                $query['pageToken'] = $pageToken;
            }

            $response = $this->baseRequest()
                ->withToken($this->accessToken())
                ->get(sprintf(self::DATA_SOURCES_ENDPOINT, rawurlencode($accountId)), $query);

            if ($response->failed()) {
                $message = $response->json('error.message')
                    ?: $response->body()
                    ?: 'Google Merchant API rejected the data source list request.';

                throw new GoogleMerchantProductSyncException($message);
            }

            $body = $response->json();
            $dataSources = array_merge($dataSources, (array) ($body['dataSources'] ?? []));
            $pageToken = trim((string) ($body['nextPageToken'] ?? ''));
        } while ($pageToken !== '');

        return $dataSources;
    }

    public function registerGcpProject(string $developerEmail): array
    {
        $developerEmail = trim($developerEmail);

        if ($developerEmail === '' || !filter_var($developerEmail, FILTER_VALIDATE_EMAIL)) {
            throw new GoogleMerchantProductSyncException('Developer email must be a valid Google account email.');
        }

        $accountId = $this->accountId();
        $response = $this->baseRequest()
            ->withToken($this->accessToken())
            ->post(sprintf(self::REGISTER_GCP_ENDPOINT, rawurlencode($accountId)), [
                'developerEmail' => $developerEmail,
            ]);

        if ($response->failed()) {
            $message = $response->json('error.message')
                ?: $response->body()
                ?: 'Google Merchant API rejected the GCP project registration request.';

            throw new GoogleMerchantProductSyncException($message);
        }

        return $response->json() ?: [];
    }

    public function buildProductInputPayload(Product $product): array
    {
        $product->loadMissing([
            'images',
            'siteDomain',
            'parentConfigurable.siteDomain',
            'parentConfigurable.images',
        ]);

        $offerId = $this->resolveOfferId($product);
        $title = $this->cleanText((string) $product->name, 150);
        $description = $this->resolveDescription($product);
        $link = $this->resolveProductUrl($product);
        $imageLink = $this->resolveImageUrl($product);
        $price = $this->resolvePrice($product);

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

        if ($price <= 0) {
            throw new GoogleMerchantProductSyncException('Product price must be greater than 0.');
        }

        return [
            'offerId' => $offerId,
            'contentLanguage' => (string) config('google_merchant.content_language', 'vi'),
            'feedLabel' => (string) config('google_merchant.feed_label', 'VN'),
            'productAttributes' => [
                'title' => $title,
                'description' => $description !== '' ? $description : $title,
                'link' => $link,
                'imageLink' => $imageLink,
                'availability' => $this->resolveAvailability($product),
                'price' => [
                    'amountMicros' => $this->toMicros($price),
                    'currencyCode' => (string) config('google_merchant.currency', 'VND'),
                ],
                'condition' => 'NEW',
            ],
        ];
    }

    private function baseRequest(): PendingRequest
    {
        return Http::acceptJson()
            ->asJson()
            ->timeout(max((int) config('google_merchant.timeout', 30), 1))
            ->connectTimeout(max((int) config('google_merchant.connect_timeout', 10), 1))
            ->withOptions([
                'verify' => (bool) config('google_merchant.verify_ssl', true),
            ]);
    }

    private function accessToken(): string
    {
        $staticAccessToken = trim((string) config('google_merchant.access_token', ''));
        if ($staticAccessToken !== '') {
            return $staticAccessToken;
        }

        $credentials = $this->serviceAccountCredentials();
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
            $message = $response->json('error_description')
                ?: $response->json('error')
                ?: $response->body()
                ?: 'Unable to fetch Google access token.';

            throw new GoogleMerchantProductSyncException($message);
        }

        $token = trim((string) $response->json('access_token', ''));
        if ($token === '') {
            throw new GoogleMerchantProductSyncException('Google token response did not include access_token.');
        }

        return $token;
    }

    private function serviceAccountCredentials(): array
    {
        $json = trim((string) config('google_merchant.service_account_json', ''));

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

    private function accountId(): string
    {
        $accountId = trim((string) config('google_merchant.account_id', ''));

        if ($accountId === '') {
            throw new GoogleMerchantProductSyncException('Missing GOOGLE_MERCHANT_ACCOUNT_ID.');
        }

        return $accountId;
    }

    private function dataSourceName(string $accountId): string
    {
        $configuredName = trim((string) config('google_merchant.data_source_name', ''));
        if ($configuredName !== '') {
            return $configuredName;
        }

        $dataSourceId = trim((string) config('google_merchant.data_source_id', ''));
        if ($dataSourceId === '') {
            throw new GoogleMerchantProductSyncException('Missing GOOGLE_MERCHANT_DATA_SOURCE_ID.');
        }

        return "accounts/{$accountId}/dataSources/{$dataSourceId}";
    }

    private function resolveOfferId(Product $product): string
    {
        $field = Str::lower(trim((string) config('google_merchant.offer_id_field', 'sku')));

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
        } catch (Throwable $exception) {
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

    private function resolveProductUrl(Product $product): string
    {
        $targetProduct = $this->productUrlOwner($product);
        $identifier = trim((string) ($targetProduct->slug ?: $targetProduct->id));

        if ($identifier === '') {
            return '';
        }

        $baseUrl = $this->resolveProductBaseUrl($targetProduct);

        return $this->normalizeUrl($baseUrl, '/san-pham/' . rawurlencode($identifier));
    }

    private function productUrlOwner(Product $product): Product
    {
        $parent = $product->parentConfigurable->first();

        return $parent instanceof Product ? $parent : $product;
    }

    private function resolveProductBaseUrl(Product $product): string
    {
        $domain = $product->siteDomain?->domain ?: $this->defaultDomainForProduct($product)?->domain;
        $domain = $this->normalizeDomain((string) $domain);

        if ($domain !== '') {
            return 'https://' . $domain;
        }

        return trim((string) config('google_merchant.product_url_base', ''));
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

        $url = trim((string) ($image?->large_url ?: $image?->image_url ?: ''));

        if ($url === '') {
            return '';
        }

        return $this->normalizeUrl($this->mediaBaseUrl(), $url);
    }

    private function primaryImageForProduct(Product $product): ?ProductImage
    {
        $images = $product->relationLoaded('images') ? $product->images : $product->images()->get();

        return $images->firstWhere('is_primary', true) ?: $images->sortBy('sort_order')->first();
    }

    private function mediaBaseUrl(): string
    {
        return trim((string) config('media.public_base_url', '')) ?: trim((string) config('app.url', ''));
    }

    private function resolvePrice(Product $product): float
    {
        return (float) ($product->current_price ?: $product->price ?: 0);
    }

    private function resolveAvailability(Product $product): string
    {
        if (!$product->status) {
            return 'OUT_OF_STOCK';
        }

        return ((int) $product->stock_quantity) > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';
    }

    private function toMicros(float $amount): string
    {
        return (string) (int) round($amount * 1_000_000);
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
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
