<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductImage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductImageBulkRefreshTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @var array<int, string>
     */
    private array $temporaryFiles = [];

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('r2');
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);
    }

    protected function tearDown(): void
    {
        foreach ($this->temporaryFiles as $path) {
            if (is_file($path)) {
                @unlink($path);
            }
        }

        parent::tearDown();
    }

    public function test_it_previews_and_applies_bulk_refresh_by_file_name(): void
    {
        [$matchedProduct, $matchedImage] = $this->createProductWithImage('match-me.png');
        [, $untouchedImage] = $this->createProductWithImage('other-image.png');

        $previewResponse = $this->post('/api/product-images/bulk-refresh/preview', [
            'images' => $this->makeFakeImages(['match-me.png']),
            'scope_selected_only' => 0,
            'update_all_matches' => 0,
        ]);

        $previewResponse
            ->assertOk()
            ->assertJsonPath('summary.ready_files', 1)
            ->assertJsonPath('summary.matched_records', 1)
            ->assertJsonPath('summary.unmatched_files', 0)
            ->assertJsonPath('summary.ambiguous_files', 0)
            ->assertJsonPath('items.0.status', 'ready')
            ->assertJsonPath('items.0.target_count', 1)
            ->assertJsonPath('items.0.candidate_records.0.product_id', $matchedProduct->id)
            ->assertJsonPath('items.0.candidate_records.0.file_name', 'match-me.png');

        $applyResponse = $this->post('/api/product-images/bulk-refresh/apply', [
            'images' => $this->makeFakeImages(['match-me.png']),
            'scope_selected_only' => 0,
            'update_all_matches' => 0,
        ]);

        $applyResponse
            ->assertOk()
            ->assertJsonPath('summary.ready_files', 1)
            ->assertJsonPath('summary.updated_records', 1)
            ->assertJsonPath('summary.failed_records', 0)
            ->assertJsonPath('summary.updated_products', 1)
            ->assertJsonPath('summary.applied_file_names', 1);

        $matchedImage->refresh();
        $untouchedImage->refresh();

        $this->assertNotNull($matchedImage->media_asset_id);
        $this->assertStringContainsString('/api/media/assets/', (string) $matchedImage->getRawOriginal('image_url'));
        $this->assertSame('match-me.png', $matchedImage->file_name);
        $this->assertSame(strlen($this->samplePng()), $matchedImage->file_size);
        $this->assertNotEmpty(Storage::disk('r2')->allFiles());

        $this->assertNull($untouchedImage->media_asset_id);
        $this->assertSame('other-image.png', $untouchedImage->file_name);
    }

    public function test_bulk_refresh_cors_configuration_allows_local_admin_origins(): void
    {
        $allowedOrigins = config('cors.allowed_origins');
        $allowedOriginPatterns = config('cors.allowed_origins_patterns');
        $lanAdminOrigin = 'http://192.168.1.55:3003';

        $this->assertContains('http://localhost:3003', $allowedOrigins);
        $this->assertContains('http://127.0.0.1:3003', $allowedOrigins);
        $this->assertTrue(
            collect($allowedOriginPatterns)->contains(
                static fn ($pattern) => is_string($pattern) && preg_match($pattern, $lanAdminOrigin) === 1
            )
        );
        $this->assertTrue((bool) config('cors.supports_credentials'));
    }

    /**
     * @return array{0: Product, 1: ProductImage}
     */
    private function createProductWithImage(string $fileName): array
    {
        $product = Product::query()->create([
            'name' => 'San pham ' . Str::lower(Str::random(6)),
            'slug' => 'san-pham-' . Str::lower(Str::random(10)),
            'price' => 100000,
            'stock_quantity' => 5,
        ]);

        $image = ProductImage::query()->create([
            'product_id' => $product->id,
            'image_url' => 'https://legacy.example.test/' . $fileName,
            'file_name' => $fileName,
            'file_size' => 1024,
            'is_primary' => true,
            'sort_order' => 0,
        ]);

        return [$product->fresh(), $image->fresh()];
    }

    /**
     * @param  array<int, string>  $fileNames
     * @return array<int, UploadedFile>
     */
    private function makeFakeImages(array $fileNames): array
    {
        return array_map(function ($fileName) {
            $tempPath = tempnam(sys_get_temp_dir(), 'refresh-img-');
            $finalPath = $tempPath . '-' . $fileName;

            if ($tempPath !== false && is_file($tempPath)) {
                @unlink($tempPath);
            }

            file_put_contents($finalPath, $this->samplePng());
            $this->temporaryFiles[] = $finalPath;

            return new UploadedFile(
                $finalPath,
                $fileName,
                'image/png',
                null,
                true
            );
        }, $fileNames);
    }

    private function samplePng(): string
    {
        return (string) base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZkQAAAAASUVORK5CYII=',
            true
        );
    }
}
