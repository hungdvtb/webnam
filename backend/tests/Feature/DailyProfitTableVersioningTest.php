<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DailyProfitTableVersioningTest extends TestCase
{
    use RefreshDatabase;

    public function test_daily_profit_table_uses_order_data_fixed_expense_and_config_versions_by_effective_date(): void
    {
        $account = Account::query()->create([
            'name' => 'Daily Profit Test Account',
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
        ], $headers)->assertOk();

        $this->postJson('/api/finance/daily-profit/config', [
            'effective_date' => '2026-03-01',
            'return_rate' => 10,
            'packaging_cost_per_order' => 5,
            'shipping_calculation_mode' => 'fixed_per_order',
            'shipping_cost_per_order' => 20,
            'shipping_cost_rate' => 0,
            'tax_rate' => 1.5,
        ], $headers)->assertCreated();

        $this->postJson('/api/finance/daily-profit/config', [
            'effective_date' => '2026-03-15',
            'return_rate' => 20,
            'packaging_cost_per_order' => 10,
            'shipping_calculation_mode' => 'revenue_percent',
            'shipping_cost_per_order' => 0,
            'shipping_cost_rate' => 5,
            'tax_rate' => 1.5,
        ], $headers)->assertCreated();

        $orderOne = new Order([
            'account_id' => $account->id,
            'order_number' => 'TEST-ORDER-001',
            'total_price' => 1000,
            'status' => 'completed',
            'customer_name' => 'Nguyen Van A',
            'customer_email' => 'a@example.com',
            'customer_phone' => '0900000001',
            'shipping_address' => 'HN',
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 400,
            'profit_total' => 600,
        ]);
        $orderOne->created_at = '2026-03-10 10:00:00';
        $orderOne->updated_at = '2026-03-10 10:00:00';
        $orderOne->save();

        $orderTwo = new Order([
            'account_id' => $account->id,
            'order_number' => 'TEST-ORDER-002',
            'total_price' => 2000,
            'status' => 'completed',
            'customer_name' => 'Nguyen Van B',
            'customer_email' => 'b@example.com',
            'customer_phone' => '0900000002',
            'shipping_address' => 'HN',
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 800,
            'profit_total' => 1200,
        ]);
        $orderTwo->created_at = '2026-03-16 11:00:00';
        $orderTwo->updated_at = '2026-03-16 11:00:00';
        $orderTwo->save();

        $response = $this->getJson('/api/finance/daily-profit?date_from=2026-03-10&date_to=2026-03-16', $headers)
            ->assertOk();

        $rows = collect($response->json('rows'))->keyBy('date');

        $this->assertSame(1000.0, (float) $rows['2026-03-10']['revenue']);
        $this->assertSame(900.0, (float) $rows['2026-03-10']['revenue_actual']);
        $this->assertSame(1, (int) $rows['2026-03-10']['order_count']);
        $this->assertSame(400.0, (float) $rows['2026-03-10']['cost_goods']);
        $this->assertSame(360.0, (float) $rows['2026-03-10']['cost_goods_actual']);
        $this->assertSame(20.0, (float) $rows['2026-03-10']['shipping_cost']);
        $this->assertSame(5.0, (float) $rows['2026-03-10']['packaging_cost']);
        $this->assertSame(13.2, (float) $rows['2026-03-10']['tax_cost']);
        $this->assertSame(100.0, (float) $rows['2026-03-10']['fixed_expense_cost']);
        $this->assertSame(401.8, (float) $rows['2026-03-10']['profit']);

        $this->assertSame(2000.0, (float) $rows['2026-03-16']['revenue']);
        $this->assertSame(1600.0, (float) $rows['2026-03-16']['revenue_actual']);
        $this->assertSame(1, (int) $rows['2026-03-16']['order_count']);
        $this->assertSame(800.0, (float) $rows['2026-03-16']['cost_goods']);
        $this->assertSame(640.0, (float) $rows['2026-03-16']['cost_goods_actual']);
        $this->assertSame(100.0, (float) $rows['2026-03-16']['shipping_cost']);
        $this->assertSame(10.0, (float) $rows['2026-03-16']['packaging_cost']);
        $this->assertSame(22.5, (float) $rows['2026-03-16']['tax_cost']);
        $this->assertSame(100.0, (float) $rows['2026-03-16']['fixed_expense_cost']);
        $this->assertSame(727.5, (float) $rows['2026-03-16']['profit']);
    }
}
