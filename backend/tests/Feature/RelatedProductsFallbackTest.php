<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RelatedProductsFallbackTest extends TestCase
{
    use RefreshDatabase;

    public function test_web_related_endpoint_returns_only_explicitly_selected_products_when_present(): void
    {
        $category = $this->createCategory('Bat Trang', 'bat-trang');

        $product = $this->createProduct('San pham goc', 'san-pham-goc', $category->id);
        $selectedA = $this->createProduct('Lien quan A', 'lien-quan-a', $category->id);
        $selectedB = $this->createProduct('Lien quan B', 'lien-quan-b', $category->id);
        $fallbackCandidate = $this->createProduct('Fallback', 'fallback', $category->id);

        $product->relatedProducts()->attach([
            $selectedA->id => ['link_type' => 'related', 'position' => 0],
            $selectedB->id => ['link_type' => 'related', 'position' => 1],
        ]);

        $response = $this->getJson("/api/web-api/products/{$product->slug}/related")
            ->assertOk();

        $ids = collect($response->json())->pluck('id')->all();

        $this->assertSame([$selectedA->id, $selectedB->id], $ids);
        $this->assertNotContains($fallbackCandidate->id, $ids);
    }

    public function test_web_related_endpoint_falls_back_to_same_category_when_no_manual_selection_exists(): void
    {
        $category = $this->createCategory('Bo suu tap', 'bo-suu-tap');
        $otherCategory = $this->createCategory('Danh muc khac', 'danh-muc-khac');

        $product = $this->createProduct('San pham chinh', 'san-pham-chinh', $category->id);
        $sameCategoryA = $this->createProduct('Cung danh muc A', 'cung-danh-muc-a', $category->id);
        $sameCategoryB = $this->createProduct('Cung danh muc B', 'cung-danh-muc-b', $category->id);
        $otherCategoryProduct = $this->createProduct('Khac danh muc', 'khac-danh-muc', $otherCategory->id);

        $response = $this->getJson("/api/web-api/products/{$product->slug}/related")
            ->assertOk();

        $ids = collect($response->json())->pluck('id')->all();

        $this->assertEqualsCanonicalizing([$sameCategoryA->id, $sameCategoryB->id], $ids);
        $this->assertNotContains($product->id, $ids);
        $this->assertNotContains($otherCategoryProduct->id, $ids);
    }

    private function createCategory(string $name, string $slug): Category
    {
        return Category::query()->create([
            'name' => $name,
            'slug' => $slug,
            'status' => true,
        ]);
    }

    private function createProduct(string $name, string $slug, int $categoryId): Product
    {
        return Product::query()->create([
            'name' => $name,
            'slug' => $slug,
            'price' => 100000,
            'category_id' => $categoryId,
            'status' => true,
        ]);
    }
}
