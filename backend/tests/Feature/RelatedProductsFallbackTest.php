<?php

namespace Tests\Feature;

use App\Models\Account;
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

    public function test_web_related_endpoint_handles_account_scoped_explicit_relations(): void
    {
        $account = $this->createAccount('Tai khoan web api');
        $category = $this->createCategory('Gom su', 'gom-su');

        $product = $this->createProduct('San pham goc', 'san-pham-goc-account', $category->id, $account->id);
        $selected = $this->createProduct('Lien quan', 'lien-quan-account', $category->id, $account->id);

        $product->relatedProducts()->attach([
            $selected->id => [
                'link_type' => 'related',
                'position' => 0,
                'account_id' => $account->id,
            ],
        ]);

        $response = $this
            ->withHeaders(['X-Account-Id' => (string) $account->id])
            ->getJson("/api/web-api/products/{$product->slug}/related")
            ->assertOk();

        $this->assertSame([$selected->id], collect($response->json())->pluck('id')->all());
    }

    public function test_storefront_related_endpoint_handles_account_scoped_explicit_relations(): void
    {
        $account = $this->createAccount('Tai khoan storefront');
        $category = $this->createCategory('Do tho', 'do-tho');

        $product = $this->createProduct('San pham goc storefront', 'san-pham-goc-storefront', $category->id, $account->id);
        $selected = $this->createProduct('Lien quan storefront', 'lien-quan-storefront', $category->id, $account->id);

        $product->relatedProducts()->attach([
            $selected->id => [
                'link_type' => 'related',
                'position' => 0,
                'account_id' => $account->id,
            ],
        ]);

        $response = $this
            ->withHeaders(['X-Account-Id' => (string) $account->id])
            ->getJson("/api/storefront/products/{$product->id}/related")
            ->assertOk();

        $this->assertSame([$selected->id], collect($response->json())->pluck('id')->all());
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

    private function createProduct(string $name, string $slug, int $categoryId, ?int $accountId = null): Product
    {
        return Product::query()->create([
            'name' => $name,
            'slug' => $slug,
            'price' => 100000,
            'category_id' => $categoryId,
            'account_id' => $accountId,
            'status' => true,
        ]);
    }

    private function createAccount(string $name): Account
    {
        return Account::query()->create([
            'name' => $name,
            'status' => true,
        ]);
    }
}
