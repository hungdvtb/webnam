<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Attribute;
use App\Models\AttributeOption;
use App\Models\Category;
use App\Models\Post;
use App\Models\Product;
use App\Models\ProductAttributeValue;
use App\Models\ProductImage;
use App\Models\SiteDomain;
use App\Models\User;
use App\Support\SimpleXlsx;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;
use ZipArchive;

class ProductExcelImportExportTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->fakeMediaStorage();
        Http::fake([
            'https://cdn.example.com/*' => Http::response($this->pngBinary(), 200, [
                'Content-Type' => 'image/png',
            ]),
            'http://localhost:8003/storage/*' => Http::response($this->pngBinary(), 200, [
                'Content-Type' => 'image/png',
            ]),
        ]);
    }

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

    public function test_product_export_and_selective_import_support_multiple_categories(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        $primaryCategory = Category::query()->create([
            'account_id' => $account->id,
            'name' => 'Đồ thờ',
            'code' => 'do-tho',
            'slug' => 'do-tho',
            'status' => true,
            'order' => 0,
        ]);
        $secondaryCategory = Category::query()->create([
            'account_id' => $account->id,
            'name' => 'Phong thủy',
            'code' => 'phong-thuy',
            'slug' => 'phong-thuy',
            'status' => true,
            'order' => 1,
        ]);
        $replacementCategory = Category::query()->create([
            'account_id' => $account->id,
            'name' => 'Quà tặng',
            'code' => 'qua-tang',
            'slug' => 'qua-tang',
            'status' => true,
            'order' => 2,
        ]);

        $product = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Bộ đồ thờ xuất nhập nhiều danh mục',
            'slug' => 'bo-do-tho-xuat-nhap-nhieu-danh-muc',
            'sku' => 'MULTI-CAT-001',
            'price' => 1450000,
            'category_id' => $primaryCategory->id,
            'status' => true,
        ]);
        $product->categories()->sync([
            $primaryCategory->id => ['sort_order' => 0, 'item_type' => 'product'],
            $secondaryCategory->id => ['sort_order' => 0, 'item_type' => 'product'],
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $exportResponse = $this
            ->withHeaders($headers)
            ->get('/api/products/export?columns=sku,category')
            ->assertOk();

        $tempPath = tempnam(sys_get_temp_dir(), 'product_export_multi_category_');
        file_put_contents($tempPath, $exportResponse->getContent());
        $rows = SimpleXlsx::readRows($tempPath);
        @unlink($tempPath);

        $this->assertSame('MULTI-CAT-001', $rows[1][0]);
        $this->assertStringContainsString('CODE:do-tho', (string) $rows[1][1]);
        $this->assertStringContainsString('CODE:phong-thuy', (string) $rows[1][1]);

        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'SanPham',
            'rows' => [
                ['ID', 'SKU', 'Slug', 'Link sản phẩm', 'Tên sản phẩm', 'Loại sản phẩm', 'Danh mục'],
                ['', 'MULTI-CAT-001', '', '', '', '', 'CODE:phong-thuy | CODE:qua-tang'],
            ],
        ]]);

        $file = UploadedFile::fake()->createWithContent('products-update-multi-category.xlsx', $binary);

        $importResponse = $this
            ->withHeaders($headers)
            ->post('/api/products/import', [
                'file' => $file,
                'mode' => 'update_selected_fields',
                'missing_product_action' => 'skip',
                'update_fields' => ['category'],
            ])
            ->assertOk()
            ->json();

        $this->assertSame(1, (int) ($importResponse['summary']['updated'] ?? 0));
        $this->assertSame(0, (int) ($importResponse['summary']['failed'] ?? 0));

        $product->refresh()->load('categories');

        $this->assertSame($secondaryCategory->id, (int) $product->category_id);
        $this->assertEqualsCanonicalizing(
            [$secondaryCategory->id, $replacementCategory->id],
            $product->categories->pluck('id')->map(fn ($id) => (int) $id)->all()
        );
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
        $this->assertSame('Mã SP con', $rows[0][1]);
        $this->assertSame('Biến thể', $rows[0][2]);
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
        $this->assertSame('Mã SP con', $rows[0][2]);
        $this->assertSame('Thành phần bundle/grouped', $rows[0][3]);
        $this->assertSame('bundle', $bundleRow[1]);
        $this->assertStringContainsString('BOWL-001', (string) $bundleRow[2]);
        $this->assertStringContainsString('OPTION-001-RED', (string) $bundleRow[2]);
        $this->assertStringContainsString('"option_title":"Mặc định"', (string) $bundleRow[3]);
        $this->assertStringContainsString('"option_title":"Màu men"', (string) $bundleRow[3]);
        $this->assertStringContainsString('"variant_sku":"OPTION-001-RED"', (string) $bundleRow[3]);
        $this->assertStringContainsString('"quantity":2', (string) $bundleRow[3]);
    }

    public function test_product_export_excel_can_include_child_names_for_content_writing(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        $configurableParent = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'configurable',
            'name' => 'San pham co bien the',
            'slug' => 'san-pham-co-bien-the',
            'sku' => 'CFG-CONTENT-001',
            'price' => 0,
            'status' => true,
        ]);

        $variantA = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Bien the xanh',
            'slug' => 'bien-the-xanh',
            'sku' => 'CFG-CONTENT-001-GREEN',
            'price' => 100000,
            'status' => true,
        ]);

        $variantB = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Bien the do',
            'slug' => 'bien-the-do',
            'sku' => 'CFG-CONTENT-001-RED',
            'price' => 110000,
            'status' => true,
        ]);

        $configurableParent->linkedProducts()->attach($variantA->id, [
            'link_type' => 'super_link',
            'position' => 0,
        ]);
        $configurableParent->linkedProducts()->attach($variantB->id, [
            'link_type' => 'super_link',
            'position' => 1,
        ]);

        $bundle = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'bundle',
            'name' => 'Bo combo co bien the',
            'slug' => 'bo-combo-co-bien-the',
            'sku' => 'BUNDLE-CONTENT-001',
            'price' => 0,
            'status' => true,
        ]);

        $simpleChild = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Bat huong men lam',
            'slug' => 'bat-huong-men-lam',
            'sku' => 'BOWL-CONTENT-001',
            'price' => 450000,
            'status' => true,
        ]);

        $bundle->bundleItems()->attach($simpleChild->id, [
            'link_type' => 'bundle',
            'position' => 0,
            'quantity' => 1,
            'is_required' => true,
        ]);

        $bundle->bundleItems()->attach($configurableParent->id, [
            'link_type' => 'bundle',
            'position' => 1,
            'quantity' => 1,
            'is_required' => true,
            'variant_id' => $variantB->id,
            'price' => 110000,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $response = $this
            ->withHeaders($headers)
            ->get('/api/products/export?columns=sku,child_names')
            ->assertOk();

        $tempPath = tempnam(sys_get_temp_dir(), 'product_export_child_names_');
        file_put_contents($tempPath, $response->getContent());
        $rows = SimpleXlsx::readRows($tempPath);
        @unlink($tempPath);

        $dataRows = collect(array_slice($rows, 1))
            ->mapWithKeys(fn (array $row) => [(string) ($row[0] ?? '') => $row]);

        $configurableRow = $dataRows->get('CFG-CONTENT-001');
        $bundleRow = $dataRows->get('BUNDLE-CONTENT-001');

        $this->assertNotNull($configurableRow);
        $this->assertNotNull($bundleRow);
        $this->assertSame('Bien the xanh | Bien the do', $configurableRow[1]);
        $this->assertSame('Bat huong men lam | Bien the do', $bundleRow[1]);
    }

    public function test_product_warehouse_label_export_expands_children_and_keeps_uncategorized_last(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        $menRan = Category::query()->create([
            'account_id' => $account->id,
            'name' => 'Bo men ran',
            'code' => 'bo-men-ran',
            'slug' => 'bo-men-ran',
            'status' => true,
            'order' => 0,
        ]);
        $menLam = Category::query()->create([
            'account_id' => $account->id,
            'name' => 'Bo men lam',
            'code' => 'bo-men-lam',
            'slug' => 'bo-men-lam',
            'status' => true,
            'order' => 1,
        ]);

        $parent = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'configurable',
            'name' => 'Tron bo do tho men ran M2',
            'slug' => 'tron-bo-do-tho-men-ran-m2',
            'sku' => 'MR71',
            'price' => 5000000,
            'category_id' => $menRan->id,
            'status' => true,
        ]);
        $parent->categories()->attach($menRan->id, ['sort_order' => 0, 'item_type' => 'product']);

        $variantA = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Bat com men ran sen M2',
            'slug' => 'bat-com-men-ran-sen-m2',
            'sku' => 'MR71-BATCOMRAN',
            'price' => 80000,
            'stock_quantity' => 24,
            'status' => true,
        ]);
        $variantB = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Bat huong men ran M2',
            'slug' => 'bat-huong-men-ran-m2',
            'sku' => 'MR71-BATHUONGRAN',
            'price' => 400000,
            'stock_quantity' => 6,
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

        $uncategorized = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Au com men ran',
            'slug' => 'au-com-men-ran',
            'sku' => 'UNCAT-001',
            'price' => 750000,
            'stock_quantity' => 4,
            'status' => true,
        ]);

        $bundle = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'bundle',
            'name' => 'Bundle men ran khong xuat tem',
            'slug' => 'bundle-men-ran-khong-xuat-tem',
            'sku' => 'BUNDLE-LABEL-001',
            'price' => 900000,
            'category_id' => $menRan->id,
            'status' => true,
        ]);
        $bundle->categories()->attach($menRan->id, ['sort_order' => 0, 'item_type' => 'product']);

        $bundleChild = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'San pham con cua bundle khong xuat tem',
            'slug' => 'san-pham-con-cua-bundle-khong-xuat-tem',
            'sku' => 'BUNDLE-CHILD-LABEL-001',
            'price' => 120000,
            'category_id' => $menLam->id,
            'stock_quantity' => 10,
            'status' => true,
        ]);
        $bundleChild->categories()->attach($menLam->id, ['sort_order' => 0, 'item_type' => 'product']);
        $bundle->bundleItems()->attach($bundleChild->id, [
            'link_type' => 'bundle',
            'position' => 0,
            'quantity' => 2,
            'is_required' => true,
        ]);

        $grouped = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'grouped',
            'name' => 'Nhom san pham men ran khong xuat tem',
            'slug' => 'nhom-san-pham-men-ran-khong-xuat-tem',
            'sku' => 'GROUPED-LABEL-001',
            'price' => 1400000,
            'category_id' => $menRan->id,
            'status' => true,
        ]);
        $grouped->categories()->attach($menRan->id, ['sort_order' => 0, 'item_type' => 'product']);

        Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'San pham men lam khong nam trong file',
            'slug' => 'san-pham-men-lam-khong-nam-trong-file',
            'sku' => 'LAM-OUT-001',
            'price' => 100000,
            'category_id' => $menLam->id,
            'status' => true,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $response = $this
            ->withHeaders($headers)
            ->get('/api/products/export?export_mode=warehouse_labels&include_parent_rows=0&category_ids=' . $menRan->id . ',uncategorized')
            ->assertOk();

        $this->assertStringContainsString('tem-nhan-kho-', (string) $response->headers->get('content-disposition'));

        $tempPath = tempnam(sys_get_temp_dir(), 'product_warehouse_labels_');
        file_put_contents($tempPath, $response->getContent());
        $rows = SimpleXlsx::readRows($tempPath);

        $header = $rows[0] ?? [];
        $headerIndex = array_flip($header);
        $dataRows = array_slice($rows, 1);
        $skuColumn = $headerIndex['SKU tem'];
        $groupColumn = $headerIndex['Nhóm danh mục'];
        $labelNameColumn = $headerIndex['Tên in tem'];
        $rowTypeColumn = $headerIndex['Loại dòng'];
        $parentSkuColumn = $headerIndex['Mã SP cha'];

        $skus = collect($dataRows)->pluck($skuColumn)->values()->all();

        $this->assertSame('Tên in tem', $header[$labelNameColumn]);
        $this->assertContains('MR71-BATCOMRAN', $skus);
        $this->assertContains('MR71-BATHUONGRAN', $skus);
        $this->assertContains('UNCAT-001', $skus);
        $this->assertNotContains('MR71', $skus);
        $this->assertNotContains('BUNDLE-LABEL-001', $skus);
        $this->assertNotContains('BUNDLE-CHILD-LABEL-001', $skus);
        $this->assertNotContains('GROUPED-LABEL-001', $skus);
        $this->assertNotContains('LAM-OUT-001', $skus);

        $variantRow = collect($dataRows)->firstWhere($skuColumn, 'MR71-BATCOMRAN');
        $uncategorizedRow = collect($dataRows)->firstWhere($skuColumn, 'UNCAT-001');

        $this->assertSame('Bo men ran', $variantRow[$groupColumn]);
        $this->assertSame('MR71', $variantRow[$parentSkuColumn]);
        $this->assertSame('Con', $variantRow[$rowTypeColumn]);
        $this->assertSame('Bat com men ran sen M2', $variantRow[$labelNameColumn]);
        $this->assertSame('Chưa gắn danh mục', $uncategorizedRow[$groupColumn]);
        $this->assertSame('Sản phẩm', $uncategorizedRow[$rowTypeColumn]);
        $this->assertGreaterThan(
            array_search('MR71-BATHUONGRAN', $skus, true),
            array_search($uncategorized->sku, $skus, true)
        );

        $zip = new ZipArchive();
        $this->assertTrue($zip->open($tempPath));
        $firstSheetXml = $zip->getFromName('xl/worksheets/sheet1.xml');
        $thirdSheetXml = $zip->getFromName('xl/worksheets/sheet3.xml');
        $zip->close();
        @unlink($tempPath);

        $this->assertStringContainsString('<pane ySplit="1"', (string) $firstSheetXml);
        $this->assertStringContainsString('<autoFilter ref="A1:', (string) $firstSheetXml);
        $this->assertStringContainsString('<cols>', (string) $firstSheetXml);
        $this->assertStringContainsString('UNCAT-001', (string) $thirdSheetXml);
        $this->assertStringNotContainsString('MR71-BATCOMRAN', (string) $thirdSheetXml);
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

    public function test_product_import_excel_can_ignore_unknown_domains_and_remap_additional_info_posts(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        $localPost = Post::query()->create([
            'account_id' => $account->id,
            'title' => 'Huong dan local',
            'slug' => 'huong-dan-local',
            'content' => 'Noi dung bai viet local',
            'is_published' => true,
            'published_at' => now(),
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $additionalInfoPayload = json_encode([
            [
                'title' => 'Bao hanh',
                'display_text' => 'Xem huong dan local',
                'post_id' => 999999,
                'post_title' => 'Bai viet cu',
                'post_slug' => 'huong-dan-local',
            ],
            [
                'title' => 'Cham soc',
                'display_text' => 'Can cap nhat lai bai viet sau khi import',
                'post_id' => 999998,
                'post_title' => 'Bai viet chua co tren local',
                'post_slug' => 'bai-viet-chua-co',
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'SanPham',
            'rows' => [
                ['Mã SP', 'Tên sản phẩm', 'Giá bán', 'Thông tin bổ sung', 'Domain'],
                ['ROUND-TRIP-LOCAL-001', 'San pham tu web cu', 2999000, $additionalInfoPayload, 'shop.example.test'],
            ],
        ]]);

        $file = UploadedFile::fake()->createWithContent('products-roundtrip-portable.xlsx', $binary);

        $response = $this
            ->withHeaders($headers)
            ->post('/api/products/import', ['file' => $file])
            ->assertOk()
            ->json();

        $product = Product::query()->where('sku', 'ROUND-TRIP-LOCAL-001')->first();

        $this->assertNotNull($product);
        $this->assertSame(1, (int) ($response['summary']['created'] ?? 0));
        $this->assertSame(0, (int) ($response['summary']['failed'] ?? 0));
        $this->assertSame(2999000.0, (float) $product->price);
        $this->assertNull($product->special_price);
        $this->assertNull($product->site_domain_id);

        $additionalInfo = json_decode((string) $product->additional_info, true);

        $this->assertCount(2, $additionalInfo);
        $this->assertSame($localPost->id, $additionalInfo[0]['post_id']);
        $this->assertSame('huong-dan-local', $additionalInfo[0]['post_slug']);
        $this->assertSame('Huong dan local', $additionalInfo[0]['post_title']);
        $this->assertNull($additionalInfo[1]['post_id']);
        $this->assertSame('Cham soc', $additionalInfo[1]['title']);
        $this->assertSame('Can cap nhat lai bai viet sau khi import', $additionalInfo[1]['display_text']);
        $this->assertSame('bai-viet-chua-co', $additionalInfo[1]['post_slug']);
    }

    public function test_product_import_excel_maps_gia_ban_to_special_price_when_gia_column_is_present(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'SanPham',
            'rows' => [
                ['Mã SP', 'Tên sản phẩm', 'Giá', 'Giá bán'],
                ['ROUND-TRIP-LOCAL-002', 'San pham co gia khuyen mai', 3200000, 2999000],
            ],
        ]]);

        $file = UploadedFile::fake()->createWithContent('products-price-roundtrip.xlsx', $binary);

        $response = $this
            ->withHeaders($headers)
            ->post('/api/products/import', ['file' => $file])
            ->assertOk()
            ->json();

        $product = Product::query()->where('sku', 'ROUND-TRIP-LOCAL-002')->first();

        $this->assertNotNull($product);
        $this->assertSame(1, (int) ($response['summary']['created'] ?? 0));
        $this->assertSame(0, (int) ($response['summary']['failed'] ?? 0));
        $this->assertSame(3200000.0, (float) $product->price);
        $this->assertSame(2999000.0, (float) $product->special_price);
    }

    public function test_product_import_excel_can_create_bundle_and_grouped_products_with_component_data(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        $simpleChild = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Bat huong local',
            'slug' => 'bat-huong-local',
            'sku' => 'BOWL-LOCAL-001',
            'price' => 450000,
            'expected_cost' => 320000,
            'stock_quantity' => 12,
            'status' => true,
        ]);

        $configurableChild = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'configurable',
            'name' => 'Tuy chon mau men local',
            'slug' => 'tuy-chon-mau-men-local',
            'sku' => 'OPTION-LOCAL-001',
            'price' => 0,
            'status' => true,
        ]);

        $selectedVariant = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Tuy chon mau men local - do',
            'slug' => 'tuy-chon-mau-men-local-do',
            'sku' => 'OPTION-LOCAL-001-RED',
            'price' => 150000,
            'expected_cost' => 90000,
            'stock_quantity' => 8,
            'status' => true,
        ]);

        $configurableChild->linkedProducts()->attach($selectedVariant->id, [
            'link_type' => 'super_link',
            'position' => 0,
        ]);

        $optionPost = Post::query()->create([
            'account_id' => $account->id,
            'title' => 'Lua chon mau men',
            'slug' => 'lua-chon-mau-men',
            'content' => 'Noi dung bai viet lua chon mau men',
            'is_published' => true,
            'published_at' => now(),
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $bundleComponentData = json_encode([
            [
                'sku' => $simpleChild->sku,
                'quantity' => 1,
                'is_required' => true,
            ],
            [
                'sku' => $configurableChild->sku,
                'variant_sku' => $selectedVariant->sku,
                'quantity' => 2,
                'is_required' => false,
                'is_default' => true,
                'price' => 150000,
                'cost_price' => 90000,
                'option_title' => 'Mau men',
                'option_post_slug' => $optionPost->slug,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $groupedComponentData = json_encode([
            [
                'sku' => $simpleChild->sku,
                'quantity' => 2,
                'is_required' => true,
            ],
            [
                'variant_sku' => $selectedVariant->sku,
                'quantity' => 3,
                'is_required' => true,
                'price' => 150000,
                'cost_price' => 90000,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'SanPham',
            'rows' => [
                ['sku', 'name', 'type', 'bundle_title', 'component_data'],
                ['BUNDLE-LOCAL-NEW-001', 'Bo combo local moi', 'bundle', 'Lua chon mau men', $bundleComponentData],
                ['GROUPED-LOCAL-NEW-001', 'Nhom san pham local moi', 'grouped', '', $groupedComponentData],
            ],
        ]]);

        $file = UploadedFile::fake()->createWithContent('products-composite-create.xlsx', $binary);

        $response = $this
            ->withHeaders($headers)
            ->post('/api/products/import', ['file' => $file])
            ->assertOk()
            ->json();

        $bundle = Product::query()
            ->with('bundleItems')
            ->where('sku', 'BUNDLE-LOCAL-NEW-001')
            ->first();

        $grouped = Product::query()
            ->with('groupedItems')
            ->where('sku', 'GROUPED-LOCAL-NEW-001')
            ->first();

        $this->assertNotNull($bundle);
        $this->assertNotNull($grouped);
        $this->assertSame(2, (int) ($response['summary']['created'] ?? 0));
        $this->assertSame(0, (int) ($response['summary']['failed'] ?? 0));
        $this->assertEmpty($response['errors'] ?? []);

        $this->assertSame('bundle', $bundle->type);
        $this->assertSame('sum', $bundle->price_type);
        $this->assertSame(750000.0, (float) $bundle->price);
        $this->assertSame('Lua chon mau men', $bundle->bundle_title);
        $this->assertCount(2, $bundle->bundleItems);

        $bundleSimpleItem = $bundle->bundleItems->firstWhere('sku', $simpleChild->sku);
        $bundleVariantItem = $bundle->bundleItems->firstWhere('sku', $configurableChild->sku);

        $this->assertNotNull($bundleSimpleItem);
        $this->assertNotNull($bundleVariantItem);
        $this->assertSame(1, (int) $bundleSimpleItem->pivot->quantity);
        $this->assertSame(2, (int) $bundleVariantItem->pivot->quantity);
        $this->assertSame($selectedVariant->id, (int) $bundleVariantItem->pivot->variant_id);
        $this->assertSame($optionPost->id, (int) $bundleVariantItem->pivot->option_post_id);
        $this->assertSame(150000.0, (float) $bundleVariantItem->pivot->price);
        $this->assertTrue((bool) $bundleVariantItem->pivot->is_default);

        $this->assertSame('grouped', $grouped->type);
        $this->assertSame('sum', $grouped->price_type);
        $this->assertSame(1350000.0, (float) $grouped->price);
        $this->assertCount(2, $grouped->groupedItems);

        $groupedSimpleItem = $grouped->groupedItems->firstWhere('sku', $simpleChild->sku);
        $groupedVariantItem = $grouped->groupedItems->firstWhere('sku', $configurableChild->sku);

        $this->assertNotNull($groupedSimpleItem);
        $this->assertNotNull($groupedVariantItem);
        $this->assertSame(2, (int) $groupedSimpleItem->pivot->quantity);
        $this->assertSame(3, (int) $groupedVariantItem->pivot->quantity);
        $this->assertSame($selectedVariant->id, (int) $groupedVariantItem->pivot->variant_id);
        $this->assertSame(150000.0, (float) $groupedVariantItem->pivot->price);
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

    private function fakeMediaStorage(): void
    {
        $root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'webnam-product-excel-media-test';
        @mkdir($root, 0777, true);

        Config::set('app.url', 'http://localhost:8003');
        Config::set('filesystems.disks.product_excel_media_test', [
            'driver' => 'local',
            'root' => $root,
            'throw' => false,
        ]);
        Config::set('media.disk', 'product_excel_media_test');
        Config::set('media.public_base_url', null);
    }

    private function pngBinary(): string
    {
        return (string) base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6n0CkAAAAASUVORK5CYII=',
            true
        );
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
