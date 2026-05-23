<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CategoryVisibilityTest extends TestCase
{
    use RefreshDatabase;

    public function test_link_only_categories_are_hidden_from_public_lists_but_direct_slug_still_works(): void
    {
        $publicCategory = Category::query()->create([
            'name' => 'Danh muc cong khai',
            'slug' => 'danh-muc-cong-khai',
            'status' => true,
            'visibility' => Category::VISIBILITY_PUBLIC,
            'order' => 0,
        ]);

        $linkOnlyCategory = Category::query()->create([
            'name' => 'Danh muc quang cao',
            'slug' => 'danh-muc-quang-cao',
            'status' => true,
            'visibility' => Category::VISIBILITY_LINK_ONLY,
            'order' => 1,
        ]);

        $product = Product::query()->create([
            'type' => 'simple',
            'name' => 'San pham quang cao',
            'slug' => 'san-pham-quang-cao',
            'sku' => 'SPQC',
            'price' => 100000,
            'status' => true,
            'category_id' => $linkOnlyCategory->id,
        ]);

        $product->categories()->attach($linkOnlyCategory->id, [
            'item_type' => 'product',
            'bundle_option_key' => '',
            'sort_order' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $webCategoryList = collect(
            $this->getJson('/api/web-api/categories')->assertOk()->json()
        );
        $this->assertSame([$publicCategory->slug], $webCategoryList->pluck('slug')->all());

        $legacyCategoryList = collect(
            $this->getJson('/api/categories')->assertOk()->json()
        );
        $this->assertSame([$publicCategory->slug], $legacyCategoryList->pluck('slug')->all());

        $this->getJson('/api/web-api/categories/' . $linkOnlyCategory->slug)
            ->assertOk()
            ->assertJsonPath('slug', $linkOnlyCategory->slug)
            ->assertJsonPath('visibility', Category::VISIBILITY_LINK_ONLY);

        $productResponse = $this->getJson('/api/web-api/products?category=' . $linkOnlyCategory->slug)
            ->assertOk();

        $this->assertSame(
            [$product->id],
            collect($productResponse->json('data'))->pluck('id')->all()
        );
    }
}
