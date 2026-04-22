<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FinDailyReportConfig;
use App\Models\InventoryDocument;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MonthlyProfitReportFilterTest extends TestCase
{
    use RefreshDatabase;

    public function test_monthly_report_revenue_and_actual_cost_only_include_completed_standard_orders(): void
    {
        $account = Account::query()->create([
            'name' => 'Monthly Profit Test Account',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);

        Sanctum::actingAs($user);

        FinDailyReportConfig::query()->create([
            'return_rate' => 10,
            'packaging_fee' => 2000,
            'shipping_estimate_rate' => 10,
            'tax_rate' => 1.5,
        ]);

        $headers = [
            'X-Account-Id' => (string) $account->id,
        ];

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-ELIGIBLE-001',
            'officialized_at' => '2026-03-05 09:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 1000,
            'cost_total' => 400,
            'internal_shipping_fee' => 15,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-ELIGIBLE-DEFAULTS',
            'officialized_at' => '2026-03-06 11:00:00',
            'status' => 'completed',
            'order_kind' => null,
            'order_type' => null,
            'total_price' => 500,
            'cost_total' => 200,
            'external_delivery_meta' => ['shipping_cost' => 35],
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-PROCESSING',
            'officialized_at' => '2026-03-07 11:00:00',
            'status' => 'processing',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 10000,
            'cost_total' => 7000,
            'internal_shipping_fee' => 120,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-EXCHANGE',
            'officialized_at' => '2026-03-08 11:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'total_price' => 9000,
            'cost_total' => 6000,
            'report_revenue_total' => 7000,
            'report_cost_total' => 6000,
            'report_profit_total' => 1000,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-PARTIAL',
            'officialized_at' => '2026-03-09 11:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'total_price' => 8000,
            'cost_total' => 5000,
            'report_revenue_total' => 8000,
            'report_cost_total' => 5000,
            'report_profit_total' => 3000,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-DRAFT',
            'officialized_at' => '2026-03-10 11:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_DRAFT,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 7000,
            'cost_total' => 4000,
        ]);

        InventoryDocument::query()->create([
            'account_id' => $account->id,
            'document_number' => 'DMG-202603-001',
            'type' => 'damaged',
            'document_date' => '2026-03-12',
            'status' => 'completed',
            'total_quantity' => 2,
            'total_amount' => 390,
        ]);

        InventoryDocument::query()->create([
            'account_id' => $account->id,
            'document_number' => 'DMG-202604-OUTSIDE',
            'type' => 'damaged',
            'document_date' => '2026-04-01',
            'status' => 'completed',
            'total_quantity' => 1,
            'total_amount' => 999,
        ]);

        InventoryDocument::query()->create([
            'account_id' => $account->id,
            'document_number' => 'RETURN-202603-001',
            'type' => 'return',
            'document_date' => '2026-03-15',
            'status' => 'completed',
            'total_quantity' => 1,
            'total_amount' => 888,
        ]);

        $response = $this->getJson('/api/finance/daily-pnl/monthly-report?start_date=2026-03-01&end_date=2026-03-31', $headers)
            ->assertOk();

        $rows = collect($response->json('data'))->keyBy('key');

        $this->assertTrue($rows->has('2026-03'));
        $this->assertSame(1500.0, (float) $rows['2026-03']['revenue']);
        $this->assertSame(600.0, (float) $rows['2026-03']['cost_actual']);
        $this->assertSame(1020.0, (float) $rows['2026-03']['shipping_fee']);
        $this->assertSame(390.0, (float) $rows['2026-03']['damaged_goods']);
        $this->assertSame(1000.0, (float) $rows['2026-03']['exchange_profit_loss']);
        $this->assertSame(3000.0, (float) $rows['2026-03']['partial_delivery_profit_loss']);
        $this->assertSame(1500.0, (float) $response->json('summary.total_revenue'));
    }

    public function test_monthly_report_packaging_fee_uses_dispatched_order_count_times_daily_config_fee(): void
    {
        $account = Account::query()->create([
            'name' => 'Monthly Packaging Config Test Account',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);

        Sanctum::actingAs($user);

        FinDailyReportConfig::query()->create([
            'return_rate' => 10,
            'packaging_fee' => 2500,
            'shipping_estimate_rate' => 10,
            'tax_rate' => 1.5,
        ]);

        $headers = [
            'X-Account-Id' => (string) $account->id,
        ];

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-PACK-MAR-ONLY',
            'officialized_at' => '2026-03-12 09:00:00',
            'shipping_dispatched_at' => '2026-03-13 09:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 1000,
            'cost_total' => 400,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-PACK-SHIFTED-TO-APR',
            'officialized_at' => '2026-03-31 18:00:00',
            'shipping_dispatched_at' => '2026-04-02 09:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 1200,
            'cost_total' => 500,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-PACK-APR-ONLY',
            'officialized_at' => '2026-04-05 11:00:00',
            'shipping_dispatched_at' => '2026-04-06 11:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 900,
            'cost_total' => 300,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-PACK-CANCELLED',
            'officialized_at' => '2026-04-07 12:00:00',
            'shipping_dispatched_at' => '2026-04-08 12:00:00',
            'status' => 'cancelled',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 999,
            'cost_total' => 111,
        ]);

        $response = $this->getJson('/api/finance/daily-pnl/monthly-report?start_date=2026-03-01&end_date=2026-04-30', $headers)
            ->assertOk();

        $rows = collect($response->json('data'))->keyBy('key');

        $this->assertSame(1, (int) $rows['2026-03']['order_count']);
        $this->assertSame(2500.0, (float) $rows['2026-03']['packaging_fee']);
        $this->assertSame(2, (int) $rows['2026-04']['order_count']);
        $this->assertSame(5000.0, (float) $rows['2026-04']['packaging_fee']);
        $this->assertSame(7500.0, (float) collect($response->json('data'))->sum('packaging_fee'));
        $this->assertSame(3, (int) $response->json('summary.total_orders'));
    }

    private function createOrder(Account $account, array $attributes): Order
    {
        $order = new Order(array_merge([
            'account_id' => $account->id,
            'order_number' => 'ORDER-' . uniqid(),
            'total_price' => 0,
            'status' => 'completed',
            'customer_name' => 'Test Customer',
            'customer_email' => 'test@example.com',
            'customer_phone' => '0900000000',
            'shipping_address' => 'Hanoi',
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => 0,
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'officialized_at' => '2026-03-01 00:00:00',
        ], $attributes));

        $order->save();

        return $order->fresh();
    }
}
