<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\Shipment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderQuickDispatchOutsideDeliveryTest extends TestCase
{
    use RefreshDatabase;

    public function test_quick_dispatch_outside_delivery_marks_order_as_shipping_without_creating_shipment(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham gui ngoai',
            'sku' => 'OUTSIDE-DELIVERY-001',
            'price' => 280000,
        ]);
        $order = $this->createOfficialOrder($account, $user, $product);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/quick-dispatch', [
                'shipments' => [[
                    'order_id' => $order->id,
                    'dispatch_mode' => 'outside_delivery',
                    'external_delivery_type' => 'xe_khach',
                    'external_delivery_contact' => 'Nha xe Phuong Trang',
                    'shipping_cost' => 45000,
                    'external_note' => 'Giao hang tai ben xe',
                ]],
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('success_count', 1)
            ->assertJsonPath('failed_count', 0)
            ->assertJsonPath('results.0.success', true)
            ->assertJsonPath('results.0.dispatch_mode', 'outside_delivery')
            ->assertJsonPath('results.0.shipment_id', null)
            ->assertJsonPath('results.0.tracking_number', null);

        $order->refresh();

        $this->assertSame('shipping', (string) $order->status);
        $this->assertSame('shipped', (string) $order->shipment_status);
        $this->assertSame('out_for_delivery', (string) $order->shipping_status);
        $this->assertSame('manual', (string) $order->shipping_status_source);
        $this->assertSame('outside_delivery', (string) $order->shipping_carrier_code);
        $this->assertStringContainsString('Gửi ngoài', (string) $order->shipping_carrier_name);
        $this->assertNull($order->shipping_tracking_code);
        $this->assertNotNull($order->shipping_dispatched_at);
        $this->assertSame('xe_khach', data_get($order->external_delivery_meta, 'delivery_type'));
        $this->assertSame('Nha xe Phuong Trang', data_get($order->external_delivery_meta, 'contact_name'));
        $this->assertSame(45000.0, (float) data_get($order->external_delivery_meta, 'shipping_cost'));
        $this->assertSame('Giao hang tai ben xe', data_get($order->external_delivery_meta, 'note'));
        $this->assertSame(0, Shipment::query()->where('order_id', $order->id)->count());
        $this->assertDatabaseHas('order_status_logs', [
            'order_id' => $order->id,
            'source' => 'manual_outside_dispatch',
            'to_status' => 'shipping',
            'to_shipping_status' => 'out_for_delivery',
        ]);
    }

    public function test_cancel_dispatch_clears_outside_delivery_marker_without_shipments(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham rollback gui ngoai',
            'sku' => 'OUTSIDE-ROLLBACK-001',
        ]);
        $order = $this->createOfficialOrder($account, $user, $product, [
            'order_number' => 'OR99001A0',
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/quick-dispatch', [
                'shipments' => [[
                    'order_id' => $order->id,
                    'dispatch_mode' => 'outside_delivery',
                    'external_delivery_type' => 'tu_giao',
                    'external_delivery_contact' => 'Anh Nam',
                    'shipping_cost' => 20000,
                ]],
            ])
            ->assertCreated()
            ->assertJsonPath('success_count', 1);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/dispatch/cancel', [
                'order_ids' => [$order->id],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('success_count', 1)
            ->assertJsonPath('failed_count', 0)
            ->assertJsonPath('results.0.success', true);

        $order->refresh();

        $this->assertSame('new', (string) $order->status);
        $this->assertNull($order->shipment_status);
        $this->assertNull($order->shipping_status);
        $this->assertNull($order->shipping_tracking_code);
        $this->assertNull($order->shipping_carrier_code);
        $this->assertNull($order->shipping_carrier_name);
        $this->assertNull($order->shipping_dispatched_at);
        $this->assertNull($order->external_delivery_meta);
        $this->assertSame(0, Shipment::query()->where('order_id', $order->id)->count());
        $this->assertDatabaseHas('order_status_logs', [
            'order_id' => $order->id,
            'source' => 'dispatch_cancel',
            'to_status' => 'new',
        ]);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Outside Delivery Account',
            'domain' => 'outside-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'outside-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Outside Delivery Admin',
            'email' => 'outside-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function createOfficialOrder(Account $account, User $user, Product $product, array $overrides = []): Order
    {
        $order = Order::query()->create(array_merge([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'OR' . random_int(10000, 99999) . 'A0',
            'order_kind' => Order::KIND_OFFICIAL,
            'total_price' => (float) ($product->price ?? 0),
            'status' => 'new',
            'customer_name' => 'Khach gui ngoai',
            'customer_email' => 'outside-order-' . Str::lower(Str::random(5)) . '@example.com',
            'customer_phone' => '090' . str_pad((string) random_int(1000000, 9999999), 7, '0', STR_PAD_LEFT),
            'shipping_address' => '456 Le Loi',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'notes' => 'Don test gui ngoai',
            'source' => 'Website',
            'type' => 'Le',
            'shipment_status' => null,
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => (float) ($product->price ?? 0),
            'shipping_status_source' => 'manual',
        ], $overrides));

        OrderItem::query()->create([
            'order_id' => $order->id,
            'account_id' => $account->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => 1,
            'price' => (float) ($product->price ?? 0),
            'cost_price' => 0,
            'cost_total' => 0,
            'profit_total' => (float) ($product->price ?? 0),
        ]);

        return $order;
    }
}
