<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class OrderListOrderTypeFilterTest extends TestCase
{
    use RefreshDatabase;

    public function test_bootstrap_includes_new_system_statuses(): void
    {
        [$account] = $this->authenticate();

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders/bootstrap?mode=list');

        $response->assertOk();

        $statusCodes = collect($response->json('order_statuses'))
            ->pluck('code')
            ->all();

        $this->assertContains('exchange_completed', $statusCodes);
        $this->assertContains('partial_delivery', $statusCodes);
    }

    public function test_order_list_can_filter_multiple_order_types(): void
    {
        [$account, $user] = $this->authenticate();

        $standardOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-STD-0001',
            'order_type' => Order::TYPE_STANDARD,
        ]);
        $exchangeOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-EX-0001',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
        ]);
        $partialOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-PD-0001',
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?per_page=100&order_type=exchange_return,partial_delivery');

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
        $returnedTypes = collect($response->json('data'))
            ->pluck('order_type')
            ->all();

        $this->assertNotContains($standardOrder->id, $returnedIds);
        $this->assertContains($exchangeOrder->id, $returnedIds);
        $this->assertContains($partialOrder->id, $returnedIds);
        $this->assertEqualsCanonicalizing(
            [Order::TYPE_EXCHANGE_RETURN, Order::TYPE_PARTIAL_DELIVERY],
            array_values(array_unique($returnedTypes))
        );
    }

    public function test_order_list_can_filter_multiple_order_types_from_array_query_values(): void
    {
        [$account, $user] = $this->authenticate();

        $standardOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-STD-ARR-0001',
            'order_type' => Order::TYPE_STANDARD,
        ]);
        $exchangeOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-EX-ARR-0001',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
        ]);
        $partialOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-PD-ARR-0001',
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->call('GET', '/api/orders', [
                'per_page' => 100,
                'order_type' => [Order::TYPE_EXCHANGE_RETURN, Order::TYPE_PARTIAL_DELIVERY],
            ]);

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
        $returnedTypes = collect($response->json('data'))
            ->pluck('order_type')
            ->all();

        $this->assertNotContains($standardOrder->id, $returnedIds);
        $this->assertContains($exchangeOrder->id, $returnedIds);
        $this->assertContains($partialOrder->id, $returnedIds);
        $this->assertEqualsCanonicalizing(
            [Order::TYPE_EXCHANGE_RETURN, Order::TYPE_PARTIAL_DELIVERY],
            array_values(array_unique($returnedTypes))
        );
    }

    public function test_standard_order_type_filter_includes_legacy_blank_values(): void
    {
        [$account, $user] = $this->authenticate();

        $standardOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-STD-0002',
            'order_type' => Order::TYPE_STANDARD,
        ]);
        $legacyBlankOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-LEGACY-0001',
            'order_type' => '',
        ]);
        $exchangeOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-EX-0002',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?per_page=100&order_type=standard');

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
        $returnedTypes = collect($response->json('data'))
            ->pluck('order_type')
            ->all();

        $this->assertContains($standardOrder->id, $returnedIds);
        $this->assertContains($legacyBlankOrder->id, $returnedIds);
        $this->assertNotContains($exchangeOrder->id, $returnedIds);
        $this->assertEqualsCanonicalizing(
            [Order::TYPE_STANDARD],
            array_values(array_unique($returnedTypes))
        );
    }

    public function test_order_type_filter_combines_with_other_filters_and_updates_summary(): void
    {
        [$account, $user] = $this->authenticate();

        $standardOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-COMBINE-STD-0001',
            'order_type' => Order::TYPE_STANDARD,
            'status' => 'processing',
            'customer_name' => 'Khach Lan',
            'customer_phone' => '0901234567',
            'total_price' => 100000,
            'discount' => 0,
            'internal_shipping_fee' => 5000,
            'created_at' => '2026-04-20 08:00:00',
            'updated_at' => '2026-04-20 08:00:00',
            'officialized_at' => '2026-04-20 08:00:00',
        ]);
        $exchangeOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-COMBINE-EX-0001',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'processing',
            'customer_name' => 'Khach Lan',
            'customer_phone' => '0901234567',
            'total_price' => 200000,
            'discount' => 0,
            'internal_shipping_fee' => 12000,
            'created_at' => '2026-04-20 09:00:00',
            'updated_at' => '2026-04-20 09:00:00',
            'officialized_at' => '2026-04-20 09:00:00',
        ]);
        $partialOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-COMBINE-PD-0001',
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'status' => 'processing',
            'customer_name' => 'Khach Lan',
            'customer_phone' => '0901234567',
            'total_price' => 300000,
            'discount' => 0,
            'internal_shipping_fee' => 18000,
            'created_at' => '2026-04-20 10:00:00',
            'updated_at' => '2026-04-20 10:00:00',
            'officialized_at' => '2026-04-20 10:00:00',
        ]);
        $differentStatusOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-COMBINE-EXCLUDED-STATUS-0001',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'completed',
            'customer_name' => 'Khach Lan',
            'customer_phone' => '0901234567',
            'total_price' => 400000,
            'discount' => 0,
            'internal_shipping_fee' => 24000,
            'created_at' => '2026-04-20 11:00:00',
            'updated_at' => '2026-04-20 11:00:00',
            'officialized_at' => '2026-04-20 11:00:00',
        ]);
        $differentDateOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-COMBINE-EXCLUDED-DATE-0001',
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'status' => 'processing',
            'customer_name' => 'Khach Lan',
            'customer_phone' => '0901234567',
            'total_price' => 500000,
            'discount' => 0,
            'internal_shipping_fee' => 30000,
            'created_at' => '2026-04-21 09:00:00',
            'updated_at' => '2026-04-21 09:00:00',
            'officialized_at' => '2026-04-21 09:00:00',
        ]);
        $differentCustomerOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-TYPE-COMBINE-EXCLUDED-CUSTOMER-0001',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'processing',
            'customer_name' => 'Khach Minh',
            'customer_phone' => '0907654321',
            'total_price' => 600000,
            'discount' => 0,
            'internal_shipping_fee' => 36000,
            'created_at' => '2026-04-20 12:00:00',
            'updated_at' => '2026-04-20 12:00:00',
            'officialized_at' => '2026-04-20 12:00:00',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?per_page=100&order_type=exchange_return,partial_delivery&status=processing&customer_name=lan&customer_phone=0901234567&created_at_from=2026-04-20&created_at_to=2026-04-20');

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertNotContains($standardOrder->id, $returnedIds);
        $this->assertContains($exchangeOrder->id, $returnedIds);
        $this->assertContains($partialOrder->id, $returnedIds);
        $this->assertNotContains($differentStatusOrder->id, $returnedIds);
        $this->assertNotContains($differentDateOrder->id, $returnedIds);
        $this->assertNotContains($differentCustomerOrder->id, $returnedIds);

        $this->assertSame(2, (int) $response->json('summary.order_count'));
        $this->assertSame(500000.0, (float) $response->json('summary.total_price'));
        $this->assertSame(30000.0, (float) $response->json('summary.shipping_fee_recorded'));
        $this->assertSame(30000.0, (float) $response->json('summary.shipping_fee_total'));
        $this->assertSame(160000.0, (float) $response->json('summary.goods_total'));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Order Type Filter ' . Str::upper(Str::random(4)),
            'domain' => 'order-type-filter-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'order-type-filter-' . Str::lower(Str::random(6)),
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
        $timestampOverrides = array_intersect_key($overrides, array_flip([
            'created_at',
            'updated_at',
            'officialized_at',
            'draft_created_at',
        ]));

        $order = Order::query()->create(array_merge([
            'account_id' => $account->id,
            'user_id' => $user->id,
            'order_number' => 'OR-TYPE-' . Str::upper(Str::random(6)),
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
        ], $overrides));

        if (!empty($timestampOverrides)) {
            DB::table('orders')
                ->where('id', $order->id)
                ->update($timestampOverrides);

            $order = $order->fresh();
        }

        return $order;
    }
}
