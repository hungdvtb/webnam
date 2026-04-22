<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
        return Order::query()->create(array_merge([
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
            'discount' => 0,
            'cost_total' => 80000,
            'profit_total' => 40000,
        ], $overrides));
    }
}
