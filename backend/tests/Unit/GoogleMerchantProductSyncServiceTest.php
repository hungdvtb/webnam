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
}
