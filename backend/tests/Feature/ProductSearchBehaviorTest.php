<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Category;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductSearchBehaviorTest extends TestCase
{
    use RefreshDatabase;

    public function test_full_sku_search_returns_only_the_exact_product_match(): void
    {
        $account = $this->authenticate();

        $exact = $this->createProduct($account, [
            'name' => 'Bat huong men ran 060',
            'sku' => 'DEMO-GOM-0060',
        ]);

        $this->createProduct($account, [
            'name' => 'San pham gan ma 0061',
            'sku' => 'DEMO-GOM-0061',
        ]);

        $this->createProduct($account, [
            'name' => 'Ten co chua DEMO GOM 0060',
            'sku' => 'TEN-KHAC-001',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=DEMO-GOM-0060&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $exact->id)
            ->assertJsonPath('data.0.sku', 'DEMO-GOM-0060');
    }

    public function test_partial_sku_search_falls_back_to_related_code_matches_only(): void
    {
        $account = $this->authenticate();

        $matching = $this->createProduct($account, [
            'name' => 'Bat huong men ran 060',
            'sku' => 'DEMO-GOM-0060',
        ]);

        $this->createProduct($account, [
            'name' => 'Bat huong men ran 061',
            'sku' => 'DEMO-GOM-0061',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=0060&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $matching->id);
    }

    public function test_name_search_uses_name_matching_instead_of_sku_token_matching(): void
    {
        $account = $this->authenticate();

        $matching = $this->createProduct($account, [
            'name' => 'Bat huong men ran cao cap',
            'sku' => 'SKU-BAT-001',
        ]);

        $this->createProduct($account, [
            'name' => 'Lo hoa men ngoc',
            'sku' => 'BAT-HUONG-999',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=bat huong&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $matching->id);
    }

    public function test_full_sku_search_respects_active_category_filters_before_falling_back(): void
    {
        $account = $this->authenticate();
        $categoryA = $this->createCategory($account, 'Danh muc A');
        $categoryB = $this->createCategory($account, 'Danh muc B');

        $this->createProduct($account, [
            'name' => 'Bat huong men ran 060',
            'sku' => 'DEMO-GOM-0060',
            'category_id' => $categoryA->id,
        ]);

        $fallback = $this->createProduct($account, [
            'name' => 'Bat huong bien the 060',
            'sku' => 'DEMO-GOM-0060-ALT',
            'category_id' => $categoryB->id,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=DEMO-GOM-0060&category_ids=' . $categoryB->id . '&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $fallback->id)
            ->assertJsonPath('data.0.sku', 'DEMO-GOM-0060-ALT');
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

    private function createCategory(Account $account, string $name): Category
    {
        return Category::query()->create([
            'account_id' => $account->id,
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(4)),
            'status' => 1,
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
