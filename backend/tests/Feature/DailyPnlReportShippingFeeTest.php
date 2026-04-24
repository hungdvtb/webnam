<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FinDailyReportConfig;
use App\Models\Order;
use App\Models\Shipment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class DailyPnlReportShippingFeeTest extends TestCase
{
    use RefreshDatabase;

    public function test_daily_report_shipping_fee_matches_order_list_total_ship_for_same_date_and_filters(): void
    {
        $account = Account::query()->create([
            'name' => 'Daily PnL Shipping Test Account',
            'domain' => 'daily-pnl-shipping.local',
            'subdomain' => 'daily-pnl-shipping',
            'status' => 'active',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);

        Sanctum::actingAs($user, ['*']);

        FinDailyReportConfig::query()->create([
            'return_rate' => 0,
            'packaging_fee' => 0,
            'shipping_estimate_rate' => 10,
            'shipping_fee_type' => '%',
            'tax_rate' => 1.5,
        ]);

        $headers = [
            'X-Account-Id' => (string) $account->id,
            'Accept' => 'application/json',
        ];

        $actualShipOrder = $this->createOrder($account, [
            'order_number' => 'DPNL-SHIP-ACTUAL',
            'status' => 'processing',
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 1000,
            'cost_total' => 400,
            'internal_shipping_fee' => 40,
            'created_at' => '2026-04-20 08:00:00',
            'updated_at' => '2026-04-20 08:00:00',
            'officialized_at' => '2026-04-20 08:00:00',
        ]);

        $estimatedShipOrder = $this->createOrder($account, [
            'order_number' => 'DPNL-SHIP-ESTIMATED',
            'status' => 'processing',
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 2000,
            'cost_total' => 700,
            'internal_shipping_fee' => 0,
            'created_at' => '2026-04-20 09:00:00',
            'updated_at' => '2026-04-20 09:00:00',
            'officialized_at' => '2026-04-20 09:00:00',
        ]);

        $activeShipmentOrder = $this->createOrder($account, [
            'order_number' => 'DPNL-SHIP-ACTIVE-SHIPMENT',
            'status' => 'processing',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'total_price' => 3000,
            'cost_total' => 1000,
            'report_profit_total' => 150,
            'created_at' => '2026-04-20 10:00:00',
            'updated_at' => '2026-04-20 10:00:00',
            'officialized_at' => '2026-04-20 10:00:00',
        ]);
        $this->createShipment($account, $activeShipmentOrder, 150);

        $outsideDeliveryOrder = $this->createOrder($account, [
            'order_number' => 'DPNL-SHIP-OUTSIDE',
            'status' => 'completed',
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'total_price' => 4000,
            'cost_total' => 1200,
            'report_profit_total' => 200,
            'external_delivery_meta' => ['shipping_cost' => 80],
            'created_at' => '2026-04-20 11:00:00',
            'updated_at' => '2026-04-20 11:00:00',
            'officialized_at' => '2026-04-20 11:00:00',
        ]);

        $legacyStandardOrder = $this->createOrder($account, [
            'order_number' => 'DPNL-SHIP-LEGACY-STANDARD',
            'status' => 'processing',
            'order_type' => '',
            'total_price' => 500,
            'cost_total' => 150,
            'internal_shipping_fee' => 0,
            'created_at' => '2026-04-20 12:00:00',
            'updated_at' => '2026-04-20 12:00:00',
            'officialized_at' => '2026-04-20 12:00:00',
        ]);

        $this->createOrder($account, [
            'order_number' => 'DPNL-SHIP-CANCELLED',
            'status' => 'cancelled',
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 9999,
            'cost_total' => 1000,
            'internal_shipping_fee' => 999,
            'created_at' => '2026-04-20 13:00:00',
            'updated_at' => '2026-04-20 13:00:00',
            'officialized_at' => '2026-04-20 13:00:00',
        ]);

        $this->createOrder($account, [
            'order_number' => 'DPNL-SHIP-OTHER-DATE',
            'status' => 'processing',
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 1200,
            'cost_total' => 300,
            'internal_shipping_fee' => 75,
            'created_at' => '2026-04-21 09:00:00',
            'updated_at' => '2026-04-21 09:00:00',
            'officialized_at' => '2026-04-21 09:00:00',
        ]);

        $expectedAllShipping = 40.0 + 100.0 + 150.0 + 80.0 + 25.0;
        $expectedFilteredShipping = 40.0 + 100.0 + 150.0 + 25.0;

        $orderListResponse = $this->withHeaders($headers)
            ->getJson('/api/orders?per_page=100&created_at_from=2026-04-20&created_at_to=2026-04-20')
            ->assertOk();

        $dailyReportResponse = $this->withHeaders($headers)
            ->getJson('/api/finance/daily-pnl/report?start_date=2026-04-20&end_date=2026-04-20')
            ->assertOk();

        $dailyRow = collect($dailyReportResponse->json('data'))->firstWhere('date', '2026-04-20');

        $this->assertNotNull($dailyRow);
        $this->assertSame($expectedAllShipping, (float) $orderListResponse->json('summary.shipping_fee_total'));
        $this->assertSame($expectedAllShipping, (float) ($dailyRow['shipping_fee'] ?? 0));
        $this->assertSame($expectedAllShipping, (float) ($dailyRow['shipping_out'] ?? 0));
        $this->assertSame(0.0, (float) ($dailyRow['shipping_return'] ?? 0));

        $filteredOrderListResponse = $this->withHeaders($headers)
            ->getJson('/api/orders?per_page=100&created_at_from=2026-04-20&created_at_to=2026-04-20&status=processing&order_type=standard,exchange_return')
            ->assertOk();

        $filteredDailyReportResponse = $this->withHeaders($headers)
            ->getJson('/api/finance/daily-pnl/report?start_date=2026-04-20&end_date=2026-04-20&status=processing&order_type=standard,exchange_return')
            ->assertOk();

        $filteredDailyRow = collect($filteredDailyReportResponse->json('data'))->firstWhere('date', '2026-04-20');

        $this->assertNotNull($filteredDailyRow);
        $this->assertSame($expectedFilteredShipping, (float) $filteredOrderListResponse->json('summary.shipping_fee_total'));
        $this->assertSame($expectedFilteredShipping, (float) ($filteredDailyRow['shipping_fee'] ?? 0));
        $this->assertSame($expectedFilteredShipping, (float) ($filteredDailyRow['shipping_out'] ?? 0));
        $this->assertSame(0.0, (float) ($filteredDailyRow['shipping_return'] ?? 0));
        $this->assertSame(4, (int) $filteredOrderListResponse->json('summary.order_count'));
        $this->assertSame(4, (int) ($filteredDailyRow['order_count'] ?? 0));
    }

    private function createOrder(Account $account, array $overrides = []): Order
    {
        $timestampOverrides = array_intersect_key($overrides, array_flip([
            'created_at',
            'updated_at',
            'officialized_at',
            'draft_created_at',
        ]));

        $order = Order::query()->create(array_merge([
            'account_id' => $account->id,
            'order_number' => 'DPNL-' . Str::upper(Str::random(8)),
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'status' => 'processing',
            'customer_name' => 'Khach test',
            'customer_phone' => '090' . random_int(1000000, 9999999),
            'shipping_address' => 'Dia chi test',
            'total_price' => 0,
            'shipping_fee' => 0,
            'internal_shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => 0,
            'report_profit_total' => 0,
        ], $overrides));

        if ($timestampOverrides !== []) {
            DB::table('orders')
                ->where('id', $order->id)
                ->update($timestampOverrides);

            $order = $order->fresh();
        }

        return $order;
    }

    private function createShipment(Account $account, Order $order, float $shippingCost): Shipment
    {
        return Shipment::query()->create([
            'account_id' => $account->id,
            'order_id' => $order->id,
            'shipment_number' => 'SHP-' . Str::upper(Str::random(10)),
            'status' => 'processing',
            'shipment_status' => 'created',
            'shipping_cost' => $shippingCost,
        ]);
    }
}
