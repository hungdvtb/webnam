<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\SiteDomain;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SiteDomainApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_store_normalizes_domain_before_saving(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);
        $account = $this->createAccount('Primary');

        $response = $this
            ->withHeader('X-Account-Id', (string) $account->id)
            ->postJson('/api/site-domains', [
                'domain' => 'https://DongDaiThanh.com/products?utm=1',
                'is_default' => true,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('domain', 'dongdaithanh.com')
            ->assertJsonPath('is_default', true);

        $this->assertDatabaseHas('site_domains', [
            'account_id' => $account->id,
            'domain' => 'dongdaithanh.com',
            'is_default' => true,
        ]);
    }

    public function test_store_reports_domain_owner_when_domain_exists_in_another_account(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);
        $owner = $this->createAccount('Gom Dai Thanh');
        $target = $this->createAccount('Dong Dai Thanh');

        SiteDomain::query()->create([
            'account_id' => $owner->id,
            'domain' => 'gomdaithanh.com',
            'is_active' => true,
            'is_default' => true,
        ]);

        $response = $this
            ->withHeader('X-Account-Id', (string) $target->id)
            ->postJson('/api/site-domains', [
                'domain' => 'https://www.gomdaithanh.com/san-pham',
            ]);

        $response
            ->assertUnprocessable()
            ->assertJsonValidationErrors('domain');

        $this->assertStringContainsString(
            'Gom Dai Thanh',
            (string) $response->json('errors.domain.0')
        );
    }

    public function test_update_can_set_default_without_resending_domain(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);
        $account = $this->createAccount('Default Switch');

        $oldDefault = SiteDomain::query()->create([
            'account_id' => $account->id,
            'domain' => 'old-default.example.com',
            'is_active' => true,
            'is_default' => true,
        ]);

        $newDefault = SiteDomain::query()->create([
            'account_id' => $account->id,
            'domain' => 'new-default.example.com',
            'is_active' => true,
            'is_default' => false,
        ]);

        $response = $this
            ->withHeader('X-Account-Id', (string) $account->id)
            ->putJson("/api/site-domains/{$newDefault->id}", [
                'is_default' => true,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('id', $newDefault->id)
            ->assertJsonPath('is_default', true);

        $this->assertFalse((bool) $oldDefault->fresh()->is_default);
        $this->assertTrue((bool) $newDefault->fresh()->is_default);
    }

    private function createAccount(string $name): Account
    {
        $slug = Str::slug($name) . '-' . Str::lower(Str::random(6));

        return Account::query()->create([
            'name' => $name,
            'domain' => $slug . '.local',
            'subdomain' => $slug,
            'status' => true,
        ]);
    }
}
