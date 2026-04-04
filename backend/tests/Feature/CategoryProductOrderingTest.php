<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Category;
use App\Models\Post;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CategoryProductOrderingTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_category_product_reorder_controls_storefront_ordering(): void
    {
        $category = Category::query()->create([
            'name' => 'Do tho',
            'slug' => 'do-tho',
            'status' => true,
        ]);

        $first = $this->createProduct($category, 'San pham 1', 'san-pham-1', Carbon::parse('2026-03-01 08:00:00'), 0);
        $second = $this->createProduct($category, 'San pham 2', 'san-pham-2', Carbon::parse('2026-03-02 08:00:00'), 1);
        $third = $this->createProduct($category, 'San pham 3', 'san-pham-3', Carbon::parse('2026-03-03 08:00:00'), 2);

        $this->authenticateAdmin();

        $this->postJson("/api/categories/{$category->id}/products/reorder", [
            'product_ids' => [$second->id, $first->id, $third->id],
        ])->assertOk();

        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $second->id,
            'item_type' => 'product',
            'bundle_option_key' => '',
            'sort_order' => 0,
        ]);
        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $first->id,
            'item_type' => 'product',
            'bundle_option_key' => '',
            'sort_order' => 1,
        ]);
        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $third->id,
            'item_type' => 'product',
            'bundle_option_key' => '',
            'sort_order' => 2,
        ]);

        $storefrontResponse = $this->getJson("/api/storefront/products?category_id={$category->id}")
            ->assertOk();

        $storefrontIds = collect($storefrontResponse->json('data'))->pluck('id')->all();
        $this->assertSame([$second->id, $first->id, $third->id], $storefrontIds);

        $webApiResponse = $this->getJson("/api/web-api/products?category={$category->slug}")
            ->assertOk();

        $webApiIds = collect($webApiResponse->json('data'))->pluck('id')->all();
        $this->assertSame([$second->id, $first->id, $third->id], $webApiIds);
    }

    public function test_category_update_persists_variant_and_bundle_option_assignments_as_distinct_items(): void
    {
        [$category, $variantParent, $variant, $bundle, $optionPost] = $this->seedCategoryWithVariantAndBundleOptionAssignments();

        $this->assertSame([], $bundle->fresh()->categories()->pluck('categories.id')->all());
        $this->assertSame([$category->id], $variant->fresh()->categories()->pluck('categories.id')->all());

        $productsResponse = $this->getJson("/api/categories/{$category->id}/products")
            ->assertOk();

        $payload = $productsResponse->json();
        $items = collect($payload['products'] ?? [])->keyBy('assignment_key');
        $variantKey = "product:{$variant->id}";
        $bundleOptionKey = "bundle_option:{$bundle->id}:post:{$optionPost->id}";

        $this->assertSame(2, data_get($payload, 'category.items_count'));
        $this->assertSame([$variantKey, $bundleOptionKey], collect($payload['products'])->pluck('assignment_key')->all());
        $this->assertSame('product', data_get($items->get($variantKey), 'item_type'));
        $this->assertSame('Bien the', data_get($items->get($variantKey), 'display_label'));
        $this->assertSame($variantParent->name, data_get($items->get($variantKey), 'variant_parent_name'));
        $this->assertSame('bundle_option', data_get($items->get($bundleOptionKey), 'item_type'));
        $this->assertSame('Tuy chon bundle', data_get($items->get($bundleOptionKey), 'display_label'));
        $this->assertSame($bundle->name, data_get($items->get($bundleOptionKey), 'bundle_parent_name'));
        $this->assertSame('Lua chon men lam', data_get($items->get($bundleOptionKey), 'bundle_option_title'));
        $this->assertSame(1, data_get($items->get($bundleOptionKey), 'bundle_items_count'));

        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $variant->id,
            'item_type' => 'product',
            'bundle_option_key' => '',
            'sort_order' => 0,
        ]);
        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $bundle->id,
            'item_type' => 'bundle_option',
            'bundle_option_key' => 'post:' . $optionPost->id,
            'bundle_option_post_id' => $optionPost->id,
            'bundle_option_title' => 'Lua chon men lam',
            'sort_order' => 1,
        ]);
        $this->assertDatabaseMissing('category_product', [
            'category_id' => $category->id,
            'product_id' => $bundle->id,
            'item_type' => 'product',
            'bundle_option_key' => '',
        ]);
    }

    public function test_category_product_reorder_accepts_mixed_bundle_option_items_payload(): void
    {
        [$category, , $variant, $bundle, $optionPost] = $this->seedCategoryWithVariantAndBundleOptionAssignments();

        $response = $this->postJson("/api/categories/{$category->id}/products/reorder", [
            'items' => [
                [
                    'item_type' => 'bundle_option',
                    'product_id' => $bundle->id,
                    'bundle_option_post_id' => $optionPost->id,
                ],
                [
                    'item_type' => 'product',
                    'product_id' => $variant->id,
                ],
            ],
        ])->assertOk();

        $this->assertSame([
            "bundle_option:{$bundle->id}:post:{$optionPost->id}",
            "product:{$variant->id}",
        ], collect($response->json('products'))->pluck('assignment_key')->all());

        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $bundle->id,
            'item_type' => 'bundle_option',
            'bundle_option_key' => 'post:' . $optionPost->id,
            'sort_order' => 0,
        ]);
        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $variant->id,
            'item_type' => 'product',
            'bundle_option_key' => '',
            'sort_order' => 1,
        ]);
    }

    private function seedCategoryWithVariantAndBundleOptionAssignments(): array
    {
        $account = $this->createAccount();
        $this->authenticateAdmin();

        $category = Category::query()->create([
            'name' => 'Do tho Bat Trang',
            'slug' => 'do-tho-bat-trang',
            'status' => true,
        ]);

        $variantParent = $this->createProduct(
            null,
            'Bo tho cha',
            'bo-tho-cha',
            Carbon::parse('2026-03-10 08:00:00'),
            null,
            'configurable'
        );
        $variant = $this->createProduct(
            $category,
            'Bo tho cha - Men lam',
            'bo-tho-cha-men-lam',
            Carbon::parse('2026-03-10 09:00:00'),
            0
        );
        $this->attachVariation($variantParent, $variant, Carbon::parse('2026-03-10 09:00:00'));

        $bundle = $this->createProduct(
            null,
            'Bo combo men lam',
            'bo-combo-men-lam',
            Carbon::parse('2026-03-11 08:00:00'),
            null,
            'bundle'
        );
        $bundleItem = $this->createProduct(
            null,
            'Chan nen men lam',
            'chan-nen-men-lam',
            Carbon::parse('2026-03-11 09:00:00')
        );
        $optionPost = $this->createPost($account, 'Men lam', 'men-lam');
        $this->attachBundleItem($bundle, $bundleItem, Carbon::parse('2026-03-11 09:30:00'), [
            'option_title' => 'Lua chon men lam',
            'option_post_id' => $optionPost->id,
        ]);

        $this->postJson("/api/categories/{$category->id}", [
            'category_items' => [
                [
                    'item_type' => 'product',
                    'product_id' => $variant->id,
                ],
                [
                    'item_type' => 'bundle_option',
                    'product_id' => $bundle->id,
                    'bundle_option_post_id' => $optionPost->id,
                ],
            ],
        ])->assertOk();

        return [$category, $variantParent, $variant, $bundle, $optionPost];
    }

    private function authenticateAdmin(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);
    }

    private function createAccount(): Account
    {
        return Account::query()->create([
            'name' => 'Test Account',
            'domain' => 'test-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'test-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);
    }

    private function createPost(Account $account, string $title, string $slug): Post
    {
        return Post::query()->create([
            'account_id' => $account->id,
            'title' => $title,
            'slug' => $slug,
            'content' => '<p>Noi dung</p>',
            'is_published' => true,
            'published_at' => now(),
        ]);
    }

    private function createProduct(
        ?Category $category,
        string $name,
        string $slug,
        Carbon $createdAt,
        ?int $sortOrder = null,
        string $type = 'simple'
    ): Product {
        $product = Product::query()->create([
            'type' => $type,
            'name' => $name,
            'slug' => $slug,
            'sku' => Str::upper(str_replace('-', '-', $slug)),
            'price' => 100000,
            'category_id' => $category?->id,
            'status' => true,
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);

        if ($category && $sortOrder !== null) {
            $product->categories()->attach($category->id, [
                'item_type' => 'product',
                'bundle_option_key' => '',
                'sort_order' => $sortOrder,
                'created_at' => $createdAt,
                'updated_at' => $createdAt,
            ]);
        }

        return $product;
    }

    private function attachVariation(Product $parent, Product $variation, Carbon $createdAt): void
    {
        $parent->linkedProducts()->attach($variation->id, [
            'link_type' => 'super_link',
            'position' => 0,
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);
    }

    private function attachBundleItem(Product $bundle, Product $item, Carbon $createdAt, array $overrides = []): void
    {
        $bundle->bundleItems()->attach($item->id, array_merge([
            'link_type' => 'bundle',
            'position' => 0,
            'quantity' => 1,
            'is_required' => 1,
            'option_title' => 'Mac dinh',
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ], $overrides));
    }
}
