<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FinDailyReportConfig;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DailyPnlConfigAccountScopeTest extends TestCase
{
    use RefreshDatabase;

    public function test_daily_pnl_config_is_saved_per_account(): void
    {
        $accountA = Account::query()->create(['name' => 'Daily PnL Account A']);
        $accountB = Account::query()->create(['name' => 'Daily PnL Account B']);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $this->withHeaders($this->headers($accountA))
            ->postJson('/api/finance/daily-pnl/config', [
                'return_rate' => 7.5,
                'packaging_fee' => 11111,
                'shipping_estimate_rate' => 5,
                'shipping_fee_type' => '%',
                'tax_rate' => 1.5,
                'fb_access_token' => 'token-a',
            ])
            ->assertOk();

        $accountBConfig = $this->withHeaders($this->headers($accountB))
            ->getJson('/api/finance/daily-pnl/config')
            ->assertOk()
            ->json('data');

        $this->assertSame(2.0, (float) $accountBConfig['return_rate']);
        $this->assertSame(2000.0, (float) $accountBConfig['packaging_fee']);
        $this->assertNull($accountBConfig['fb_access_token']);

        $this->withHeaders($this->headers($accountB))
            ->postJson('/api/finance/daily-pnl/config', [
                'return_rate' => 1,
                'packaging_fee' => 22222,
                'shipping_estimate_rate' => 6,
                'shipping_fee_type' => '%',
                'tax_rate' => 2,
                'fb_access_token' => 'token-b',
            ])
            ->assertOk();

        $accountAConfig = $this->withHeaders($this->headers($accountA))
            ->getJson('/api/finance/daily-pnl/config')
            ->assertOk()
            ->json('data');

        $this->assertSame(7.5, (float) $accountAConfig['return_rate']);
        $this->assertSame(11111.0, (float) $accountAConfig['packaging_fee']);
        $this->assertSame('token-a', $accountAConfig['fb_access_token']);

        $this->assertSame(1, FinDailyReportConfig::query()->where('account_id', $accountA->id)->count());
        $this->assertSame(1, FinDailyReportConfig::query()->where('account_id', $accountB->id)->count());
    }

    private function headers(Account $account): array
    {
        return [
            'X-Account-Id' => (string) $account->id,
            'Accept' => 'application/json',
        ];
    }
}
