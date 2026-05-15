<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductImage;
use App\Models\SiteDomain;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MetaFeedTest extends TestCase
{
    use RefreshDatabase;

    public function test_meta_feed_csv_contains_active_products_with_required_columns(): void
    {
        config([
            'app.url' => 'https://api.gomdaithanh.com',
            'app.frontend_url' => 'https://gomdaithanh.com',
            'media.public_base_url' => null,
        ]);

        $account = Account::create([
            'name' => 'Gom Dai Thanh',
            'domain' => 'gomdaithanh.com',
            'status' => true,
        ]);
        $domain = SiteDomain::create([
            'account_id' => $account->id,
            'domain' => 'gomdaithanh.com',
            'is_active' => true,
            'is_default' => true,
        ]);
        $category = Category::create([
            'account_id' => $account->id,
            'name' => 'Bộ đồ thờ men lam vẽ vàng Bát Tràng',
            'slug' => 'bo-do-tho-men-lam-ve-vang-bat-trang',
            'status' => true,
        ]);

        $activeProduct = Product::create([
            'account_id' => $account->id,
            'site_domain_id' => $domain->id,
            'category_id' => $category->id,
            'name' => 'Bộ đồ thờ men lam',
            'slug' => 'bo-do-tho-men-lam',
            'description' => '<p>Gốm sứ Bát Tràng.</p>',
            'price' => 1500000,
            'stock_quantity' => 3,
            'status' => true,
            'sku' => 'GDT-001',
        ]);

        ProductImage::create([
            'product_id' => $activeProduct->id,
            'image_url' => '/storage/products/gdt-001.jpg',
            'is_primary' => true,
            'sort_order' => 0,
        ]);

        Product::create([
            'account_id' => $account->id,
            'site_domain_id' => $domain->id,
            'name' => 'Sản phẩm tắt',
            'slug' => 'san-pham-tat',
            'description' => 'Không xuất hiện',
            'price' => 100000,
            'stock_quantity' => 5,
            'status' => false,
            'sku' => 'OFF-001',
        ]);

        $response = $this->get('/meta-feed.csv');

        $response->assertOk();
        $response->assertHeader('Content-Type', 'text/csv; charset=UTF-8');

        $content = $response->streamedContent();
        $this->assertStringContainsString('id,title,description,availability,condition,price,link,image_link,brand,product_type,custom_label_0', $content);
        $this->assertStringContainsString('GDT-001', $content);
        $this->assertStringContainsString('Bộ đồ thờ men lam', $content);
        $this->assertStringContainsString('Gốm sứ Bát Tràng.', $content);
        $this->assertStringContainsString('in stock', $content);
        $this->assertStringContainsString('new', $content);
        $this->assertStringContainsString('1500000 VND', $content);
        $this->assertStringContainsString('https://gomdaithanh.com/product/bo-do-tho-men-lam', $content);
        $this->assertStringContainsString('https://api.gomdaithanh.com/storage/products/gdt-001.jpg', $content);
        $this->assertStringContainsString('Gốm Đại Thành', $content);
        $this->assertStringContainsString('Bộ đồ thờ men lam vẽ vàng Bát Tràng', $content);
        $this->assertStringNotContainsString('OFF-001', $content);
    }

    public function test_meta_feed_xml_uses_meta_catalog_fields(): void
    {
        config([
            'app.frontend_url' => 'https://gomdaithanh.com',
        ]);
        $category = Category::create([
            'name' => 'Bát hương Bát Tràng',
            'slug' => 'bat-huong-bat-trang',
            'status' => true,
        ]);

        $product = Product::create([
            'category_id' => $category->id,
            'name' => 'Bát hương men rạn',
            'slug' => 'bat-huong-men-ran',
            'description' => 'Hết hàng nhưng vẫn đang bán.',
            'price' => 450000,
            'stock_quantity' => 0,
            'status' => true,
            'sku' => 'BHM-001',
        ]);

        ProductImage::create([
            'product_id' => $product->id,
            'image_url' => 'https://cdn.gomdaithanh.com/bhm-001.jpg',
            'is_primary' => true,
            'sort_order' => 0,
        ]);

        $response = $this->get('/meta-feed.xml');

        $response->assertOk();
        $content = $response->streamedContent();

        $this->assertStringContainsString('<g:id>BHM-001</g:id>', $content);
        $this->assertStringContainsString('<g:availability>in stock</g:availability>', $content);
        $this->assertStringContainsString('<g:condition>new</g:condition>', $content);
        $this->assertStringContainsString('<g:price>450000 VND</g:price>', $content);
        $this->assertStringContainsString('<g:brand>Gốm Đại Thành</g:brand>', $content);
        $this->assertStringContainsString('<g:product_type>Bát hương Bát Tràng</g:product_type>', $content);
        $this->assertStringContainsString('<g:custom_label_0>Bát hương Bát Tràng</g:custom_label_0>', $content);
    }
}
