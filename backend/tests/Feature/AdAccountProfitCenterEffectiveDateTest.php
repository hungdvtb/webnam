<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AdAccountProfitCenter;
use App\Models\DailyAdsSpend;
use App\Models\FinDailyReportConfig;
use App\Models\ProfitCenter;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdAccountProfitCenterEffectiveDateTest extends TestCase
{
    use RefreshDatabase;

    public function test_saving_new_effective_date_closes_prior_mapping_and_reassigns_saved_spend(): void
    {
        [$account, $headers] = $this->actingAdmin();

        $centerA = $this->createCenter($account, 'Mang A', 'mang-a');
        $centerB = $this->createCenter($account, 'Mang B', 'mang-b');

        $this->putJson('/api/finance/profit-centers/ad-account-mappings', [
            'mappings' => [[
                'platform' => 'facebook',
                'external_account_id' => 'act_123',
                'external_account_name' => 'TK3',
                'profit_center_id' => $centerA->id,
                'is_active' => true,
            ]],
        ], $headers)->assertOk();

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
            'profit_center_id' => $centerA->id,
        ]);

        $response = $this->putJson('/api/finance/profit-centers/ad-account-mappings', [
            'mappings' => [[
                'platform' => 'facebook',
                'external_account_id' => 'act_123',
                'external_account_name' => 'TK3',
                'profit_center_id' => $centerB->id,
                'effective_from' => '2026-06-01',
                'is_active' => true,
            ]],
        ], $headers)->assertOk();

        $rows = collect($response->json('ad_account_mappings'))
            ->where('platform', 'facebook')
            ->where('external_account_id', '123')
            ->values();

        $this->assertCount(2, $rows);

        $firstMapping = AdAccountProfitCenter::query()
            ->where('external_account_id', '123')
            ->where('profit_center_id', $centerA->id)
            ->firstOrFail();
        $secondMapping = AdAccountProfitCenter::query()
            ->where('external_account_id', '123')
            ->where('profit_center_id', $centerB->id)
            ->firstOrFail();

        $this->assertSame('1900-01-01', $firstMapping->effective_from->toDateString());
        $this->assertSame('2026-05-31', $firstMapping->effective_to->toDateString());
        $this->assertSame('2026-06-01', $secondMapping->effective_from->toDateString());
        $this->assertNull($secondMapping->effective_to);

        $this->assertSame($centerA->id, DailyAdsSpend::query()->whereDate('date', '2026-05-31')->value('profit_center_id'));
        $this->assertSame($centerB->id, DailyAdsSpend::query()->whereDate('date', '2026-06-01')->value('profit_center_id'));

        $this->assertSame($centerA->id, AdAccountProfitCenter::resolveProfitCenterId('facebook', 'act_123', '2026-05-31'));
        $this->assertSame($centerB->id, AdAccountProfitCenter::resolveProfitCenterId('facebook', 'act_123', '2026-06-01'));
    }

    public function test_profit_center_index_returns_connected_accounts_for_quick_assignment(): void
    {
        [$account, $headers] = $this->actingAdmin();

        $centerA = $this->createCenter($account, 'Mang A', 'mang-a');

        FinDailyReportConfig::query()->create([
            'fb_access_token' => 'token',
            'fb_ad_account_ids' => 'act_123',
            'fb_tokens_configs' => [
                ['token' => 'token', 'account_ids' => 'act_123, act_456'],
            ],
            'google_customer_ids' => '789-000-1111',
        ]);

        AdAccountProfitCenter::query()->create([
            'account_id' => $account->id,
            'platform' => DailyAdsSpend::PLATFORM_FACEBOOK,
            'external_account_id' => '123',
            'external_account_name' => 'TK3',
            'profit_center_id' => $centerA->id,
            'allocation_percent' => 100,
            'is_active' => true,
        ]);

        DailyAdsSpend::query()->create([
            'platform' => DailyAdsSpend::PLATFORM_GOOGLE,
            'date' => '2026-06-01',
            'account_id' => 2223334444,
            'amount' => 50,
        ]);

        $response = $this->getJson('/api/finance/profit-centers', $headers)
            ->assertOk();

        $accounts = collect($response->json('available_ad_accounts'));
        $this->assertTrue($accounts->contains(fn (array $row) => $row['platform'] === 'facebook' && $row['external_account_id'] === '123' && $row['external_account_name'] === 'TK3' && $row['is_mapped'] === true));
        $this->assertTrue($accounts->contains(fn (array $row) => $row['platform'] === 'facebook' && $row['external_account_id'] === '456'));
        $this->assertTrue($accounts->contains(fn (array $row) => $row['platform'] === 'google' && $row['external_account_id'] === '7890001111'));
        $this->assertTrue($accounts->contains(fn (array $row) => $row['platform'] === 'google' && $row['external_account_id'] === '2223334444'));
    }

    private function actingAdmin(): array
    {
        $account = Account::query()->create([
            'name' => 'Profit Center Effective Date Account',
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
