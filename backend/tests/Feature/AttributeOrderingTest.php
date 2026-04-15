<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Attribute;
use App\Models\Product;
use App\Models\ProductAttributeValue;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AttributeOrderingTest extends TestCase
{
    use RefreshDatabase;

    public function test_attribute_reorder_persists_and_orders_product_payloads_across_endpoints(): void
    {
        $account = $this->createAccount();
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $headers = [
            'X-Account-Id' => (string) $account->id,
            'Accept' => 'application/json',
        ];

        $size = Attribute::query()->create([
            'account_id' => $account->id,
            'name' => 'Kich thuoc',
            'entity_type' => 'product',
            'code' => 'kich_thuoc',
            'frontend_type' => 'select',
            'is_filterable' => false,
            'is_filterable_frontend' => false,
            'is_filterable_backend' => true,
            'is_required' => false,
            'is_variant' => true,
            'status' => true,
            'sort_order' => 1,
        ]);

        $pattern = Attribute::query()->create([
            'account_id' => $account->id,
            'name' => 'Mau',
            'entity_type' => 'product',
            'code' => 'mau',
            'frontend_type' => 'select',
            'is_filterable' => false,
            'is_filterable_frontend' => false,
            'is_filterable_backend' => true,
            'is_required' => false,
            'is_variant' => true,
            'status' => true,
            'sort_order' => 2,
        ]);

        $size->options()->createMany([
            ['value' => 'S', 'order' => 0],
            ['value' => 'M', 'order' => 1],
        ]);

        $pattern->options()->createMany([
            ['value' => 'Tron', 'order' => 0],
            ['value' => 'Vuong', 'order' => 1],
        ]);

        $parent = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'configurable',
            'name' => 'Bo tho demo',
            'slug' => 'bo-tho-demo',
            'sku' => 'BO-THO-DEMO',
            'price' => 100000,
            'stock_quantity' => 10,
            'status' => true,
        ]);

        $variant = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Bo tho demo - Mau Tron - M',
            'slug' => 'bo-tho-demo-mau-tron-m',
            'sku' => 'BO-THO-DEMO-TRON-M',
            'price' => 110000,
            'stock_quantity' => 5,
            'status' => true,
        ]);

        $parent->superAttributes()->attach($size->id, ['position' => 0]);
        $parent->superAttributes()->attach($pattern->id, ['position' => 1]);
        $parent->linkedProducts()->attach($variant->id, [
            'link_type' => 'super_link',
            'position' => 0,
        ]);

        ProductAttributeValue::query()->create([
            'product_id' => $variant->id,
            'attribute_id' => $size->id,
            'value' => 'M',
        ]);
        ProductAttributeValue::query()->create([
            'product_id' => $variant->id,
            'attribute_id' => $pattern->id,
            'value' => 'Tron',
        ]);

        $this->withHeaders($headers)
            ->postJson('/api/attributes/reorder', [
                'entity_type' => 'product',
                'attribute_ids' => [$pattern->id, $size->id],
            ])
            ->assertOk();

        $this->assertDatabaseHas('attributes', [
            'id' => $pattern->id,
            'sort_order' => 1,
        ]);
        $this->assertDatabaseHas('attributes', [
            'id' => $size->id,
            'sort_order' => 2,
        ]);

        $attributeListResponse = $this->withHeaders($headers)
            ->getJson('/api/attributes?entity_type=product')
            ->assertOk();

        $this->assertSame(
            [$pattern->id, $size->id],
            collect($attributeListResponse->json())->pluck('id')->map(fn ($id) => (int) $id)->all()
        );

        $adminProductResponse = $this->withHeaders($headers)
            ->getJson('/api/products/' . $parent->id)
            ->assertOk();

        $this->assertSame(
            [$pattern->id, $size->id],
            collect($adminProductResponse->json('super_attributes'))->pluck('id')->map(fn ($id) => (int) $id)->all()
        );
        $this->assertSame(
            [$pattern->id, $size->id],
            collect(data_get($adminProductResponse->json(), 'variations.0.attribute_values', []))
                ->pluck('attribute_id')
                ->map(fn ($id) => (int) $id)
                ->all()
        );

        $webApiResponse = $this->withHeaders($headers)
            ->getJson('/api/web-api/products/' . $parent->slug)
            ->assertOk();

        $this->assertSame(
            [$pattern->id, $size->id],
            collect($webApiResponse->json('super_attributes'))->pluck('id')->map(fn ($id) => (int) $id)->all()
        );
        $this->assertSame(
            [$pattern->id, $size->id],
            collect(data_get($webApiResponse->json(), 'variations.0.attribute_values', []))
                ->pluck('attribute_id')
                ->map(fn ($id) => (int) $id)
                ->all()
        );

        $storefrontResponse = $this->withHeaders($headers)
            ->getJson('/api/storefront/products/' . $parent->slug)
            ->assertOk();

        $this->assertSame(
            [$pattern->id, $size->id],
            collect($storefrontResponse->json('super_attributes'))->pluck('id')->map(fn ($id) => (int) $id)->all()
        );
        $this->assertSame(
            [$pattern->id, $size->id],
            collect(data_get($storefrontResponse->json(), 'variants.0.attributes', []))
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->all()
        );
    }

    private function createAccount(): Account
    {
        return Account::query()->create([
            'name' => 'Attribute Ordering ' . Str::upper(Str::random(4)),
            'domain' => 'attribute-order-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'attribute-order-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);
    }
}
