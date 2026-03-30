<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Attribute;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductAttributeValue;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductListSortingTest extends TestCase
{
    use RefreshDatabase;

    public function test_product_list_can_sort_by_primary_category_name(): void
    {
        $account = $this->authenticate();
        $categoryZ = $this->createCategory($account, 'Bo tho men ran');
        $categoryA = $this->createCategory($account, 'Am tra men lam');

        $productZ = $this->createProduct($account, [
            'name' => 'San pham category Z',
            'sku' => 'SORT-CAT-Z',
            'category_id' => $categoryZ->id,
        ]);

        $productA = $this->createProduct($account, [
            'name' => 'San pham category A',
            'sku' => 'SORT-CAT-A',
            'category_id' => $categoryA->id,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?per_page=20&sort_by=category&sort_order=asc');

        $response->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->take(2)->all();

        $this->assertSame([$productA->id, $productZ->id], $ids);
    }

    public function test_product_list_can_sort_by_dynamic_attribute_column_key(): void
    {
        $account = $this->authenticate();
        $glazeAttribute = $this->createProductAttribute($account, 'Loai men');

        $productRan = $this->createProduct($account, [
            'name' => 'San pham men ran',
            'sku' => 'SORT-ATTR-RAN',
        ]);
        $this->attachProductAttributeValue($productRan, $glazeAttribute, 'Men ran');

        $productLam = $this->createProduct($account, [
            'name' => 'San pham men lam',
            'sku' => 'SORT-ATTR-LAM',
        ]);
        $this->attachProductAttributeValue($productLam, $glazeAttribute, 'Men lam');

        $productNoValue = $this->createProduct($account, [
            'name' => 'San pham chua gan men',
            'sku' => 'SORT-ATTR-NONE',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson("/api/products?per_page=20&sort_by=attr_{$glazeAttribute->id}&sort_order=asc");

        $response->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->take(3)->all();

        $this->assertSame([$productLam->id, $productRan->id, $productNoValue->id], $ids);
    }

    private function authenticate(): Account
    {
        $account = Account::query()->create([
            'name' => 'Product Sort ' . Str::upper(Str::random(4)),
            'domain' => 'product-sort-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'product-sort-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::factory()->create([
            'name' => 'Product Sort Admin',
            'email' => 'product-sort-' . Str::lower(Str::random(6)) . '@example.com',
            'is_admin' => true,
        ]);

        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user, ['*']);

        return $account;
    }

    private function headers(Account $account): array
    {
        return [
            'X-Account-Id' => (string) $account->id,
            'Accept' => 'application/json',
        ];
    }

    private function createCategory(Account $account, string $name): Category
    {
        return Category::query()->create([
            'account_id' => $account->id,
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(4)),
            'status' => true,
        ]);
    }

    private function createProductAttribute(Account $account, string $name): Attribute
    {
        return Attribute::query()->create([
            'account_id' => $account->id,
            'name' => $name,
            'code' => Str::slug($name) . '-' . Str::lower(Str::random(5)),
            'entity_type' => 'product',
            'frontend_type' => 'select',
            'is_filterable' => true,
            'is_filterable_backend' => true,
            'status' => true,
        ]);
    }

    private function attachProductAttributeValue(Product $product, Attribute $attribute, string $value): ProductAttributeValue
    {
        return ProductAttributeValue::query()->create([
            'product_id' => $product->id,
            'attribute_id' => $attribute->id,
            'value' => $value,
        ]);
    }

    private function createProduct(Account $account, array $overrides = []): Product
    {
        $name = $overrides['name'] ?? ('San pham ' . Str::lower(Str::random(5)));
        $sku = $overrides['sku'] ?? ('SKU-' . Str::upper(Str::random(6)));

        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(5)),
            'sku' => $sku,
            'price' => 100000,
            'expected_cost' => 80000,
            'cost_price' => 80000,
            'stock_quantity' => 0,
            'status' => true,
        ], $overrides));
    }
}
