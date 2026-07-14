<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Category;
use App\Models\Product;
use App\Models\PublicCategoryNode;
use App\Models\SiteDomain;
use App\Models\Store;
use App\Support\StorefrontDomainScope;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class StorefrontPublicDomainScopeTest extends TestCase
{
    use RefreshDatabase;

    public function test_local_product_detail_uses_requested_site_code_scope(): void
    {
        $defaultAccount = Account::query()->create([
            'name' => 'Default store',
            'subdomain' => 'default-store',
            'site_code' => 'GSDT',
            'status' => true,
        ]);
        $previewAccount = Account::query()->create([
            'name' => 'Preview store',
            'subdomain' => 'preview-store',
            'site_code' => 'TEST_STORE',
            'status' => true,
        ]);

        Product::query()->create([
            'account_id' => $defaultAccount->id,
            'type' => 'simple',
            'name' => 'Other product',
            'slug' => 'other-product',
            'sku' => 'OTHER-1',
            'price' => 100000,
            'status' => true,
        ]);
        Product::query()->create([
            'account_id' => $previewAccount->id,
            'type' => 'simple',
            'name' => 'Preview product',
            'slug' => 'preview-product',
            'sku' => 'PREVIEW-1',
            'price' => 200000,
            'status' => true,
        ]);

        $this
            ->withHeaders([
                'X-Site-Code' => 'GSDT',
                'X-Public-Host' => 'localhost:3000',
            ])
            ->getJson('/api/web-api/products/preview-product')
            ->assertNotFound();

        $this
            ->withHeaders([
                'X-Site-Code' => 'TEST_STORE',
                'X-Public-Host' => 'localhost:3000',
            ])
            ->getJson('/api/web-api/products/preview-product')
            ->assertOk()
            ->assertJsonPath('slug', 'preview-product')
            ->assertJsonPath('account_id', $previewAccount->id);
    }

    public function test_public_domain_can_group_products_from_multiple_accounts(): void
    {
        $firstAccount = Account::query()->create([
            'name' => 'Store 1',
            'subdomain' => 'store-1',
            'site_code' => 'STORE1',
            'status' => true,
        ]);
        $secondAccount = Account::query()->create([
            'name' => 'Store 2',
            'subdomain' => 'store-2',
            'site_code' => 'STORE2',
            'status' => true,
        ]);
        $thirdAccount = Account::query()->create([
            'name' => 'Store 3',
            'subdomain' => 'store-3',
            'site_code' => 'STORE3',
            'status' => true,
        ]);

        $gomDomain = SiteDomain::query()->create([
            'account_id' => $firstAccount->id,
            'domain' => 'gomdaithanh.com',
            'is_active' => true,
            'is_default' => true,
        ]);
        $dongDomain = SiteDomain::query()->create([
            'account_id' => $thirdAccount->id,
            'domain' => 'dongdaithanh.com',
            'is_active' => true,
            'is_default' => true,
        ]);

        $secondAccount->update(['public_domain_id' => $gomDomain->id]);
        $thirdAccount->update(['public_domain_id' => $dongDomain->id]);

        $firstStore = Store::query()->create([
            'account_id' => $firstAccount->id,
            'public_domain_id' => $gomDomain->id,
            'name' => 'Store 1 branch',
            'slug' => 'store-1-branch',
            'status' => true,
        ]);
        $secondStore = Store::query()->create([
            'account_id' => $secondAccount->id,
            'name' => 'Store 2 branch',
            'slug' => 'store-2-branch',
            'status' => true,
        ]);
        $thirdStore = Store::query()->create([
            'account_id' => $thirdAccount->id,
            'public_domain_id' => $dongDomain->id,
            'name' => 'Store 3 branch',
            'slug' => 'store-3-branch',
            'status' => true,
        ]);

        Product::query()->create([
            'account_id' => $firstAccount->id,
            'store_id' => $firstStore->id,
            'type' => 'simple',
            'name' => 'Product on Gom 1',
            'slug' => 'product-on-gom-1',
            'sku' => 'GOM-1',
            'price' => 100000,
            'status' => true,
        ]);
        $secondParentProduct = Product::query()->create([
            'account_id' => $secondAccount->id,
            'store_id' => $secondStore->id,
            'type' => 'configurable',
            'name' => 'Product on Gom 2',
            'slug' => 'product-on-gom-2',
            'sku' => 'GOM-2',
            'price' => 200000,
            'status' => true,
        ]);
        $secondChildProduct = Product::query()->create([
            'account_id' => $secondAccount->id,
            'store_id' => $secondStore->id,
            'type' => 'simple',
            'name' => 'Product on Gom 2 child',
            'slug' => 'product-on-gom-2-child',
            'sku' => 'GOM-2-CHILD',
            'price' => 210000,
            'status' => true,
        ]);
        DB::table('product_links')->insert([
            'account_id' => $secondAccount->id,
            'product_id' => $secondParentProduct->id,
            'linked_product_id' => $secondChildProduct->id,
            'link_type' => 'super_link',
            'position' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Product::query()->create([
            'account_id' => $thirdAccount->id,
            'store_id' => $thirdStore->id,
            'type' => 'simple',
            'name' => 'Product on Dong',
            'slug' => 'product-on-dong',
            'sku' => 'DONG-1',
            'price' => 300000,
            'status' => true,
        ]);

        $request = Request::create('/api/web-api/products', 'GET');
        $request->headers->set('X-Public-Host', 'gomdaithanh.com');

        $this->assertSame(
            [$firstAccount->id, $secondAccount->id],
            StorefrontDomainScope::resolveAccountIds($request, $firstAccount->id)
        );
        $this->assertNull(
            StorefrontDomainScope::resolveStoreIds($request, $firstAccount->id, [$firstAccount->id, $secondAccount->id])
        );

        $response = $this
            ->withHeaders([
                'X-Site-Code' => 'STORE1',
                'X-Public-Host' => 'gomdaithanh.com',
            ])
            ->getJson('/api/web-api/products?per_page=50')
            ->assertOk();

        $slugs = collect($response->json('data'))
            ->pluck('slug')
            ->sort()
            ->values()
            ->all();

        $this->assertSame(['product-on-gom-1', 'product-on-gom-2'], $slugs);
    }

    public function test_public_domain_category_tree_can_merge_categories_from_multiple_accounts(): void
    {
        $firstAccount = Account::query()->create([
            'name' => 'Store 1',
            'subdomain' => 'store-1',
            'site_code' => 'STORE1',
            'status' => true,
        ]);
        $secondAccount = Account::query()->create([
            'name' => 'Store 2',
            'subdomain' => 'store-2',
            'site_code' => 'STORE2',
            'status' => true,
        ]);

        $domain = SiteDomain::query()->create([
            'account_id' => $firstAccount->id,
            'domain' => 'gomdaithanh.com',
            'is_active' => true,
            'is_default' => true,
        ]);
        $secondAccount->update(['public_domain_id' => $domain->id]);

        $firstCategory = Category::query()->create([
            'account_id' => $firstAccount->id,
            'name' => 'Bo do tho men ran',
            'slug' => 'bo-do-tho-men-ran',
            'status' => true,
            'order' => 1,
        ]);
        $secondCategory = Category::query()->create([
            'account_id' => $secondAccount->id,
            'name' => 'Bo do tho men ran mau 2',
            'slug' => 'bo-do-tho-men-ran-mau-2',
            'status' => true,
            'order' => 1,
        ]);

        $firstProduct = Product::query()->create([
            'account_id' => $firstAccount->id,
            'category_id' => $firstCategory->id,
            'type' => 'simple',
            'name' => 'Product from store 1 category',
            'slug' => 'product-from-store-1-category',
            'sku' => 'CAT-1',
            'price' => 100000,
            'status' => true,
        ]);
        $secondProduct = Product::query()->create([
            'account_id' => $secondAccount->id,
            'category_id' => $secondCategory->id,
            'type' => 'simple',
            'name' => 'Product from store 2 category',
            'slug' => 'product-from-store-2-category',
            'sku' => 'CAT-2',
            'price' => 200000,
            'status' => true,
        ]);

        DB::table('category_product')->insert([
            [
                'product_id' => $firstProduct->id,
                'category_id' => $firstCategory->id,
                'sort_order' => 0,
                'item_type' => 'product',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'product_id' => $secondProduct->id,
                'category_id' => $secondCategory->id,
                'sort_order' => 1,
                'item_type' => 'product',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $publicNode = PublicCategoryNode::query()->create([
            'site_domain_id' => $domain->id,
            'title' => 'Bo do tho men ran',
            'slug' => 'bo-do-tho-men-ran-public',
            'status' => true,
            'sort_order' => 0,
        ]);
        $publicNode->categories()->attach([
            $firstCategory->id => ['sort_order' => 0],
            $secondCategory->id => ['sort_order' => 1],
        ]);

        $categoriesResponse = $this
            ->withHeaders([
                'X-Site-Code' => 'STORE1',
                'X-Public-Host' => 'gomdaithanh.com',
            ])
            ->getJson('/api/web-api/categories')
            ->assertOk();

        $categoriesResponse->assertJsonCount(1);
        $categoriesResponse->assertJsonPath('0.slug', 'bo-do-tho-men-ran-public');
        $categoriesResponse->assertJsonPath('0.products_count', 2);

        $productsResponse = $this
            ->withHeaders([
                'X-Site-Code' => 'STORE1',
                'X-Public-Host' => 'gomdaithanh.com',
            ])
            ->getJson('/api/web-api/products?category=bo-do-tho-men-ran-public&per_page=50')
            ->assertOk();

        $slugs = collect($productsResponse->json('data'))
            ->pluck('slug')
            ->sort()
            ->values()
            ->all();

        $this->assertSame([
            'product-from-store-1-category',
            'product-from-store-2-category',
        ], $slugs);
    }
}
