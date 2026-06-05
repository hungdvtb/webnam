<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Category;
use App\Models\Post;
use App\Models\Product;
use App\Models\ProductImage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
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

    public function test_category_update_normalizes_variant_assignments_to_parent_and_keeps_bundle_options_distinct(): void
    {
        [$category, $variantParent, $variant, $bundle, $optionPost] = $this->seedCategoryWithVariantAndBundleOptionAssignments();

        $this->assertSame([], $bundle->fresh()->categories()->pluck('categories.id')->all());
        $this->assertSame([], $variant->fresh()->categories()->pluck('categories.id')->all());
        $this->assertSame([$category->id], $variantParent->fresh()->categories()->pluck('categories.id')->all());

        $productsResponse = $this->getJson("/api/categories/{$category->id}/products")
            ->assertOk();

        $payload = $productsResponse->json();
        $items = collect($payload['products'] ?? [])->keyBy('assignment_key');
        $variantParentKey = "product:{$variantParent->id}";
        $bundleOptionKey = "bundle_option:{$bundle->id}:post:{$optionPost->id}";

        $this->assertSame(2, data_get($payload, 'category.items_count'));
        $this->assertSame([$variantParentKey, $bundleOptionKey], collect($payload['products'])->pluck('assignment_key')->all());
        $this->assertSame('product', data_get($items->get($variantParentKey), 'item_type'));
        $this->assertSame('San pham co bien the', data_get($items->get($variantParentKey), 'display_label'));
        $this->assertSame($variantParent->name, data_get($items->get($variantParentKey), 'name'));
        $this->assertNull(data_get($items->get($variantParentKey), 'variant_parent_name'));
        $this->assertSame('bundle_option', data_get($items->get($bundleOptionKey), 'item_type'));
        $this->assertSame('Tuy chon bundle', data_get($items->get($bundleOptionKey), 'display_label'));
        $this->assertSame($bundle->name, data_get($items->get($bundleOptionKey), 'bundle_parent_name'));
        $this->assertSame('Lua chon men lam', data_get($items->get($bundleOptionKey), 'bundle_option_title'));
        $this->assertSame(1, data_get($items->get($bundleOptionKey), 'bundle_items_count'));

        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $variantParent->id,
            'item_type' => 'product',
            'bundle_option_key' => '',
            'sort_order' => 0,
        ]);
        $this->assertDatabaseMissing('category_product', [
            'category_id' => $category->id,
            'product_id' => $variant->id,
            'item_type' => 'product',
            'bundle_option_key' => '',
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

    public function test_admin_category_products_payload_collapses_existing_variant_rows_to_parent(): void
    {
        $this->authenticateAdmin();

        $category = Category::query()->create([
            'name' => 'Do tho co bien the',
            'slug' => 'do-tho-co-bien-the',
            'status' => true,
        ]);
        $variantParent = $this->createProduct(
            null,
            'Bo tho cha',
            'bo-tho-cha-existing',
            Carbon::parse('2026-03-10 08:00:00'),
            null,
            'configurable'
        );
        $variant = $this->createProduct(
            $category,
            'Bo tho cha - Men lam',
            'bo-tho-cha-men-lam-existing',
            Carbon::parse('2026-03-10 09:00:00'),
            0
        );
        $this->attachVariation($variantParent, $variant, Carbon::parse('2026-03-10 09:00:00'));

        $response = $this->getJson("/api/categories/{$category->id}/products")
            ->assertOk();

        $items = collect($response->json('products'));

        $this->assertSame(["product:{$variantParent->id}"], $items->pluck('assignment_key')->all());
        $this->assertSame('San pham co bien the', data_get($items->first(), 'display_label'));
        $this->assertSame($variantParent->id, data_get($items->first(), 'product_id'));
        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $variant->id,
            'item_type' => 'product',
            'bundle_option_key' => '',
        ]);
    }

    public function test_admin_category_products_backfills_variant_primary_category_as_parent_assignment(): void
    {
        $this->authenticateAdmin();

        $category = Category::query()->create([
            'name' => 'Do tho legacy category id',
            'slug' => 'do-tho-legacy-category-id',
            'status' => true,
        ]);
        $variantParent = $this->createProduct(
            null,
            'Bo tho cha legacy',
            'bo-tho-cha-legacy',
            Carbon::parse('2026-03-10 08:00:00'),
            null,
            'configurable'
        );
        $variant = $this->createProduct(
            null,
            'Bo tho cha legacy - Men lam',
            'bo-tho-cha-legacy-men-lam',
            Carbon::parse('2026-03-10 09:00:00')
        );
        $variant->update(['category_id' => $category->id]);
        $this->attachVariation($variantParent, $variant, Carbon::parse('2026-03-10 09:00:00'));

        $response = $this->getJson("/api/categories/{$category->id}/products")
            ->assertOk();

        $this->assertSame(["product:{$variantParent->id}"], collect($response->json('products'))->pluck('assignment_key')->all());
        $this->assertDatabaseHas('category_product', [
            'category_id' => $category->id,
            'product_id' => $variantParent->id,
            'item_type' => 'product',
            'bundle_option_key' => '',
        ]);
        $this->assertDatabaseMissing('category_product', [
            'category_id' => $category->id,
            'product_id' => $variant->id,
            'item_type' => 'product',
            'bundle_option_key' => '',
        ]);
    }

    public function test_category_product_reorder_accepts_mixed_bundle_option_items_payload(): void
    {
        [$category, $variantParent, $variant, $bundle, $optionPost] = $this->seedCategoryWithVariantAndBundleOptionAssignments();

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
            "product:{$variantParent->id}",
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
            'product_id' => $variantParent->id,
            'item_type' => 'product',
            'bundle_option_key' => '',
            'sort_order' => 1,
        ]);
        $this->assertDatabaseMissing('category_product', [
            'category_id' => $category->id,
            'product_id' => $variant->id,
            'item_type' => 'product',
            'bundle_option_key' => '',
        ]);
    }

    public function test_web_api_products_bundle_option_listing_falls_back_to_bundle_parent_image_when_option_has_no_image(): void
    {
        [$category, , , $bundle, $optionPost] = $this->seedCategoryWithVariantAndBundleOptionAssignments();
        $bundleItem = $bundle->bundleItems()->firstOrFail();

        $bundleItem->update(['price' => 222000]);
        $this->attachPrimaryImage($bundle, '/bundle-parent.jpg');
        $this->attachPrimaryImage($bundleItem, '/component.jpg');

        $response = $this->getJson("/api/web-api/products?category={$category->slug}")
            ->assertOk();

        $bundleOption = collect($response->json('data'))
            ->firstWhere('bundle_option_key', 'post:' . $optionPost->id);

        $this->assertNotNull($bundleOption);
        $this->assertSame('bundle_option', data_get($bundleOption, 'item_type'));
        $this->assertSame('Lua chon men lam', data_get($bundleOption, 'name'));
        $this->assertSame(222000.0, (float) data_get($bundleOption, 'price'));
        $this->assertSame(199800.0, (float) data_get($bundleOption, 'current_price'));
        $this->assertSame(222000.0, (float) data_get($bundleOption, 'bundle_option_total_price'));
        $this->assertSame(199800.0, (float) data_get($bundleOption, 'bundle_option_discounted_price'));
        $this->assertSame('/bundle-parent.jpg', data_get($bundleOption, 'primary_image.url'));
    }

    public function test_web_api_products_bundle_option_listing_supports_legacy_product_rows_with_option_metadata(): void
    {
        [$category, , , $bundle, $optionPost] = $this->seedCategoryWithVariantAndBundleOptionAssignments();
        $bundleItem = $bundle->bundleItems()->firstOrFail();

        $bundleItem->update(['price' => 222000]);
        $this->attachPrimaryImage($bundle, '/bundle-parent.jpg');

        DB::table('category_product')
            ->where('category_id', $category->id)
            ->where('product_id', $bundle->id)
            ->where('bundle_option_key', 'post:' . $optionPost->id)
            ->update([
                'item_type' => 'product',
                'updated_at' => now(),
            ]);

        $response = $this->getJson("/api/web-api/products?category={$category->slug}")
            ->assertOk();

        $bundleOption = collect($response->json('data'))
            ->firstWhere('bundle_option_key', 'post:' . $optionPost->id);

        $this->assertNotNull($bundleOption);
        $this->assertSame('bundle_option', data_get($bundleOption, 'item_type'));
        $this->assertSame('Lua chon men lam', data_get($bundleOption, 'name'));
        $this->assertSame(222000.0, (float) data_get($bundleOption, 'price'));
        $this->assertSame(199800.0, (float) data_get($bundleOption, 'current_price'));
        $this->assertSame('Lua chon men lam', data_get($bundleOption, 'bundle_option_title'));
    }

    public function test_web_api_products_bundle_option_listing_uses_option_title_and_discounted_price_for_localized_title_keys(): void
    {
        $category = Category::query()->create([
            'name' => 'Ban than tai',
            'slug' => 'ban-than-tai',
            'status' => true,
        ]);
        $bundle = $this->createProduct(
            null,
            'Tron bo do tho men lam ve vang 24K',
            'tron-bo-do-tho-men-lam-ve-vang-24k',
            Carbon::parse('2026-03-12 08:00:00'),
            null,
            'bundle'
        );
        $bundleItem = $this->createProduct(
            null,
            'Bat huong men lam ve vang',
            'bat-huong-men-lam-ve-vang',
            Carbon::parse('2026-03-12 09:00:00')
        );
        $optionTitle = 'Ban thần tài - Men lam vẽ vàng 24K';

        $this->attachBundleItem($bundle, $bundleItem, Carbon::parse('2026-03-12 09:30:00'), [
            'option_title' => $optionTitle,
            'price' => 1960000,
        ]);

        DB::table('category_product')->insert([
            'category_id' => $category->id,
            'product_id' => $bundle->id,
            'item_type' => 'bundle_option',
            'bundle_option_key' => 'title:' . Str::lower(Str::squish($optionTitle)),
            'bundle_option_post_id' => null,
            'bundle_option_title' => $optionTitle,
            'sort_order' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->getJson("/api/web-api/products?category={$category->slug}")
            ->assertOk();

        $this->assertSame(1, $response->json('total'));
        $bundleOption = $response->json('data.0');

        $this->assertSame('bundle_option', data_get($bundleOption, 'item_type'));
        $this->assertSame($optionTitle, data_get($bundleOption, 'name'));
        $this->assertSame(1960000.0, (float) data_get($bundleOption, 'price'));
        $this->assertSame(1764000.0, (float) data_get($bundleOption, 'current_price'));
        $this->assertSame(196000.0, (float) data_get($bundleOption, 'bundle_option_discount_amount'));
    }

    public function test_web_api_products_keeps_bundle_parent_assignment_as_parent_item(): void
    {
        $category = Category::query()->create([
            'name' => 'Bo combo',
            'slug' => 'bo-combo',
            'status' => true,
        ]);
        $bundle = $this->createProduct(
            $category,
            'Tron bo do tho',
            'tron-bo-do-tho',
            Carbon::parse('2026-03-13 08:00:00'),
            0,
            'bundle'
        );
        $firstItem = $this->createProduct(null, 'Bat huong', 'bat-huong', Carbon::parse('2026-03-13 09:00:00'));
        $secondItem = $this->createProduct(null, 'Den tho', 'den-tho', Carbon::parse('2026-03-13 10:00:00'));

        $this->attachBundleItem($bundle, $firstItem, Carbon::parse('2026-03-13 09:30:00'), [
            'option_title' => 'Ban than tai - Men lam',
            'position' => 0,
            'price' => 1000000,
        ]);
        $this->attachBundleItem($bundle, $secondItem, Carbon::parse('2026-03-13 10:30:00'), [
            'option_title' => 'Ban tho 1m - Men lam',
            'position' => 1,
            'price' => 2000000,
        ]);

        $response = $this->getJson("/api/web-api/products?category={$category->slug}")
            ->assertOk();

        $items = collect($response->json('data'));

        $this->assertCount(1, $items);
        $this->assertSame($bundle->id, data_get($items->first(), 'id'));
        $this->assertSame('Tron bo do tho', data_get($items->first(), 'name'));
        $this->assertSame('product', data_get($items->first(), 'item_type'));
        $this->assertNull(data_get($items->first(), 'bundle_option_key'));
        $this->assertCount(2, data_get($items->first(), 'bundle_options'));
        $this->assertCount(2, data_get($items->first(), 'bundle_items'));
    }

    public function test_web_api_bundle_option_detail_without_requested_option_returns_full_catalog_for_quick_add(): void
    {
        $bundle = $this->createProduct(
            null,
            'Tron bo do tho men lam',
            'tron-bo-do-tho-men-lam',
            Carbon::parse('2026-03-14 08:00:00'),
            null,
            'bundle'
        );
        $firstItem = $this->createProduct(null, 'Bat huong', 'bat-huong-men-lam', Carbon::parse('2026-03-14 09:00:00'));
        $secondItem = $this->createProduct(null, 'Den tho', 'den-tho-men-lam', Carbon::parse('2026-03-14 10:00:00'));

        $this->attachBundleItem($bundle, $firstItem, Carbon::parse('2026-03-14 09:30:00'), [
            'option_title' => 'Ban tho 1m - Men lam',
            'price' => 1000000,
        ]);
        $this->attachBundleItem($bundle, $secondItem, Carbon::parse('2026-03-14 10:30:00'), [
            'option_title' => 'Ban than tai - Men lam',
            'price' => 2000000,
        ]);

        $response = $this->getJson("/api/web-api/products/{$bundle->slug}/bundle-option-detail")
            ->assertOk();

        $this->assertCount(2, $response->json('bundle_items'));
        $this->assertSame(
            ['Ban tho 1m - Men lam', 'Ban than tai - Men lam'],
            collect($response->json('bundle_options'))->pluck('bundle_option_title')->all()
        );

        $selectedResponse = $this->getJson("/api/web-api/products/{$bundle->slug}/bundle-option-detail?bundle_option=" . rawurlencode('Ban than tai - Men lam'))
            ->assertOk();

        $this->assertCount(1, $selectedResponse->json('bundle_items'));
        $this->assertSame(['Ban than tai - Men lam'], collect($selectedResponse->json('bundle_options'))->pluck('bundle_option_title')->all());
    }

    public function test_web_api_bundle_option_detail_allows_direct_internal_option_link(): void
    {
        $bundle = $this->createProduct(
            null,
            'Tron bo do tho men ran',
            'tron-bo-do-tho-men-ran',
            Carbon::parse('2026-03-15 08:00:00'),
            null,
            'bundle'
        );
        $visibleItem = $this->createProduct(null, 'Bat huong visible', 'bat-huong-visible', Carbon::parse('2026-03-15 09:00:00'));
        $internalItem = $this->createProduct(null, 'Den tho internal', 'den-tho-internal', Carbon::parse('2026-03-15 10:00:00'));

        $this->attachBundleItem($bundle, $visibleItem, Carbon::parse('2026-03-15 09:30:00'), [
            'option_title' => 'Ban tho visible',
            'bundle_option_uid' => 'visible-option-uid',
            'bundle_option_status' => 'visible',
            'price' => 1000000,
        ]);
        $this->attachBundleItem($bundle, $internalItem, Carbon::parse('2026-03-15 10:30:00'), [
            'option_title' => 'Ban than tai internal',
            'bundle_option_uid' => 'internal-option-uid',
            'bundle_option_status' => 'internal',
            'option_image_url' => 'https://example.com/internal-option.jpg',
            'option_video_url' => 'https://www.youtube.com/watch?v=abc12345678',
            'price' => 2000000,
        ]);

        $defaultResponse = $this->getJson("/api/web-api/products/{$bundle->slug}/bundle-option-detail")
            ->assertOk();

        $this->assertSame(['Ban tho visible'], collect($defaultResponse->json('bundle_options'))->pluck('bundle_option_title')->all());
        $this->assertCount(1, $defaultResponse->json('bundle_items'));

        $internalResponse = $this->getJson("/api/web-api/products/{$bundle->slug}/bundle-option-detail?o=internal-option-uid&utm_source=facebook")
            ->assertOk();

        $this->assertCount(1, $internalResponse->json('bundle_items'));
        $this->assertSame(['Ban than tai internal'], collect($internalResponse->json('bundle_options'))->pluck('bundle_option_title')->all());
        $this->assertSame('internal', $internalResponse->json('bundle_options.0.bundle_option_status'));
        $this->assertSame('https://example.com/internal-option.jpg', $internalResponse->json('bundle_options.0.option_image_url'));
        $this->assertSame('https://www.youtube.com/watch?v=abc12345678', $internalResponse->json('bundle_options.0.option_video_url'));
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

    private function attachPrimaryImage(Product $product, string $imageUrl): void
    {
        ProductImage::query()->create([
            'product_id' => $product->id,
            'image_url' => $imageUrl,
            'is_primary' => true,
            'sort_order' => 0,
        ]);
    }
}
