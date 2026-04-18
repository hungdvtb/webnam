<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\OrderSupplementItem;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class OrderReturnFollowupTest extends TestCase
{
    use RefreshDatabase;

    public function test_return_followup_endpoint_groups_old_orders_and_sorts_oldest_first(): void
    {
        [$account, $user] = $this->authenticate();

        $pendingReturnOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-FOLLOW-PENDING-0001',
            'status' => 'pending_return',
            'shipping_dispatched_at' => Carbon::now()->subDays(14),
        ]);
        $this->createStatusLog($pendingReturnOrder, 'shipping', 'pending_return', Carbon::now()->subDays(12));

        $exchangeReturnOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-FOLLOW-EXCHANGE-0001',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'shipping',
            'shipping_dispatched_at' => Carbon::now()->subDays(15),
        ]);
        $this->createSupplementItem($account, $exchangeReturnOrder);

        $partialDeliveryOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-FOLLOW-PARTIAL-0001',
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'status' => 'shipping',
            'shipping_dispatched_at' => Carbon::now()->subDays(13),
        ]);

        $exchangeWithoutReturnGoods = $this->createOrder($account, $user, [
            'order_number' => 'OR-FOLLOW-EXCHANGE-0002',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'shipping',
            'shipping_dispatched_at' => Carbon::now()->subDays(18),
        ]);

        $freshPendingReturnOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-FOLLOW-PENDING-0002',
            'status' => 'pending_return',
            'shipping_dispatched_at' => Carbon::now()->subDays(8),
        ]);
        $this->createStatusLog($freshPendingReturnOrder, 'shipping', 'pending_return', Carbon::now()->subDays(8));

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders/return-followups?per_page=50');

        $response->assertOk();

        $data = collect($response->json('data'));
        $returnedIds = $data->pluck('id')->map(fn ($id) => (int) $id)->all();

        $this->assertEquals(
            [
                $exchangeReturnOrder->id,
                $partialDeliveryOrder->id,
                $pendingReturnOrder->id,
            ],
            $returnedIds
        );

        $this->assertNotContains($exchangeWithoutReturnGoods->id, $returnedIds);
        $this->assertNotContains($freshPendingReturnOrder->id, $returnedIds);

        $this->assertSame(1, $response->json('meta.counts.pending_return'));
        $this->assertSame(1, $response->json('meta.counts.exchange_return'));
        $this->assertSame(1, $response->json('meta.counts.partial_delivery'));
        $this->assertSame(3, $response->json('meta.counts.all'));

        $this->assertSame('exchange_return', $data[0]['followup_category']);
        $this->assertSame('partial_delivery', $data[1]['followup_category']);
        $this->assertSame('pending_return', $data[2]['followup_category']);
        $this->assertSame('dispatched', $data[0]['relevant_date_mode']);
        $this->assertSame('status_changed', $data[2]['relevant_date_mode']);
    }

    public function test_exchange_order_already_in_pending_return_is_only_reported_in_pending_filter(): void
    {
        [$account, $user] = $this->authenticate();

        $exchangePendingReturnOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-FOLLOW-EXCHANGE-PENDING-0001',
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'pending_return',
            'shipping_dispatched_at' => Carbon::now()->subDays(16),
        ]);
        $this->createSupplementItem($account, $exchangePendingReturnOrder);
        $this->createStatusLog($exchangePendingReturnOrder, 'shipping', 'pending_return', Carbon::now()->subDays(11));

        $exchangeResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders/return-followups?category=exchange_return&per_page=50');

        $exchangeResponse->assertOk();
        $this->assertSame([], collect($exchangeResponse->json('data'))->pluck('id')->all());

        $pendingResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders/return-followups?category=pending_return&per_page=50');

        $pendingResponse->assertOk();
        $pendingData = collect($pendingResponse->json('data'));

        $this->assertSame([$exchangePendingReturnOrder->id], $pendingData->pluck('id')->map(fn ($id) => (int) $id)->all());
        $this->assertSame('pending_return', $pendingData->first()['followup_category']);
    }

    public function test_return_followup_endpoint_applies_search_terms(): void
    {
        [$account, $user] = $this->authenticate();

        $matchedOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-FOLLOW-SEARCH-0001',
            'status' => 'pending_return',
            'customer_name' => 'Le Tim Kiem',
            'customer_phone' => '0912345678',
            'shipping_tracking_code' => 'search-track-001',
            'shipping_dispatched_at' => Carbon::now()->subDays(18),
        ]);
        $this->createStatusLog($matchedOrder, 'shipping', 'pending_return', Carbon::now()->subDays(12));

        $otherOrder = $this->createOrder($account, $user, [
            'order_number' => 'OR-FOLLOW-SEARCH-0002',
            'status' => 'pending_return',
            'customer_name' => 'Nguoi Khac',
            'customer_phone' => '0988888888',
            'shipping_tracking_code' => 'other-track-002',
            'shipping_dispatched_at' => Carbon::now()->subDays(18),
        ]);
        $this->createStatusLog($otherOrder, 'shipping', 'pending_return', Carbon::now()->subDays(12));

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders/return-followups?per_page=50&search=Le%20Tim,search-track-001');

        $response->assertOk();

        $data = collect($response->json('data'));
        $this->assertSame([$matchedOrder->id], $data->pluck('id')->map(fn ($id) => (int) $id)->all());
        $this->assertSame(1, $response->json('meta.counts.pending_return'));
        $this->assertSame(1, $response->json('meta.counts.all'));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Order Followup ' . Str::upper(Str::random(4)),
            'domain' => 'order-followup-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'order-followup-' . Str::lower(Str::random(6)),
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
            'order_number' => 'OR-FOLLOW-' . Str::upper(Str::random(6)),
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'status' => 'new',
            'customer_name' => 'Khach theo doi',
            'customer_phone' => '090' . random_int(1000000, 9999999),
            'shipping_address' => 'Dia chi test',
            'total_price' => 150000,
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 90000,
            'profit_total' => 60000,
        ], $overrides));
    }

    private function createSupplementItem(Account $account, Order $order): void
    {
        OrderSupplementItem::query()->create([
            'account_id' => $account->id,
            'order_id' => $order->id,
            'product_name_snapshot' => 'Hang khach tra',
            'product_sku_snapshot' => 'RETURN-GOOD-001',
            'quantity' => 1,
            'price' => 50000,
            'cost_price' => 30000,
            'total_price' => 50000,
            'total_cost' => 30000,
        ]);
    }

    private function createStatusLog(Order $order, string $fromStatus, string $toStatus, Carbon $createdAt): void
    {
        DB::table('order_status_logs')->insert([
            'order_id' => $order->id,
            'from_status' => $fromStatus,
            'to_status' => $toStatus,
            'source' => 'system',
            'changed_by' => null,
            'reason' => 'Test followup',
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);
    }
}
