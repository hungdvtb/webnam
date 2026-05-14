<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\DailyAdsSpend;
use App\Models\FinDailyReportConfig;
use App\Models\FixedCostDailySnapshot;
use App\Models\InventoryDocument;
use App\Models\Order;
use App\Models\Shipment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MonthlyProfitReportFilterTest extends TestCase
{
    use RefreshDatabase;

    public function test_monthly_report_keeps_standard_revenue_cost_uses_all_valid_orders_for_shipping_and_keeps_tax_on_completed_orders(): void
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
            'order_number' => 'MONTHLY-CANCELLED',
            'officialized_at' => '2026-03-07 12:00:00',
            'status' => 'cancelled',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 11000,
            'cost_total' => 5000,
            'internal_shipping_fee' => 999,
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

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-APRIL-OUTSIDE',
            'officialized_at' => '2026-04-02 08:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 2000,
            'cost_total' => 900,
            'internal_shipping_fee' => 100,
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
        $this->assertSame(234.0, (float) $rows['2026-03']['tax']);
        $this->assertSame(390.0, (float) $rows['2026-03']['damaged_goods']);
        $this->assertSame(1000.0, (float) $rows['2026-03']['exchange_profit_loss']);
        $this->assertSame(3000.0, (float) $rows['2026-03']['partial_delivery_profit_loss']);
        $this->assertSame(3256.0, (float) $rows['2026-03']['total_profit']);
        $this->assertSame(1500.0, (float) $response->json('summary.total_revenue'));
        $this->assertSame(1020.0, (float) $response->json('summary.shipping_fee'));
        $this->assertSame(234.0, (float) $response->json('summary.total_tax'));
        $this->assertSame(3256.0, (float) $response->json('summary.total_profit'));
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

    public function test_monthly_report_ads_spend_matches_sum_of_daily_report_raw_and_taxed_values(): void
    {
        $account = Account::query()->create([
            'name' => 'Monthly Ads Spend Test Account',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);

        Sanctum::actingAs($user);

        FinDailyReportConfig::query()->create([
            'return_rate' => 10,
            'packaging_fee' => 2000,
            'shipping_estimate_rate' => 10,
            'tax_rate' => 1.5,
            'fb_tax_rate' => 10,
            'google_tax_rate' => 5,
        ]);

        $headers = [
            'X-Account-Id' => (string) $account->id,
        ];

        DailyAdsSpend::query()->create([
            'date' => '2026-04-05',
            'amount' => 100,
        ]);

        DailyAdsSpend::query()->create([
            'date' => '2026-04-05',
            'amount' => 50,
            'account_id' => $account->id,
        ]);

        DailyAdsSpend::query()->create([
            'platform' => DailyAdsSpend::PLATFORM_GOOGLE,
            'date' => '2026-04-05',
            'amount' => 20,
        ]);

        DailyAdsSpend::query()->create([
            'date' => '2026-04-06',
            'amount' => 25,
        ]);

        $dailyResponse = $this->getJson('/api/finance/daily-pnl/report?start_date=2026-04-01&end_date=2026-04-30', $headers)
            ->assertOk();

        $dailyRows = collect($dailyResponse->json('data'))->keyBy('date');

        $this->assertSame(150.0, (float) $dailyRows['2026-04-05']['fb_ads_spend_raw']);
        $this->assertSame(165.0, (float) $dailyRows['2026-04-05']['fb_ads_spend']);
        $this->assertSame(20.0, (float) $dailyRows['2026-04-05']['google_ads_spend_raw']);
        $this->assertSame(21.0, (float) $dailyRows['2026-04-05']['google_ads_spend']);
        $this->assertSame(170.0, (float) $dailyRows['2026-04-05']['ads_spend_raw']);
        $this->assertSame(186.0, (float) $dailyRows['2026-04-05']['ads_spend']);
        $this->assertSame(25.0, (float) $dailyRows['2026-04-06']['ads_spend_raw']);
        $this->assertSame(27.5, (float) $dailyRows['2026-04-06']['ads_spend']);

        $monthlyResponse = $this->getJson('/api/finance/daily-pnl/monthly-report?start_date=2026-04-01&end_date=2026-04-30', $headers)
            ->assertOk();

        $monthRow = collect($monthlyResponse->json('data'))->firstWhere('key', '2026-04');

        $this->assertNotNull($monthRow);
        $this->assertSame(175.0, (float) ($monthRow['fb_ads_spend_raw'] ?? 0));
        $this->assertSame(192.5, (float) ($monthRow['fb_ads_spend'] ?? 0));
        $this->assertSame(20.0, (float) ($monthRow['google_ads_spend_raw'] ?? 0));
        $this->assertSame(21.0, (float) ($monthRow['google_ads_spend'] ?? 0));
        $this->assertSame(195.0, (float) ($monthRow['ads_spend_raw'] ?? 0));
        $this->assertSame(213.5, (float) ($monthRow['ads_spend'] ?? 0));
        $this->assertSame(
            round((float) collect($dailyResponse->json('data'))->sum('ads_spend_raw'), 2),
            round((float) ($monthRow['ads_spend_raw'] ?? 0), 2)
        );
        $this->assertSame(
            round((float) collect($dailyResponse->json('data'))->sum('ads_spend'), 2),
            round((float) ($monthRow['ads_spend'] ?? 0), 2)
        );
    }

    public function test_monthly_report_special_profit_columns_use_order_level_report_profit_total_by_month(): void
    {
        $account = Account::query()->create([
            'name' => 'Monthly Special Profit Source Test Account',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);

        Sanctum::actingAs($user);

        FinDailyReportConfig::query()->create([
            'return_rate' => 0,
            'packaging_fee' => 0,
            'shipping_estimate_rate' => 0,
            'tax_rate' => 0,
        ]);

        $headers = [
            'X-Account-Id' => (string) $account->id,
        ];

        $fallbackExchange = $this->createOrder($account, [
            'order_number' => 'MONTHLY-SPECIAL-MAR-FALLBACK',
            'officialized_at' => null,
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'total_price' => 0,
            'cost_total' => 0,
            'report_profit_total' => 150,
        ]);

        $fallbackExchange->timestamps = false;
        $fallbackExchange->forceFill([
            'created_at' => '2026-03-03 08:00:00',
            'updated_at' => '2026-03-03 08:00:00',
        ])->save();
        $fallbackExchange->timestamps = true;

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-SPECIAL-MAR-PARTIAL',
            'officialized_at' => '2026-03-10 08:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'total_price' => 0,
            'cost_total' => 0,
            'report_profit_total' => 75,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-SPECIAL-APR-EXCHANGE',
            'officialized_at' => '2026-04-02 10:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'total_price' => 0,
            'cost_total' => 0,
            'report_profit_total' => -20,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-SPECIAL-MAR-CANCELLED',
            'officialized_at' => '2026-03-12 08:00:00',
            'status' => 'canceled',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'total_price' => 0,
            'cost_total' => 0,
            'report_profit_total' => 999,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-SPECIAL-MAR-STANDARD',
            'officialized_at' => '2026-03-14 08:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 0,
            'cost_total' => 0,
            'report_profit_total' => 888,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-SPECIAL-MAR-DRAFT',
            'officialized_at' => '2026-03-16 08:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_DRAFT,
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'total_price' => 0,
            'cost_total' => 0,
            'report_profit_total' => 777,
        ]);

        $response = $this->getJson('/api/finance/daily-pnl/monthly-report?start_date=2026-03-01&end_date=2026-04-30', $headers)
            ->assertOk();

        $rows = collect($response->json('data'))->keyBy('key');

        $this->assertSame(150.0, (float) $rows['2026-03']['exchange_profit_loss']);
        $this->assertSame(75.0, (float) $rows['2026-03']['partial_delivery_profit_loss']);
        $this->assertSame(225.0, (float) $rows['2026-03']['total_profit']);
        $this->assertSame(-20.0, (float) $rows['2026-04']['exchange_profit_loss']);
        $this->assertSame(0.0, (float) $rows['2026-04']['partial_delivery_profit_loss']);
        $this->assertSame(-20.0, (float) $rows['2026-04']['total_profit']);
        $this->assertSame(130.0, (float) $response->json('summary.exchange_profit_loss'));
        $this->assertSame(75.0, (float) $response->json('summary.partial_delivery_profit_loss'));
        $this->assertSame(205.0, (float) $response->json('summary.total_profit'));
        $this->assertSame(102.5, (float) $response->json('summary.profit_per_house'));
    }

    public function test_monthly_report_total_profit_recomputes_from_monthly_cost_columns_for_each_row_and_summary(): void
    {
        $account = Account::query()->create([
            'name' => 'Monthly Total Profit Formula Test Account',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);

        Sanctum::actingAs($user);

        FinDailyReportConfig::query()->create([
            'return_rate' => 0,
            'packaging_fee' => 500,
            'shipping_estimate_rate' => 10,
            'tax_rate' => 1.5,
            'fb_tax_rate' => 10,
            'google_tax_rate' => 5,
        ]);

        $headers = [
            'X-Account-Id' => (string) $account->id,
        ];

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-FORMULA-MAR-STANDARD-1',
            'officialized_at' => '2026-03-02 09:00:00',
            'shipping_dispatched_at' => '2026-03-03 09:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 10000,
            'cost_total' => 4000,
            'internal_shipping_fee' => 800,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-FORMULA-MAR-STANDARD-2',
            'officialized_at' => '2026-03-04 11:00:00',
            'shipping_dispatched_at' => '2026-03-05 11:00:00',
            'status' => 'completed',
            'order_kind' => '',
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 2000,
            'cost_total' => 500,
            'external_delivery_meta' => ['shipping_cost' => 200],
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-FORMULA-MAR-EXCHANGE',
            'officialized_at' => '2026-03-06 08:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'total_price' => 0,
            'cost_total' => 0,
            'report_profit_total' => -300,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-FORMULA-MAR-PARTIAL',
            'officialized_at' => '2026-03-07 08:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'total_price' => 0,
            'cost_total' => 0,
            'report_profit_total' => 200,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-FORMULA-APR-STANDARD',
            'officialized_at' => '2026-04-08 10:00:00',
            'shipping_dispatched_at' => '2026-04-09 10:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 5000,
            'cost_total' => 2200,
            'internal_shipping_fee' => 300,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-FORMULA-APR-PROCESSING',
            'officialized_at' => '2026-04-10 10:00:00',
            'shipping_dispatched_at' => '2026-04-11 10:00:00',
            'status' => 'processing',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 4000,
            'cost_total' => 1000,
            'internal_shipping_fee' => 150,
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-FORMULA-APR-EXCHANGE',
            'officialized_at' => '2026-04-12 08:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'total_price' => 0,
            'cost_total' => 0,
            'report_profit_total' => 50,
        ]);

        InventoryDocument::query()->create([
            'account_id' => $account->id,
            'document_number' => 'DMG-FORMULA-202603-001',
            'type' => 'damaged',
            'document_date' => '2026-03-12',
            'status' => 'completed',
            'total_quantity' => 1,
            'total_amount' => 250,
        ]);

        InventoryDocument::query()->create([
            'account_id' => $account->id,
            'document_number' => 'DMG-FORMULA-202603-DRAFT',
            'type' => 'damaged',
            'document_date' => '2026-03-18',
            'status' => 'draft',
            'total_quantity' => 1,
            'total_amount' => 999,
        ]);

        InventoryDocument::query()->create([
            'account_id' => $account->id,
            'document_number' => 'DMG-FORMULA-202604-001',
            'type' => 'damaged',
            'document_date' => '2026-04-14',
            'status' => 'completed',
            'total_quantity' => 1,
            'total_amount' => 100,
        ]);

        FixedCostDailySnapshot::query()->create([
            'date' => '2026-03-15',
            'amount' => 1000,
        ]);

        FixedCostDailySnapshot::query()->create([
            'date' => '2026-04-15',
            'amount' => 500,
        ]);

        DailyAdsSpend::query()->create([
            'date' => '2026-03-02',
            'amount' => 100,
        ]);

        DailyAdsSpend::query()->create([
            'date' => '2026-03-04',
            'amount' => 50,
            'account_id' => $account->id,
        ]);

        DailyAdsSpend::query()->create([
            'platform' => DailyAdsSpend::PLATFORM_GOOGLE,
            'date' => '2026-03-04',
            'amount' => 30,
        ]);

        DailyAdsSpend::query()->create([
            'date' => '2026-04-08',
            'amount' => 20,
        ]);

        DailyAdsSpend::query()->create([
            'platform' => DailyAdsSpend::PLATFORM_GOOGLE,
            'date' => '2026-04-08',
            'amount' => 10,
        ]);

        $response = $this->getJson('/api/finance/daily-pnl/monthly-report?start_date=2026-03-01&end_date=2026-04-30', $headers)
            ->assertOk();

        $rows = collect($response->json('data'))->keyBy('key');

        $this->assertSame(2, (int) $rows['2026-03']['order_count']);
        $this->assertSame(12000.0, (float) $rows['2026-03']['revenue']);
        $this->assertSame(4500.0, (float) $rows['2026-03']['cost_actual']);
        $this->assertSame(1000.0, (float) $rows['2026-03']['shipping_fee']);
        $this->assertSame(250.0, (float) $rows['2026-03']['damaged_goods']);
        $this->assertSame(1000.0, (float) $rows['2026-03']['packaging_fee']);
        $this->assertSame(150.0, (float) $rows['2026-03']['fb_ads_spend_raw']);
        $this->assertSame(165.0, (float) $rows['2026-03']['fb_ads_spend']);
        $this->assertSame(30.0, (float) $rows['2026-03']['google_ads_spend_raw']);
        $this->assertSame(31.5, (float) $rows['2026-03']['google_ads_spend']);
        $this->assertSame(180.0, (float) $rows['2026-03']['ads_spend_raw']);
        $this->assertSame(196.5, (float) $rows['2026-03']['ads_spend']);
        $this->assertSame(165.0, (float) $rows['2026-03']['tax']);
        $this->assertSame(1000.0, (float) $rows['2026-03']['fixed_cost']);
        $this->assertSame(-300.0, (float) $rows['2026-03']['exchange_profit_loss']);
        $this->assertSame(200.0, (float) $rows['2026-03']['partial_delivery_profit_loss']);
        $this->assertSame(3788.5, (float) $rows['2026-03']['total_profit']);

        $this->assertSame(2, (int) $rows['2026-04']['order_count']);
        $this->assertSame(5000.0, (float) $rows['2026-04']['revenue']);
        $this->assertSame(2200.0, (float) $rows['2026-04']['cost_actual']);
        $this->assertSame(450.0, (float) $rows['2026-04']['shipping_fee']);
        $this->assertSame(100.0, (float) $rows['2026-04']['damaged_goods']);
        $this->assertSame(1000.0, (float) $rows['2026-04']['packaging_fee']);
        $this->assertSame(20.0, (float) $rows['2026-04']['fb_ads_spend_raw']);
        $this->assertSame(22.0, (float) $rows['2026-04']['fb_ads_spend']);
        $this->assertSame(10.0, (float) $rows['2026-04']['google_ads_spend_raw']);
        $this->assertSame(10.5, (float) $rows['2026-04']['google_ads_spend']);
        $this->assertSame(30.0, (float) $rows['2026-04']['ads_spend_raw']);
        $this->assertSame(32.5, (float) $rows['2026-04']['ads_spend']);
        $this->assertSame(70.5, (float) $rows['2026-04']['tax']);
        $this->assertSame(500.0, (float) $rows['2026-04']['fixed_cost']);
        $this->assertSame(50.0, (float) $rows['2026-04']['exchange_profit_loss']);
        $this->assertSame(0.0, (float) $rows['2026-04']['partial_delivery_profit_loss']);
        $this->assertSame(697.0, (float) $rows['2026-04']['total_profit']);

        $summary = $response->json('summary');

        $this->assertSame(4, (int) ($summary['order_count'] ?? 0));
        $this->assertSame(17000.0, (float) ($summary['revenue'] ?? 0));
        $this->assertSame(6700.0, (float) ($summary['cost_actual'] ?? 0));
        $this->assertSame(1450.0, (float) ($summary['shipping_fee'] ?? 0));
        $this->assertSame(350.0, (float) ($summary['damaged_goods'] ?? 0));
        $this->assertSame(2000.0, (float) ($summary['packaging_fee'] ?? 0));
        $this->assertSame(170.0, (float) ($summary['fb_ads_spend_raw'] ?? 0));
        $this->assertSame(187.0, (float) ($summary['fb_ads_spend'] ?? 0));
        $this->assertSame(40.0, (float) ($summary['google_ads_spend_raw'] ?? 0));
        $this->assertSame(42.0, (float) ($summary['google_ads_spend'] ?? 0));
        $this->assertSame(210.0, (float) ($summary['ads_spend_raw'] ?? 0));
        $this->assertSame(229.0, (float) ($summary['ads_spend'] ?? 0));
        $this->assertSame(235.5, (float) ($summary['tax'] ?? 0));
        $this->assertSame(1500.0, (float) ($summary['fixed_cost'] ?? 0));
        $this->assertSame(-250.0, (float) ($summary['exchange_profit_loss'] ?? 0));
        $this->assertSame(200.0, (float) ($summary['partial_delivery_profit_loss'] ?? 0));
        $this->assertSame(4485.5, (float) ($summary['total_profit'] ?? 0));
        $this->assertSame(2242.75, (float) ($summary['profit_per_house'] ?? 0));
    }

    public function test_monthly_report_drilldown_returns_exact_scope_for_all_clickable_metrics(): void
    {
        $account = Account::query()->create([
            'name' => 'Monthly Drilldown Test Account',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);

        Sanctum::actingAs($user);

        $headers = [
            'X-Account-Id' => (string) $account->id,
        ];

        $standardFirst = $this->createOrder($account, [
            'order_number' => 'MONTHLY-DRILLDOWN-STANDARD-1',
            'officialized_at' => '2026-04-05 09:00:00',
            'shipping_dispatched_at' => '2026-04-06 10:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 10000,
            'cost_total' => 4000,
            'report_revenue_total' => 9000,
            'report_cost_total' => 3500,
            'internal_shipping_fee' => 500,
        ]);

        $standardSecond = $this->createOrder($account, [
            'order_number' => 'MONTHLY-DRILLDOWN-STANDARD-2',
            'officialized_at' => '2026-04-20 09:00:00',
            'shipping_dispatched_at' => '2026-04-21 08:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 5000,
            'cost_total' => 2200,
            'report_revenue_total' => 4800,
            'report_cost_total' => 1800,
            'external_delivery_meta' => ['shipping_cost' => 200],
        ]);

        $processingOrder = $this->createOrder($account, [
            'order_number' => 'MONTHLY-DRILLDOWN-PROCESSING',
            'officialized_at' => '2026-04-22 11:00:00',
            'shipping_dispatched_at' => '2026-04-24 11:00:00',
            'status' => 'processing',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 7000,
            'cost_total' => 2600,
            'internal_shipping_fee' => 300,
        ]);

        $processingShipmentOrder = $this->createOrder($account, [
            'order_number' => 'MONTHLY-DRILLDOWN-PROCESSING-SHIPMENT',
            'officialized_at' => '2026-04-18 14:00:00',
            'status' => 'processing',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 100000,
            'cost_total' => 1000,
            'internal_shipping_fee' => 0,
        ]);
        $this->createShipment($account, $processingShipmentOrder, [
            'shipment_number' => 'MONTHLY-DRILLDOWN-SHIPMENT-LOWER',
            'shipment_status' => 'processing',
            'shipping_cost' => 2000,
        ]);

        $exchangeOrder = $this->createOrder($account, [
            'order_number' => 'MONTHLY-DRILLDOWN-EXCHANGE',
            'officialized_at' => '2026-04-10 08:00:00',
            'shipping_dispatched_at' => '2026-04-11 08:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'report_profit_total' => 250,
            'internal_shipping_fee' => 50,
        ]);

        $partialOrder = $this->createOrder($account, [
            'order_number' => 'MONTHLY-DRILLDOWN-PARTIAL',
            'officialized_at' => '2026-04-12 08:00:00',
            'shipping_dispatched_at' => '2026-04-13 09:00:00',
            'status' => 'completed',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'report_profit_total' => -100,
            'external_delivery_meta' => ['shipping_cost' => 75],
        ]);

        $this->createOrder($account, [
            'order_number' => 'MONTHLY-DRILLDOWN-CANCELLED',
            'officialized_at' => '2026-04-26 07:00:00',
            'shipping_dispatched_at' => '2026-04-26 12:00:00',
            'status' => 'cancelled',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 9999,
            'cost_total' => 9999,
            'report_revenue_total' => 9999,
            'report_cost_total' => 9999,
            'report_profit_total' => 9999,
            'internal_shipping_fee' => 999,
        ]);

        $revenueResponse = $this
            ->getJson('/api/finance/daily-pnl/monthly-report/drilldown?start_date=2026-04-01&end_date=2026-04-30&month=2026-04&metric=revenue', $headers)
            ->assertOk();

        $this->assertSame(13800.0, (float) $revenueResponse->json('data.value'));
        $this->assertEqualsCanonicalizing(
            [$standardFirst->id, $standardSecond->id],
            $revenueResponse->json('data.order_ids')
        );
        $this->assertEqualsCanonicalizing(
            [$standardFirst->id, $standardSecond->id],
            $revenueResponse->json('data.filters.order_ids')
        );
        $this->assertSame(['completed'], $revenueResponse->json('data.context_filters.status'));
        $this->assertSame([Order::TYPE_STANDARD], $revenueResponse->json('data.context_filters.order_type'));
        $this->assertSame('2026-04-01', $revenueResponse->json('data.context_filters.created_at_from'));
        $this->assertSame('2026-04-30', $revenueResponse->json('data.context_filters.created_at_to'));
        $this->assertSame('report_revenue_total', $revenueResponse->json('data.summary_field'));

        $costResponse = $this
            ->getJson('/api/finance/daily-pnl/monthly-report/drilldown?start_date=2026-04-01&end_date=2026-04-30&month=2026-04&metric=cost_actual', $headers)
            ->assertOk();

        $this->assertSame(5300.0, (float) $costResponse->json('data.value'));
        $this->assertEqualsCanonicalizing(
            [$standardFirst->id, $standardSecond->id],
            $costResponse->json('data.order_ids')
        );
        $this->assertEqualsCanonicalizing(
            [$standardFirst->id, $standardSecond->id],
            $costResponse->json('data.filters.order_ids')
        );
        $this->assertSame('report_cost_total', $costResponse->json('data.summary_field'));

        $shippingResponse = $this
            ->getJson('/api/finance/daily-pnl/monthly-report/drilldown?start_date=2026-04-01&end_date=2026-04-30&month=2026-04&metric=shipping_fee', $headers)
            ->assertOk();

        $this->assertSame(3125.0, (float) $shippingResponse->json('data.value'));
        $this->assertEqualsCanonicalizing(
            [$standardFirst->id, $standardSecond->id, $processingOrder->id, $processingShipmentOrder->id, $exchangeOrder->id, $partialOrder->id],
            $shippingResponse->json('data.order_ids')
        );
        $this->assertEqualsCanonicalizing(
            [$standardFirst->id, $standardSecond->id, $processingOrder->id, $processingShipmentOrder->id, $exchangeOrder->id, $partialOrder->id],
            $shippingResponse->json('data.filters.order_ids')
        );
        $this->assertSame(['cancelled', 'canceled'], $shippingResponse->json('data.context_filters.status_exclude'));
        $this->assertSame('2026-04-01', $shippingResponse->json('data.context_filters.created_at_from'));
        $this->assertSame('2026-04-30', $shippingResponse->json('data.context_filters.created_at_to'));

        $monthlyReportResponse = $this
            ->getJson('/api/finance/daily-pnl/monthly-report?start_date=2026-04-01&end_date=2026-04-30', $headers)
            ->assertOk();
        $monthlyRows = collect($monthlyReportResponse->json('data'))->keyBy('key');
        $this->assertSame(3125.0, (float) ($monthlyRows['2026-04']['shipping_fee'] ?? 0));

        $countResponse = $this
            ->getJson('/api/finance/daily-pnl/monthly-report/drilldown?start_date=2026-04-01&end_date=2026-04-30&month=2026-04&metric=order_count', $headers)
            ->assertOk();

        $this->assertSame(5, (int) $countResponse->json('data.value'));
        $this->assertEqualsCanonicalizing(
            [$standardFirst->id, $standardSecond->id, $processingOrder->id, $exchangeOrder->id, $partialOrder->id],
            $countResponse->json('data.order_ids')
        );
        $this->assertEqualsCanonicalizing(
            [$standardFirst->id, $standardSecond->id, $processingOrder->id, $exchangeOrder->id, $partialOrder->id],
            $countResponse->json('data.filters.order_ids')
        );
        $this->assertSame(['cancelled', 'canceled'], $countResponse->json('data.context_filters.status_exclude'));
        $this->assertSame('2026-04-01', $countResponse->json('data.context_filters.shipping_dispatched_from'));
        $this->assertSame('2026-04-30', $countResponse->json('data.context_filters.shipping_dispatched_to'));

        $exchangeResponse = $this
            ->getJson('/api/finance/daily-pnl/monthly-report/drilldown?start_date=2026-04-01&end_date=2026-04-30&month=2026-04&metric=exchange_profit_loss', $headers)
            ->assertOk();

        $this->assertSame(250.0, (float) $exchangeResponse->json('data.value'));
        $this->assertEqualsCanonicalizing([$exchangeOrder->id], $exchangeResponse->json('data.order_ids'));
        $this->assertSame([$exchangeOrder->id], $exchangeResponse->json('data.filters.order_ids'));
        $this->assertSame([Order::TYPE_EXCHANGE_RETURN], $exchangeResponse->json('data.context_filters.order_type'));
        $this->assertSame('report_profit_total', $exchangeResponse->json('data.summary_field'));

        $partialResponse = $this
            ->getJson('/api/finance/daily-pnl/monthly-report/drilldown?start_date=2026-04-01&end_date=2026-04-30&month=2026-04&metric=partial_delivery_profit_loss', $headers)
            ->assertOk();

        $this->assertSame(-100.0, (float) $partialResponse->json('data.value'));
        $this->assertEqualsCanonicalizing([$partialOrder->id], $partialResponse->json('data.order_ids'));
        $this->assertSame([$partialOrder->id], $partialResponse->json('data.filters.order_ids'));
        $this->assertSame([Order::TYPE_PARTIAL_DELIVERY], $partialResponse->json('data.context_filters.order_type'));

        $partialRangeRevenueResponse = $this
            ->getJson('/api/finance/daily-pnl/monthly-report/drilldown?start_date=2026-04-15&end_date=2026-04-30&month=2026-04&metric=revenue', $headers)
            ->assertOk();

        $this->assertSame(4800.0, (float) $partialRangeRevenueResponse->json('data.value'));
        $this->assertEqualsCanonicalizing([$standardSecond->id], $partialRangeRevenueResponse->json('data.order_ids'));
        $this->assertSame([$standardSecond->id], $partialRangeRevenueResponse->json('data.filters.order_ids'));
        $this->assertSame('2026-04-15', $partialRangeRevenueResponse->json('data.start_date'));
        $this->assertSame('2026-04-30', $partialRangeRevenueResponse->json('data.end_date'));

        $shippingOrderListResponse = $this
            ->withHeaders($headers)
            ->call('GET', '/api/orders', [
                'per_page' => 100,
                'order_ids' => $shippingResponse->json('data.filters.order_ids'),
            ]);

        $shippingOrderListResponse->assertOk();
        $this->assertSame(6, (int) $shippingOrderListResponse->json('summary.order_count'));
        $this->assertSame(3125.0, (float) $shippingOrderListResponse->json('summary.shipping_fee_total'));
        $this->assertSame(
            (float) $shippingResponse->json('data.value'),
            (float) $shippingOrderListResponse->json('summary.shipping_fee_total')
        );
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

    private function createShipment(Account $account, Order $order, array $attributes = []): Shipment
    {
        return Shipment::query()->create(array_merge([
            'account_id' => $account->id,
            'order_id' => $order->id,
            'shipment_number' => 'SHP-' . uniqid(),
            'shipment_status' => 'processing',
            'status' => 'processing',
            'shipping_cost' => 0,
        ], $attributes));
    }
}
