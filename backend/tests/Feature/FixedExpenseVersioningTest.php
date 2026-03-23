<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FixedExpenseVersioningTest extends TestCase
{
    use RefreshDatabase;

    public function test_fixed_expense_versions_are_used_by_effective_date(): void
    {
        $account = Account::query()->create([
            'name' => 'Finance Test Account',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);

        Sanctum::actingAs($user);

        $headers = [
            'X-Account-Id' => (string) $account->id,
        ];

        $this->putJson('/api/finance/fixed-expenses/sheet', [
            'effective_date' => '2026-03-01',
            'day_calculation_mode' => 'fixed_30',
            'rows' => [
                ['content' => 'Thuê mặt bằng', 'monthly_amount' => 3000],
            ],
        ], $headers)->assertOk()->assertJsonPath('version.daily_amount', 100.0);

        $this->putJson('/api/finance/fixed-expenses/sheet', [
            'effective_date' => '2026-03-15',
            'day_calculation_mode' => 'fixed_30',
            'rows' => [
                ['content' => 'Thuê mặt bằng', 'monthly_amount' => 6000],
            ],
        ], $headers)->assertOk()->assertJsonPath('version.daily_amount', 200.0);

        $this->getJson('/api/finance/fixed-expenses/by-date?date=2026-03-10', $headers)
            ->assertOk()
            ->assertJsonPath('effective_date', '2026-03-01')
            ->assertJsonPath('daily_amount', 100.0)
            ->assertJsonPath('total_monthly_amount', 3000.0);

        $this->getJson('/api/finance/fixed-expenses/by-date?date=2026-03-20', $headers)
            ->assertOk()
            ->assertJsonPath('effective_date', '2026-03-15')
            ->assertJsonPath('daily_amount', 200.0)
            ->assertJsonPath('total_monthly_amount', 6000.0);

        $this->getJson('/api/finance/fixed-expenses?date=2026-03-10', $headers)
            ->assertOk()
            ->assertJsonPath('current_version.effective_date', '2026-03-01')
            ->assertJsonPath('rows.0.content', 'Thuê mặt bằng')
            ->assertJsonPath('rows.0.monthly_amount', 3000.0)
            ->assertJsonPath('summary.total_monthly_amount', 3000.0);

        $this->getJson('/api/finance/fixed-expenses?date=2026-03-20', $headers)
            ->assertOk()
            ->assertJsonPath('current_version.effective_date', '2026-03-15')
            ->assertJsonPath('rows.0.content', 'Thuê mặt bằng')
            ->assertJsonPath('rows.0.monthly_amount', 6000.0)
            ->assertJsonPath('summary.total_monthly_amount', 6000.0);

        $reportResponse = $this->getJson('/api/finance/reports?date_from=2026-03-10&date_to=2026-03-16', $headers)
            ->assertOk();

        $dailyRows = collect($reportResponse->json('daily_profit_loss'))->keyBy('date');

        $this->assertSame(100.0, (float) $dailyRows['2026-03-10']['fixed_expense_daily']);
        $this->assertSame(100.0, (float) $dailyRows['2026-03-14']['fixed_expense_daily']);
        $this->assertSame(200.0, (float) $dailyRows['2026-03-15']['fixed_expense_daily']);
        $this->assertSame(200.0, (float) $dailyRows['2026-03-16']['fixed_expense_daily']);
    }
}
