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

        $this->assertSame('delete', $method->invoke($service, $product, [], null));
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
        $this->assertSame('6890000000000', $payloads[1]['productAttributes']['price']['amountMicros']);
        $this->assertSame('BUNDLE-001', $payloads[1]['productAttributes']['itemGroupId']);
    }

    private function bundleItemWithPivot(int $id, float $price, int $quantity): Product
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
            'bundle_option_uid' => 'bundle-option-1',
            'option_title' => 'Ban tho 2m tro len, 3 bat huong',
            'quantity' => $quantity,
            'price' => $price,
        ]);
        $item->setRelation('pivot', $pivot);

        return $item;
    }
}
