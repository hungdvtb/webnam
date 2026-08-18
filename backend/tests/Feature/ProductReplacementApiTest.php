<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductReplacementApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_expression_creates_bidirectional_replacement_lookup(): void
    {
        $account = $this->authenticate();
        $source = $this->createProduct($account, [
            'name' => 'De bat huong rong 30',
            'sku' => 'MR70-DEBATHUONG-RONG-30',
            'stock_quantity' => 0,
            'price' => 300000,
            'cost_price' => 180000,
        ]);
        $replacement = $this->createProduct($account, [
            'name' => 'De bat huong 25',
            'sku' => 'MR71-DEBATHUONG-25',
            'stock_quantity' => 5,
            'price' => 330000,
            'cost_price' => 210000,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/product-replacements', [
                'expression' => 'MR70-DEBATHUONG-RONG-30 = MR71-DEBATHUONG-25',
            ])
            ->assertCreated()
            ->assertJsonPath('data.items_count', 2);

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/product-replacements/lookup?' . http_build_query([
                'sku' => $source->sku,
                'locked_price' => 300000,
                'quantity' => 2,
            ]))
            ->assertOk()
            ->assertJsonPath('data.product.sku', $source->sku)
            ->assertJsonPath('data.alternatives.0.sku', $replacement->sku)
            ->assertJsonPath('data.alternatives.0.price', 330000)
            ->assertJsonPath('data.alternatives.0.locked_price', 300000)
            ->assertJsonPath('data.alternatives.0.cost_price', 210000)
            ->assertJsonPath('data.alternatives.0.replacement_profit_total', 180000);

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/product-replacements/lookup?' . http_build_query([
                'sku' => $replacement->sku,
            ]))
            ->assertOk()
            ->assertJsonPath('data.product.sku', $replacement->sku)
            ->assertJsonPath('data.alternatives.0.sku', $source->sku);
    }

    public function test_lookup_prefers_sku_when_product_id_is_from_order_line_context(): void
    {
        $account = $this->authenticate();
        $source = $this->createProduct($account, [
            'sku' => 'MR70-DEBATHUONG-RONG-22',
            'stock_quantity' => 0,
        ]);
        $replacement = $this->createProduct($account, [
            'sku' => 'MR71-DEBATHUONG-22',
            'stock_quantity' => 5,
        ]);
        $unrelatedOrderLineProduct = $this->createProduct($account, [
            'sku' => 'ORDER-LINE-PARENT-SKU',
            'stock_quantity' => 1,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/product-replacements', [
                'expression' => "{$source->sku} = {$replacement->sku}",
            ])
            ->assertCreated();

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/product-replacements/lookup?' . http_build_query([
                'product_id' => $unrelatedOrderLineProduct->id,
                'sku' => $source->sku,
            ]))
            ->assertOk()
            ->assertJsonPath('data.product.sku', $source->sku)
            ->assertJsonPath('data.alternatives.0.sku', $replacement->sku);
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
            'cost_price' => 60000,
            'stock_quantity' => 0,
            'status' => true,
        ], $overrides));
    }
}
