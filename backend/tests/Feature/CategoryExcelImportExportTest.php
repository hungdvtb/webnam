<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\User;
use App\Support\SimpleXlsx;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CategoryExcelImportExportTest extends TestCase
{
    use RefreshDatabase;

    public function test_category_export_excel_supports_selected_tree_and_online_images(): void
    {
        Storage::fake('public');
        config(['filesystems.disks.public.url' => 'https://cdn.test/storage']);

        $root = Category::query()->create([
            'name' => 'Do tho',
            'code' => 'do-tho',
            'slug' => 'do-tho',
            'description' => 'Danh muc goc',
            'banner_path' => 'category-banners/do-tho.jpg',
            'logo_path' => 'category-logos/do-tho.png',
            'status' => true,
            'order' => 0,
            'display_layout' => 'layout_1',
            'filterable_attribute_ids' => [],
        ]);

        Category::query()->create([
            'name' => 'Bo am tra',
            'code' => 'bo-am-tra',
            'slug' => 'bo-am-tra',
            'parent_id' => $root->id,
            'description' => 'Danh muc con',
            'banner_path' => 'category-banners/bo-am-tra.jpg',
            'logo_path' => 'category-logos/bo-am-tra.png',
            'status' => true,
            'order' => 0,
            'display_layout' => 'layout_1',
            'filterable_attribute_ids' => [],
        ]);

        Category::query()->create([
            'name' => 'Ngoai pham vi',
            'code' => 'ngoai-pham-vi',
            'slug' => 'ngoai-pham-vi',
            'status' => true,
            'order' => 1,
            'display_layout' => 'layout_1',
            'filterable_attribute_ids' => [],
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $response = $this->get('/api/categories/export?ids[]=' . $root->id)->assertOk();

        $rows = $this->readWorkbookRows($response->getContent());

        $this->assertSame(
            ['Ma danh muc', 'Ten danh muc', 'Mo ta', 'Danh muc cha', 'Thu tu trong cay', 'Link anh banner', 'Link anh nho'],
            $rows[0]
        );
        $this->assertCount(3, $rows);
        $this->assertSame('do-tho', $rows[1][0]);
        $this->assertSame('Danh muc goc', $rows[1][2]);
        $this->assertSame('https://cdn.test/storage/category-banners/do-tho.jpg', $rows[1][5]);
        $this->assertSame('https://cdn.test/storage/category-logos/do-tho.png', $rows[1][6]);
        $this->assertSame('bo-am-tra', $rows[2][0]);
        $this->assertSame('CODE:do-tho', $rows[2][3]);
        $this->assertSame('https://cdn.test/storage/category-banners/bo-am-tra.jpg', $rows[2][5]);
    }

    public function test_category_import_excel_round_trips_tree_and_downloads_online_images(): void
    {
        Storage::fake('public');
        config(['filesystems.disks.public.url' => 'https://cdn.test/storage']);

        Http::fake([
            'cdn.example.com/*' => Http::response('fake-image-binary', 200, ['Content-Type' => 'image/jpeg']),
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'DanhMucSanPham',
            'rows' => [
                ['Ma danh muc', 'Ten danh muc', 'Mo ta', 'Danh muc cha', 'Thu tu trong cay', 'Link anh banner', 'Link anh nho'],
                ['do-tho', 'Do tho', 'Danh muc goc', '', 0, 'https://cdn.example.com/categories/do-tho-banner.jpg', 'https://cdn.example.com/categories/do-tho-logo.jpg'],
                ['bo-am-tra', 'Bo am tra', 'Danh muc con', 'CODE:do-tho', 0, 'https://cdn.example.com/categories/bo-am-tra-banner.jpg', 'https://cdn.example.com/categories/bo-am-tra-logo.jpg'],
            ],
        ]]);

        $file = UploadedFile::fake()->createWithContent('categories.xlsx', $binary);

        $response = $this->post('/api/categories/import', ['file' => $file])
            ->assertOk()
            ->json();

        $this->assertSame(2, (int) ($response['summary']['created'] ?? 0));
        $this->assertSame(0, (int) ($response['summary']['updated'] ?? 0));
        $this->assertSame(4, (int) ($response['summary']['images_imported'] ?? 0));

        $root = Category::query()->where('code', 'do-tho')->first();
        $child = Category::query()->where('code', 'bo-am-tra')->first();

        $this->assertNotNull($root);
        $this->assertNotNull($child);
        $this->assertSame($root->id, $child->parent_id);
        $this->assertSame('Danh muc goc', $root->description);
        $this->assertStringStartsWith('https://cdn.test/storage/category-banners/', (string) $root->banner_path);
        $this->assertStringStartsWith('https://cdn.test/storage/category-logos/', (string) $root->logo_path);
        $this->assertStringStartsWith('https://cdn.test/storage/category-banners/', (string) $child->banner_path);
        $this->assertStringStartsWith('https://cdn.test/storage/category-logos/', (string) $child->logo_path);
        $this->assertCount(2, Storage::disk('public')->allFiles('category-banners'));
        $this->assertCount(2, Storage::disk('public')->allFiles('category-logos'));
    }

    public function test_category_import_excel_update_mode_updates_only_selected_fields_and_keeps_existing_data(): void
    {
        Storage::fake('public');
        config(['filesystems.disks.public.url' => 'https://cdn.test/storage']);

        $category = Category::query()->create([
            'name' => 'Do tho cu',
            'code' => 'do-tho',
            'slug' => 'do-tho',
            'description' => 'Mo ta cu',
            'banner_path' => 'category-banners/old-banner.jpg',
            'logo_path' => 'category-logos/old-logo.jpg',
            'status' => true,
            'order' => 0,
            'display_layout' => 'layout_1',
            'filterable_attribute_ids' => [],
        ]);

        $untouched = Category::query()->create([
            'name' => 'Danh muc khac',
            'code' => 'danh-muc-khac',
            'slug' => 'danh-muc-khac',
            'description' => 'Khong doi',
            'status' => true,
            'order' => 1,
            'display_layout' => 'layout_1',
            'filterable_attribute_ids' => [],
        ]);

        Http::fake([
            'cdn.example.com/*' => Http::response('fake-image-binary', 200, ['Content-Type' => 'image/png']),
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'DanhMucSanPham',
            'rows' => [
                ['Ma danh muc', 'Ten danh muc', 'Mo ta', 'Danh muc cha', 'Thu tu trong cay', 'Link anh banner', 'Link anh nho'],
                ['do-tho', 'Do tho moi', 'Mo ta moi', '', 0, 'https://cdn.example.com/categories/new-banner.png', 'https://cdn.example.com/categories/new-logo.png'],
            ],
        ]]);

        $file = UploadedFile::fake()->createWithContent('categories-update.xlsx', $binary);

        $response = $this->post('/api/categories/import', [
            'file' => $file,
            'mode' => 'update_selected_fields',
            'update_fields' => ['banner', 'logo'],
        ])
            ->assertOk()
            ->json();

        $category->refresh();
        $untouched->refresh();

        $this->assertSame(0, (int) ($response['summary']['created'] ?? 0));
        $this->assertSame(1, (int) ($response['summary']['updated'] ?? 0));
        $this->assertSame('Do tho cu', $category->name);
        $this->assertSame('Mo ta cu', $category->description);
        $this->assertSame(1, Category::query()->where('code', 'do-tho')->count());
        $this->assertStringStartsWith('https://cdn.test/storage/category-banners/', (string) $category->banner_path);
        $this->assertStringStartsWith('https://cdn.test/storage/category-logos/', (string) $category->logo_path);
        $this->assertSame('Khong doi', $untouched->description);
    }

    public function test_category_import_excel_returns_row_errors_for_invalid_image_links_and_duplicate_codes(): void
    {
        Category::query()->create([
            'name' => 'Do tho',
            'code' => 'do-tho',
            'slug' => 'do-tho',
            'status' => true,
            'order' => 0,
            'display_layout' => 'layout_1',
            'filterable_attribute_ids' => [],
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'DanhMucSanPham',
            'rows' => [
                ['Ma danh muc', 'Ten danh muc', 'Mo ta', 'Danh muc cha', 'Thu tu trong cay', 'Link anh banner', 'Link anh nho'],
                ['do-tho', 'Do tho moi', 'Mo ta moi', '', 0, 'not-a-valid-url', 'https://cdn.example.com/categories/logo.jpg'],
                ['do-tho', 'Trung ma', '', '', 1, '', ''],
            ],
        ]]);

        $file = UploadedFile::fake()->createWithContent('categories-invalid.xlsx', $binary);

        $response = $this->post('/api/categories/import', ['file' => $file])
            ->assertStatus(422)
            ->json();

        $errors = collect($response['errors'] ?? []);

        $this->assertTrue($errors->contains(fn ($error) => (int) ($error['row'] ?? 0) === 2 && ($error['column'] ?? '') === 'Link anh banner'));
        $this->assertTrue($errors->contains(fn ($error) => (int) ($error['row'] ?? 0) === 3 && str_contains((string) ($error['message'] ?? ''), 'Trung ma danh muc')));
    }

    private function readWorkbookRows(string $binary): array
    {
        $tempPath = tempnam(sys_get_temp_dir(), 'cat_export_');
        file_put_contents($tempPath, $binary);
        $rows = SimpleXlsx::readRows($tempPath);
        @unlink($tempPath);

        return $rows;
    }
}
