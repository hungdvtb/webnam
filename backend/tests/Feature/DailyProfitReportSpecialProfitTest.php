<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\DailyAdsSpend;
use App\Models\FinDailyReportConfig;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DailyProfitReportSpecialProfitTest extends TestCase
{
    use RefreshDatabase;

    public function test_daily_report_extra_profit_sums_report_profit_total_for_all_special_orders_by_day(): void
    {
        $account = Account::query()->create([
            'name' => 'Daily Special Profit Test Account',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);

        Sanctum::actingAs($user);

        FinDailyReportConfig::query()->create([
            'return_rate' => 0,
            'packaging_fee' => 0,
            'shipping_estimate_rate' => 10,
            'tax_rate' => 0,
            'fb_tax_rate' => 0,
        ]);

        $headers = [
            'X-Account-Id' => (string) $account->id,
        ];

        $this->createOrder($account, [
            'order_number' => 'DAILY-STANDARD-001',
            'officialized_at' => '2026-04-10 08:00:00',
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 1000,
            'cost_total' => 400,
        ]);

        $this->createOrder($account, [
            'order_number' => 'DAILY-EXCHANGE-001',
            'officialized_at' => '2026-04-10 09:00:00',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'report_profit_total' => 150,
        ]);

        $this->createOrder($account, [
            'order_number' => 'DAILY-PARTIAL-001',
            'officialized_at' => '2026-04-10 10:00:00',
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'report_profit_total' => -20,
        ]);

        $this->createOrder($account, [
            'order_number' => 'DAILY-EXCHANGE-002',
            'officialized_at' => '2026-04-11 11:00:00',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'report_profit_total' => 80,
        ]);

        $this->createOrder($account, [
            'order_number' => 'DAILY-OUTSIDE-RANGE',
            'officialized_at' => '2026-04-09 11:00:00',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'report_profit_total' => 999,
        ]);

        $this->createOrder($account, [
            'order_number' => 'DAILY-CANCELLED-SPECIAL',
            'officialized_at' => '2026-04-10 12:00:00',
            'status' => 'cancelled',
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'report_profit_total' => 777,
        ]);

        $response = $this->getJson('/api/finance/daily-pnl/report?start_date=2026-04-10&end_date=2026-04-12', $headers)
            ->assertOk();

        $rows = collect($response->json('data'))->keyBy('date');

        $this->assertSame(150.0, (float) $rows['2026-04-10']['exchange_profit_loss']);
        $this->assertSame(-20.0, (float) $rows['2026-04-10']['partial_delivery_profit_loss']);
        $this->assertSame(1, (int) $rows['2026-04-10']['exchange_return_order_count']);
        $this->assertSame(1, (int) $rows['2026-04-10']['partial_delivery_order_count']);
        $this->assertSame(2, (int) $rows['2026-04-10']['extra_profit_order_count']);
        $this->assertSame(130.0, (float) $rows['2026-04-10']['extra_profit']);

        $this->assertSame(80.0, (float) $rows['2026-04-11']['exchange_profit_loss']);
        $this->assertSame(0.0, (float) $rows['2026-04-11']['partial_delivery_profit_loss']);
        $this->assertSame(1, (int) $rows['2026-04-11']['exchange_return_order_count']);
        $this->assertSame(0, (int) $rows['2026-04-11']['partial_delivery_order_count']);
        $this->assertSame(1, (int) $rows['2026-04-11']['extra_profit_order_count']);
        $this->assertSame(80.0, (float) $rows['2026-04-11']['extra_profit']);

        $this->assertSame(0.0, (float) $rows['2026-04-12']['exchange_profit_loss']);
        $this->assertSame(0.0, (float) $rows['2026-04-12']['partial_delivery_profit_loss']);
        $this->assertSame(0, (int) $rows['2026-04-12']['exchange_return_order_count']);
        $this->assertSame(0, (int) $rows['2026-04-12']['partial_delivery_order_count']);
        $this->assertSame(0, (int) $rows['2026-04-12']['extra_profit_order_count']);
        $this->assertSame(0.0, (float) $rows['2026-04-12']['extra_profit']);

        $this->assertSame(2, (int) $response->json('summary.exchange_return_order_count'));
        $this->assertSame(1, (int) $response->json('summary.partial_delivery_order_count'));
        $this->assertSame(3, (int) $response->json('summary.extra_profit_order_count'));
        $this->assertSame(230.0, (float) $response->json('summary.exchange_profit_loss'));
        $this->assertSame(-20.0, (float) $response->json('summary.partial_delivery_profit_loss'));
        $this->assertSame(210.0, (float) $response->json('summary.total_extra_profit'));
    }

    public function test_daily_report_extra_profit_uses_created_at_fallback_for_special_orders_without_officialized_at(): void
    {
        $account = Account::query()->create([
            'name' => 'Daily Special Profit Fallback Test Account',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);

        Sanctum::actingAs($user);

        FinDailyReportConfig::query()->create([
            'return_rate' => 0,
            'packaging_fee' => 0,
            'shipping_estimate_rate' => 10,
            'tax_rate' => 0,
            'fb_tax_rate' => 0,
        ]);

        $headers = [
            'X-Account-Id' => (string) $account->id,
        ];

        $this->createOrder($account, [
            'order_number' => 'DAILY-FALLBACK-EXCHANGE',
            'officialized_at' => null,
            'created_at' => '2026-04-15 09:00:00',
            'updated_at' => '2026-04-15 09:00:00',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'report_profit_total' => 55,
        ]);

        $response = $this->getJson('/api/finance/daily-pnl/report?start_date=2026-04-15&end_date=2026-04-15', $headers)
            ->assertOk();

        $row = collect($response->json('data'))->firstWhere('date', '2026-04-15');

        $this->assertNotNull($row);
        $this->assertSame(1, (int) ($row['exchange_return_order_count'] ?? 0));
        $this->assertSame(0, (int) ($row['partial_delivery_order_count'] ?? 0));
        $this->assertSame(1, (int) ($row['extra_profit_order_count'] ?? 0));
        $this->assertSame(55.0, (float) ($row['exchange_profit_loss'] ?? 0));
        $this->assertSame(0.0, (float) ($row['partial_delivery_profit_loss'] ?? 0));
        $this->assertSame(55.0, (float) ($row['extra_profit'] ?? 0));
        $this->assertSame(1, (int) $response->json('summary.exchange_return_order_count'));
        $this->assertSame(0, (int) $response->json('summary.partial_delivery_order_count'));
        $this->assertSame(1, (int) $response->json('summary.extra_profit_order_count'));
        $this->assertSame(55.0, (float) $response->json('summary.total_extra_profit'));
    }

    public function test_daily_report_load_uses_saved_ad_spend_without_auto_syncing_external_apis(): void
    {
        $account = Account::query()->create([
            'name' => 'Daily Report Saved Ads Test Account',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);

        Sanctum::actingAs($user);

        FinDailyReportConfig::query()->create([
            'return_rate' => 0,
            'packaging_fee' => 0,
            'shipping_estimate_rate' => 10,
            'tax_rate' => 0,
            'fb_tax_rate' => 0,
            'google_tax_rate' => 0,
            'fb_access_token' => 'fb-token',
            'fb_ad_account_ids' => 'act_123',
            'google_developer_token' => 'google-dev-token',
            'google_client_id' => 'google-client-id',
            'google_client_secret' => 'google-client-secret',
            'google_refresh_token' => 'google-refresh-token',
            'google_customer_ids' => '456-789-0123',
        ]);

        DailyAdsSpend::query()->create([
            'platform' => DailyAdsSpend::PLATFORM_FACEBOOK,
            'date' => '2026-04-18',
            'amount' => 120,
            'account_id' => null,
        ]);
        DailyAdsSpend::query()->create([
            'platform' => DailyAdsSpend::PLATFORM_GOOGLE,
            'date' => '2026-04-18',
            'amount' => 80,
            'account_id' => null,
        ]);

        Http::fake(function () {
            throw new \RuntimeException('Daily report should not call external Ads APIs while loading.');
        });

        $response = $this->getJson('/api/finance/daily-pnl/report?start_date=2026-04-18&end_date=2026-04-18', [
            'X-Account-Id' => (string) $account->id,
        ])->assertOk();

        $row = collect($response->json('data'))->firstWhere('date', '2026-04-18');

        $this->assertNotNull($row);
        $this->assertSame(120.0, (float) ($row['fb_ads_spend'] ?? 0));
        $this->assertSame(80.0, (float) ($row['google_ads_spend'] ?? 0));
        $this->assertSame(200.0, (float) ($row['ads_spend'] ?? 0));
        $this->assertFalse((bool) $response->json('meta.ads_sync.requested'));
        Http::assertNothingSent();
    }

    private function createOrder(Account $account, array $attributes): Order
    {
        $timestamps = [];

        foreach (['created_at', 'updated_at'] as $field) {
            if (array_key_exists($field, $attributes)) {
                $timestamps[$field] = $attributes[$field];
                unset($attributes[$field]);
            }
        }

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
            'report_profit_total' => 0,
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'officialized_at' => '2026-04-01 00:00:00',
        ], $attributes));

        foreach ($timestamps as $field => $value) {
            $order->{$field} = $value;
        }

        $order->save();

        return $order->fresh();
    }
}
