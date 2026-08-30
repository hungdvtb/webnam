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

class ProductPickerDeclarationSearchRegressionTest extends TestCase
{
    use RefreshDatabase;

    public function test_short_name_search_does_not_match_middle_letters_in_unrelated_products(): void
    {
        $account = $this->authenticate();

        $matching = $this->createProduct($account, [
            'name' => 'Nam ruou men LAM S2 cao 20 cm - SEN',
            'sku' => 'ML80-NAMRUOU-S2',
        ]);

        $unrelated = $this->createProduct($account, [
            'name' => 'Am tra men LAM hoa tiet - SEN - 3 chen',
            'sku' => 'ML80-AMTRALAM-SEN-3',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'picker' => 1,
                'fast_picker' => 1,
                'search' => 'nam',
                'per_page' => 20,
            ]));

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertContains($matching->id, $returnedIds);
        $this->assertNotContains($unrelated->id, $returnedIds);
    }

    public function test_replace_picker_keeps_variant_with_empty_attribute_value_when_parent_matches_filter(): void
    {
        $account = $this->authenticate();
        $glazeAttribute = $this->createProductAttribute($account, 'Loai men', [
            'Men lam',
            'Men ran',
        ]);

        $parent = $this->createProduct($account, [
            'name' => 'Ong huong men LAM',
            'sku' => 'ML80-ONGHUONGLAM',
            'type' => 'configurable',
        ]);
        $this->attachProductAttributeValue($parent, $glazeAttribute, 'Men lam');

        $variant = $this->createProduct($account, [
            'name' => 'Ong huong men LAM - S2 - Cao 20cm',
            'sku' => 'ML80-ONGHUONG-S2-20',
            'price' => 350000,
        ]);
        $this->attachProductAttributeValue($variant, $glazeAttribute, null);
        $this->attachVariation($parent, $variant);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'picker' => 1,
                'fast_picker' => 1,
                'replace_picker' => 1,
                'allow_variants' => 1,
                'quick_filter_enabled' => 1,
                'search' => 'onghuong',
                'per_page' => 20,
                'attributes' => [
                    $glazeAttribute->id => 'Men lam',
                ],
            ]));

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertSame([$variant->id], $returnedIds);
        $response
            ->assertJsonPath('data.0.entry_kind', 'variation')
            ->assertJsonPath('data.0.parent_product_id', $parent->id)
            ->assertJsonPath('data.0.sku', 'ML80-ONGHUONG-S2-20');
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

    private function attachProductAttributeValue(
        Product $product,
        Attribute $attribute,
        string|array|null $value
    ): ProductAttributeValue {
        return ProductAttributeValue::query()->create([
            'product_id' => $product->id,
            'attribute_id' => $attribute->id,
            'value' => is_array($value) ? json_encode(array_values($value)) : $value,
        ]);
    }

    private function attachVariation(Product $parent, Product $variation, array $overrides = []): void
    {
        $parent->variations()->attach($variation->id, array_merge([
            'link_type' => 'super_link',
            'position' => 0,
            'is_default' => true,
        ], $overrides));
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
