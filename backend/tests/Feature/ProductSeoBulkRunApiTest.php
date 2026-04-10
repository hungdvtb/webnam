<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Product;
use App\Models\User;
use App\Services\AI\ProductSeoAiService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class ProductSeoBulkRunApiTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Mockery::close();

        parent::tearDown();
    }

    public function test_it_reuses_the_same_bulk_run_when_the_create_request_is_retried(): void
    {
        config([
            'product_seo_bulk.queue_connection' => 'sync',
        ]);

        $account = Account::create([
            'name' => 'SEO Bulk Store',
            'domain' => 'seo-bulk.local',
            'subdomain' => 'seo-bulk',
            'site_code' => 'SEO_BULK_STORE',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user);

        $product = Product::query()->create([
            'account_id' => $account->id,
            'name' => 'Bo am tra Bat Trang',
            'slug' => 'bo-am-tra-bat-trang',
            'sku' => 'SEO-BULK-001',
            'price' => 120000,
            'stock_quantity' => 5,
        ]);

        $seoService = Mockery::mock(ProductSeoAiService::class);
        $seoService->shouldReceive('generate')
            ->once()
            ->andReturn([
                'description' => 'Mo ta san pham',
                'specifications' => [],
                'meta_title' => 'SEO title',
                'meta_description' => 'SEO description',
                'meta_keywords' => 'seo, bulk',
                'model' => 'gemini-2.5-flash',
            ]);
        $seoService->shouldReceive('persist')
            ->once()
            ->andReturnUsing(fn (Product $resolvedProduct, array $generated) => $resolvedProduct);
        $this->app->instance(ProductSeoAiService::class, $seoService);

        $headers = [
            'X-Account-Id' => (string) $account->id,
        ];
        $payload = [
            'product_ids' => [$product->id],
            'request_key' => 'seo-bulk-retry-1',
        ];

        $firstResponse = $this->withHeaders($headers)->postJson('/api/products/seo-bulk/runs', $payload);
        $secondResponse = $this->withHeaders($headers)->postJson('/api/products/seo-bulk/runs', $payload);
        $listResponse = $this->withHeaders($headers)->getJson('/api/products/seo-bulk/runs?request_key=seo-bulk-retry-1');

        $firstResponse->assertCreated();
        $secondResponse->assertCreated();
        $listResponse->assertOk();

        $this->assertSame(
            $firstResponse->json('data.id'),
            $secondResponse->json('data.id')
        );
        $this->assertSame('seo-bulk-retry-1', $secondResponse->json('data.request_key'));
        $this->assertSame(
            $firstResponse->json('data.id'),
            $listResponse->json('data.0.id')
        );

        $this->assertDatabaseCount('product_seo_bulk_runs', 1);
        $this->assertDatabaseCount('product_seo_bulk_run_items', 1);
    }
}
