<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductBundleParentRetailPriceSyncTest extends TestCase
{
    use RefreshDatabase;

    public function test_bundle_parent_retail_price_uses_lowest_visible_valid_option(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]));

        $itemA = $this->createProduct(['sku' => 'BUNDLE-ITEM-A', 'price' => 300000]);
        $itemB = $this->createProduct(['sku' => 'BUNDLE-ITEM-B', 'price' => 100000]);
        $itemC = $this->createProduct(['sku' => 'BUNDLE-ITEM-C', 'price' => 250000]);
        $hiddenCheapItem = $this->createProduct(['sku' => 'BUNDLE-ITEM-HIDDEN', 'price' => 10000]);

        $response = $this->postJson('/api/products', [
            'type' => 'bundle',
            'name' => 'Bundle Lowest Option',
            'sku' => 'BUNDLE-LOWEST-OPTION',
            'price' => 999000,
            'price_type' => 'fixed',
            'grouped_items' => [
                [
                    'id' => $itemA->id,
                    'quantity' => 1,
                    'is_required' => true,
                    'option_title' => 'Option A',
                    'bundle_option_status' => 'visible',
                    'price' => 300000,
                ],
                [
                    'id' => $itemB->id,
                    'quantity' => 2,
                    'is_required' => true,
                    'option_title' => 'Option A',
                    'bundle_option_status' => 'visible',
                    'price' => 100000,
                ],
                [
                    'id' => $itemC->id,
                    'quantity' => 1,
                    'is_required' => true,
                    'option_title' => 'Option B',
                    'bundle_option_status' => 'visible',
                    'price' => 250000,
                ],
                [
                    'id' => $hiddenCheapItem->id,
                    'quantity' => 1,
                    'is_required' => true,
                    'option_title' => 'Internal Option',
                    'bundle_option_status' => 'internal',
                    'price' => 10000,
                ],
            ],
        ])->assertCreated();

        $this->assertDatabaseHas('products', [
            'id' => (int) $response->json('id'),
            'price' => 250000,
        ]);
        $this->assertDatabaseHas('product_links', [
            'product_id' => (int) $response->json('id'),
            'linked_product_id' => $hiddenCheapItem->id,
            'link_type' => 'bundle',
            'bundle_option_status' => 'internal',
            'price' => 10000,
        ]);
    }

    public function test_hiding_bundle_option_resyncs_parent_price_to_next_valid_option(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]));

        $bundle = $this->createProduct([
            'name' => 'Bundle Hide Option',
            'slug' => 'bundle-hide-option',
            'sku' => 'BUNDLE-HIDE-OPTION',
            'type' => 'bundle',
            'price' => 100000,
            'price_type' => 'sum',
        ]);
        $cheapItem = $this->createProduct(['sku' => 'BUNDLE-CHEAP', 'price' => 100000]);
        $expensiveItem = $this->createProduct(['sku' => 'BUNDLE-EXPENSIVE', 'price' => 500000]);

        $this->postJson("/api/products/{$bundle->id}", [
            'type' => 'bundle',
            'name' => $bundle->name,
            'sku' => $bundle->sku,
            'price' => 600000,
            'price_type' => 'sum',
            'grouped_items' => [
                [
                    'id' => $cheapItem->id,
                    'quantity' => 1,
                    'is_required' => true,
                    'option_title' => 'Hidden Cheap Option',
                    'bundle_option_status' => 'internal',
                    'price' => 100000,
                ],
                [
                    'id' => $expensiveItem->id,
                    'quantity' => 1,
                    'is_required' => true,
                    'option_title' => 'Visible Expensive Option',
                    'bundle_option_status' => 'visible',
                    'price' => 500000,
                ],
            ],
        ])->assertOk();

        $this->assertDatabaseHas('products', [
            'id' => $bundle->id,
            'price' => 500000,
        ]);
    }

    public function test_bundle_parent_price_stays_current_when_no_valid_option_exists(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]));

        $bundle = $this->createProduct([
            'name' => 'Bundle No Valid Option',
            'slug' => 'bundle-no-valid-option',
            'sku' => 'BUNDLE-NO-VALID',
            'type' => 'bundle',
            'price' => 777000,
            'price_type' => 'sum',
        ]);
        $hiddenItem = $this->createProduct(['sku' => 'BUNDLE-HIDDEN-ONLY', 'price' => 100000]);

        $this->postJson("/api/products/{$bundle->id}", [
            'type' => 'bundle',
            'name' => $bundle->name,
            'sku' => $bundle->sku,
            'price' => 100000,
            'price_type' => 'sum',
            'grouped_items' => [
                [
                    'id' => $hiddenItem->id,
                    'quantity' => 1,
                    'is_required' => true,
                    'option_title' => 'Hidden Only',
                    'bundle_option_status' => 'internal',
                    'price' => 100000,
                ],
            ],
        ])->assertOk();

        $this->assertDatabaseHas('products', [
            'id' => $bundle->id,
            'price' => 777000,
        ]);
    }

    private function createProduct(array $overrides = []): Product
    {
        return Product::query()->create(array_merge([
            'name' => 'Bundle Test Product',
            'slug' => 'bundle-test-product-' . uniqid(),
            'sku' => 'BUNDLE-TEST-' . uniqid(),
            'price' => 100000,
            'type' => 'simple',
            'status' => true,
            'stock_quantity' => 0,
        ], $overrides));
    }
}
