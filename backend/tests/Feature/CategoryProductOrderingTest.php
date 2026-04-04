<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CategoryProductOrderingTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_category_product_reorder_controls_storefront_ordering(): void
    {
        $category = Category::query()->create([
            'name' => 'Do tho',
            'slug' => 'do-tho',
            'status' => true,
        ]);

        $first = $this->createProduct($category, 'San pham 1', 'san-pham-1', Carbon::parse('2026-03-01 08:00:00'), 0);
        $second = $this->createProduct($category, 'San pham 2', 'san-pham-2', Carbon::parse('2026-03-02 08:00:00'), 1);
        $third = $this->createProduct($category, 'San pham 3', 'san-pham-3', Carbon::parse('2026-03-03 08:00:00'), 2);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $this->postJson("/api/categories/{$category->id}/products/reorder", [
            'product_ids' => [$second->id, $first->id, $third->id],
        ])->assertOk();

        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $second->id,
            'sort_order' => 0,
        ]);
        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $first->id,
            'sort_order' => 1,
        ]);
        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $third->id,
            'sort_order' => 2,
        ]);

        $storefrontResponse = $this->getJson("/api/storefront/products?category_id={$category->id}")
            ->assertOk();

        $storefrontIds = collect($storefrontResponse->json('data'))->pluck('id')->all();
        $this->assertSame([$second->id, $first->id, $third->id], $storefrontIds);

        $webApiResponse = $this->getJson("/api/web-api/products?category={$category->slug}")
            ->assertOk();

        $webApiIds = collect($webApiResponse->json('data'))->pluck('id')->all();
        $this->assertSame([$second->id, $first->id, $third->id], $webApiIds);
    }

    public function test_category_product_sort_endpoints_exclude_variants_and_only_reorder_parents(): void
    {
        $category = Category::query()->create([
            'name' => 'Do tho Bat Trang',
            'slug' => 'do-tho-bat-trang',
            'status' => true,
        ]);

        $parentA = $this->createProduct(
            $category,
            'Bo tho cha A',
            'bo-tho-cha-a',
            Carbon::parse('2026-03-01 08:00:00'),
            0,
            'configurable'
        );
        $variant = Product::query()->create([
            'type' => 'simple',
            'name' => 'Bo tho cha A - Phien ban 12',
            'slug' => 'bo-tho-cha-a-phien-ban-12',
            'price' => 100000,
            'category_id' => $category->id,
            'status' => true,
            'created_at' => Carbon::parse('2026-03-01 09:00:00'),
            'updated_at' => Carbon::parse('2026-03-01 09:00:00'),
        ]);
        $variant->categories()->attach($category->id, [
            'sort_order' => 1,
            'created_at' => Carbon::parse('2026-03-01 09:00:00'),
            'updated_at' => Carbon::parse('2026-03-01 09:00:00'),
        ]);
        $parentA->linkedProducts()->attach($variant->id, [
            'link_type' => 'super_link',
            'position' => 0,
            'created_at' => Carbon::parse('2026-03-01 09:00:00'),
            'updated_at' => Carbon::parse('2026-03-01 09:00:00'),
        ]);

        $parentB = $this->createProduct(
            $category,
            'Bo tho cha B',
            'bo-tho-cha-b',
            Carbon::parse('2026-03-02 08:00:00'),
            2,
            'configurable'
        );

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $productsResponse = $this->getJson("/api/categories/{$category->id}/products")
            ->assertOk();

        $loadedIds = collect($productsResponse->json('products'))->pluck('id')->all();
        $this->assertSame([$parentA->id, $parentB->id], $loadedIds);
        $this->assertNotContains($variant->id, $loadedIds);
        $this->assertSame(2, $productsResponse->json('category.products_count'));

        $reorderResponse = $this->postJson("/api/categories/{$category->id}/products/reorder", [
            'product_ids' => [$parentB->id, $parentA->id],
        ])->assertOk();

        $reorderedIds = collect($reorderResponse->json('products'))->pluck('id')->all();
        $this->assertSame([$parentB->id, $parentA->id], $reorderedIds);
        $this->assertNotContains($variant->id, $reorderedIds);
        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $parentB->id,
            'sort_order' => 0,
        ]);
        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $parentA->id,
            'sort_order' => 1,
        ]);
    }

    private function createProduct(
        Category $category,
        string $name,
        string $slug,
        Carbon $createdAt,
        int $sortOrder,
        string $type = 'simple'
    ): Product
    {
        $product = Product::query()->create([
            'type' => $type,
            'name' => $name,
            'slug' => $slug,
            'price' => 100000,
            'category_id' => $category->id,
            'status' => true,
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);

        $product->categories()->attach($category->id, [
            'sort_order' => $sortOrder,
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);

        return $product;
    }
}
