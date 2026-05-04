<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class ReportDashboardSummaryTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_dashboard_summary_returns_real_kpis_and_chart_series_across_all_order_statuses(): void
    {
        Carbon::setTestNow('2026-04-25 10:30:00');

        [$account, $user] = $this->authenticate();

        $otherAccount = Account::query()->create([
            'name' => 'Dashboard Other Account',
        ]);

        $otherUser = User::factory()->create();
        $otherUser->accounts()->attach($otherAccount->id, ['role' => 'owner']);

        $this->createOrder($account, $user, [
            'order_number' => 'DB-TODAY-VALID',
            'officialized_at' => '2026-04-25 08:30:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 1000,
            'report_revenue_total' => 900,
        ]);

        $this->createOrder($account, $user, [
            'order_number' => 'DB-APR-VALID-NULLS',
            'officialized_at' => '2026-04-05 09:00:00',
            'status' => 'completed',
            'order_kind' => null,
            'order_type' => null,
            'total_price' => 500,
            'report_revenue_total' => null,
        ]);

        $this->createOrder($account, $user, [
            'order_number' => 'DB-MAR-VALID-1',
            'officialized_at' => '2026-03-02 09:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 1400,
            'report_revenue_total' => 1200,
        ]);

        $this->createOrder($account, $user, [
            'order_number' => 'DB-MAR-VALID-2',
            'officialized_at' => '2026-03-20 14:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 800,
            'report_revenue_total' => 800,
        ]);

        $this->createOrder($account, $user, [
            'order_number' => 'DB-JAN-VALID',
            'officialized_at' => '2026-01-10 08:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 150,
            'report_revenue_total' => 150,
        ]);

        $this->createOrder($account, $user, [
            'order_number' => 'DB-APR-PROCESSING',
            'officialized_at' => '2026-04-12 09:00:00',
            'status' => 'processing',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 9999,
            'report_revenue_total' => 9999,
        ]);

        $this->createOrder($account, $user, [
            'order_number' => 'DB-INVALID-DRAFT',
            'officialized_at' => '2026-04-13 09:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_DRAFT,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 777,
            'report_revenue_total' => 777,
        ]);

        $this->createOrder($account, $user, [
            'order_number' => 'DB-INVALID-EXCHANGE',
            'officialized_at' => '2026-04-14 09:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'total_price' => 888,
            'report_revenue_total' => 666,
        ]);

        $this->createOrder($account, $user, [
            'order_number' => 'DB-MAR-CANCELLED',
            'officialized_at' => '2026-03-21 09:00:00',
            'status' => 'cancelled',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 12345,
            'report_revenue_total' => 12345,
        ]);

        $this->createOrder($otherAccount, $otherUser, [
            'order_number' => 'DB-OTHER-ACCOUNT',
            'officialized_at' => '2026-04-25 10:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 50000,
            'report_revenue_total' => 50000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/reports/dashboard?month=3&year=2026')
            ->assertOk();

        $this->assertSame(900.0, (float) $response->json('summary.today.revenue'));
        $this->assertSame(1, (int) $response->json('summary.today.orders_count'));
        $this->assertSame(11399.0, (float) $response->json('summary.current_month.revenue'));
        $this->assertSame(3, (int) $response->json('summary.current_month.orders_count'));
        $this->assertSame(900.0, (float) $response->json('sales_today'));
        $this->assertSame(1, (int) $response->json('orders_today'));
        $this->assertSame(0, (int) $response->json('low_stock_alerts'));
        $this->assertSame(3, (int) $response->json('filters.selected_month'));
        $this->assertSame(2026, (int) $response->json('filters.selected_year'));
        $this->assertContains(2026, $response->json('filters.available_years'));

        $dailySeries = collect($response->json('charts.daily_in_month.series'));
        $marchSecond = $dailySeries->firstWhere('date', '2026-03-02');
        $marchTwentieth = $dailySeries->firstWhere('date', '2026-03-20');
        $marchTwentyFirst = $dailySeries->firstWhere('date', '2026-03-21');
        $this->assertCount(31, $dailySeries);
        $this->assertSame(14345.0, (float) $response->json('charts.daily_in_month.total_revenue'));
        $this->assertSame(3, (int) $response->json('charts.daily_in_month.total_orders'));
        $this->assertNotNull($marchSecond);
        $this->assertNotNull($marchTwentieth);
        $this->assertNotNull($marchTwentyFirst);
        $this->assertSame(1200.0, (float) ($marchSecond['revenue'] ?? 0));
        $this->assertSame(1, (int) ($marchSecond['orders_count'] ?? 0));
        $this->assertSame(800.0, (float) ($marchTwentieth['revenue'] ?? 0));
        $this->assertSame(12345.0, (float) ($marchTwentyFirst['revenue'] ?? 0));

        $monthlySeries = collect($response->json('charts.monthly_in_year.series'))->keyBy('month');
        $this->assertCount(12, $monthlySeries);
        $this->assertSame(25894.0, (float) $response->json('charts.monthly_in_year.total_revenue'));
        $this->assertSame(7, (int) $response->json('charts.monthly_in_year.total_orders'));
        $this->assertSame(150.0, (float) ($monthlySeries->get(1)['revenue'] ?? 0));
        $this->assertSame(14345.0, (float) ($monthlySeries->get(3)['revenue'] ?? 0));
        $this->assertSame(11399.0, (float) ($monthlySeries->get(4)['revenue'] ?? 0));
        $this->assertTrue((bool) ($monthlySeries->get(4)['is_current'] ?? false));
        $this->assertSame('all', $response->json('meta.revenue_logic.status'));
        $this->assertSame('official', $response->json('meta.revenue_logic.order_kind'));
        $this->assertSame('standard', $response->json('meta.revenue_logic.order_type'));
        $this->assertSame('officialized_at', $response->json('meta.revenue_logic.date_field'));
        $this->assertSame('report_revenue_total', $response->json('meta.revenue_logic.amount_field'));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Dashboard ' . Str::upper(Str::random(4)),
            'domain' => 'dashboard-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'dashboard-' . Str::lower(Str::random(6)),
            'status' => 'active',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);

        Sanctum::actingAs($user, ['*']);

        return [$account, $user];
    }

    private function headers(Account $account): array
    {
        return [
            'X-Account-Id' => (string) $account->id,
            'Accept' => 'application/json',
        ];
    }

    private function createOrder(Account $account, User $user, array $overrides = []): Order
    {
        return Order::query()->create(array_merge([
            'account_id' => $account->id,
            'user_id' => $user->id,
            'order_number' => 'DB-' . Str::upper(Str::random(8)),
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'status' => 'completed',
            'customer_name' => 'Khach dashboard',
            'customer_phone' => '090' . random_int(1000000, 9999999),
            'shipping_address' => 'Dia chi dashboard',
            'total_price' => 0,
            'discount' => 0,
            'shipping_fee' => 0,
            'internal_shipping_fee' => 0,
            'cost_total' => 0,
            'profit_total' => 0,
            'report_revenue_total' => 0,
            'report_cost_total' => 0,
            'report_profit_total' => 0,
            'officialized_at' => '2026-04-01 00:00:00',
        ], $overrides));
    }
}
