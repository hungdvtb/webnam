<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Category;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CategoryMediaIsolationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('r2');
        config(['media.disk' => 'r2']);
    }

    public function test_updating_logo_and_banner_only_changes_the_selected_category(): void
    {
        Account::query()->create([
            'name' => 'Main account',
            'site_code' => 'MAIN',
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $firstCategory = $this->createCategory([
            'name' => 'Danh muc 1',
            'code' => 'danh-muc-1',
            'slug' => 'danh-muc-1',
            'banner_path' => 'legacy/category-1-banner.jpg',
            'logo_path' => 'legacy/category-1-logo.png',
        ]);

        $secondCategory = $this->createCategory([
            'name' => 'Danh muc 2',
            'code' => 'danh-muc-2',
            'slug' => 'danh-muc-2',
            'banner_path' => 'legacy/category-2-banner.jpg',
            'logo_path' => 'legacy/category-2-logo.png',
            'order' => 1,
        ]);

        $response = $this->post("/api/categories/{$firstCategory->id}", [
            'name' => $firstCategory->name,
            'banner' => $this->makePngUpload('category-1-banner.png'),
            'logo' => $this->makePngUpload('category-1-logo.png'),
        ])->assertOk();

        $payload = $response->json();

        $firstCategory->refresh();
        $secondCategory->refresh();

        $this->assertSame((int) $firstCategory->id, (int) $payload['id']);
        $this->assertNotNull($firstCategory->banner_media_asset_id);
        $this->assertNotNull($firstCategory->logo_media_asset_id);
        $this->assertStringContainsString('/api/media/assets/', (string) $firstCategory->banner_path);
        $this->assertStringContainsString('/api/media/assets/', (string) $firstCategory->logo_path);

        $this->assertNull($secondCategory->banner_media_asset_id);
        $this->assertNull($secondCategory->logo_media_asset_id);
        $this->assertSame('legacy/category-2-banner.jpg', $secondCategory->getRawOriginal('banner_path'));
        $this->assertSame('legacy/category-2-logo.png', $secondCategory->getRawOriginal('logo_path'));

        $indexPayload = collect($this->getJson('/api/categories')->assertOk()->json())->keyBy('id');
        $firstIndexCategory = $indexPayload->get($firstCategory->id);
        $secondIndexCategory = $indexPayload->get($secondCategory->id);

        $this->assertSame((int) $firstCategory->banner_media_asset_id, (int) $firstIndexCategory['banner_media_asset_id']);
        $this->assertSame((int) $firstCategory->logo_media_asset_id, (int) $firstIndexCategory['logo_media_asset_id']);
        $this->assertNull($secondIndexCategory['banner_media_asset_id']);
        $this->assertNull($secondIndexCategory['logo_media_asset_id']);
        $this->assertSame($secondCategory->banner_path, $secondIndexCategory['banner_path']);
        $this->assertSame($secondCategory->logo_path, $secondIndexCategory['logo_path']);

        $productsPayload = $this->getJson("/api/categories/{$firstCategory->id}/products")
            ->assertOk()
            ->json('category');

        $this->assertSame((int) $firstCategory->banner_media_asset_id, (int) $productsPayload['banner_media_asset_id']);
        $this->assertSame((int) $firstCategory->logo_media_asset_id, (int) $productsPayload['logo_media_asset_id']);
        $this->assertStringContainsString('/api/media/assets/', (string) $productsPayload['banner_path']);
        $this->assertStringContainsString('/api/media/assets/', (string) $productsPayload['logo_path']);
    }

    private function createCategory(array $overrides = []): Category
    {
        return Category::withoutGlobalScopes()->create(array_merge([
            'account_id' => null,
            'name' => 'Danh muc',
            'code' => 'danh-muc',
            'slug' => 'danh-muc',
            'description' => 'Mo ta',
            'status' => 1,
            'order' => 0,
            'display_layout' => 'layout_1',
            'filterable_attribute_ids' => [],
        ], $overrides));
    }

    private function makePngUpload(string $filename): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'cat-media-');
        $pngBinary = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1EAAAAASUVORK5CYII=', true);

        file_put_contents($path, $pngBinary);

        return new UploadedFile(
            $path,
            $filename,
            'image/png',
            null,
            true
        );
    }
}
