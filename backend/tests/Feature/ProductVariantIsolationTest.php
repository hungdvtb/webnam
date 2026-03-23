<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductVariantIsolationTest extends TestCase
{
    use RefreshDatabase;

    public function test_duplicate_configurable_product_clones_variants_instead_of_reusing_existing_children(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]));

        $parent = $this->createProduct([
            'name' => 'Parent Configurable',
            'slug' => 'parent-configurable',
            'sku' => 'PARENT-CONFIG',
            'type' => 'configurable',
        ]);
        $variantA = $this->createProduct([
            'name' => 'Variant A',
            'slug' => 'variant-a',
            'sku' => 'PARENT-CONFIG-V1',
        ]);
        $variantB = $this->createProduct([
            'name' => 'Variant B',
            'slug' => 'variant-b',
            'sku' => 'PARENT-CONFIG-V2',
        ]);

        $parent->linkedProducts()->attach($variantA->id, ['link_type' => 'super_link', 'position' => 0]);
        $parent->linkedProducts()->attach($variantB->id, ['link_type' => 'super_link', 'position' => 1]);

        $response = $this->postJson("/api/products/{$parent->id}/duplicate")
            ->assertOk();

        $cloneId = $response->json('data.id');
        $this->assertNotNull($cloneId);

        $clone = Product::query()->with('variations')->findOrFail($cloneId);
        $cloneVariantIds = $clone->variations->pluck('id')->all();
        $cloneVariantSkus = $clone->variations->pluck('sku')->all();

        $this->assertCount(2, $cloneVariantIds);
        $this->assertEmpty(array_intersect($cloneVariantIds, [$variantA->id, $variantB->id]));
        $this->assertCount(2, array_unique($cloneVariantSkus));
        $this->assertSame(
            0,
            DB::table('product_links')
                ->where('product_id', $cloneId)
                ->where('link_type', 'super_link')
                ->whereIn('linked_product_id', [$variantA->id, $variantB->id])
                ->count()
        );
    }

    public function test_update_rejects_shared_variants_attached_to_multiple_configurable_parents(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]));

        $originalParent = $this->createProduct([
            'name' => 'Original Parent',
            'slug' => 'original-parent',
            'sku' => 'ORIGINAL-PARENT',
            'type' => 'configurable',
        ]);
        $copyParent = $this->createProduct([
            'name' => 'Copy Parent',
            'slug' => 'copy-parent',
            'sku' => 'COPY-PARENT',
            'type' => 'configurable',
        ]);
        $sharedVariant = $this->createProduct([
            'name' => 'Shared Variant',
            'slug' => 'shared-variant',
            'sku' => 'ORIGINAL-PARENT-V1',
            'stock_quantity' => 5,
        ]);

        $originalParent->linkedProducts()->attach($sharedVariant->id, ['link_type' => 'super_link', 'position' => 0]);
        $copyParent->linkedProducts()->attach($sharedVariant->id, ['link_type' => 'super_link', 'position' => 0]);

        $this->postJson("/api/products/{$copyParent->id}", [
            'variants' => [[
                'id' => $sharedVariant->id,
                'sku' => $sharedVariant->sku,
                'price' => $sharedVariant->price,
                'stock_quantity' => $sharedVariant->stock_quantity,
            ]],
        ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['variants.0.id']);

        $this->assertSame(
            2,
            DB::table('product_links')
                ->where('link_type', 'super_link')
                ->where('linked_product_id', $sharedVariant->id)
                ->count()
        );
    }

    private function createProduct(array $overrides = []): Product
    {
        return Product::query()->create(array_merge([
            'name' => 'Test Product',
            'slug' => 'test-product-' . uniqid(),
            'sku' => 'TEST-' . uniqid(),
            'price' => 100000,
            'type' => 'simple',
            'status' => true,
            'stock_quantity' => 0,
        ], $overrides));
    }
}
