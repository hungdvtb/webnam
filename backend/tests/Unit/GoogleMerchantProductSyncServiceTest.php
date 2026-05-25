<?php

namespace Tests\Unit;

use App\Models\Product;
use App\Models\ProductImage;
use App\Models\SiteDomain;
use App\Services\GoogleMerchant\GoogleMerchantProductSyncService;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Tests\TestCase;

class GoogleMerchantProductSyncServiceTest extends TestCase
{
    public function test_it_builds_a_google_merchant_product_input_payload(): void
    {
        config([
            'google_merchant.content_language' => 'vi',
            'google_merchant.feed_label' => 'VN',
            'google_merchant.currency' => 'VND',
            'google_merchant.offer_id_field' => 'sku',
            'google_merchant.product_url_base' => 'https://gomdaithanh.com',
        ]);

        $domain = new SiteDomain([
            'domain' => 'gomdaithanh.com',
            'is_active' => true,
            'is_default' => true,
        ]);
        $product = new Product([
            'account_id' => 1,
            'site_domain_id' => 1,
            'type' => 'simple',
            'name' => 'Bo do tho men lam',
            'slug' => 'bo-do-tho-men-lam',
            'description' => '<p>Bo do tho gom su Bat Trang.</p>',
            'price' => 250000,
            'category_id' => 6,
            'sku' => 'GDT-001',
            'stock_quantity' => 0,
            'status' => true,
        ]);
        $product->id = 123;
        $product->exists = true;

        $image = new ProductImage([
            'product_id' => $product->id,
            'image_url' => 'https://cdn.gomdaithanh.com/products/gdt-001.jpg',
            'is_primary' => true,
            'sort_order' => 0,
        ]);
        $image->exists = true;

        $product->setRelation('siteDomain', $domain);
        $product->setRelation('images', new EloquentCollection([$image]));
        $product->setRelation('parentConfigurable', new EloquentCollection());

        $payload = app(GoogleMerchantProductSyncService::class)
            ->buildProductInputPayload($product);

        $this->assertSame('GDT-001', $payload['offerId']);
        $this->assertSame('vi', $payload['contentLanguage']);
        $this->assertSame('VN', $payload['feedLabel']);
        $this->assertSame('Bo do tho men lam', $payload['productAttributes']['title']);
        $this->assertSame('Bo do tho gom su Bat Trang.', $payload['productAttributes']['description']);
        $this->assertArrayNotHasKey('brand', $payload['productAttributes']);
        $this->assertSame('https://gomdaithanh.com/san-pham/bo-do-tho-men-lam', $payload['productAttributes']['link']);
        $this->assertSame('https://cdn.gomdaithanh.com/products/gdt-001.jpg', $payload['productAttributes']['imageLink']);
        $this->assertSame('IN_STOCK', $payload['productAttributes']['availability']);
        $this->assertSame('250000000000', $payload['productAttributes']['price']['amountMicros']);
        $this->assertSame('VND', $payload['productAttributes']['price']['currencyCode']);
    }

    public function test_inactive_products_resolve_to_delete_action(): void
    {
        $product = new Product([
            'status' => false,
        ]);
        $product->id = 123;
        $product->exists = true;

        $service = app(GoogleMerchantProductSyncService::class);
        $method = new \ReflectionMethod($service, 'resolveSyncAction');
        $method->setAccessible(true);

        $this->assertSame('delete_inactive', $method->invoke($service, $product, [], null));
    }

    public function test_bundle_product_payloads_include_bundle_options(): void
    {
        config([
            'google_merchant.content_language' => 'vi',
            'google_merchant.feed_label' => 'VN',
            'google_merchant.currency' => 'VND',
            'google_merchant.offer_id_field' => 'sku',
            'google_merchant.product_url_base' => 'https://gomdaithanh.com',
        ]);

        $product = new Product([
            'account_id' => 1,
            'type' => 'bundle',
            'name' => 'Bo do tho bundle',
            'slug' => 'bo-do-tho-bundle',
            'description' => '<p>Mo ta bundle cha.</p>',
            'price' => 1000000,
            'category_id' => 7,
            'sku' => 'BUNDLE-001',
            'stock_quantity' => 0,
            'status' => true,
        ]);
        $product->id = 456;
        $product->exists = true;

        $image = new ProductImage([
            'product_id' => $product->id,
            'image_url' => 'https://cdn.gomdaithanh.com/products/bundle.jpg',
            'is_primary' => true,
            'sort_order' => 0,
        ]);
        $image->exists = true;
        $domain = new SiteDomain([
            'domain' => 'gomdaithanh.com',
            'is_active' => true,
            'is_default' => true,
        ]);
        $itemA = $this->bundleItemWithPivot(10, 3000000, 1);
        $itemB = $this->bundleItemWithPivot(11, 3890000, 1);

        $product->setRelation('siteDomain', $domain);
        $product->setRelation('images', new EloquentCollection([$image]));
        $product->setRelation('parentConfigurable', new EloquentCollection());
        $product->setRelation('bundleItems', new EloquentCollection([$itemA, $itemB]));

        $payloads = app(GoogleMerchantProductSyncService::class)
            ->buildProductInputPayloads($product);

        $this->assertCount(2, $payloads);
        $this->assertSame('BUNDLE-001', $payloads[0]['offerId']);
        $this->assertSame('Ban tho 2m tro len, 3 bat huong', $payloads[1]['productAttributes']['title']);
        $this->assertSame('Mo ta bundle cha.', $payloads[1]['productAttributes']['description']);
        $this->assertSame('https://cdn.gomdaithanh.com/products/bundle.jpg', $payloads[1]['productAttributes']['imageLink']);
        $this->assertStringContainsString('bundle_option_uid=bundle-option-1', $payloads[1]['productAttributes']['link']);
        $this->assertStringContainsString('bundle_option_key=title%3Aban%20tho%202m%20tro%20len%203%20bat%20huong', $payloads[1]['productAttributes']['link']);
        $this->assertSame('6200000000000', $payloads[1]['productAttributes']['price']['amountMicros']);
        $this->assertSame('BUNDLE-001', $payloads[1]['productAttributes']['itemGroupId']);
    }

