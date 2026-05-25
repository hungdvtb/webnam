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
    private const BUNDLE_OPTION_STATUS_VISIBLE = 'visible';
    private const BUNDLE_OPTION_STATUS_INTERNAL = 'internal';
    private const BUNDLE_FULL_SET_DISCOUNT_RATE = 0.10;
    private const BUNDLE_TOTAL_ROUNDING_UNIT = 10000;

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

        $this->loadProductMerchantRelations($product);

        if ($parent = $this->variantParent($product)) {
            return $this->syncVariantChildThroughParent($product, $parent, $action);
        }

        $accountId = $this->accountId($settings);
        $dataSourceName = $this->dataSourceName($settings, $accountId);
        $offerId = $this->resolveOfferId($product, $settings);
        $resolvedAction = $this->resolveSyncAction($product, $settings, $action);

        if (Str::startsWith($resolvedAction, 'delete')) {
            return $this->deleteProductAndBundleOptionInputs(
                $product,
                $settings,
                $accountId,
                $dataSourceName,
                $offerId,
                $resolvedAction,
                $this->productInactiveReason($product)
            );
        }

        $eligibilityFailures = $this->productInputEligibilityFailures($product, $settings);
        if (!empty($eligibilityFailures)) {
            $reason = implode(' ', $eligibilityFailures);

            if ($this->hasMerchantSyncState($product) || in_array((string) $product->type, ['bundle', 'configurable'], true)) {
                return $this->deleteProductAndBundleOptionInputs(
                    $product,
                    $settings,
                    $accountId,
                    $dataSourceName,
                    $offerId,
                    'delete_ineligible',
                    $reason
                );
            }

            return $this->markProductSkipped($product, $offerId, $reason);
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
            $variantChildDeleteResults = $this->deleteVariantChildInputs(
                $product,
                $settings,
                $accountId,
                $dataSourceName,
                'Bien the con khong con duoc day rieng len Google Merchant.'
            );
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

            if (!empty($variantChildDeleteResults)) {
                $result['variant_child_deletes'] = $variantChildDeleteResults;
            }

            return $result;
        } catch (Throwable $exception) {
            $this->markProductFailure($product, $resolvedAction, $offerId, $exception);
            throw $exception;
        }
    }

    private function syncVariantChildThroughParent(Product $variant, Product $parent, ?string $action = null): array
    {
        $settings = $this->settingsService->settingsFor((int) ($variant->account_id ?: $parent->account_id) ?: null);
        $accountId = $this->accountId($settings);
        $dataSourceName = $this->dataSourceName($settings, $accountId);
        $variantOfferId = $this->resolveOfferId($variant, $settings);
        $reason = 'Bien the con khong duoc day rieng; chi giu offer san pham cha tren Google Merchant.';

        $this->recordLocalLog(
            $variant,
            $variantOfferId,
            'variant_child_redirect',
            'skipped',
            'Bien the con khong duoc day rieng; dong bo lai san pham cha.'
        );

        $variantDeleteResult = $this->deleteProductInput(
            $variant,
            $settings,
            $accountId,
            $dataSourceName,
            $variantOfferId,
            'variant_child_delete',
            $reason
        );

        if ($action === 'delete') {
            $variantDeleteResult['redirected_from_variant_id'] = (int) $variant->id;
            $variantDeleteResult['redirected_from_variant_action'] = $action;

            return $variantDeleteResult;
        }

        $result = $this->syncProduct($parent, null);
        $result['variant_child_deletes'] = collect([$variantDeleteResult])
            ->merge($result['variant_child_deletes'] ?? [])
            ->unique(fn (array $deleteResult) => (string) ($deleteResult['offer_id'] ?? ''))
            ->values()
            ->all();
        $result['redirected_from_variant_id'] = (int) $variant->id;
        $result['redirected_from_variant_action'] = $action;

        return $result;
    }

    private function deleteProductAndBundleOptionInputs(
        Product $product,
        array $settings,
        string $accountId,
        string $dataSourceName,
        string $offerId,
        string $action = 'delete',
        ?string $reason = null
    ): array {
        $result = $this->deleteProductInput($product, $settings, $accountId, $dataSourceName, $offerId, $action, $reason);
        $bundleOptionResults = $this->deleteBundleOptionInputs(
            $product,
            $settings,
            $accountId,
            $dataSourceName,
            $offerId,
            null,
            'bundle_option_delete',
            $reason
        );

        if ($reason !== null && $reason !== '') {
            $result['reason'] = $reason;
        }

        if (!empty($bundleOptionResults)) {
            $result['bundle_options'] = $bundleOptionResults;
        }

        $variantChildDeleteResults = $this->deleteVariantChildInputs(
            $product,
            $settings,
            $accountId,
            $dataSourceName,
            $reason ?: 'San pham cha khong con du dieu kien nen bien the con cung phai go khoi Google Merchant.'
        );

        if (!empty($variantChildDeleteResults)) {
            $result['variant_child_deletes'] = $variantChildDeleteResults;
        }

        return $result;
    }

    public function deleteProductInput(
        Product $product,
        array $settings,
        string $accountId,
        string $dataSourceName,
        string $offerId,
        string $action = 'delete',
        ?string $reason = null
    ): array
    {
        if ($offerId === '') {
            throw new GoogleMerchantProductSyncException('Product has no stable offer ID.');
        }

        $name = $product->google_merchant_product_input_name
            ?: $this->productInputName($accountId, (string) $settings['content_language'], (string) $settings['feed_label'], $offerId);
        $url = sprintf(self::DELETE_ENDPOINT, $name)
            . '?dataSource=' . rawurlencode($dataSourceName);

        $this->markProductAttempt($product, $action, $offerId, null);

        try {
            $response = $this->sendMerchantRequest('delete', $url, null, $product, $offerId, $action, $settings);

            if ($response->failed() && $response->status() !== 404) {
                throw new GoogleMerchantProductSyncException($this->responseErrorMessage($response, 'Google Merchant API rejected the product delete request.'));
            }

            $this->markProductDeleted($product, $offerId, $action);

            $result = [
                'status' => 'deleted',
                'action' => $action,
                'product_id' => (int) $product->id,
                'offer_id' => $offerId,
                'response' => $response->json() ?: [],
            ];

            if ($reason !== null && $reason !== '') {
                $result['reason'] = $reason;
            }

            return $result;
        } catch (Throwable $exception) {
            $this->markProductFailure($product, $action, $offerId, $exception);
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

        if ($parent = $this->variantParent($product)) {
            return $this->buildProductInputPayload($parent, $settings, $options);
        }

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

        $eligibilityFailures = $this->productInputEligibilityFailures($product, $settings, [
            'offer_id' => $offerId,
            'title' => $title,
            'link' => $link,
            'image_link' => $imageLink,
            'regular_price' => $regularPrice,
        ]);

        if (!empty($eligibilityFailures)) {
            throw new GoogleMerchantProductSyncException(
                'San pham khong du dieu kien dong bo Google Merchant: ' . implode(' ', $eligibilityFailures)
            );
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
        $this->loadProductMerchantRelations($product);

        if ($parent = $this->variantParent($product)) {
            return $this->buildProductInputPayloads($parent, $settings);
        }

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
        foreach ($this->bundleOptionGroups($product, self::BUNDLE_OPTION_STATUS_VISIBLE) as $option) {
            $eligibilityFailures = $this->bundleOptionEligibilityFailures($product, $option, $settings);
            if (!empty($eligibilityFailures)) {
                $results[] = $this->deleteBundleOptionInput(
                    $product,
                    $settings,
                    $accountId,
                    $dataSourceName,
                    $parentOfferId,
                    $option,
                    'bundle_option_delete_ineligible',
                    implode(' ', $eligibilityFailures)
                );

                continue;
            }

            $entry = [
                ...$option,
                'payload' => $this->buildBundleOptionInputPayload($product, $option, $settings, $parentOfferId),
            ];
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

        return array_merge(
            $results,
            $this->deleteBundleOptionInputs(
                $product,
                $settings,
                $accountId,
                $dataSourceName,
                $parentOfferId,
                self::BUNDLE_OPTION_STATUS_INTERNAL,
                'bundle_option_delete_internal',
                'Tuy chon bundle dang o trang thai Noi bo va khong duoc xuat hien tren Google Merchant.'
            )
        );
    }

    private function deleteBundleOptionInputs(
        Product $product,
        array $settings,
        string $accountId,
        string $dataSourceName,
        string $parentOfferId,
        ?string $visibility = null,
        string $action = 'bundle_option_delete',
        ?string $reason = null
    ): array
    {
        $results = [];
        foreach ($this->bundleOptionGroups($product, $visibility) as $option) {
            $results[] = $this->deleteBundleOptionInput(
                $product,
                $settings,
                $accountId,
                $dataSourceName,
                $parentOfferId,
                $option,
                $action,
                $reason
            );
        }

        return $results;
    }

    private function deleteBundleOptionInput(
        Product $product,
        array $settings,
        string $accountId,
        string $dataSourceName,
        string $parentOfferId,
        array $option,
        string $action,
        ?string $reason = null
    ): array {
        $offerId = $this->bundleOptionOfferId($parentOfferId, $option);
        $name = $this->productInputName(
            $accountId,
            (string) $settings['content_language'],
            (string) $settings['feed_label'],
            $offerId
        );
        $url = sprintf(self::DELETE_ENDPOINT, $name)
            . '?dataSource=' . rawurlencode($dataSourceName);
        $response = $this->sendMerchantRequest('delete', $url, null, $product, $offerId, $action, $settings);

        if ($response->failed() && $response->status() !== 404) {
            throw new GoogleMerchantProductSyncException($this->responseErrorMessage($response, 'Google Merchant API rejected the bundle option delete request.'));
        }

        $result = [
            'status' => 'deleted',
            'action' => $action,
            'offer_id' => $offerId,
            'title' => $option['title'],
            'response' => $response->json() ?: [],
        ];

        if ($reason !== null && $reason !== '') {
            $result['reason'] = $reason;
        }

        return $result;
    }

    private function deleteVariantChildInputs(
        Product $product,
        array $settings,
        string $accountId,
        string $dataSourceName,
        string $reason
    ): array {
        if ((string) $product->type !== 'configurable') {
            return [];
        }

        return $this->configurableProductVariants($product, true)
            ->map(function (Product $variant) use ($settings, $accountId, $dataSourceName, $reason) {
                return $this->deleteProductInput(
                    $variant,
                    $settings,
                    $accountId,
                    $dataSourceName,
                    $this->resolveOfferId($variant, $settings),
                    'variant_child_delete',
                    $reason
                );
            })
            ->values()
            ->all();
    }

    private function bundleOptionPayloadEntries(Product $product, array $settings, string $parentOfferId): array
    {
        return collect($this->bundleOptionGroups($product, self::BUNDLE_OPTION_STATUS_VISIBLE))
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
        $displayProduct = $this->productUrlOwner($product);
        $title = $this->cleanText((string) ($option['title'] ?? ''), 150);
        $description = $this->resolveDescription($displayProduct);
        $link = $this->resolveBundleOptionProductUrl($displayProduct, $option, $settings);
        $imageLink = $this->resolveImageUrl($displayProduct);
        $additionalImages = $this->resolveAdditionalImageUrls($displayProduct, $imageLink);
        $price = (float) $option['price'];
        $googleProductCategory = $this->resolveGoogleProductCategory($displayProduct, $settings);
        $productTypes = $this->resolveProductTypes($displayProduct);

        $eligibilityFailures = $this->bundleOptionEligibilityFailures($displayProduct, $option, $settings, [
            'title' => $title,
            'link' => $link,
            'image_link' => $imageLink,
            'price' => $price,
        ]);

        if (!empty($eligibilityFailures)) {
            throw new GoogleMerchantProductSyncException(
                'Tuy chon bundle khong du dieu kien dong bo Google Merchant: ' . implode(' ', $eligibilityFailures)
            );
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

    private function bundleOptionGroups(Product $product, ?string $visibility = null): array
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
                $status = $this->resolveBundleOptionGroupStatus($optionItems);
                $postId = filled($first?->pivot?->option_post_id ?? null)
                    ? (int) $first->pivot->option_post_id
                    : null;
                $title = $optionItems
                    ->map(fn (Product $item) => trim((string) ($item->pivot?->option_title ?? '')))
                    ->first(fn (string $value) => $value !== '')
                    ?: trim((string) ($product->bundle_title ?: $product->name));

                return [
                    'key' => $key,
                    'uid' => $uid,
                    'title' => $title,
                    'post_id' => $postId,
                    'public_key' => $this->bundleOptionPublicKey($postId, $title),
                    'status' => $status,
                    'has_inactive_item' => collect($optionItems)
                        ->contains(fn (Product $item) => !$this->isProductBusinessActive($item)),
                    'price' => $this->resolveBundleOptionPrice($optionItems),
                ];
            })
            ->filter(fn (array $option) => $visibility === null || $option['status'] === $visibility)
            ->values()
            ->all();
    }

    private function resolveBundleOptionGroupStatus($optionItems): string
    {
        $hasInternalItem = collect($optionItems)
            ->contains(fn (Product $item) => $this->isInternalBundleOptionStatus($item->pivot?->bundle_option_status ?? null));

        return $hasInternalItem ? self::BUNDLE_OPTION_STATUS_INTERNAL : self::BUNDLE_OPTION_STATUS_VISIBLE;
    }

    private function isInternalBundleOptionStatus(mixed $value): bool
    {
        return Str::lower(Str::squish((string) $value)) === self::BUNDLE_OPTION_STATUS_INTERNAL;
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
        $total = (float) collect($items)->sum(function (Product $item) {
            $quantity = (float) ($item->pivot?->quantity ?? 1);
            $quantity = $quantity > 0 ? $quantity : 1;
            $pivotPrice = $item->pivot?->price;
            $unitPrice = is_numeric($pivotPrice) && (float) $pivotPrice > 0
                ? (float) $pivotPrice
                : $this->resolveRegularPrice($item);

            return $unitPrice * $quantity;
        });

        return $this->discountFullBundleTotal($total);
    }

    private function discountFullBundleTotal(float $total): float
    {
        $normalizedTotal = max(round($total, 2), 0);
        if ($normalizedTotal <= 0) {
            return 0.0;
        }

        $discountedSubtotal = max($normalizedTotal - round($normalizedTotal * self::BUNDLE_FULL_SET_DISCOUNT_RATE, 0), 0);

        return floor($discountedSubtotal / self::BUNDLE_TOTAL_ROUNDING_UNIT) * self::BUNDLE_TOTAL_ROUNDING_UNIT;
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
                'variations.images',
                'variations.categories',
                'variations.attributeValues.attribute',
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
        $action = Str::lower(trim((string) $action));

        if ($action === 'delete') {
            return 'delete';
        }

        if ($this->productInactiveReason($product) !== null) {
            return 'delete_inactive';
        }

        if ($action === 'out_of_stock') {
            return 'out_of_stock';
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

    private function resolveBundleOptionProductUrl(Product $product, array $option, array $settings): string
    {
        $url = $this->resolveProductUrl($product, $settings);
        if ($url === '') {
            return '';
        }

        $query = [];
        $uid = trim((string) ($option['uid'] ?? ''));
        if ($uid !== '') {
            $query['bundle_option_uid'] = $uid;
        }

        $publicKey = trim((string) ($option['public_key'] ?? ''));
        if ($publicKey !== '') {
            $query['bundle_option_key'] = $publicKey;
        }

        $title = trim((string) ($option['title'] ?? ''));
        if ($title !== '') {
            $query['bundle_option'] = $title;
        }

        if (empty($query)) {
            return $url;
        }

        $separator = str_contains($url, '?') ? '&' : '?';

        return $url . $separator . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    }

    private function bundleOptionPublicKey($postId, ?string $title): string
    {
        if (filled($postId) && is_numeric($postId)) {
            return 'post:' . (int) $postId;
        }

        $normalizedTitle = Str::of((string) $title)
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', ' ')
            ->squish()
            ->value();

        return 'title:' . ($normalizedTitle !== '' ? $normalizedTitle : 'mac dinh');
    }

    private function productUrlOwner(Product $product): Product
    {
        $parent = $product->parentConfigurable->first();

        return $parent instanceof Product ? $parent : $product;
    }

    private function variantParent(Product $product): ?Product
    {
        if ((string) $product->type === 'configurable') {
            return null;
        }

        $parent = $product->parentConfigurable->first();

        return $parent instanceof Product ? $parent : null;
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
        if ((string) $product->type === 'configurable') {
            $variant = $this->cheapestEligibleVariant($product);
            if (!$variant) {
                return 0.0;
            }

            $price = (float) ($variant->price ?: 0);
            if ($price > 0) {
                return $price;
            }

            return $this->variantSellingPrice($variant);
        }

        $price = (float) ($product->price ?: 0);

        return $price > 0 ? $price : (float) ($product->current_price ?: 0);
    }

    private function resolveSalePrice(Product $product, float $regularPrice): ?float
    {
        if ((string) $product->type === 'configurable') {
            $variant = $this->cheapestEligibleVariant($product);
            if (!$variant) {
                return null;
            }

            $currentPrice = $this->variantSellingPrice($variant);
            if ($currentPrice > 0 && $regularPrice > 0 && $currentPrice < $regularPrice) {
                return $currentPrice;
            }

            return null;
        }

        $currentPrice = (float) ($product->current_price ?: 0);
        if ($currentPrice > 0 && $regularPrice > 0 && $currentPrice < $regularPrice) {
            return $currentPrice;
        }

        return null;
    }

    private function cheapestEligibleVariant(Product $product): ?Product
    {
        if ((string) $product->type !== 'configurable' || !$this->isProductBusinessActive($product)) {
            return null;
        }

        return $this->configurableProductVariants($product)
            ->filter(fn (Product $variant) => $this->isEligibleVariantForParentOffer($variant))
            ->sortBy(fn (Product $variant) => $this->variantSellingPrice($variant))
            ->first();
    }

    private function configurableProductVariants(Product $product, bool $includeTrashed = false)
    {
        if ((string) $product->type !== 'configurable') {
            return collect();
        }

        if (!$includeTrashed && $product->relationLoaded('variations')) {
            return $product->variations;
        }

        $query = $product->variations();
        if ($includeTrashed) {
            $query->withTrashed();
        }

        return $query->get();
    }

    private function isEligibleVariantForParentOffer(Product $variant): bool
    {
        if (method_exists($variant, 'trashed') && $variant->trashed()) {
            return false;
        }

        if (!$this->isProductBusinessActive($variant)) {
            return false;
        }

        return $this->variantSellingPrice($variant) > 0;
    }

    private function variantSellingPrice(Product $variant): float
    {
        $currentPrice = (float) ($variant->current_price ?: 0);
        if ($currentPrice > 0) {
            return $currentPrice;
        }

        return (float) ($variant->price ?: 0);
    }

    private function resolveAvailability(Product $product): string
    {
        return 'IN_STOCK';
    }

    private function productInputEligibilityFailures(Product $product, array $settings, array $resolved = []): array
    {
        $this->loadProductMerchantRelations($product);

        $failures = [];
        $inactiveReason = $this->productInactiveReason($product);
        if ($inactiveReason !== null) {
            $failures[] = $inactiveReason;
        }

        if ((string) $product->type === 'configurable' && !$this->cheapestEligibleVariant($product)) {
            $failures[] = 'San pham co bien the chua co bien the hop le de lay gia ban.';
        }

        $offerId = array_key_exists('offer_id', $resolved)
            ? trim((string) $resolved['offer_id'])
            : $this->resolveOfferId($product, $settings);
        if ($offerId === '') {
            $failures[] = 'San pham chua co ma offer on dinh.';
        }

        $title = array_key_exists('title', $resolved)
            ? trim((string) $resolved['title'])
            : $this->cleanText((string) $product->name, 150);
        if ($title === '') {
            $failures[] = 'Ten san pham dang trong.';
        }

        $link = array_key_exists('link', $resolved)
            ? trim((string) $resolved['link'])
            : $this->resolveProductUrl($product, $settings);
        if (!$this->isValidPublicUrl($link)) {
            $failures[] = 'Link cong khai cua san pham dang trong hoac khong hop le.';
        }

        $domain = $this->productUrlOwner($product)->siteDomain;
        if ($domain instanceof SiteDomain && !(bool) $domain->is_active) {
            $failures[] = 'Ten mien website cua san pham dang tat.';
        }

        $imageLink = array_key_exists('image_link', $resolved)
            ? trim((string) $resolved['image_link'])
            : $this->resolveImageUrl($product);
        if (!$this->isValidPublicUrl($imageLink)) {
            $failures[] = 'Anh dai dien cua san pham dang trong hoac khong hop le.';
        }

        $regularPrice = array_key_exists('regular_price', $resolved)
            ? (float) $resolved['regular_price']
            : $this->resolveRegularPrice($product);
        if ($regularPrice <= 0) {
            $failures[] = 'Gia ban san pham phai lon hon 0.';
        }

        if (!$this->hasProductCategory($product)) {
            $failures[] = 'San pham chua co danh muc.';
        }

        return $failures;
    }

    private function bundleOptionEligibilityFailures(Product $product, array $option, array $settings, array $resolved = []): array
    {
        $failures = [];

        if (!empty($option['has_inactive_item'])) {
            $failures[] = 'Tuy chon bundle co san pham thanh phan dang tat trang thai kinh doanh.';
        }

        $title = array_key_exists('title', $resolved)
            ? trim((string) $resolved['title'])
            : $this->cleanText((string) ($option['title'] ?? ''), 150);
        if ($title === '') {
            $failures[] = 'Ten tuy chon bundle dang trong.';
        }

        $link = array_key_exists('link', $resolved)
            ? trim((string) $resolved['link'])
            : $this->resolveProductUrl($product, $settings);
        if (!$this->isValidPublicUrl($link)) {
            $failures[] = 'Link cong khai cua tuy chon bundle dang trong hoac khong hop le.';
        }

        $imageLink = array_key_exists('image_link', $resolved)
            ? trim((string) $resolved['image_link'])
            : $this->resolveImageUrl($product);
        if (!$this->isValidPublicUrl($imageLink)) {
            $failures[] = 'Anh dai dien cua tuy chon bundle dang trong hoac khong hop le.';
        }

        $price = array_key_exists('price', $resolved)
            ? (float) $resolved['price']
            : (float) ($option['price'] ?? 0);
        if ($price <= 0) {
            $failures[] = "Gia ban tuy chon bundle phai lon hon 0: {$title}";
        }

        if (!$this->hasProductCategory($product)) {
            $failures[] = 'San pham bundle chua co danh muc.';
        }

        return $failures;
    }

    private function productInactiveReason(Product $product): ?string
    {
        if (method_exists($product, 'trashed') && $product->trashed()) {
            return 'San pham da bi xoa va phai duoc go khoi Google Merchant.';
        }

        if (!$this->isProductBusinessActive($product)) {
            return 'Trang thai kinh doanh khong phai "Dang mo ban tren toan he thong".';
        }

        $owner = $this->productUrlOwner($product);
        if ((int) $owner->id !== (int) $product->id && !$this->isProductBusinessActive($owner)) {
            return 'Trang thai kinh doanh cua san pham cha dang tat.';
        }

        return null;
    }

    private function isProductBusinessActive(Product $product): bool
    {
        if (method_exists($product, 'trashed') && $product->trashed()) {
            return false;
        }

        return (bool) $product->status;
    }

    private function isValidPublicUrl(string $url): bool
    {
        $url = trim($url);

        return $url !== ''
            && filter_var($url, FILTER_VALIDATE_URL) !== false
            && Str::startsWith(Str::lower($url), ['http://', 'https://']);
    }

    private function hasProductCategory(Product $product): bool
    {
        if ($this->modelHasProductCategory($product)) {
            return true;
        }

        $owner = $this->productUrlOwner($product);
        if ((int) $owner->id !== (int) $product->id) {
            return $this->modelHasProductCategory($owner);
        }

        return false;
    }

    private function modelHasProductCategory(Product $product): bool
    {
        if ($product->relationLoaded('category') && $product->category) {
            return true;
        }

        if ($product->relationLoaded('categories') && $product->categories->isNotEmpty()) {
            return true;
        }

        return (int) ($product->category_id ?? 0) > 0;
    }

    private function hasMerchantSyncState(Product $product): bool
    {
        return trim((string) $product->google_merchant_offer_id) !== ''
            || trim((string) $product->google_merchant_product_input_name) !== ''
            || (string) $product->google_merchant_sync_status === 'synced';
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
        $owner = $this->productUrlOwner($product);
        $categorySource = $this->modelHasProductCategory($product) ? $product : $owner;
        $primaryCategory = $categorySource->relationLoaded('category') ? $categorySource->category : null;
        $categories = $categorySource->relationLoaded('categories') ? $categorySource->categories : collect();

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

    private function markProductDeleted(Product $product, string $offerId, string $action = 'delete'): void
    {
        $product->forceFill([
            'google_merchant_sync_status' => 'not_synced',
            'google_merchant_last_synced_at' => now(),
            'google_merchant_last_attempted_at' => now(),
            'google_merchant_last_error' => null,
            'google_merchant_offer_id' => $offerId,
            'google_merchant_product_input_name' => null,
            'google_merchant_last_payload_hash' => null,
            'google_merchant_last_action' => $action,
        ])->saveQuietly();
    }

    private function markProductSkipped(Product $product, ?string $offerId, string $reason): array
    {
        $product->forceFill([
            'google_merchant_sync_status' => 'not_synced',
            'google_merchant_last_attempted_at' => now(),
            'google_merchant_last_error' => Str::limit($reason, 5000, ''),
            'google_merchant_offer_id' => $offerId,
            'google_merchant_product_input_name' => null,
            'google_merchant_last_payload_hash' => null,
            'google_merchant_last_action' => 'skip_ineligible',
        ])->saveQuietly();

        $this->recordLocalLog($product, $offerId, 'skip_ineligible', 'skipped', $reason);

        Log::info('Google Merchant product sync skipped.', [
            'product_id' => $product->id,
            'sku' => $product->sku,
            'offer_id' => $offerId,
            'reason' => $reason,
        ]);

        return [
            'status' => 'skipped',
            'action' => 'skip_ineligible',
            'product_id' => (int) $product->id,
            'offer_id' => $offerId,
            'reason' => $reason,
        ];
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
                'status' => $this->logStatusForMerchantResponse($method, $response, $error),
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

    private function logStatusForMerchantResponse(string $method, ?Response $response, ?Throwable $error): string
    {
        if ($error !== null) {
            return 'error';
        }

        if ($response?->successful()) {
            return 'success';
        }

        if ($method === 'DELETE' && $response?->status() === 404) {
            return 'success';
        }

        return 'error';
    }

    private function recordLocalLog(?Product $product, ?string $offerId, string $action, string $status, ?string $message = null): void
    {
        try {
            GoogleMerchantSyncLog::create([
                'account_id' => $product?->account_id,
                'product_id' => $product?->id,
                'offer_id' => $offerId,
                'action' => $action,
                'status' => $status,
                'error_message' => $message,
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
