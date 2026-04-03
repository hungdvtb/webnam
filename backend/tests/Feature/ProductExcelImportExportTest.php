<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Attribute;
use App\Models\AttributeOption;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductAttributeValue;
use App\Models\ProductImage;
use App\Models\SiteDomain;
use App\Models\User;
use App\Support\SimpleXlsx;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductExcelImportExportTest extends TestCase
{
    use RefreshDatabase;

    public function test_product_export_excel_includes_online_images_and_variant_json(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        $category = Category::query()->create([
            'account_id' => $account->id,
            'name' => 'Đồ thờ',
            'code' => 'do-tho',
            'slug' => 'do-tho',
            'status' => true,
            'order' => 0,
        ]);

        $color = $this->createAttribute($account->id, 'Màu sắc', 'mau-sac', 'select', true);
        $material = $this->createAttribute($account->id, 'Chất liệu', 'chat-lieu', 'multiselect');

        $parent = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'configurable',
            'name' => 'Bộ đồ thờ men lam',
            'slug' => 'bo-do-tho-men-lam',
            'sku' => 'BODM-001',
            'price' => 2500000,
            'category_id' => $category->id,
            'status' => true,
        ]);

        $parent->categories()->attach($category->id, ['sort_order' => 0]);
        $parent->superAttributes()->attach($color->id, ['position' => 0]);

        ProductAttributeValue::query()->create([
            'product_id' => $parent->id,
            'attribute_id' => $material->id,
            'value' => json_encode(['Gốm', 'Men lam'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);

        ProductImage::query()->create([
            'product_id' => $parent->id,
            'image_url' => 'https://cdn.example.com/products/parent-main.jpg',
            'is_primary' => true,
            'sort_order' => 0,
        ]);
        ProductImage::query()->create([
            'product_id' => $parent->id,
            'image_url' => 'https://cdn.example.com/products/parent-gallery.jpg',
            'is_primary' => false,
            'sort_order' => 1,
        ]);

        $variant = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Bộ đồ thờ men lam - Đỏ',
            'slug' => 'bo-do-tho-men-lam-do',
            'sku' => 'BODM-001-DO',
            'price' => 2600000,
            'stock_quantity' => 7,
            'category_id' => $category->id,
            'status' => true,
        ]);

        ProductAttributeValue::query()->create([
            'product_id' => $variant->id,
            'attribute_id' => $color->id,
            'value' => 'Đỏ',
        ]);
        ProductImage::query()->create([
            'product_id' => $variant->id,
            'image_url' => 'https://cdn.example.com/products/variant-red.jpg',
            'is_primary' => true,
            'sort_order' => 0,
        ]);

        $parent->linkedProducts()->attach($variant->id, [
            'link_type' => 'super_link',
            'position' => 0,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $response = $this
            ->withHeaders($headers)
            ->get('/api/products/export?columns=sku,category,attributes,primary_image_url,gallery_image_urls,variant_data')
            ->assertOk();

        $tempPath = tempnam(sys_get_temp_dir(), 'product_export_');
        file_put_contents($tempPath, $response->getContent());
        $rows = SimpleXlsx::readRows($tempPath);
        @unlink($tempPath);

        $this->assertSame('Mã SP', $rows[0][0]);
        $this->assertSame('Danh mục', $rows[0][1]);
        $this->assertSame('Thuộc tính', $rows[0][2]);
        $this->assertSame('Ảnh đại diện', $rows[0][3]);
        $this->assertSame('Thư viện ảnh', $rows[0][4]);
        $this->assertSame('Biến thể', $rows[0][5]);

        $this->assertSame('BODM-001', $rows[1][0]);
        $this->assertSame('CODE:do-tho', $rows[1][1]);
        $this->assertStringContainsString('CODE:chat-lieu', (string) $rows[1][2]);
        $this->assertSame('https://cdn.example.com/products/parent-main.jpg', $rows[1][3]);
        $this->assertStringContainsString('https://cdn.example.com/products/parent-gallery.jpg', (string) $rows[1][4]);
        $this->assertStringContainsString('BODM-001-DO', (string) $rows[1][5]);
        $this->assertStringContainsString('CODE:mau-sac', (string) $rows[1][5]);
    }

    public function test_product_export_excel_supports_child_skus_for_configurable_products(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        $parent = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'configurable',
            'name' => 'Sản phẩm cha configurable',
            'slug' => 'san-pham-cha-configurable',
            'sku' => 'CFG-001',
            'price' => 1200000,
            'status' => true,
        ]);

        $variantA = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Biến thể A',
            'slug' => 'bien-the-a',
            'sku' => 'CFG-001-A',
            'price' => 1250000,
            'stock_quantity' => 3,
            'status' => true,
        ]);

        $variantB = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Biến thể B',
            'slug' => 'bien-the-b',
            'sku' => 'CFG-001-B',
            'price' => 1260000,
            'stock_quantity' => 4,
            'status' => true,
        ]);

        $parent->linkedProducts()->attach($variantA->id, [
            'link_type' => 'super_link',
            'position' => 0,
        ]);
        $parent->linkedProducts()->attach($variantB->id, [
            'link_type' => 'super_link',
            'position' => 1,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $response = $this
            ->withHeaders($headers)
            ->get('/api/products/export?columns=sku,child_skus,variant_data')
            ->assertOk();

        $tempPath = tempnam(sys_get_temp_dir(), 'product_export_child_skus_');
        file_put_contents($tempPath, $response->getContent());
        $rows = SimpleXlsx::readRows($tempPath);
        @unlink($tempPath);

        $dataRows = collect(array_slice($rows, 1))
            ->mapWithKeys(fn (array $row) => [(string) ($row[0] ?? '') => $row]);

        $parentRow = $dataRows->get('CFG-001');
        $this->assertNotNull($parentRow);
        $this->assertSame('MÃ£ SP con', $rows[0][1]);
        $this->assertSame('Biáº¿n thá»ƒ', $rows[0][2]);
        $this->assertSame('CFG-001-A | CFG-001-B', $parentRow[1]);
        $this->assertStringContainsString('CFG-001-A', (string) $parentRow[2]);
        $this->assertStringContainsString('CFG-001-B', (string) $parentRow[2]);
    }

    public function test_product_export_excel_includes_bundle_child_skus_and_component_payload(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        $bundle = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'bundle',
            'name' => 'Bộ combo xuất bundle',
            'slug' => 'bo-combo-xuat-bundle',
            'sku' => 'BUNDLE-001',
            'price' => 0,
            'status' => true,
        ]);

        $simpleChild = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Bát hương con',
            'slug' => 'bat-huong-con',
            'sku' => 'BOWL-001',
            'price' => 450000,
            'stock_quantity' => 5,
            'status' => true,
        ]);

        $configurableChild = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'configurable',
            'name' => 'Tùy chọn màu men',
            'slug' => 'tuy-chon-mau-men',
            'sku' => 'OPTION-001',
            'price' => 0,
            'status' => true,
        ]);

        $selectedVariant = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Tùy chọn màu men - đỏ',
            'slug' => 'tuy-chon-mau-men-do',
            'sku' => 'OPTION-001-RED',
            'price' => 150000,
            'stock_quantity' => 8,
            'status' => true,
        ]);

        $configurableChild->linkedProducts()->attach($selectedVariant->id, [
            'link_type' => 'super_link',
            'position' => 0,
        ]);

        $bundle->bundleItems()->attach($simpleChild->id, [
            'link_type' => 'bundle',
            'position' => 0,
            'quantity' => 1,
            'is_required' => true,
            'option_title' => 'Mặc định',
        ]);

        $bundle->bundleItems()->attach($configurableChild->id, [
            'link_type' => 'bundle',
            'position' => 1,
            'quantity' => 2,
            'is_required' => false,
            'option_title' => 'Màu men',
            'is_default' => true,
            'variant_id' => $selectedVariant->id,
            'price' => 150000,
            'cost_price' => 90000,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $response = $this
            ->withHeaders($headers)
            ->get('/api/products/export?columns=sku,type,child_skus,component_data')
            ->assertOk();

        $tempPath = tempnam(sys_get_temp_dir(), 'product_export_bundle_');
        file_put_contents($tempPath, $response->getContent());
        $rows = SimpleXlsx::readRows($tempPath);
        @unlink($tempPath);

        $dataRows = collect(array_slice($rows, 1))
            ->mapWithKeys(fn (array $row) => [(string) ($row[0] ?? '') => $row]);

        $bundleRow = $dataRows->get('BUNDLE-001');
        $this->assertNotNull($bundleRow);
        $this->assertSame('MÃ£ SP con', $rows[0][2]);
        $this->assertSame('ThÃ nh pháº§n bundle/grouped', $rows[0][3]);
        $this->assertSame('bundle', $bundleRow[1]);
        $this->assertStringContainsString('BOWL-001', (string) $bundleRow[2]);
        $this->assertStringContainsString('OPTION-001-RED', (string) $bundleRow[2]);
        $this->assertStringContainsString('"option_title":"Mặc định"', (string) $bundleRow[3]);
        $this->assertStringContainsString('"option_title":"Màu men"', (string) $bundleRow[3]);
        $this->assertStringContainsString('"variant_sku":"OPTION-001-RED"', (string) $bundleRow[3]);
        $this->assertStringContainsString('"quantity":2', (string) $bundleRow[3]);
    }

    public function test_product_import_excel_auto_creates_missing_categories_attributes_values_images_and_variants(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        $existingCategory = Category::query()->create([
            'account_id' => $account->id,
            'name' => 'Đồ thờ',
            'code' => 'do-tho',
            'slug' => 'do-tho',
            'status' => true,
            'order' => 0,
        ]);

        $existingAttribute = $this->createAttribute($account->id, 'Loại men', 'loai-men');
        AttributeOption::query()->create([
            'attribute_id' => $existingAttribute->id,
            'value' => 'Men lam',
            'order' => 0,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'SanPham',
            'rows' => [
                [
                    'ID', 'SKU', 'Slug', 'Link sản phẩm', 'Tên sản phẩm', 'Loại sản phẩm', 'Danh mục',
                    'Giá bán', 'Giá dự kiến', 'Tồn kho', 'Đang bán', 'Nổi bật', 'Mới', 'Domain',
                    'Video URL', 'Thông số', 'Tiêu đề bundle', 'Thuộc tính', 'Ảnh đại diện', 'Thư viện ảnh', 'Biến thể',
                ],
                [
                    '', 'SP-SIMPLE-001', 'bat-huong-men-lam', '', 'Bát hương men lam', 'simple', 'CODE:do-tho',
                    1250000, 850000, 12, 1, 1, 1, '', '', 'Men lam Bat Trang', '',
                    '{"CODE:loai-men":"Men lam","NAME:Chất liệu":"Gốm"}',
                    'https://cdn.example.com/products/simple-main.jpg',
                    'https://cdn.example.com/products/simple-gallery-1.jpg | https://cdn.example.com/products/simple-gallery-2.jpg',
                    '',
                ],
                [
                    '', 'SP-CONF-001', 'bo-do-tho-hien-dai', '', 'Bộ đồ thờ hiện đại', 'configurable', 'NAME:Bộ sưu tập mới',
                    3500000, 2200000, 0, 1, 0, 1, '', '', '', '',
                    '{"NAME:Phong cách":"Hiện đại"}',
                    'https://cdn.example.com/products/conf-main.jpg',
                    'https://cdn.example.com/products/conf-gallery-1.jpg',
                    '[{"sku":"SP-CONF-001-RED","name":"Bộ đồ thờ hiện đại - Đỏ","price":3600000,"stock_quantity":5,"attributes":{"CODE:mau-sac":"Đỏ"},"primary_image_url":"https://cdn.example.com/products/conf-red.jpg"},{"sku":"SP-CONF-001-BLUE","name":"Bộ đồ thờ hiện đại - Xanh","price":3650000,"stock_quantity":3,"attributes":{"CODE:mau-sac":"Xanh"},"primary_image_url":"https://cdn.example.com/products/conf-blue.jpg","gallery_image_urls":["https://cdn.example.com/products/conf-blue-2.jpg"]}]',
                ],
            ],
        ]]);

        $file = UploadedFile::fake()->createWithContent('products.xlsx', $binary);

        $response = $this
            ->withHeaders($headers)
            ->post('/api/products/import', ['file' => $file])
            ->assertOk()
            ->json();

        $this->assertSame(2, (int) ($response['summary']['created'] ?? 0));
        $this->assertSame(0, (int) ($response['summary']['failed'] ?? 0));
        $this->assertSame(1, (int) ($response['summary']['categories_created'] ?? 0));
        $this->assertGreaterThanOrEqual(2, (int) ($response['summary']['attributes_created'] ?? 0));

        $simple = Product::query()->where('sku', 'SP-SIMPLE-001')->first();
        $this->assertNotNull($simple);
        $this->assertSame($existingCategory->id, $simple->category_id);
        $this->assertSame(3, $simple->images()->count());

        $newCategory = Category::query()->where('name', 'Bộ sưu tập mới')->first();
        $this->assertNotNull($newCategory);

        $color = Attribute::query()->where('code', 'mau-sac')->first();
        $style = Attribute::query()->where('name', 'Phong cách')->first();
        $material = Attribute::query()->where('name', 'Chất liệu')->first();

        $this->assertNotNull($color);
        $this->assertTrue((bool) $color->is_variant);
        $this->assertNotNull($style);
        $this->assertNotNull($material);
        $this->assertDatabaseHas('attribute_options', ['attribute_id' => $color->id, 'value' => 'Đỏ']);
        $this->assertDatabaseHas('attribute_options', ['attribute_id' => $color->id, 'value' => 'Xanh']);

        $parent = Product::query()->where('sku', 'SP-CONF-001')->first();
        $this->assertNotNull($parent);
        $this->assertSame('configurable', $parent->type);
        $this->assertSame($newCategory->id, $parent->category_id);
        $this->assertSame(2, $parent->variations()->count());
        $this->assertSame(2, $parent->images()->count());
        $this->assertDatabaseHas('product_super_attributes', [
            'product_id' => $parent->id,
            'attribute_id' => $color->id,
        ]);
    }

    public function test_product_import_excel_returns_row_errors_without_failing_valid_rows(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'SanPham',
            'rows' => [
                ['ID', 'SKU', 'Slug', 'Link sản phẩm', 'Tên sản phẩm', 'Loại sản phẩm', 'Danh mục', 'Giá bán', 'Giá dự kiến', 'Tồn kho', 'Đang bán', 'Nổi bật', 'Mới', 'Domain', 'Video URL', 'Thông số', 'Tiêu đề bundle', 'Thuộc tính', 'Ảnh đại diện', 'Thư viện ảnh', 'Biến thể'],
                ['', 'ROW-OK-001', 'row-ok-001', '', 'Dòng hợp lệ', 'simple', 'NAME:Danh mục tự tạo', 100000, 50000, 2, 1, 0, 1, '', '', '', '', '{"NAME:Chất liệu":"Gốm"}', 'https://cdn.example.com/products/ok.jpg', '', ''],
                ['', 'ROW-BAD-001', 'row-bad-001', '', 'Dòng lỗi', 'simple', 'NAME:Danh mục tự tạo 2', 100000, 50000, 2, 1, 0, 1, 'ID:999999', '', '', '', '', 'not-a-valid-url', '', ''],
            ],
        ]]);

        $file = UploadedFile::fake()->createWithContent('products-partial.xlsx', $binary);

        $response = $this
            ->withHeaders($headers)
            ->post('/api/products/import', ['file' => $file])
            ->assertOk()
            ->json();

        $this->assertSame(1, (int) ($response['summary']['created'] ?? 0));
        $this->assertSame(1, (int) ($response['summary']['failed'] ?? 0));
        $this->assertNotEmpty($response['errors'] ?? []);
        $this->assertTrue(Product::query()->where('sku', 'ROW-OK-001')->exists());
        $this->assertFalse(Product::query()->where('sku', 'ROW-BAD-001')->exists());
    }

    public function test_product_import_excel_updates_only_selected_fields_and_selected_attributes(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];
        $color = $this->createAttribute($account->id, 'Màu sắc', 'mau-sac');

        $product = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Bộ đồ thờ cũ',
            'slug' => 'bo-do-tho-cu',
            'sku' => 'UPDATE-001',
            'price' => 1500000,
            'stock_quantity' => 5,
            'description' => 'Mô tả cũ',
            'status' => true,
        ]);

        ProductAttributeValue::query()->create([
            'product_id' => $product->id,
            'attribute_id' => $color->id,
            'value' => 'Xanh',
        ]);

        ProductImage::query()->create([
            'product_id' => $product->id,
            'image_url' => 'https://cdn.example.com/products/update-old.jpg',
            'is_primary' => true,
            'sort_order' => 0,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'SanPham',
            'rows' => [
                ['ID', 'SKU', 'Tên sản phẩm', 'Giá', 'Tồn kho', 'Mô tả', 'Ảnh đại diện', 'Thông tin bổ sung', 'Thuộc tính: Màu sắc'],
                [
                    $product->id,
                    'UPDATE-001',
                    'Bộ đồ thờ mới',
                    1999000,
                    99,
                    'Mô tả mới',
                    'not-a-valid-url',
                    '{"invalid":true}',
                    'Đỏ',
                ],
            ],
        ]]);

        $file = UploadedFile::fake()->createWithContent('products-selective-update.xlsx', $binary);

        $response = $this
            ->withHeaders($headers)
            ->post('/api/products/import', [
                'file' => $file,
                'mode' => 'update_selected_fields',
                'missing_product_action' => 'skip',
                'update_fields' => ['price', 'attr_' . $color->id],
            ])
            ->assertOk()
            ->json();

        $product->refresh();

        $this->assertSame(1, (int) ($response['summary']['updated'] ?? 0));
        $this->assertSame(0, (int) ($response['summary']['failed'] ?? 0));
        $this->assertSame(1999000.0, (float) $product->price);
        $this->assertSame(5, (int) $product->stock_quantity);
        $this->assertSame('Bộ đồ thờ cũ', $product->name);
        $this->assertSame('Mô tả cũ', $product->description);
        $this->assertSame('Đỏ', ProductAttributeValue::query()
            ->where('product_id', $product->id)
            ->where('attribute_id', $color->id)
            ->value('value'));
        $this->assertSame(1, $product->images()->count());
    }

    public function test_product_import_excel_update_mode_can_skip_or_create_missing_products(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'SanPham',
            'rows' => [
                ['ID', 'SKU', 'Tên sản phẩm', 'Giá'],
                ['', 'UPDATE-MISSING-001', 'Sản phẩm tạo mới từ update mode', 2450000],
            ],
        ]]);

        $skipFile = UploadedFile::fake()->createWithContent('products-update-skip.xlsx', $binary);

        $skipResponse = $this
            ->withHeaders($headers)
            ->post('/api/products/import', [
                'file' => $skipFile,
                'mode' => 'update_selected_fields',
                'missing_product_action' => 'skip',
                'update_fields' => ['price'],
            ])
            ->assertOk()
            ->json();

        $this->assertSame(1, (int) ($skipResponse['summary']['skipped_missing'] ?? 0));
        $this->assertFalse(Product::query()->where('sku', 'UPDATE-MISSING-001')->exists());

        $createFile = UploadedFile::fake()->createWithContent('products-update-create.xlsx', $binary);

        $createResponse = $this
            ->withHeaders($headers)
            ->post('/api/products/import', [
                'file' => $createFile,
                'mode' => 'update_selected_fields',
                'missing_product_action' => 'create',
                'update_fields' => ['price'],
            ])
            ->assertOk()
            ->json();

        $createdProduct = Product::query()->where('sku', 'UPDATE-MISSING-001')->first();

        $this->assertSame(1, (int) ($createResponse['summary']['created'] ?? 0));
        $this->assertNotNull($createdProduct);
        $this->assertSame('Sản phẩm tạo mới từ update mode', $createdProduct->name);
        $this->assertSame(2450000.0, (float) $createdProduct->price);
        $this->assertSame($account->id, (int) $createdProduct->account_id);
    }

    public function test_product_export_excel_supports_extended_round_trip_columns(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];
        $domain = SiteDomain::query()->create([
            'account_id' => $account->id,
            'domain' => 'shop.example.test',
            'is_active' => true,
            'is_default' => true,
        ]);

        Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Bộ đồ thờ round trip',
            'slug' => 'bo-do-tho-round-trip',
            'sku' => 'ROUND-TRIP-001',
            'price' => 3200000,
            'special_price' => 2999000,
            'description' => 'Mô tả round trip',
            'meta_title' => 'SEO title round trip',
            'meta_description' => 'SEO description round trip',
            'meta_keywords' => 'seo,round-trip',
            'weight' => '2kg',
            'additional_info' => json_encode([
                ['post_id' => 12, 'title' => 'Bảo hành', 'display_text' => 'Xem chi tiết'],
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'site_domain_id' => $domain->id,
            'status' => true,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $response = $this
            ->withHeaders($headers)
            ->get('/api/products/export?columns=sku,description,special_price,additional_info,meta_title,meta_description,meta_keywords,weight,domain')
            ->assertOk();

        $tempPath = tempnam(sys_get_temp_dir(), 'product_export_extended_');
        file_put_contents($tempPath, $response->getContent());
        $rows = SimpleXlsx::readRows($tempPath);
        @unlink($tempPath);

        $this->assertSame('Mã SP', $rows[0][0]);
        $this->assertSame('Mô tả', $rows[0][1]);
        $this->assertSame('Giá bán', $rows[0][2]);
        $this->assertSame('Thông tin bổ sung', $rows[0][3]);
        $this->assertSame('SEO title', $rows[0][4]);
        $this->assertSame('SEO description', $rows[0][5]);
        $this->assertSame('SEO keywords', $rows[0][6]);
        $this->assertSame('Khối lượng', $rows[0][7]);
        $this->assertSame('Domain', $rows[0][8]);

        $this->assertSame('ROUND-TRIP-001', $rows[1][0]);
        $this->assertSame('Mô tả round trip', $rows[1][1]);
        $this->assertSame(2999000, (int) $rows[1][2]);
        $this->assertStringContainsString('"post_id":12', (string) $rows[1][3]);
        $this->assertSame('SEO title round trip', $rows[1][4]);
        $this->assertSame('SEO description round trip', $rows[1][5]);
        $this->assertSame('seo,round-trip', $rows[1][6]);
        $this->assertSame('2kg', $rows[1][7]);
        $this->assertSame('shop.example.test', $rows[1][8]);
    }

    public function test_product_export_and_import_accept_relative_image_paths_for_round_trip(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        $product = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Sản phẩm ảnh local',
            'slug' => 'san-pham-anh-local',
            'sku' => 'LOCAL-IMG-001',
            'price' => 150000,
            'status' => true,
        ]);

        ProductImage::query()->create([
            'product_id' => $product->id,
            'image_url' => '/storage/products/local-main.jpg',
            'is_primary' => true,
            'sort_order' => 0,
        ]);

        ProductImage::query()->create([
            'product_id' => $product->id,
            'image_url' => 'products/local-gallery.jpg',
            'is_primary' => false,
            'sort_order' => 1,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $exportResponse = $this
            ->withHeaders($headers)
            ->get('/api/products/export?columns=id,sku,primary_image_url,gallery_image_urls')
            ->assertOk();

        $tempPath = tempnam(sys_get_temp_dir(), 'product_export_roundtrip_img_');
        file_put_contents($tempPath, $exportResponse->getContent());
        $rows = SimpleXlsx::readRows($tempPath);

        $this->assertStringStartsWith('http', (string) $rows[1][2]);
        $this->assertStringStartsWith('http', (string) $rows[1][3]);

        $file = UploadedFile::fake()->createWithContent('products-roundtrip-images.xlsx', $exportResponse->getContent());

        $importResponse = $this
            ->withHeaders($headers)
            ->post('/api/products/import', ['file' => $file])
            ->assertOk()
            ->json();

        @unlink($tempPath);

        $this->assertSame(0, (int) ($importResponse['summary']['failed'] ?? 0));
        $this->assertEmpty($importResponse['errors'] ?? []);
    }

    private function createAccount(): Account
    {
        return Account::query()->create([
            'name' => 'Test account',
            'domain' => 'example.test',
            'subdomain' => 'example',
            'site_code' => 'example-test',
            'status' => true,
        ]);
    }

    private function createAttribute(int $accountId, string $name, string $code, string $frontendType = 'select', bool $isVariant = false): Attribute
    {
        return Attribute::query()->create([
            'account_id' => $accountId,
            'name' => $name,
            'entity_type' => 'product',
            'code' => $code,
            'frontend_type' => $frontendType,
            'is_filterable' => false,
            'is_filterable_frontend' => false,
            'is_filterable_backend' => true,
            'is_required' => false,
            'is_variant' => $isVariant,
            'status' => true,
        ]);
    }
}
