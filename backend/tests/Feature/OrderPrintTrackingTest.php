<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\OrderStatusLog;
use App\Models\User;
use App\Support\OrderStatusCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderPrintTrackingTest extends TestCase
{
    use RefreshDatabase;

    public function test_mark_printed_counts_every_reprint_and_only_changes_status_once(): void
    {
        [$account, $user] = $this->authenticate();

        $order = $this->createOrder($account, $user, [
            'status' => 'new',
            'order_kind' => Order::KIND_OFFICIAL,
            'print_count' => 0,
            'last_printed_at' => null,
        ]);

        $firstResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/mark-printed', [
                'ids' => [$order->id],
            ]);

        $firstResponse
            ->assertOk()
            ->assertJsonPath('recorded_count', 1)
            ->assertJsonPath('updated_count', 1)
            ->assertJsonPath('preserved_count', 0)
            ->assertJsonPath('ignored_count', 0)
            ->assertJsonPath("print_counts.{$order->id}", 1);

        $order->refresh();

        $this->assertSame(OrderStatusCatalog::PRINTED_CODE, (string) $order->status);
        $this->assertSame(1, (int) $order->print_count);
        $this->assertNotNull($order->last_printed_at);
        $this->assertDatabaseHas('order_status_logs', [
            'order_id' => $order->id,
            'from_status' => 'new',
            'to_status' => OrderStatusCatalog::PRINTED_CODE,
        ]);

        $secondResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/mark-printed', [
                'ids' => [$order->id],
            ]);

        $secondResponse
            ->assertOk()
            ->assertJsonPath('recorded_count', 1)
            ->assertJsonPath('updated_count', 0)
            ->assertJsonPath('preserved_count', 1)
            ->assertJsonPath('ignored_count', 0)
            ->assertJsonPath("print_counts.{$order->id}", 2);

        $order->refresh();

        $this->assertSame(OrderStatusCatalog::PRINTED_CODE, (string) $order->status);
        $this->assertSame(2, (int) $order->print_count);
        $this->assertSame(
            1,
            OrderStatusLog::query()
                ->where('order_id', $order->id)
                ->where('to_status', OrderStatusCatalog::PRINTED_CODE)
                ->count()
        );
    }

    public function test_mark_printed_tracks_draft_orders_without_overwriting_status(): void
    {
        [$account, $user] = $this->authenticate();

        $order = $this->createOrder($account, $user, [
            'order_kind' => Order::KIND_DRAFT,
            'status' => 'new',
            'print_count' => 0,
            'last_printed_at' => null,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/mark-printed', [
                'ids' => [$order->id],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('recorded_count', 1)
            ->assertJsonPath('updated_count', 0)
            ->assertJsonPath('preserved_count', 0)
            ->assertJsonPath('ignored_count', 1)
            ->assertJsonPath("print_counts.{$order->id}", 1);

        $order->refresh();

        $this->assertSame(Order::KIND_DRAFT, (string) $order->order_kind);
        $this->assertSame('new', (string) $order->status);
        $this->assertSame(1, (int) $order->print_count);
        $this->assertNotNull($order->last_printed_at);
    }

    public function test_order_list_and_detail_include_print_tracking_fields(): void
    {
        [$account, $user] = $this->authenticate();
        $printedAt = now()->startOfSecond();

        $order = $this->createOrder($account, $user, [
            'status' => OrderStatusCatalog::PRINTED_CODE,
            'print_count' => 2,
            'last_printed_at' => $printedAt,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders')
            ->assertOk()
            ->assertJsonPath('data.0.id', $order->id)
            ->assertJsonPath('data.0.print_count', 2);

        $this
            ->withHeaders($this->headers($account))
            ->getJson("/api/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('id', $order->id)
            ->assertJsonPath('print_count', 2);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Order Print Account',
            'domain' => 'order-print-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'order-print-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Order Print Admin',
            'email' => 'order-print-' . Str::lower(Str::random(6)) . '@example.com',
            'password' => 'password',
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
            'order_number' => 'OR' . random_int(10000, 99999) . 'A0',
            'order_kind' => Order::KIND_OFFICIAL,
            'total_price' => 150000,
            'status' => 'new',
            'customer_name' => 'Khach in don',
            'customer_email' => 'print-order@example.com',
            'customer_phone' => '0901234567',
            'shipping_address' => '123 Nguyen Trai',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'notes' => 'Don in test',
            'source' => 'Website',
            'type' => 'Le',
            'shipment_status' => 'Chua giao',
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => 150000,
            'shipping_status_source' => 'manual',
            'print_count' => 0,
            'last_printed_at' => null,
        ], $overrides));
    }
}
