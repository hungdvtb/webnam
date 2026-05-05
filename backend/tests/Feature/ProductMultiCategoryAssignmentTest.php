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

    public function test_product_list_returns_all_categories_and_category_count_for_multi_category_product(): void
    {
        $account = $this->authenticate();
        $primaryCategory = $this->createCategory($account, 'Do tho', 'do-tho');
        $secondaryCategory = $this->createCategory($account, 'Phong thuy', 'phong-thuy');
        $tertiaryCategory = $this->createCategory($account, 'Qua tang', 'qua-tang');

        $product = $this->createProduct($account, [
            'name' => 'Bo tam cap men ran',
            'slug' => 'bo-tam-cap-men-ran',
            'sku' => 'BTC-MR-001',
            'category_id' => $primaryCategory->id,
        ]);
        $this->syncProductCategories($product, [
            $primaryCategory->id,
            $secondaryCategory->id,
            $tertiaryCategory->id,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?per_page=20');

        $response->assertOk();

        $row = collect($response->json('data'))->firstWhere('id', $product->id);

        $this->assertNotNull($row);
        $this->assertSame(3, (int) ($row['category_count'] ?? 0));
        $this->assertEqualsCanonicalizing(
            [$primaryCategory->id, $secondaryCategory->id, $tertiaryCategory->id],
            collect($row['category_ids'] ?? [])->map(fn ($id) => (int) $id)->all()
        );
        $this->assertEqualsCanonicalizing(
            [$primaryCategory->id, $secondaryCategory->id, $tertiaryCategory->id],
            collect($row['categories'] ?? [])->pluck('id')->map(fn ($id) => (int) $id)->all()
        );
    }

    public function test_product_list_can_filter_by_actual_category_count(): void
    {
        $account = $this->authenticate();
        $categoryA = $this->createCategory($account, 'Do tho', 'do-tho');
        $categoryB = $this->createCategory($account, 'Phong thuy', 'phong-thuy');
        $categoryC = $this->createCategory($account, 'Qua tang', 'qua-tang');
        $categoryD = $this->createCategory($account, 'Trang tri', 'trang-tri');

        $singleCategoryProduct = $this->createProduct($account, [
            'name' => 'San pham 1 danh muc',
            'slug' => 'san-pham-1-danh-muc',
            'sku' => 'CAT-COUNT-1',
            'category_id' => $categoryA->id,
        ]);
        $this->syncProductCategories($singleCategoryProduct, [$categoryA->id]);

        $twoCategoryProduct = $this->createProduct($account, [
            'name' => 'San pham 2 danh muc',
            'slug' => 'san-pham-2-danh-muc',
            'sku' => 'CAT-COUNT-2',
            'category_id' => $categoryA->id,
        ]);
        $this->syncProductCategories($twoCategoryProduct, [$categoryA->id, $categoryB->id]);

        $legacySplitProduct = $this->createProduct($account, [
            'name' => 'San pham legacy 2 danh muc',
            'slug' => 'san-pham-legacy-2-danh-muc',
            'sku' => 'CAT-COUNT-LEGACY-2',
            'category_id' => $categoryC->id,
        ]);
        $legacySplitProduct->categories()->sync([
            $categoryD->id => ['sort_order' => 0, 'item_type' => 'product'],
        ]);

        $threeCategoryProduct = $this->createProduct($account, [
            'name' => 'San pham 3 danh muc',
            'slug' => 'san-pham-3-danh-muc',
            'sku' => 'CAT-COUNT-3',
            'category_id' => $categoryA->id,
        ]);
        $this->syncProductCategories($threeCategoryProduct, [$categoryA->id, $categoryB->id, $categoryC->id]);

        $exactTwoResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?per_page=20&category_count_filter=exact_2');

        $exactTwoResponse->assertOk();
        $exactTwoIds = collect($exactTwoResponse->json('data'))->pluck('id')->map(fn ($id) => (int) $id)->all();
        $this->assertEqualsCanonicalizing([$twoCategoryProduct->id, $legacySplitProduct->id], $exactTwoIds);

        $exactThreeResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?per_page=20&category_count_filter=exact_3');

        $exactThreeResponse->assertOk();
        $exactThreeIds = collect($exactThreeResponse->json('data'))->pluck('id')->map(fn ($id) => (int) $id)->all();
        $this->assertSame([$threeCategoryProduct->id], $exactThreeIds);

        $minTwoResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?per_page=20&category_count_filter=min_2');

        $minTwoResponse->assertOk();
        $minTwoIds = collect($minTwoResponse->json('data'))->pluck('id')->map(fn ($id) => (int) $id)->all();
        $this->assertEqualsCanonicalizing(
            [$twoCategoryProduct->id, $legacySplitProduct->id, $threeCategoryProduct->id],
            $minTwoIds
        );

        $minThreeResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?per_page=20&category_count_filter=min_3');

        $minThreeResponse->assertOk();
        $minThreeIds = collect($minThreeResponse->json('data'))->pluck('id')->map(fn ($id) => (int) $id)->all();
        $this->assertSame([$threeCategoryProduct->id], $minThreeIds);
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

    private function createProduct(Account $account, array $overrides = []): Product
    {
        $name = $overrides['name'] ?? ('San pham ' . Str::lower(Str::random(5)));

        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => $name,
            'slug' => $overrides['slug'] ?? Str::slug($name),
            'sku' => $overrides['sku'] ?? ('SKU-' . Str::upper(Str::random(6))),
            'price' => 100000,
            'status' => true,
        ], $overrides));
    }

    private function syncProductCategories(Product $product, array $categoryIds): void
    {
        $normalizedCategoryIds = collect($categoryIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        $product->forceFill([
            'category_id' => $normalizedCategoryIds[0] ?? null,
        ])->save();

        $product->categories()->sync(
            collect($normalizedCategoryIds)->mapWithKeys(
                fn ($categoryId, $index) => [$categoryId => ['sort_order' => $index, 'item_type' => 'product']]
            )->all()
        );
    }
}