    public function test_configurable_product_payload_uses_parent_offer_and_cheapest_valid_variant_price(): void
    {
        config([
            'google_merchant.content_language' => 'vi',
            'google_merchant.feed_label' => 'VN',
            'google_merchant.currency' => 'VND',
            'google_merchant.offer_id_field' => 'sku',
            'google_merchant.product_url_base' => 'https://gomdaithanh.com',
        ]);

        $parent = new Product([
            'account_id' => 1,
            'type' => 'configurable',
            'name' => 'Ky ngai men vang anh kim',
            'slug' => 'ky-ngai-men-vang-anh-kim',
            'description' => 'Mo ta san pham cha.',
            'price' => 999000,
            'category_id' => 8,
            'sku' => 'KYNGAI-VAK',
            'status' => true,
        ]);
        $parent->id = 900;
        $parent->exists = true;

        $image = new ProductImage([
            'product_id' => $parent->id,
            'image_url' => 'https://cdn.gomdaithanh.com/products/ky-ngai.jpg',
            'is_primary' => true,
            'sort_order' => 0,
        ]);
        $image->exists = true;

        $variantA = $this->variantProduct(901, 'KYNGAI-VAK-3', 550000, true);
        $variantB = $this->variantProduct(902, 'KYNGAI-VAK-5', 420000, true);
        $variantHidden = $this->variantProduct(903, 'KYNGAI-VAK-HIDDEN', 300000, false);

        $parent->setRelation('images', new EloquentCollection([$image]));
        $parent->setRelation('siteDomain', new SiteDomain([
            'domain' => 'gomdaithanh.com',
            'is_active' => true,
            'is_default' => true,
        ]));
        $parent->setRelation('parentConfigurable', new EloquentCollection());
        $parent->setRelation('variations', new EloquentCollection([$variantA, $variantB, $variantHidden]));

        $payloads = app(GoogleMerchantProductSyncService::class)
            ->buildProductInputPayloads($parent);

        $this->assertCount(1, $payloads);
        $this->assertSame('KYNGAI-VAK', $payloads[0]['offerId']);
        $this->assertSame('Ky ngai men vang anh kim', $payloads[0]['productAttributes']['title']);
        $this->assertSame('Mo ta san pham cha.', $payloads[0]['productAttributes']['description']);
        $this->assertSame('https://gomdaithanh.com/san-pham/ky-ngai-men-vang-anh-kim', $payloads[0]['productAttributes']['link']);
        $this->assertSame('https://cdn.gomdaithanh.com/products/ky-ngai.jpg', $payloads[0]['productAttributes']['imageLink']);
        $this->assertSame('420000000000', $payloads[0]['productAttributes']['price']['amountMicros']);
        $this->assertArrayNotHasKey('itemGroupId', $payloads[0]['productAttributes']);
    }

