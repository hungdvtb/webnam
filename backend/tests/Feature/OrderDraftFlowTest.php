<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderDraftFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_store_and_update_draft_order_keep_manual_shipping_source(): void
    {
        [$account] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham draft',
            'sku' => 'DRAFT-001',
            'price' => 185000,
        ]);

        $storeResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach draft',
                'customer_phone' => '0912345678',
                'customer_email' => 'draft@example.com',
                'shipping_address' => '123 Nguyen Trai',
                'notes' => 'Ban nhap dau tien',
                'source' => 'Website',
                'type' => 'Le',
                'shipment_status' => 'Chua giao',
                'items' => [
                    [
                        'product_id' => $product->id,
                        'quantity' => 2,
                        'price' => 185000,
                    ],
                ],
            ]);

        $storeResponse
            ->assertCreated()
            ->assertJsonPath('order_kind', Order::KIND_DRAFT)
            ->assertJsonPath('shipping_status_source', 'manual');

        $order = Order::query()->findOrFail((int) $storeResponse->json('id'));

        $this->assertSame(Order::KIND_DRAFT, $order->order_kind);
        $this->assertSame('manual', $order->shipping_status_source);
        $this->assertNull($order->shipping_tracking_code);

        $updateResponse = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$order->id}", [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach draft da sua',
                'notes' => 'Ban nhap da cap nhat',
                'items' => [
                    [
                        'product_id' => $product->id,
                        'quantity' => 3,
                        'price' => 190000,
                    ],
                ],
            ]);

        $updateResponse
            ->assertOk()
            ->assertJsonPath('id', $order->id)
            ->assertJsonPath('shipping_status_source', 'manual');

        $order->refresh();

        $this->assertSame(Order::KIND_DRAFT, $order->order_kind);
        $this->assertSame('manual', $order->shipping_status_source);
        $this->assertNull($order->shipping_status);
        $this->assertNull($order->shipping_carrier_code);
        $this->assertNull($order->shipping_tracking_code);
        $this->assertSame('Khach draft da sua', $order->customer_name);
        $this->assertCount(1, $order->items);
        $this->assertSame(3, (int) $order->items()->first()->quantity);
    }

    public function test_convert_official_order_to_draft_resets_shipping_summary_and_uses_manual_source(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham convert',
            'sku' => 'CONVERT-001',
            'price' => 210000,
        ]);

        $order = Order::query()->create([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'OR' . random_int(10000, 99999) . 'A0',
            'order_kind' => Order::KIND_OFFICIAL,
            'total_price' => 210000,
            'status' => 'shipping',
            'customer_name' => 'Khach official',
            'customer_email' => 'official@example.com',
            'customer_phone' => '0987654321',
            'shipping_address' => '456 Le Loi',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'notes' => 'Don dang giao',
            'source' => 'Website',
            'type' => 'Le',
            'shipment_status' => 'Shipped',
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => 210000,
            'shipping_status' => 'waiting_pickup',
            'shipping_synced_at' => now(),
            'shipping_status_source' => 'carrier',
            'shipping_carrier_code' => 'viettel_post',
            'shipping_carrier_name' => 'Viettel Post',
            'shipping_tracking_code' => 'TRACK-001',
            'shipping_dispatched_at' => now(),
        ]);

        OrderItem::query()->create([
            'order_id' => $order->id,
            'account_id' => $account->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => 1,
            'price' => 210000,
            'cost_price' => 0,
            'cost_total' => 0,
            'profit_total' => 210000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$order->id}/convert", [
                'target_kind' => Order::KIND_DRAFT,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('id', $order->id)
            ->assertJsonPath('order_kind', Order::KIND_DRAFT)
            ->assertJsonPath('shipping_status_source', 'manual');

        $order->refresh();

        $this->assertSame(Order::KIND_DRAFT, $order->order_kind);
        $this->assertSame('manual', $order->shipping_status_source);
        $this->assertNull($order->shipping_status);
        $this->assertNull($order->shipping_synced_at);
        $this->assertNull($order->shipping_carrier_code);
        $this->assertNull($order->shipping_carrier_name);
        $this->assertNull($order->shipping_tracking_code);
        $this->assertNull($order->shipping_dispatched_at);
        $this->assertSame($order->id, (int) $order->converted_from_order_id);
        $this->assertSame(Order::KIND_OFFICIAL, $order->converted_from_kind);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Order Test Account',
            'domain' => 'orders-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'orders-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Order Admin',
            'email' => 'order-admin-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function createProduct(Account $account, array $overrides = []): Product
    {
        $name = $overrides['name'] ?? ('San pham ' . Str::lower(Str::random(5)));
        $sku = $overrides['sku'] ?? ('SKU-' . Str::upper(Str::random(6)));

        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(5)),
            'sku' => $sku,
            'price' => 100000,
            'stock_quantity' => 0,
            'status' => true,
        ], $overrides));
    }
}
