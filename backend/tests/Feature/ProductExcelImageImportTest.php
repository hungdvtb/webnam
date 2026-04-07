<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Product;
use App\Models\ProductImage;
use App\Models\User;
use App\Support\SimpleXlsx;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductExcelImageImportTest extends TestCase
{
    use RefreshDatabase;

    public function test_product_import_excel_updates_primary_and_gallery_images_from_url_in_selective_update_mode(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        $product = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Ống hương men LAM',
            'slug' => 'ong-huong-men-lam',
            'sku' => 'ML80-ONGHUONGLAM',
            'price' => 150000,
            'status' => true,
        ]);

        $this->fakeMediaStorage();
        Http::fake([
            'https://cdn.example.com/*' => Http::response($this->pngBinary(), 200, [
                'Content-Type' => 'image/png',
            ]),
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $galleryValue = " \u{200B}https://cdn.example.com/products/ml80-gallery-1.png\u{00A0} | \r\n“https://cdn.example.com/products/ml80-gallery-2.png” | https://cdn.example.com/products/ml80-main.png ";
        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'SanPham',
            'rows' => [
                ['Mã SP', 'Ảnh đại diện', 'Thư viện ảnh'],
                ['ML80-ONGHUONGLAM', " 'https://cdn.example.com/products/ml80-main.png' ", $galleryValue],
            ],
        ]]);

        $file = UploadedFile::fake()->createWithContent('products-images-update.xlsx', $binary);

        $response = $this
            ->withHeaders($headers)
            ->post('/api/products/import', [
                'file' => $file,
                'mode' => 'update_selected_fields',
                'missing_product_action' => 'skip',
                'update_fields' => ['images'],
            ])
            ->assertOk()
            ->json();

        $product->refresh();
        $product->load('images');

        $this->assertSame(1, (int) ($response['summary']['updated'] ?? 0));
        $this->assertSame(0, (int) ($response['summary']['failed'] ?? 0));
        $this->assertSame(3, (int) ($response['summary']['images_imported'] ?? 0));
        $this->assertEmpty($response['errors'] ?? []);
        $this->assertCount(3, $product->images);

        $primaryImage = $product->images->firstWhere('is_primary', true);
        $galleryImages = $product->images->where('is_primary', false)->values();

        $this->assertNotNull($primaryImage);
        $this->assertNotNull($primaryImage->media_asset_id);
        $this->assertCount(2, $galleryImages);
        $this->assertTrue($galleryImages->every(fn (ProductImage $image) => $image->media_asset_id !== null));

        $showResponse = $this
            ->withHeaders($headers)
            ->get('/api/products/' . $product->id)
            ->assertOk()
            ->json();

        $this->assertCount(3, $showResponse['images'] ?? []);
        $this->assertTrue((bool) ($showResponse['images'][0]['is_primary'] ?? false));
        $this->assertNotEmpty($showResponse['images'][0]['image_url'] ?? '');
        $this->assertNotEmpty($showResponse['images'][0]['thumbnail_url'] ?? '');
    }

    public function test_product_import_excel_reports_clear_error_when_managed_image_url_cannot_be_saved(): void
    {
        $account = $this->createAccount();
        $headers = ['X-Account-Id' => (string) $account->id];

        $product = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Ống hương men LAM',
            'slug' => 'ong-huong-men-lam',
            'sku' => 'ML80-ONGHUONGLAM',
            'price' => 150000,
            'status' => true,
        ]);

        ProductImage::query()->create([
            'product_id' => $product->id,
            'image_url' => 'https://cdn.example.com/products/existing-image.png',
            'is_primary' => true,
            'sort_order' => 0,
        ]);

        $this->fakeMediaStorage();
        Http::fake([
            'http://localhost:8003/media-assets/*' => Http::response('missing', 404, [
                'Content-Type' => 'text/plain',
            ]),
            'https://cdn.example.com/*' => Http::response($this->pngBinary(), 200, [
                'Content-Type' => 'image/png',
            ]),
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $missingManagedUrl = 'http://localhost:8003/media-assets/01j77jj6k59p4k8e8h6p4m0abc/large.png';
        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'SanPham',
            'rows' => [
                ['Mã SP', 'Ảnh đại diện'],
                ['ML80-ONGHUONGLAM', $missingManagedUrl],
            ],
        ]]);

        $file = UploadedFile::fake()->createWithContent('products-images-fail.xlsx', $binary);

        $response = $this
            ->withHeaders($headers)
            ->post('/api/products/import', [
                'file' => $file,
                'mode' => 'update_selected_fields',
                'missing_product_action' => 'skip',
                'update_fields' => ['images'],
            ])
            ->assertStatus(422)
            ->json();

        $product->refresh();

        $this->assertSame(1, (int) ($response['summary']['failed'] ?? 0));
        $this->assertSame(0, (int) ($response['summary']['updated'] ?? 0));
        $this->assertNotEmpty($response['errors'] ?? []);
        $this->assertSame('Ảnh', $response['errors'][0]['column'] ?? null);
        $this->assertStringContainsString('Khong the tai anh tu URL', (string) ($response['errors'][0]['message'] ?? ''));
        $this->assertSame(1, $product->images()->count());
        $this->assertSame('https://cdn.example.com/products/existing-image.png', (string) $product->images()->value('image_url'));
    }

    private function fakeMediaStorage(): void
    {
        Config::set('app.url', 'http://localhost:8003');
        Config::set('media.disk', 'local');
        Config::set('media.public_base_url', null);
        Storage::fake('local');
    }

    private function pngBinary(): string
    {
        return (string) base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6n0CkAAAAASUVORK5CYII=',
            true
        );
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
}
