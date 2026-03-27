<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\Shipment;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ShipmentStatsFilterTest extends TestCase
{
    use DatabaseTransactions;

    public function test_stats_follow_current_filters_and_return_grouped_totals(): void
    {
        [$account, $user] = $this->authenticate();

        $deliveredOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-STATS-DELIVERED',
            'status' => 'shipping',
            'total_price' => 100000,
        ]);
        $returningOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-STATS-RETURN',
            'status' => 'shipping',
            'total_price' => 150000,
        ]);
        $ignoredOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-STATS-IGNORED',
            'status' => 'shipping',
            'total_price' => 200000,
        ]);

        $this->createShipment($account, $deliveredOrder, $user, [
            'shipment_number' => 'VD-STATS-001',
            'shipment_status' => 'delivered',
            'status' => 'delivered',
            'cod_amount' => 100000,
            'shipping_cost' => 10000,
            'service_fee' => 5000,
            'actual_received_amount' => 85000,
            'reconciled_amount' => 84000,
            'reconciliation_status' => 'reconciled',
            'shipped_at' => now()->subDays(2),
            'delivered_at' => now()->subDay(),
            'reconciled_at' => now()->subHours(12),
        ]);

        $this->createShipment($account, $returningOrder, $user, [
            'shipment_number' => 'VD-STATS-002',
            'shipment_status' => 'returning',
            'status' => 'returning',
            'cod_amount' => 150000,
            'shipping_cost' => 0,
            'service_fee' => 0,
            'return_fee' => 5000,
            'actual_received_amount' => 145000,
            'reconciliation_status' => 'pending',
            'shipped_at' => now()->subDays(3),
            'returning_at' => now()->subDay(),
        ]);

        $this->createShipment($account, $ignoredOrder, $user, [
            'shipment_number' => 'VD-STATS-003',
            'shipment_status' => 'delivered',
            'status' => 'delivered',
            'cod_amount' => 200000,
            'shipping_cost' => 20000,
            'service_fee' => 0,
            'actual_received_amount' => 180000,
            'reconciliation_status' => 'pending',
            'shipped_at' => now()->subDays(45),
            'delivered_at' => now()->subDays(44),
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/shipments/stats?' . http_build_query([
                'shipment_status' => 'delivered,returning',
                'shipping_dispatched_from' => now()->subDays(10)->toDateString(),
                'shipping_dispatched_to' => now()->toDateString(),
            ]));

        $response->assertOk();

        $payload = $response->json();

        $this->assertSame(2, data_get($payload, 'counts.total_orders'));
        $this->assertSame(0, data_get($payload, 'counts.in_delivery'));
        $this->assertSame(1, data_get($payload, 'counts.delivered'));
        $this->assertSame(1, data_get($payload, 'counts.pending_return'));
        $this->assertSame(1, data_get($payload, 'counts.reconciliation_total'));
        $this->assertSame(1, data_get($payload, 'counts.reconciliation_done'));
        $this->assertSame(0, data_get($payload, 'counts.reconciliation_pending'));

        $this->assertSame(250000.0, (float) data_get($payload, 'amounts.total_revenue'));
        $this->assertSame(84000.0, (float) data_get($payload, 'amounts.carrier_collected'));
        $this->assertSame(20000.0, (float) data_get($payload, 'amounts.shipping_service_fees'));
        $this->assertSame(150000.0, (float) data_get($payload, 'amounts.pending_return_amount'));
        $this->assertSame(100.0, (float) data_get($payload, 'amounts.percentages.total_revenue'));
        $this->assertSame(33.6, (float) data_get($payload, 'amounts.percentages.carrier_collected'));
        $this->assertSame(8.0, (float) data_get($payload, 'amounts.percentages.shipping_service_fees'));
        $this->assertSame(60.0, (float) data_get($payload, 'amounts.percentages.pending_return_amount'));
    }

    public function test_stats_return_zeroed_groups_when_filter_has_no_data(): void
    {
        [$account, $user] = $this->authenticate();

        $order = $this->createOrder($account, $user, [
            'order_number' => 'OR-STATS-ZERO',
            'status' => 'new',
            'total_price' => 90000,
        ]);

        $this->createShipment($account, $order, $user, [
            'shipment_number' => 'VD-STATS-ZERO',
            'shipment_status' => 'created',
            'status' => 'created',
            'cod_amount' => 90000,
            'actual_received_amount' => 90000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/shipments/stats?' . http_build_query([
                'shipment_status' => 'canceled',
                'customer_name' => 'Khong ton tai',
            ]));

        $response->assertOk();

        $payload = $response->json();

        $this->assertSame(0, data_get($payload, 'counts.total_orders'));
        $this->assertSame(0, data_get($payload, 'counts.reconciliation_total'));
        $this->assertSame(0.0, (float) data_get($payload, 'amounts.total_revenue'));
        $this->assertSame(0.0, (float) data_get($payload, 'amounts.carrier_collected'));
        $this->assertSame(0.0, (float) data_get($payload, 'amounts.shipping_service_fees'));
        $this->assertSame(0.0, (float) data_get($payload, 'amounts.pending_return_amount'));
        $this->assertSame(0.0, (float) data_get($payload, 'amounts.percentages.total_revenue'));
        $this->assertSame(0.0, (float) data_get($payload, 'amounts.percentages.pending_return_amount'));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Shipment Stats Account',
            'domain' => 'shipment-stats-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'shipment-stats-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::factory()->create([
            'name' => 'Shipment Stats Admin',
            'email' => 'shipment-stats-' . Str::lower(Str::random(6)) . '@example.com',
            'is_admin' => true,
        ]);

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
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'OR' . random_int(10000, 99999) . 'ST',
            'order_kind' => Order::KIND_OFFICIAL,
            'total_price' => 100000,
            'status' => 'new',
            'customer_name' => 'Khach shipment stats',
            'customer_email' => 'stats-' . Str::lower(Str::random(5)) . '@example.com',
            'customer_phone' => '090' . str_pad((string) random_int(1000000, 9999999), 7, '0', STR_PAD_LEFT),
            'shipping_address' => '123 Nguyen Trai',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'notes' => 'Order for shipment stats',
            'source' => 'Website',
            'type' => 'Le',
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => 100000,
            'shipping_status_source' => 'manual',
        ], $overrides));
    }

    private function createShipment(Account $account, Order $order, User $user, array $overrides = []): Shipment
    {
        return Shipment::query()->create(array_merge([
            'account_id' => $account->id,
            'order_id' => $order->id,
            'order_code' => $order->order_number,
            'shipment_number' => 'VD-' . now()->format('Ymd') . '-' . Str::upper(Str::random(4)),
            'tracking_number' => 'TRACK-' . Str::upper(Str::random(6)),
            'carrier_tracking_code' => 'TRACK-' . Str::upper(Str::random(6)),
            'carrier_code' => 'viettel_post',
            'carrier_name' => 'Viettel Post',
            'channel' => 'manual',
            'customer_name' => $order->customer_name,
            'customer_phone' => $order->customer_phone,
            'customer_address' => $order->shipping_address,
            'customer_ward' => $order->ward,
            'customer_district' => $order->district,
            'customer_province' => $order->province,
            'status' => 'created',
            'shipment_status' => 'created',
            'order_status_snapshot' => $order->status,
            'cod_amount' => (float) $order->total_price,
            'shipping_cost' => 0,
            'service_fee' => 0,
            'return_fee' => 0,
            'insurance_fee' => 0,
            'other_fee' => 0,
            'reconciled_amount' => 0,
            'actual_received_amount' => (float) $order->total_price,
            'reconciliation_status' => 'pending',
            'created_by' => $user->id,
        ], $overrides));
    }
}
