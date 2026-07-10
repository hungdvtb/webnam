<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\ProductController;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

class AdminProductPublicDomainPayloadTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_product_list_query_eager_loads_account_public_domain_for_public_links(): void
    {
        $controller = app(ProductController::class);
        $request = Request::create('/api/products', 'GET', ['per_page' => 10]);
        $request->headers->set('X-Account-Id', '1');

        [$query] = \Closure::bind(function () use ($request) {
            return $this->buildAdminProductListBaseQuery($request, false);
        }, $controller, $controller::class)();

        $eagerLoads = $query->getEagerLoads();

        $this->assertArrayHasKey('account', $eagerLoads);
        $this->assertArrayHasKey('account.publicDomain', $eagerLoads);
    }

    public function test_product_resource_relations_include_account_site_code_for_public_preview_links(): void
    {
        $controller = app(ProductController::class);

        $relations = \Closure::bind(function () {
            return $this->productResourceRelations(false);
        }, $controller, $controller::class)();

        $this->assertContains('account:id,name,site_code,public_domain_id', $relations);
    }

    public function test_product_export_link_uses_account_public_domain_and_public_product_path(): void
    {
        $controller = app(ProductController::class);

        $url = \Closure::bind(function () {
            return $this->buildProductPageUrlFromArray([
                'id' => 1,
                'slug' => 'bo-am-chen-gia-co',
                'account' => [
                    'public_domain_id' => 10,
                    'public_domain' => [
                        'domain' => 'gomdaithanh.com',
                    ],
                ],
            ], collect(), null);
        }, $controller, $controller::class)();

        $this->assertSame('https://gomdaithanh.com/product/bo-am-chen-gia-co', $url);
    }
}
