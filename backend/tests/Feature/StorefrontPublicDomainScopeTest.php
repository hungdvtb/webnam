<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Product;
use App\Models\SiteDomain;
use App\Models\Store;
use App\Support\StorefrontDomainScope;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

class StorefrontPublicDomainScopeTest extends TestCase
{
    use RefreshDatabase;

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

        $firstAccount->update(['public_domain_id' => $gomDomain->id]);
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
        Product::query()->create([
            'account_id' => $secondAccount->id,
            'store_id' => $secondStore->id,
            'type' => 'simple',
            'name' => 'Product on Gom 2',
            'slug' => 'product-on-gom-2',
            'sku' => 'GOM-2',
            'price' => 200000,
            'status' => true,
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
}
