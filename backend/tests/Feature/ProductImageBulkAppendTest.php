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

class ProductImageBulkAppendTest extends TestCase
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

    public function test_it_previews_and_applies_bulk_append_for_selected_products_at_the_start(): void
    {
        $selectedProduct = $this->createProductWithImages(['old-1.png', 'old-2.png']);
        $unselectedProduct = $this->createProductWithImages(['stay-1.png', 'stay-2.png']);

        $previewResponse = $this->post('/api/product-images/bulk-append/preview', [
            'images' => $this->makeFakeImages(['new-a.png', 'new-b.png']),
            'product_ids' => [$selectedProduct->id],
            'scope_selected_only' => 1,
            'insertion_mode' => 'start',
        ]);

        $previewResponse
            ->assertOk()
            ->assertJsonPath('summary.can_apply', true)
            ->assertJsonPath('summary.target_products', 1)
            ->assertJsonPath('summary.eligible_products', 1)
            ->assertJsonPath('products.0.preview_items.0.kind', 'new')
            ->assertJsonPath('products.0.preview_items.1.kind', 'new');

        $applyResponse = $this->post('/api/product-images/bulk-append/apply', [
            'images' => $this->makeFakeImages(['new-a.png', 'new-b.png']),
            'product_ids' => [$selectedProduct->id],
            'scope_selected_only' => 1,
            'insertion_mode' => 'start',
        ]);

        $applyResponse
            ->assertOk()
            ->assertJsonPath('summary.applied_products', 1)
            ->assertJsonPath('summary.created_records', 2)
            ->assertJsonPath('summary.failed_products', 0);

        $this->assertProductImageOrder($selectedProduct, ['new-a.png', 'new-b.png', 'old-1.png', 'old-2.png']);
        $this->assertProductImageOrder($unselectedProduct, ['stay-1.png', 'stay-2.png']);

        $selectedProduct->refresh();
        $this->assertSame(
            'new-a.png',
            $selectedProduct->images()->first()?->file_name
        );
        $this->assertNotEmpty(Storage::disk('r2')->allFiles());
    }

    public function test_it_applies_bulk_append_for_selected_products_after_a_specific_existing_image(): void
    {
        $firstProduct = $this->createProductWithImages(['a-1.png', 'a-2.png', 'a-3.png']);
        $secondProduct = $this->createProductWithImages(['b-1.png', 'b-2.png', 'b-3.png', 'b-4.png']);

        $response = $this->post('/api/product-images/bulk-append/apply', [
            'images' => $this->makeFakeImages(['insert-1.png', 'insert-2.png']),
            'product_ids' => [$firstProduct->id, $secondProduct->id],
            'scope_selected_only' => 1,
            'insertion_mode' => 'after_index',
            'after_index' => 2,
        ]);

        $response
            ->assertOk()
            ->assertJsonPath('summary.applied_products', 2)
            ->assertJsonPath('summary.created_records', 4)
            ->assertJsonPath('summary.failed_products', 0);

        $this->assertProductImageOrder($firstProduct, ['a-1.png', 'a-2.png', 'insert-1.png', 'insert-2.png', 'a-3.png']);
        $this->assertProductImageOrder($secondProduct, ['b-1.png', 'b-2.png', 'insert-1.png', 'insert-2.png', 'b-3.png', 'b-4.png']);
    }

    public function test_it_applies_bulk_append_for_all_products_at_the_end(): void
    {
        $firstProduct = $this->createProductWithImages(['tail-a-1.png', 'tail-a-2.png']);
        $secondProduct = $this->createProductWithImages(['tail-b-1.png']);

        $response = $this->post('/api/product-images/bulk-append/apply', [
            'images' => $this->makeFakeImages(['tail-new-1.png', 'tail-new-2.png']),
            'scope_selected_only' => 0,
            'insertion_mode' => 'end',
        ]);

        $response
            ->assertOk()
            ->assertJsonPath('summary.applied_products', 2)
            ->assertJsonPath('summary.created_records', 4)
            ->assertJsonPath('summary.failed_products', 0);

        $this->assertProductImageOrder($firstProduct, ['tail-a-1.png', 'tail-a-2.png', 'tail-new-1.png', 'tail-new-2.png']);
        $this->assertProductImageOrder($secondProduct, ['tail-b-1.png', 'tail-new-1.png', 'tail-new-2.png']);
    }

    public function test_it_blocks_after_index_append_when_the_target_scope_cannot_support_a_uniform_position(): void
    {
        $longProduct = $this->createProductWithImages(['long-1.png', 'long-2.png']);
        $shortProduct = $this->createProductWithImages(['short-1.png']);

        $previewResponse = $this->post('/api/product-images/bulk-append/preview', [
            'images' => $this->makeFakeImages(['blocked-1.png']),
            'scope_selected_only' => 0,
            'insertion_mode' => 'after_index',
            'after_index' => 2,
        ]);

        $previewResponse
            ->assertOk()
            ->assertJsonPath('summary.can_apply', false)
            ->assertJsonPath('summary.blocking_products', 1)
            ->assertJsonPath('summary.supported_after_index_max_for_all_targets', 1);

        $applyResponse = $this->withHeaders([
            'Accept' => 'application/json',
        ])->post('/api/product-images/bulk-append/apply', [
            'images' => $this->makeFakeImages(['blocked-1.png']),
            'scope_selected_only' => 0,
            'insertion_mode' => 'after_index',
            'after_index' => 2,
        ]);

        $applyResponse->assertStatus(422);

        $this->assertProductImageOrder($longProduct, ['long-1.png', 'long-2.png']);
        $this->assertProductImageOrder($shortProduct, ['short-1.png']);
    }

    private function createProductWithImages(array $fileNames): Product
    {
        $product = Product::query()->create([
            'name' => 'San pham ' . Str::lower(Str::random(6)),
            'slug' => 'san-pham-' . Str::lower(Str::random(10)),
            'price' => 100000,
            'stock_quantity' => 5,
        ]);

        foreach ($fileNames as $index => $fileName) {
            ProductImage::query()->create([
                'product_id' => $product->id,
                'image_url' => 'https://legacy.example.test/' . $fileName,
                'file_name' => $fileName,
                'file_size' => 1024 + $index,
                'is_primary' => $index === 0,
                'sort_order' => $index,
            ]);
        }

        return $product->fresh();
    }

    /**
     * @param  array<int, string>  $fileNames
     * @return array<int, UploadedFile>
     */
    private function makeFakeImages(array $fileNames): array
    {
        return array_map(function ($fileName) {
            $tempPath = tempnam(sys_get_temp_dir(), 'bulk-img-');
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

    /**
     * @param  array<int, string>  $expectedOrder
     */
    private function assertProductImageOrder(Product $product, array $expectedOrder): void
    {
        $actualOrder = $product->fresh()->images()->get()->pluck('file_name')->all();

        $this->assertSame($expectedOrder, $actualOrder);
        $this->assertSame(
            $expectedOrder[0] ?? null,
            $product->fresh()->images()->first()?->file_name
        );

        $primaryImage = $product->fresh()->images()->firstWhere('is_primary', true);
        $this->assertSame($expectedOrder[0] ?? null, $primaryImage?->file_name);
    }

    private function samplePng(): string
    {
        return (string) base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZkQAAAAASUVORK5CYII=',
            true
        );
    }
}
