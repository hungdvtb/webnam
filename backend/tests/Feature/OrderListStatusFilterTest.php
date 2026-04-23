<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderListStatusFilterTest extends TestCase
{
    use RefreshDatabase;

    public function test_order_list_can_filter_multiple_statuses_from_comma_separated_query(): void
    {
        [$account, $user] = $this->authenticate();

        $newOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-STATUS-NEW-0001',
            'status' => 'new',
        ]);
        $processingOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-STATUS-PROCESSING-0001',
            'status' => 'processing',
        ]);
        $shippedOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-STATUS-SHIPPED-0001',
            'status' => 'shipped',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?per_page=100&status=processing,shipped');

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
        $returnedStatuses = collect($response->json('data'))
            ->pluck('status')
            ->unique()
            ->values()
            ->all();

        $this->assertNotContains($newOrder->id, $returnedIds);
        $this->assertContains($processingOrder->id, $returnedIds);
        $this->assertContains($shippedOrder->id, $returnedIds);
        $this->assertEqualsCanonicalizing(['processing', 'shipped'], $returnedStatuses);
    }

    public function test_order_list_can_filter_multiple_statuses_from_array_query_values(): void
    {
        [$account, $user] = $this->authenticate();

        $newOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-STATUS-NEW-ARR-0001',
            'status' => 'new',
        ]);
        $processingOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-STATUS-PROCESSING-ARR-0001',
            'status' => 'processing',
        ]);
        $shippedOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-STATUS-SHIPPED-ARR-0001',
            'status' => 'shipped',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->call('GET', '/api/orders', [
                'per_page' => 100,
                'status' => ['processing', 'shipped'],
            ]);

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
        $returnedStatuses = collect($response->json('data'))
            ->pluck('status')
            ->unique()
            ->values()
            ->all();

        $this->assertNotContains($newOrder->id, $returnedIds);
        $this->assertContains($processingOrder->id, $returnedIds);
        $this->assertContains($shippedOrder->id, $returnedIds);
        $this->assertEqualsCanonicalizing(['processing', 'shipped'], $returnedStatuses);
    }

    public function test_multi_status_filter_still_combines_with_other_filters(): void
    {
        [$account, $user] = $this->authenticate();

        $matchingOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-STATUS-COMBINE-0001',
            'status' => 'processing',
            'customer_name' => 'Khach Lan',
        ]);
        $otherNameOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-STATUS-COMBINE-0002',
            'status' => 'shipped',
            'customer_name' => 'Khach Minh',
        ]);
        $otherStatusOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-STATUS-COMBINE-0003',
            'status' => 'cancelled',
            'customer_name' => 'Khach Lan',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?per_page=100&status=processing,shipped&customer_name=lan');

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertContains($matchingOrder->id, $returnedIds);
        $this->assertNotContains($otherNameOrder->id, $returnedIds);
        $this->assertNotContains($otherStatusOrder->id, $returnedIds);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Order Status Filter ' . Str::upper(Str::random(4)),
            'domain' => 'order-status-filter-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'order-status-filter-' . Str::lower(Str::random(6)),
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
            'order_number' => 'OR-STATUS-' . Str::upper(Str::random(6)),
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
