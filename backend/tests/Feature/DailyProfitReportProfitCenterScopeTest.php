<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\DailyAdsSpend;
use App\Models\FinDailyReportConfig;
use App\Models\ProfitCenter;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DailyProfitReportProfitCenterScopeTest extends TestCase
{
    use RefreshDatabase;

    public function test_daily_report_filters_saved_ad_spend_by_date_correct_profit_center(): void
    {
        [$account, $headers] = $this->actingAdmin();

        $centerA = $this->createCenter($account, 'Mang A', 'mang-a');
        $centerB = $this->createCenter($account, 'Mang B', 'mang-b');

        FinDailyReportConfig::query()->create([
            'return_rate' => 0,
            'packaging_fee' => 0,
            'shipping_estimate_rate' => 0,
            'tax_rate' => 0,
            'fb_tax_rate' => 0,
            'google_tax_rate' => 0,
            'fb_access_token' => 'token',
            'fb_ad_account_ids' => 'act_123',
        ]);

        DailyAdsSpend::query()->create([
            'platform' => DailyAdsSpend::PLATFORM_FACEBOOK,
            'date' => '2026-05-31',
            'account_id' => 123,
            'amount' => 100,
            'profit_center_id' => $centerA->id,
        ]);

        DailyAdsSpend::query()->create([
            'platform' => DailyAdsSpend::PLATFORM_FACEBOOK,
            'date' => '2026-06-01',
            'account_id' => 123,
            'amount' => 200,
            'profit_center_id' => $centerB->id,
        ]);

        $aResponse = $this->getJson('/api/finance/daily-pnl/report?start_date=2026-05-31&end_date=2026-06-01&profit_center_id=' . $centerA->id, $headers)
            ->assertOk();
        $bResponse = $this->getJson('/api/finance/daily-pnl/report?start_date=2026-05-31&end_date=2026-06-01&profit_center_id=' . $centerB->id, $headers)
            ->assertOk();

        $this->assertSame(100.0, (float) collect($aResponse->json('data'))->sum('fb_ads_spend'));
        $this->assertSame(200.0, (float) collect($bResponse->json('data'))->sum('fb_ads_spend'));
    }

    private function actingAdmin(): array
    {
        $account = Account::query()->create([
            'name' => 'Profit Center Scoped Report Account',
        ]);

        $user = User::factory()->create([
            'is_admin' => true,
        ]);
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user, ['*']);

        return [$account, ['X-Account-Id' => (string) $account->id]];
    }

    private function createCenter(Account $account, string $name, string $code): ProfitCenter
    {
        return ProfitCenter::query()->create([
            'account_id' => $account->id,
            'name' => $name,
            'code' => $code,
            'channel' => ProfitCenter::CHANNEL_SHARED,
            'is_active' => true,
        ]);
    }
}

