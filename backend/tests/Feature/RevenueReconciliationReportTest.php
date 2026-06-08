<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RevenueReconciliationReportTest extends TestCase
{
    use RefreshDatabase;

    public function test_report_lists_orders_that_make_daily_and_monthly_revenue_different(): void
    {
        $account = Account::query()->create([
            'name' => 'Revenue Reconciliation Test Account',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user);

        $headers = [
            'X-Account-Id' => (string) $account->id,
        ];

        $this->createOrder($account, [
            'order_number' => 'REC-EQUAL',
            'total_price' => 1000,
            'report_revenue_total' => 1000,
        ]);

        $processingOrder = $this->createOrder($account, [
            'order_number' => 'REC-PROCESSING',
            'status' => 'processing',
            'total_price' => 500,
            'report_revenue_total' => 0,
        ]);

        $amountMismatchOrder = $this->createOrder($account, [
            'order_number' => 'REC-AMOUNT-MISMATCH',
            'total_price' => 700,
            'report_revenue_total' => 600,
        ]);

        $zeroRevenueOrder = $this->createOrder($account, [
            'order_number' => 'REC-ZERO-REPORT',
            'total_price' => 300,
            'report_revenue_total' => 0,
        ]);

        $typeMismatchOrder = $this->createOrder($account, [
            'order_number' => 'REC-CUSTOM-TYPE',
            'order_type' => 'custom_type',
            'total_price' => 200,
            'report_revenue_total' => 200,
        ]);

        $this->createOrder($account, [
            'order_number' => 'REC-CANCELLED',
            'status' => 'cancelled',
            'total_price' => 900,
            'report_revenue_total' => 900,
        ]);

        $this->createOrder($account, [
            'order_number' => 'REC-EXCHANGE',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'total_price' => 800,
            'report_revenue_total' => 800,
        ]);

        $this->createOrder($account, [
            'order_number' => 'REC-OUTSIDE-MONTH',
            'officialized_at' => '2026-05-01 08:00:00',
            'total_price' => 400,
            'report_revenue_total' => 0,
        ]);

        $response = $this
            ->getJson('/api/finance/daily-pnl/revenue-reconciliation?month=2026-04', $headers)
            ->assertOk()
            ->assertJsonPath('data.month_key', '2026-04')
            ->assertJsonPath('data.summary.daily_revenue', 2700)
            ->assertJsonPath('data.summary.monthly_revenue', 1600)
            ->assertJsonPath('data.summary.difference', 1100)
            ->assertJsonPath('data.summary.different_order_count', 4);

        $rows = collect($response->json('data.orders'))->keyBy('id');

        $this->assertSame(500.0, (float) $rows[$processingOrder->id]['difference']);
        $this->assertContains('status_not_completed', $rows[$processingOrder->id]['reason_codes']);

        $this->assertSame(100.0, (float) $rows[$amountMismatchOrder->id]['difference']);
        $this->assertContains('amount_mismatch', $rows[$amountMismatchOrder->id]['reason_codes']);

        $this->assertSame(300.0, (float) $rows[$zeroRevenueOrder->id]['difference']);
        $this->assertContains('report_revenue_zero', $rows[$zeroRevenueOrder->id]['reason_codes']);

        $this->assertSame(200.0, (float) $rows[$typeMismatchOrder->id]['difference']);
        $this->assertContains('order_type_mismatch', $rows[$typeMismatchOrder->id]['reason_codes']);
    }

    private function createOrder(Account $account, array $attributes): Order
    {
        return Order::query()->create(array_merge([
            'account_id' => $account->id,
            'order_number' => 'REC-' . uniqid(),
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 0,
            'report_revenue_total' => 0,
            'status' => 'completed',
            'customer_name' => 'Test Customer',
            'customer_email' => 'test@example.com',
            'customer_phone' => '0900000000',
            'shipping_address' => 'Hanoi',
            'officialized_at' => '2026-04-15 08:00:00',
        ], $attributes));
    }
}
