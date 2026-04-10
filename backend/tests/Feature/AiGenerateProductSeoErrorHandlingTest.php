<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\User;
use App\Services\AI\ProductSeoAiService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Mockery;
use RuntimeException;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class AiGenerateProductSeoErrorHandlingTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Mockery::close();

        parent::tearDown();
    }

    public function test_it_returns_a_specific_ssl_error_for_product_seo_generation(): void
    {
        $account = Account::create([
            'name' => 'SEO Store',
            'domain' => 'seo.local',
            'subdomain' => 'seo',
            'site_code' => 'SEO_STORE',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user);

        $seoService = Mockery::mock(ProductSeoAiService::class);
        $seoService->shouldReceive('generate')
            ->once()
            ->andThrow(new RuntimeException('cURL error 60: SSL certificate problem: unable to get local issuer certificate'));
        $this->app->instance(ProductSeoAiService::class, $seoService);

        $response = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->postJson('/api/ai/generate-product-seo', [
            'name' => 'Am tra men lam ve vang',
        ]);

        $response
            ->assertStatus(503)
            ->assertJsonPath('error_code', 'AI_SSL_CERTIFICATE')
            ->assertJsonPath('message', 'May chu deploy khong ket noi duoc Gemini vi loi xac thuc chung chi SSL.')
            ->assertJsonPath('retryable', false);

        $this->assertStringContainsString(
            'SSL certificate problem',
            (string) $response->json('detail')
        );
    }

    public function test_it_returns_a_specific_invalid_json_error_for_product_seo_generation(): void
    {
        $account = Account::create([
            'name' => 'JSON Store',
            'domain' => 'json.local',
            'subdomain' => 'json',
            'site_code' => 'JSON_STORE',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user);

        $seoService = Mockery::mock(ProductSeoAiService::class);
        $seoService->shouldReceive('generate')
            ->once()
            ->andThrow(new RuntimeException('AI tra ve JSON khong hop le cho goi SEO san pham: Syntax error'));
        $this->app->instance(ProductSeoAiService::class, $seoService);

        $response = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->postJson('/api/ai/generate-product-seo', [
            'name' => 'Bat com men lam',
        ]);

        $response
            ->assertStatus(502)
            ->assertJsonPath('error_code', 'AI_INVALID_RESPONSE')
            ->assertJsonPath('message', 'Gemini tra ve noi dung sai dinh dang JSON nen backend khong the dung de tao SEO.')
            ->assertJsonPath('retryable', true);

        $this->assertStringContainsString(
            'Syntax error',
            (string) $response->json('detail')
        );
    }
}
