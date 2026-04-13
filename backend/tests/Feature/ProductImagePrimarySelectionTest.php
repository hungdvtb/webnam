<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductImage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductImagePrimarySelectionTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);
    }

    public function test_reorder_preserves_the_explicit_primary_image(): void
    {
        $product = $this->createProductWithImages([
            ['file_name' => 'first.jpg', 'sort_order' => 0, 'is_primary' => false],
            ['file_name' => 'second.jpg', 'sort_order' => 1, 'is_primary' => true],
            ['file_name' => 'third.jpg', 'sort_order' => 2, 'is_primary' => false],
        ]);

        $images = $product->images()->orderBy('sort_order')->get();
        $explicitPrimaryId = (int) $images[1]->id;
        $reorderedIds = [
            (int) $images[2]->id,
            (int) $images[0]->id,
            $explicitPrimaryId,
        ];

        $this->postJson('/api/product-images/reorder', [
            'ids' => $reorderedIds,
        ])->assertOk();

        $orderedImages = ProductImage::query()
            ->where('product_id', $product->id)
            ->orderBy('sort_order')
            ->get();

        $this->assertSame($reorderedIds, $orderedImages->pluck('id')->map(fn ($id) => (int) $id)->all());
        $this->assertSame($explicitPrimaryId, (int) $orderedImages->firstWhere('is_primary', true)?->id);
        $this->assertCount(1, $orderedImages->where('is_primary', true));
    }

    public function test_reorder_falls_back_to_the_first_image_when_no_primary_exists(): void
    {
        $product = $this->createProductWithImages([
            ['file_name' => 'alpha.jpg', 'sort_order' => 0, 'is_primary' => false],
            ['file_name' => 'beta.jpg', 'sort_order' => 1, 'is_primary' => false],
        ]);

        $images = $product->images()->orderBy('sort_order')->get();
        $reorderedIds = [
            (int) $images[1]->id,
            (int) $images[0]->id,
        ];

        $this->postJson('/api/product-images/reorder', [
            'ids' => $reorderedIds,
        ])->assertOk();

        $orderedImages = ProductImage::query()
            ->where('product_id', $product->id)
            ->orderBy('sort_order')
            ->get();

        $this->assertSame((int) $orderedImages->first()->id, (int) $orderedImages->firstWhere('is_primary', true)?->id);
        $this->assertCount(1, $orderedImages->where('is_primary', true));
    }

    public function test_deleting_the_primary_image_promotes_the_first_remaining_image(): void
    {
        $product = $this->createProductWithImages([
            ['file_name' => 'one.jpg', 'sort_order' => 0, 'is_primary' => false],
            ['file_name' => 'two.jpg', 'sort_order' => 1, 'is_primary' => true],
            ['file_name' => 'three.jpg', 'sort_order' => 2, 'is_primary' => false],
        ]);

        $primaryImage = ProductImage::query()
            ->where('product_id', $product->id)
            ->where('is_primary', true)
            ->firstOrFail();

        $this->deleteJson("/api/product-images/{$primaryImage->id}")
            ->assertOk();

        $remainingImages = ProductImage::query()
            ->where('product_id', $product->id)
            ->orderBy('sort_order')
            ->get();

        $this->assertCount(2, $remainingImages);
        $this->assertSame((int) $remainingImages->first()->id, (int) $remainingImages->firstWhere('is_primary', true)?->id);
        $this->assertCount(1, $remainingImages->where('is_primary', true));
    }

    /**
     * @param  array<int, array{file_name: string, sort_order: int, is_primary: bool}>  $images
     */
    private function createProductWithImages(array $images): Product
    {
        $product = Product::query()->create([
            'name' => 'San pham test',
            'slug' => 'san-pham-test-' . uniqid(),
            'price' => 100000,
            'stock_quantity' => 5,
        ]);

        foreach ($images as $image) {
            ProductImage::query()->create([
                'product_id' => $product->id,
                'image_url' => 'https://legacy.example.test/' . $image['file_name'],
                'file_name' => $image['file_name'],
                'file_size' => 1024,
                'is_primary' => $image['is_primary'],
                'sort_order' => $image['sort_order'],
            ]);
        }

        return $product->fresh();
    }
}