    public function test_variant_child_payloads_are_redirected_to_parent_payload(): void
    {
        config([
            'google_merchant.content_language' => 'vi',
            'google_merchant.feed_label' => 'VN',
            'google_merchant.currency' => 'VND',
            'google_merchant.offer_id_field' => 'sku',
            'google_merchant.product_url_base' => 'https://gomdaithanh.com',
        ]);

        $parent = new Product([
            'account_id' => 1,
            'type' => 'configurable',
            'name' => 'Ky ngai men vang anh kim',
            'slug' => 'ky-ngai-men-vang-anh-kim',
            'description' => 'Mo ta san pham cha.',
            'price' => 999000,
            'category_id' => 8,
            'sku' => 'KYNGAI-VAK',
            'status' => true,
        ]);
        $parent->id = 900;
        $parent->exists = true;

        $image = new ProductImage([
            'product_id' => $parent->id,
            'image_url' => 'https://cdn.gomdaithanh.com/products/ky-ngai.jpg',
            'is_primary' => true,
            'sort_order' => 0,
        ]);
        $image->exists = true;

        $variant = $this->variantProduct(902, 'KYNGAI-VAK-5', 420000, true);
        $variant->setRelation('parentConfigurable', new EloquentCollection([$parent]));
        $parent->setRelation('images', new EloquentCollection([$image]));
        $parent->setRelation('siteDomain', new SiteDomain([
            'domain' => 'gomdaithanh.com',
            'is_active' => true,
            'is_default' => true,
        ]));
        $parent->setRelation('parentConfigurable', new EloquentCollection());
        $parent->setRelation('variations', new EloquentCollection([$variant]));

        $payloads = app(GoogleMerchantProductSyncService::class)
            ->buildProductInputPayloads($variant);

        $this->assertCount(1, $payloads);
        $this->assertSame('KYNGAI-VAK', $payloads[0]['offerId']);
        $this->assertSame('Ky ngai men vang anh kim', $payloads[0]['productAttributes']['title']);
        $this->assertSame('Mo ta san pham cha.', $payloads[0]['productAttributes']['description']);
        $this->assertSame('https://gomdaithanh.com/san-pham/ky-ngai-men-vang-anh-kim', $payloads[0]['productAttributes']['link']);
        $this->assertSame('https://cdn.gomdaithanh.com/products/ky-ngai.jpg', $payloads[0]['productAttributes']['imageLink']);
        $this->assertSame('420000000000', $payloads[0]['productAttributes']['price']['amountMicros']);
    }

    public function test_bundle_product_payloads_do_not_include_internal_bundle_options(): void
    {
        config([
            'google_merchant.content_language' => 'vi',
            'google_merchant.feed_label' => 'VN',
            'google_merchant.currency' => 'VND',
            'google_merchant.offer_id_field' => 'sku',
            'google_merchant.product_url_base' => 'https://gomdaithanh.com',
        ]);

        $product = new Product([
            'account_id' => 1,
            'type' => 'bundle',
            'name' => 'Bo do tho bundle',
            'slug' => 'bo-do-tho-bundle',
            'description' => '<p>Mo ta bundle cha.</p>',
            'price' => 1000000,
            'category_id' => 7,
            'sku' => 'BUNDLE-001',
            'status' => true,
        ]);
        $product->id = 456;
        $product->exists = true;

        $image = new ProductImage([
            'product_id' => $product->id,
            'image_url' => 'https://cdn.gomdaithanh.com/products/bundle.jpg',
            'is_primary' => true,
            'sort_order' => 0,
        ]);
        $image->exists = true;
        $domain = new SiteDomain([
            'domain' => 'gomdaithanh.com',
            'is_active' => true,
            'is_default' => true,
        ]);

        $visibleItem = $this->bundleItemWithPivot(10, 3000000, 1, 'bundle-option-visible', 'Lua chon hien thi');
        $internalItem = $this->bundleItemWithPivot(11, 3890000, 1, 'bundle-option-internal', 'Lua chon noi bo', 'internal');

        $product->setRelation('siteDomain', $domain);
        $product->setRelation('images', new EloquentCollection([$image]));
        $product->setRelation('parentConfigurable', new EloquentCollection());
        $product->setRelation('bundleItems', new EloquentCollection([$visibleItem, $internalItem]));

        $payloads = app(GoogleMerchantProductSyncService::class)
            ->buildProductInputPayloads($product);

        $this->assertCount(2, $payloads);
        $this->assertSame('BUNDLE-001', $payloads[0]['offerId']);
        $this->assertSame('Lua chon hien thi', $payloads[1]['productAttributes']['title']);
    }

    private function bundleItemWithPivot(
        int $id,
        float $price,
        int $quantity,
        string $uid = 'bundle-option-1',
        string $title = 'Ban tho 2m tro len, 3 bat huong',
        string $status = 'visible'
    ): Product
    {
        $item = new Product([
            'name' => "Item {$id}",
            'price' => $price,
            'stock_quantity' => 0,
            'status' => true,
        ]);
        $item->id = $id;
        $item->exists = true;
        $pivot = new \Illuminate\Database\Eloquent\Relations\Pivot([
            'bundle_option_uid' => $uid,
            'option_title' => $title,
            'bundle_option_status' => $status,
            'quantity' => $quantity,
            'price' => $price,
        ]);
        $item->setRelation('pivot', $pivot);

        return $item;
    }

    private function variantProduct(int $id, string $sku, float $price, bool $status): Product
    {
        $variant = new Product([
            'account_id' => 1,
            'type' => 'simple',
            'name' => "Variant {$id}",
            'slug' => "variant-{$id}",
            'sku' => $sku,
            'price' => $price,
            'category_id' => 8,
            'status' => $status,
        ]);
        $variant->id = $id;
        $variant->exists = true;
        $variant->setRelation('parentConfigurable', new EloquentCollection());

        return $variant;
    }
}
