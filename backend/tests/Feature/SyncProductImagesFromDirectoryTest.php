<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductImage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class SyncProductImagesFromDirectoryTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @var array<int, string>
     */
    private array $temporaryDirectories = [];

    protected function tearDown(): void
    {
        foreach ($this->temporaryDirectories as $directory) {
            $this->deleteDirectory($directory);
        }

        parent::tearDown();
    }

    public function test_sync_directory_updates_matching_product_image_and_creates_new_asset(): void
    {
        Storage::fake('r2');

        $product = $this->createProduct();
        $productImage = ProductImage::query()->create([
            'product_id' => $product->id,
            'image_url' => 'https://legacy.example.test/bat-com-lam.png',
            'file_name' => 'bat-com-lam.png',
            'file_size' => 1234,
            'is_primary' => true,
            'sort_order' => 0,
        ]);

        $directory = $this->makeImageDirectory([
            'bat-com-lam.png' => $this->samplePng(),
        ]);

        $this->artisan('product-images:sync-directory', [
            'directory' => $directory,
        ])->assertExitCode(0);

        $productImage->refresh();

        $this->assertNotNull($productImage->media_asset_id);
        $this->assertStringContainsString('/api/media/assets/', (string) $productImage->getRawOriginal('image_url'));
        $this->assertSame('bat-com-lam.png', $productImage->file_name);
        $this->assertSame(filesize($directory . DIRECTORY_SEPARATOR . 'bat-com-lam.png'), $productImage->file_size);
        $this->assertNotEmpty(Storage::disk('r2')->allFiles());
    }

    public function test_sync_directory_skips_ambiguous_matches_by_default_and_can_update_all_when_requested(): void
    {
        Storage::fake('r2');

        $product = $this->createProduct();

        $firstImage = ProductImage::query()->create([
            'product_id' => $product->id,
            'image_url' => 'https://legacy.example.test/trung-ten.png',
            'file_name' => 'trung-ten.png',
            'is_primary' => true,
            'sort_order' => 0,
        ]);

        $secondImage = ProductImage::query()->create([
            'product_id' => $product->id,
            'image_url' => 'https://legacy.example.test/trung-ten-khac.png',
            'file_name' => 'trung-ten.png',
            'is_primary' => false,
            'sort_order' => 1,
        ]);

        $directory = $this->makeImageDirectory([
            'trung-ten.png' => $this->samplePng(),
        ]);

        $this->artisan('product-images:sync-directory', [
            'directory' => $directory,
        ])->assertExitCode(0);

        $firstImage->refresh();
        $secondImage->refresh();

        $this->assertNull($firstImage->media_asset_id);
        $this->assertNull($secondImage->media_asset_id);

        $this->artisan('product-images:sync-directory', [
            'directory' => $directory,
            '--update-all-matches' => true,
        ])->assertExitCode(0);

        $firstImage->refresh();
        $secondImage->refresh();

        $this->assertNotNull($firstImage->media_asset_id);
        $this->assertNotNull($secondImage->media_asset_id);
        $this->assertNotSame($firstImage->media_asset_id, $secondImage->media_asset_id);
    }

    private function createProduct(): Product
    {
        return Product::query()->create([
            'name' => 'San pham test',
            'slug' => 'san-pham-test-' . Str::lower(Str::random(10)),
            'price' => 100000,
            'stock_quantity' => 5,
        ]);
    }

    /**
     * @param  array<string, string>  $files
     */
    private function makeImageDirectory(array $files): string
    {
        $directory = storage_path('framework/testing/product-image-sync-' . Str::lower(Str::random(12)));

        if (!is_dir($directory)) {
            mkdir($directory, 0777, true);
        }

        foreach ($files as $name => $contents) {
            file_put_contents($directory . DIRECTORY_SEPARATOR . $name, $contents);
        }

        $this->temporaryDirectories[] = $directory;

        return $directory;
    }

    private function samplePng(): string
    {
        return (string) base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZkQAAAAASUVORK5CYII=', true);
    }

    private function deleteDirectory(string $directory): void
    {
        if (!is_dir($directory)) {
            return;
        }

        $items = array_diff(scandir($directory) ?: [], ['.', '..']);

        foreach ($items as $item) {
            $path = $directory . DIRECTORY_SEPARATOR . $item;

            if (is_dir($path)) {
                $this->deleteDirectory($path);
                continue;
            }

            @unlink($path);
        }

        @rmdir($directory);
    }
}
