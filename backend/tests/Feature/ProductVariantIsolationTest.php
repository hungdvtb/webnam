<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductImage;
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

    public function test_show_returns_all_variants_for_configurable_product_even_when_some_are_inactive(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]));

        $parent = $this->createProduct([
            'name' => 'Parent Configurable',
            'slug' => 'parent-configurable-show',
            'sku' => 'PARENT-CONFIG-SHOW',
            'type' => 'configurable',
        ]);
        $activeVariant = $this->createProduct([
            'name' => 'Variant Active',
            'slug' => 'variant-active',
            'sku' => 'PARENT-CONFIG-SHOW-V1',
            'status' => true,
        ]);
        $inactiveVariant = $this->createProduct([
            'name' => 'Variant Inactive',
            'slug' => 'variant-inactive',
            'sku' => 'PARENT-CONFIG-SHOW-V2',
            'status' => false,
        ]);

        $parent->linkedProducts()->attach($activeVariant->id, ['link_type' => 'super_link', 'position' => 0]);
        $parent->linkedProducts()->attach($inactiveVariant->id, ['link_type' => 'super_link', 'position' => 1]);

        $response = $this->getJson("/api/products/{$parent->id}")
            ->assertOk();

        $variationIds = collect($response->json('variations'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertSame([$activeVariant->id, $inactiveVariant->id], $variationIds);
    }

    public function test_update_configurable_product_persists_one_default_variant(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]));

        $parent = $this->createProduct([
            'name' => 'Parent Default Variant',
            'slug' => 'parent-default-variant',
            'sku' => 'PARENT-DEFAULT',
            'type' => 'configurable',
            'price' => 500000,
        ]);
        $variantA = $this->createProduct([
            'name' => 'Variant 28cm',
            'slug' => 'variant-28cm',
            'sku' => 'PARENT-DEFAULT-28',
            'price' => 280000,
        ]);
        $variantB = $this->createProduct([
            'name' => 'Variant 32cm',
            'slug' => 'variant-32cm',
            'sku' => 'PARENT-DEFAULT-32',
            'price' => 320000,
        ]);

        $parent->linkedProducts()->attach($variantA->id, ['link_type' => 'super_link', 'position' => 0]);
        $parent->linkedProducts()->attach($variantB->id, ['link_type' => 'super_link', 'position' => 1]);

        $this->postJson("/api/products/{$parent->id}", [
            'type' => 'configurable',
            'name' => $parent->name,
            'sku' => $parent->sku,
            'price' => $parent->price,
            'variants' => [
                [
                    'id' => $variantA->id,
                    'name' => $variantA->name,
                    'sku' => $variantA->sku,
                    'price' => $variantA->price,
                    'is_default' => false,
                ],
                [
                    'id' => $variantB->id,
                    'name' => $variantB->name,
                    'sku' => $variantB->sku,
                    'price' => $variantB->price,
                    'is_default' => true,
                ],
            ],
        ])->assertOk();

        $this->assertDatabaseHas('product_links', [
            'product_id' => $parent->id,
            'linked_product_id' => $variantA->id,
            'link_type' => 'super_link',
            'is_default' => false,
        ]);
        $this->assertDatabaseHas('product_links', [
            'product_id' => $parent->id,
            'linked_product_id' => $variantB->id,
            'link_type' => 'super_link',
            'is_default' => true,
        ]);

        $response = $this->getJson("/api/products/{$parent->id}")
            ->assertOk();
        $defaultVariantIds = collect($response->json('linked_products'))
            ->filter(fn (array $variant) => (bool) data_get($variant, 'pivot.is_default'))
            ->pluck('id')
            ->values()
            ->all();

        $this->assertSame([$variantB->id], $defaultVariantIds);
    }

    public function test_update_configurable_product_falls_back_to_first_variant_when_default_is_missing(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]));

        $parent = $this->createProduct([
            'name' => 'Parent Missing Default Variant',
            'slug' => 'parent-missing-default-variant',
            'sku' => 'PARENT-MISSING-DEFAULT',
            'type' => 'configurable',
            'price' => 500000,
        ]);
        $variantA = $this->createProduct([
            'name' => 'Variant First',
            'slug' => 'variant-first-default',
            'sku' => 'PARENT-MISSING-DEFAULT-1',
            'price' => 280000,
        ]);
        $variantB = $this->createProduct([
            'name' => 'Variant Second',
            'slug' => 'variant-second-default',
            'sku' => 'PARENT-MISSING-DEFAULT-2',
            'price' => 320000,
        ]);

        $parent->linkedProducts()->attach($variantA->id, ['link_type' => 'super_link', 'position' => 0]);
        $parent->linkedProducts()->attach($variantB->id, ['link_type' => 'super_link', 'position' => 1]);

        $this->postJson("/api/products/{$parent->id}", [
            'type' => 'configurable',
            'name' => $parent->name,
            'sku' => $parent->sku,
            'price' => $parent->price,
            'variants' => [
                [
                    'id' => $variantA->id,
                    'name' => $variantA->name,
                    'sku' => $variantA->sku,
                    'price' => $variantA->price,
                ],
                [
                    'id' => $variantB->id,
                    'name' => $variantB->name,
                    'sku' => $variantB->sku,
                    'price' => $variantB->price,
                ],
            ],
        ])->assertOk();

        $defaultVariantIds = DB::table('product_links')
            ->where('product_id', $parent->id)
            ->where('link_type', 'super_link')
            ->where('is_default', true)
            ->pluck('linked_product_id')
            ->values()
            ->all();

        $this->assertSame([$variantA->id], $defaultVariantIds);
    }

    public function test_variant_without_own_image_exposes_parent_primary_image_without_copying_gallery(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]));

        $parent = $this->createProduct([
            'name' => 'Parent Configurable',
            'slug' => 'parent-configurable-image',
            'sku' => 'PARENT-CONFIG-IMAGE',
            'type' => 'configurable',
        ]);
        ProductImage::query()->create([
            'product_id' => $parent->id,
            'image_url' => 'https://cdn.example.com/parent-primary.jpg',
            'is_primary' => true,
            'sort_order' => 0,
        ]);

        $variant = $this->createProduct([
            'name' => 'Variant No Image',
            'slug' => 'variant-no-image',
            'sku' => 'PARENT-CONFIG-IMAGE-V1',
        ]);
        $parent->linkedProducts()->attach($variant->id, ['link_type' => 'super_link', 'position' => 0]);

        $response = $this->getJson("/api/products/{$parent->id}")
            ->assertOk();

        $linkedVariant = collect($response->json('linked_products'))->firstWhere('id', $variant->id);

        $this->assertSame('https://cdn.example.com/parent-primary.jpg', $linkedVariant['main_image']);
        $this->assertSame('https://cdn.example.com/parent-primary.jpg', $linkedVariant['primary_image']['image_url']);
        $this->assertTrue($linkedVariant['primary_image']['is_inherited']);
        $this->assertSame($parent->id, $linkedVariant['primary_image']['source_product_id']);
        $this->assertSame([], $linkedVariant['images']);
        $this->assertSame(0, $variant->images()->count());
    }

    public function test_updating_a_variant_directly_resyncs_parent_retail_price_only(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]));

        $parent = $this->createProduct([
            'name' => 'Parent Configurable',
            'slug' => 'parent-configurable-update',
            'sku' => 'PARENT-CONFIG-UPDATE',
            'type' => 'configurable',
            'price' => 500000,
            'expected_cost' => 250000,
        ]);
        $variantA = $this->createProduct([
            'name' => 'Variant A',
            'slug' => 'variant-a-update',
            'sku' => 'PARENT-CONFIG-UPDATE-V1',
            'price' => 120000,
            'expected_cost' => 70000,
        ]);
        $variantB = $this->createProduct([
            'name' => 'Variant B',
            'slug' => 'variant-b-update',
            'sku' => 'PARENT-CONFIG-UPDATE-V2',
            'price' => 135000,
            'expected_cost' => 80000,
        ]);

        $parent->linkedProducts()->attach($variantA->id, ['link_type' => 'super_link', 'position' => 0]);
        $parent->linkedProducts()->attach($variantB->id, ['link_type' => 'super_link', 'position' => 1]);

        $this->postJson("/api/products/{$variantA->id}", [
            'price' => 155000,
            'expected_cost' => 91000,
        ])->assertOk();

        $this->assertDatabaseHas('products', [
            'id' => $variantA->id,
            'price' => 155000,
            'expected_cost' => 91000,
        ]);
        $this->assertDatabaseHas('products', [
            'id' => $parent->id,
            'price' => 135000,
            'expected_cost' => 250000,
        ]);
        $this->assertDatabaseHas('products', [
            'id' => $variantB->id,
            'price' => 135000,
            'expected_cost' => 80000,
        ]);
    }

    public function test_inactive_variants_are_excluded_from_parent_retail_price_sync(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]));

        $response = $this->postJson('/api/products', [
            'type' => 'configurable',
            'name' => 'Parent Lowest Variant',
            'sku' => 'PARENT-LOWEST',
            'price' => 500000,
            'variants' => [
                [
                    'name' => 'Hidden Cheap Variant',
                    'sku' => 'PARENT-LOWEST-HIDDEN',
                    'price' => 80000,
                    'status' => false,
                ],
                [
                    'name' => 'Visible Lowest Variant',
                    'sku' => 'PARENT-LOWEST-90',
                    'price' => 90000,
                    'status' => true,
                ],
                [
                    'name' => 'Visible Higher Variant',
                    'sku' => 'PARENT-LOWEST-140',
                    'price' => 140000,
                    'status' => true,
                ],
            ],
        ])->assertCreated();

        $parentId = (int) $response->json('id');

        $this->assertDatabaseHas('products', [
            'id' => $parentId,
            'price' => 90000,
        ]);
        $this->assertDatabaseHas('products', [
            'sku' => 'PARENT-LOWEST-HIDDEN',
            'price' => 80000,
            'status' => false,
        ]);
    }

    public function test_trashing_variant_resyncs_parent_retail_price_to_next_lowest_active_variant(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]));

        $parent = $this->createProduct([
            'name' => 'Parent Delete Variant',
            'slug' => 'parent-delete-variant',
            'sku' => 'PARENT-DELETE',
            'type' => 'configurable',
            'price' => 90000,
        ]);
        $variantA = $this->createProduct([
            'name' => 'Variant Cheapest',
            'slug' => 'variant-cheapest-delete',
            'sku' => 'PARENT-DELETE-90',
            'price' => 90000,
        ]);
        $variantB = $this->createProduct([
            'name' => 'Variant Remaining',
            'slug' => 'variant-remaining-delete',
            'sku' => 'PARENT-DELETE-140',
            'price' => 140000,
        ]);

        $parent->linkedProducts()->attach($variantA->id, ['link_type' => 'super_link', 'position' => 0]);
        $parent->linkedProducts()->attach($variantB->id, ['link_type' => 'super_link', 'position' => 1]);

        $this->deleteJson("/api/products/{$variantA->id}")
            ->assertOk();

        $this->assertSoftDeleted('products', ['id' => $variantA->id]);
        $this->assertDatabaseHas('products', [
            'id' => $parent->id,
            'price' => 140000,
        ]);
    }

    public function test_trashing_and_restoring_configurable_product_cascades_to_variant_children(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]));

        [$parent, $variants] = $this->createConfigurableProductWithVariants();

        $this->deleteJson("/api/products/{$parent->id}")
            ->assertOk();

        $this->assertSoftDeleted('products', ['id' => $parent->id]);
        foreach ($variants as $variant) {
            $this->assertSoftDeleted('products', ['id' => $variant->id]);
        }

        $this->postJson("/api/products/{$parent->id}/restore")
            ->assertOk();

        $this->assertDatabaseHas('products', ['id' => $parent->id, 'deleted_at' => null]);
        foreach ($variants as $variant) {
            $this->assertDatabaseHas('products', ['id' => $variant->id, 'deleted_at' => null]);
        }
    }

    public function test_force_deleting_trashed_configurable_product_also_removes_variant_children(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]));

        [$parent, $variants] = $this->createConfigurableProductWithVariants();

        $this->deleteJson("/api/products/{$parent->id}")
            ->assertOk();

        $this->deleteJson("/api/products/{$parent->id}/force")
            ->assertOk();

        $this->assertDatabaseMissing('products', ['id' => $parent->id]);
        foreach ($variants as $variant) {
            $this->assertDatabaseMissing('products', ['id' => $variant->id]);
            $this->assertSame(
                0,
                DB::table('product_links')
                    ->where('link_type', 'super_link')
                    ->where('linked_product_id', $variant->id)
                    ->count()
            );
        }
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

    private function createConfigurableProductWithVariants(): array
    {
        $parent = $this->createProduct([
            'name' => 'Configurable Parent',
            'slug' => 'configurable-parent',
            'sku' => 'CONFIG-PARENT',
            'type' => 'configurable',
        ]);

        $variantA = $this->createProduct([
            'name' => 'Config Variant A',
            'slug' => 'config-variant-a',
            'sku' => 'CONFIG-PARENT-V1',
        ]);
        $variantB = $this->createProduct([
            'name' => 'Config Variant B',
            'slug' => 'config-variant-b',
            'sku' => 'CONFIG-PARENT-V2',
        ]);

        $parent->linkedProducts()->attach($variantA->id, ['link_type' => 'super_link', 'position' => 0]);
        $parent->linkedProducts()->attach($variantB->id, ['link_type' => 'super_link', 'position' => 1]);

        return [$parent, [$variantA, $variantB]];
    }
}
