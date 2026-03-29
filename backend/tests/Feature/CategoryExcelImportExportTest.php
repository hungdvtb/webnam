<?php

namespace Tests\Feature;

use App\Models\Attribute;
use App\Models\Category;
use App\Models\User;
use App\Support\SimpleXlsx;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CategoryExcelImportExportTest extends TestCase
{
    use RefreshDatabase;

    public function test_category_export_excel_contains_tree_and_filter_columns(): void
    {
        $diameter = $this->createAttribute('Duong kinh', 'duong-kinh');
        $glaze = $this->createAttribute('Loai men', 'loai-men');

        $parent = Category::query()->create([
            'name' => 'Do tho',
            'code' => 'do-tho',
            'slug' => 'do-tho',
            'status' => true,
            'order' => 0,
            'display_layout' => 'layout_2',
            'filterable_attribute_ids' => [$diameter->id, $glaze->id],
        ]);

        Category::query()->create([
            'name' => 'Bo am tra',
            'code' => 'bo-am-tra',
            'slug' => 'bo-am-tra',
            'parent_id' => $parent->id,
            'description' => 'Ghi chu con',
            'status' => false,
            'order' => 0,
            'display_layout' => 'layout_1',
            'filterable_attribute_ids' => [],
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $response = $this->get('/api/categories/export')->assertOk();

        $tempPath = tempnam(sys_get_temp_dir(), 'cat_export_');
        file_put_contents($tempPath, $response->getContent());
        $rows = SimpleXlsx::readRows($tempPath);
        @unlink($tempPath);

        $this->assertSame('Ma danh muc', $rows[0][0]);
        $this->assertSame('do-tho', $rows[1][0]);
        $this->assertSame('Do tho', $rows[1][2]);
        $this->assertSame('duong-kinh, loai-men', $rows[1][6]);
        $this->assertSame('bo-am-tra', $rows[2][0]);
        $this->assertSame('CODE:do-tho', $rows[2][3]);
        $this->assertSame('Ghi chu con', $rows[2][8]);
    }

    public function test_category_import_excel_creates_and_updates_categories_with_parent_relations(): void
    {
        $diameter = $this->createAttribute('Duong kinh', 'duong-kinh');
        $glaze = $this->createAttribute('Loai men', 'loai-men');

        $existing = Category::query()->create([
            'name' => 'Danh muc goc cu',
            'code' => 'danh-muc-goc',
            'slug' => 'danh-muc-goc',
            'status' => false,
            'order' => 0,
            'display_layout' => 'layout_1',
            'filterable_attribute_ids' => [],
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'DanhMucSanPham',
            'rows' => [
                ['Ma danh muc', 'ID', 'Ten danh muc', 'Danh muc cha', 'Thu tu hien thi', 'Giao dien', 'Bo loc thuoc tinh', 'Trang thai hien thi', 'Ghi chu'],
                ['danh-muc-goc', $existing->id, 'Danh muc goc moi', '', 0, 'layout_2', 'duong-kinh, loai-men', 1, 'Cap nhat tu excel'],
                ['bo-am-tra-dao', '', 'Bo am tra dao', 'CODE:danh-muc-goc', 0, 'layout_1', 'duong-kinh', 1, 'Them moi tu excel'],
            ],
        ]]);

        $file = UploadedFile::fake()->createWithContent('categories.xlsx', $binary);

        $this->post('/api/categories/import', ['file' => $file])
            ->assertOk()
            ->assertJsonPath('summary.created', 1)
            ->assertJsonPath('summary.updated', 1);

        $existing->refresh();
        $this->assertSame('Danh muc goc moi', $existing->name);
        $this->assertSame('layout_2', $existing->display_layout);
        $this->assertSame(1, (int) $existing->status);
        $this->assertSame([$diameter->id, $glaze->id], $existing->filterable_attribute_ids);

        $child = Category::query()->where('code', 'bo-am-tra-dao')->first();
        $this->assertNotNull($child);
        $this->assertSame($existing->id, $child->parent_id);
        $this->assertSame([$diameter->id], $child->filterable_attribute_ids);
        $this->assertSame('Them moi tu excel', $child->description);
    }

    public function test_category_import_excel_returns_row_level_errors(): void
    {
        Category::query()->create([
            'name' => 'Danh muc goc',
            'code' => 'danh-muc-goc',
            'slug' => 'danh-muc-goc',
            'status' => true,
            'order' => 0,
        ]);

        $this->createAttribute('Duong kinh', 'duong-kinh');

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $binary = SimpleXlsx::buildWorkbook([[
            'name' => 'DanhMucSanPham',
            'rows' => [
                ['Ma danh muc', 'ID', 'Ten danh muc', 'Danh muc cha', 'Thu tu hien thi', 'Giao dien', 'Bo loc thuoc tinh', 'Trang thai hien thi', 'Ghi chu'],
                ['trung-ma', '', '', 'CODE:khong-ton-tai', 'abc', 'layout_9', 'khong-co', 'abc', ''],
                ['trung-ma', '', 'Dong bi trung ma', '', 0, 'layout_1', '', 1, ''],
            ],
        ]]);

        $file = UploadedFile::fake()->createWithContent('categories.xlsx', $binary);

        $response = $this->post('/api/categories/import', ['file' => $file])
            ->assertStatus(422)
            ->json();

        $errors = collect($response['errors'] ?? []);

        $this->assertTrue($errors->contains(fn ($error) => (int) ($error['row'] ?? 0) === 2 && str_contains($error['message'] ?? '', 'Ten danh muc')));
        $this->assertTrue($errors->contains(fn ($error) => (int) ($error['row'] ?? 0) === 2 && str_contains($error['message'] ?? '', 'Giao dien')));
        $this->assertTrue($errors->contains(fn ($error) => (int) ($error['row'] ?? 0) === 2 && str_contains($error['message'] ?? '', 'Thu tu')));
        $this->assertTrue($errors->contains(fn ($error) => (int) ($error['row'] ?? 0) === 2 && str_contains($error['message'] ?? '', 'Khong tim thay thuoc tinh')));
        $this->assertTrue($errors->contains(fn ($error) => (int) ($error['row'] ?? 0) === 3 && str_contains($error['message'] ?? '', 'Trung ma danh muc')));
    }

    private function createAttribute(string $name, string $code): Attribute
    {
        return Attribute::query()->create([
            'name' => $name,
            'entity_type' => 'product',
            'code' => $code,
            'frontend_type' => 'select',
            'is_filterable' => true,
            'is_filterable_frontend' => true,
            'is_filterable_backend' => true,
            'status' => true,
        ]);
    }
}
