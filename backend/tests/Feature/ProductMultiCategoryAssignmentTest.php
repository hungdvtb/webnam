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

class ProductMultiCategoryAssignmentTest extends TestCase
{
    use RefreshDatabase;

    public function test_store_product_assigns_multiple_categories_and_primary_category(): void
    {
        $account = $this->authenticate();
        $primaryCategory = $this->createCategory($account, 'Do tho', 'do-tho');
        $secondaryCategory = $this->createCategory($account, 'Phong thuy', 'phong-thuy');

        $response = $this
            ->withHeaders($this->headers($account))
            ->post('/api/products', [
                'type' => 'simple',
                'name' => 'Bo do tho men lam',
                'sku' => 'BODM-001',
                'price' => 1250000,
                'category_ids' => [$primaryCategory->id, $secondaryCategory->id],
            ]);

        $response->assertCreated();

        $product = Product::query()->with('categories')->findOrFail((int) $response->json('id'));

        $this->assertSame($primaryCategory->id, (int) $product->category_id);
        $this->assertEqualsCanonicalizing(
            [$primaryCategory->id, $secondaryCategory->id],
            $product->categories->pluck('id')->map(fn ($id) => (int) $id)->all()
        );
    }

    public function test_update_product_syncs_multiple_categories_and_primary_category(): void
    {
        $account = $this->authenticate();
        $legacyCategory = $this->createCategory($account, 'Do tho', 'do-tho');
        $newPrimaryCategory = $this->createCategory($account, 'Trang tri', 'trang-tri');
        $newSecondaryCategory = $this->createCategory($account, 'Qua tang', 'qua-tang');

        $product = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Loc hoa gom su',
            'slug' => 'loc-hoa-gom-su',
            'sku' => 'LHGS-001',
            'price' => 880000,
            'category_id' => $legacyCategory->id,
            'status' => true,
        ]);
        $product->categories()->sync([
            $legacyCategory->id => ['sort_order' => 0, 'item_type' => 'product'],
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->post("/api/products/{$product->id}", [
                'category_ids' => [$newPrimaryCategory->id, $newSecondaryCategory->id],
            ])
            ->assertOk();

        $product->refresh()->load('categories');

        $this->assertSame($newPrimaryCategory->id, (int) $product->category_id);
        $this->assertEqualsCanonicalizing(
            [$newPrimaryCategory->id, $newSecondaryCategory->id],
            $product->categories->pluck('id')->map(fn ($id) => (int) $id)->all()
        );
    }

    public function test_update_product_can_clear_all_categories(): void
    {
        $account = $this->authenticate();
        $primaryCategory = $this->createCategory($account, 'Do tho', 'do-tho');
        $secondaryCategory = $this->createCategory($account, 'Phong thuy', 'phong-thuy');

        $product = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Bat huong gom',
            'slug' => 'bat-huong-gom',
            'sku' => 'BHG-001',
            'price' => 560000,
            'category_id' => $primaryCategory->id,
            'status' => true,
        ]);
        $product->categories()->sync([
            $primaryCategory->id => ['sort_order' => 0, 'item_type' => 'product'],
            $secondaryCategory->id => ['sort_order' => 0, 'item_type' => 'product'],
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->post("/api/products/{$product->id}", [
                'clear_category_ids' => true,
            ])
            ->assertOk();

        $product->refresh()->load('categories');

        $this->assertNull($product->category_id);
        $this->assertCount(0, $product->categories);
    }

    private function authenticate(): Account
    {
        $account = Account::query()->create([
            'name' => 'Test account',
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

    private function createCategory(Account $account, string $name, string $code): Category
    {
        return Category::query()->create([
            'account_id' => $account->id,
            'name' => $name,
            'code' => $code,
            'slug' => Str::slug($name),
            'status' => true,
            'order' => 0,
        ]);
    }
}
