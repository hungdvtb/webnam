<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Attribute;
use App\Models\AttributeOption;
use App\Models\Product;
use App\Models\ProductAttributeValue;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductPickerQuickFilterFallbackTest extends TestCase
{
    use RefreshDatabase;

    public function test_picker_quick_attribute_filter_finds_named_m2_product_when_attribute_value_is_stale(): void
    {
        $account = $this->authenticate();
        $glazeAttribute = $this->createProductAttribute($account, 'Loai men', [
            'Men ran',
            'Men ran M2',
        ]);

        $staleProduct = $this->createProduct($account, [
            'name' => 'Am tra men ran hoa tiet sen M2',
            'sku' => 'ML71-AMTRARAN-SEN',
            'status' => false,
        ]);
        $this->attachProductAttributeValue($staleProduct, $glazeAttribute, 'Men ran');

        $plainProduct = $this->createProduct($account, [
            'name' => 'Am tra men ran hoa tiet sen',
            'sku' => 'ML70-AMTRARAN-SEN',
        ]);
        $this->attachProductAttributeValue($plainProduct, $glazeAttribute, 'Men ran');

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'picker' => 1,
                'fast_picker' => 1,
                'quick_filter_enabled' => 1,
                'search' => 'am tra',
                'per_page' => 20,
                'attributes' => [
                    $glazeAttribute->id => 'Men ran M2',
                ],
            ]));

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertContains($staleProduct->id, $returnedIds);
        $this->assertNotContains($plainProduct->id, $returnedIds);
    }

    private function authenticate(): Account
    {
        $account = Account::query()->create([
            'name' => 'Test Account',
            'domain' => 'test-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'test-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Admin',
            'email' => 'admin-' . Str::lower(Str::random(6)) . '@example.com',
            'password' => 'password',
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

    private function createProductAttribute(Account $account, string $name, array $options = []): Attribute
    {
        $attribute = Attribute::query()->create([
            'account_id' => $account->id,
            'name' => $name,
            'code' => Str::slug($name) . '-' . Str::lower(Str::random(5)),
            'entity_type' => 'product',
            'frontend_type' => 'select',
            'is_filterable' => true,
            'is_filterable_backend' => true,
            'status' => true,
        ]);

        foreach (array_values($options) as $index => $option) {
            AttributeOption::query()->create([
                'attribute_id' => $attribute->id,
                'value' => $option,
                'order' => $index,
            ]);
        }

        return $attribute->fresh('options');
    }

    private function attachProductAttributeValue(Product $product, Attribute $attribute, string|array $value): ProductAttributeValue
    {
        return ProductAttributeValue::query()->create([
            'product_id' => $product->id,
            'attribute_id' => $attribute->id,
            'value' => is_array($value) ? json_encode(array_values($value)) : $value,
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
            'stock_quantity' => 0,
            'status' => true,
        ], $overrides));
    }
}
