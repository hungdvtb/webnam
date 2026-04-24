<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\Shipment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class OrderListSummaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_order_list_summary_uses_filtered_orders_and_is_stable_across_pagination(): void
    {
        [$account, $user] = $this->authenticate();

        $directShippingOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-SUM-DIRECT-0001',
            'customer_name' => 'Lan Anh',
            'status' => 'delivered',
            'total_price' => 120000,
            'discount' => 20000,
            'internal_shipping_fee' => 15000,
        ]);

        $outsideDeliveryOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-SUM-OUTSIDE-0001',
            'customer_name' => 'Lan Phuong',
            'status' => 'delivered',
            'total_price' => 230000,
            'discount' => 30000,
            'internal_shipping_fee' => 0,
            'external_delivery_meta' => [
                'shipping_cost' => 25000,
            ],
        ]);

        $shipmentBackedOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-SUM-SHIPMENT-0001',
            'customer_name' => 'Lan Chi',
            'status' => 'delivered',
            'total_price' => 340000,
            'discount' => 40000,
            'internal_shipping_fee' => 0,
        ]);

        $this->createShipment($account, $shipmentBackedOrder, [
            'shipment_number' => 'SHP-SUM-0001',
            'shipment_status' => 'processing',
            'shipping_cost' => 35000,
        ]);

        $this->createOrder($account, $user, [
            'order_number' => 'OR-SUM-EXCLUDED-STATUS-0001',
            'customer_name' => 'Lan Status',
            'status' => 'processing',
            'total_price' => 410000,
            'discount' => 10000,
            'internal_shipping_fee' => 45000,
        ]);

        $this->createOrder($account, $user, [
            'order_number' => 'OR-SUM-EXCLUDED-NAME-0001',
            'customer_name' => 'Minh Tran',
            'status' => 'delivered',
            'total_price' => 520000,
            'discount' => 20000,
            'internal_shipping_fee' => 55000,
        ]);

        $expectedOrderCount = 3;
        $expectedTotalPrice = 690000.0;
        $expectedShippingFee = 75000.0;
        $expectedGoodsTotal = 780000.0;

        $firstPageResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?status=delivered&customer_name=lan&sort_by=order_number&sort_order=asc&per_page=1&page=2');

        $firstPageResponse->assertOk();
        $this->assertCount(1, $firstPageResponse->json('data'));
        $this->assertSame($expectedOrderCount, (int) $firstPageResponse->json('total'));
        $this->assertSame($expectedOrderCount, (int) $firstPageResponse->json('summary.order_count'));
        $this->assertSame($expectedTotalPrice, (float) $firstPageResponse->json('summary.total_price'));
        $this->assertSame($expectedShippingFee, (float) $firstPageResponse->json('summary.shipping_fee'));
        $this->assertSame($expectedGoodsTotal, (float) $firstPageResponse->json('summary.goods_total'));

        $secondPageResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?status=delivered&customer_name=lan&sort_by=order_number&sort_order=asc&per_page=2&page=1');

        $secondPageResponse->assertOk();
        $this->assertCount(2, $secondPageResponse->json('data'));
        $this->assertSame($expectedOrderCount, (int) $secondPageResponse->json('summary.order_count'));
        $this->assertSame($expectedTotalPrice, (float) $secondPageResponse->json('summary.total_price'));
        $this->assertSame($expectedShippingFee, (float) $secondPageResponse->json('summary.shipping_fee'));
        $this->assertSame($expectedGoodsTotal, (float) $secondPageResponse->json('summary.goods_total'));

        $returnedIds = collect($secondPageResponse->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertContains($directShippingOrder->id, $returnedIds);
        $this->assertContains($outsideDeliveryOrder->id, $returnedIds);
        $this->assertNotContains($shipmentBackedOrder->id, $returnedIds);
    }

    public function test_order_list_summary_includes_report_totals_and_honors_status_exclude_filter(): void
    {
        [$account, $user] = $this->authenticate();

        $reportRevenueOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-SUM-REPORT-REV-0001',
            'status' => 'completed',
            'total_price' => 120000,
            'cost_total' => 70000,
            'report_revenue_total' => 105000,
            'report_cost_total' => 68000,
            'report_profit_total' => 37000,
        ]);

        $reportProfitOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-SUM-REPORT-PROFIT-0001',
            'status' => 'processing',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'total_price' => 0,
            'cost_total' => 0,
            'report_profit_total' => -5000,
        ]);

        $excludedOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-SUM-REPORT-EXCLUDED-0001',
            'status' => 'cancelled',
            'total_price' => 999999,
            'cost_total' => 888888,
            'report_revenue_total' => 777777,
            'report_cost_total' => 666666,
            'report_profit_total' => 555555,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?per_page=100&status_exclude=cancelled');

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertContains($reportRevenueOrder->id, $returnedIds);
        $this->assertContains($reportProfitOrder->id, $returnedIds);
        $this->assertNotContains($excludedOrder->id, $returnedIds);
        $this->assertSame(105000.0, (float) $response->json('summary.report_revenue_total'));
        $this->assertSame(68000.0, (float) $response->json('summary.report_cost_total'));
        $this->assertSame(32000.0, (float) $response->json('summary.report_profit_total'));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Order Summary ' . Str::upper(Str::random(4)),
            'domain' => 'order-summary-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'order-summary-' . Str::lower(Str::random(6)),
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
            'order_number' => 'OR-SUM-' . Str::upper(Str::random(6)),
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'status' => 'new',
            'customer_name' => 'Khach test',
            'customer_phone' => '090' . random_int(1000000, 9999999),
            'shipping_address' => 'Dia chi test',
            'total_price' => 120000,
            'shipping_fee' => 0,
            'internal_shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 80000,
            'profit_total' => 40000,
            'external_delivery_meta' => null,
        ], $overrides));
    }

    private function createShipment(Account $account, Order $order, array $overrides = []): Shipment
    {
        return Shipment::query()->create(array_merge([
            'account_id' => $account->id,
            'order_id' => $order->id,
            'shipment_number' => 'SHP-' . Str::upper(Str::random(8)),
            'carrier_name' => 'Viettel Post',
            'shipment_status' => 'processing',
            'shipping_cost' => 0,
        ], $overrides));
    }
}
