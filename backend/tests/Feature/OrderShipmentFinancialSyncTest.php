<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\Shipment;
use App\Support\OrderCodAdjustmentSystemNote;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderShipmentFinancialSyncTest extends TestCase
{
    use RefreshDatabase;

    public function test_updating_shipment_cod_resyncs_order_total_and_discount(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'Bo su tap gom cao cap',
            'sku' => 'SYNC-COD-001',
            'price' => 11420000,
        ]);
        $order = $this->createOfficialOrder($account, $user, $product, [
            'total_price' => 10000000,
            'shipping_fee' => 350000,
            'discount' => 1420000,
            'profit_total' => 10000000,
        ]);
        $shipment = $this->createShipment($order, $user, [
            'cod_amount' => 10000000,
            'shipping_cost' => 443000,
            'actual_received_amount' => 9557000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/shipments/{$shipment->id}", [
                'cod_amount' => 9500000,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('cod_amount', 9500000)
            ->assertJsonPath('order.total_price', 9500000)
            ->assertJsonPath('order.discount', 1920000);

        $order->refresh();
        $shipment->refresh();

        $this->assertSame(9500000.0, (float) $shipment->cod_amount);
        $this->assertSame(9057000.0, (float) $shipment->actual_received_amount);
        $this->assertSame(9500000.0, (float) $order->total_price);
        $this->assertSame(350000.0, (float) $order->shipping_fee);
        $this->assertSame(1920000.0, (float) $order->discount);
        $this->assertSame(9500000.0, (float) $order->profit_total);
        $this->assertSame(9500000.0, (float) ($order->report_revenue_total ?? 0));
    }

    public function test_updating_order_discount_resyncs_active_shipment_cod(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'Bo su tap gom cao cap',
            'sku' => 'SYNC-ORDER-001',
            'price' => 11420000,
        ]);
        $order = $this->createOfficialOrder($account, $user, $product, [
            'total_price' => 10000000,
            'shipping_fee' => 350000,
            'discount' => 1420000,
            'profit_total' => 10000000,
        ]);
        $shipment = $this->createShipment($order, $user, [
            'cod_amount' => 10000000,
            'shipping_cost' => 443000,
            'actual_received_amount' => 9557000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$order->id}", [
                'discount' => 2000000,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('total_price', 9420000)
            ->assertJsonPath('discount', 2000000);

        $order->refresh();
        $shipment->refresh();

        $this->assertSame(9420000.0, (float) $order->total_price);
        $this->assertSame(350000.0, (float) $order->shipping_fee);
        $this->assertSame(2000000.0, (float) $order->discount);
        $this->assertSame(9420000.0, (float) $shipment->cod_amount);
        $this->assertSame(8977000.0, (float) $shipment->actual_received_amount);
    }

    public function test_updating_shipment_cod_appends_single_system_note_and_removes_it_when_adjustment_is_cleared(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'Bo su tap ghi chu COD',
            'sku' => 'SYNC-NOTE-001',
            'price' => 10000000,
        ]);
        $order = $this->createOfficialOrder($account, $user, $product, [
            'total_price' => 10000000,
            'discount' => 0,
            'notes' => 'Nhan vien ghi chu tay',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'cod_amount' => 10000000,
            'shipping_cost' => 0,
            'actual_received_amount' => 10000000,
        ]);

        $expectedSystemNote = OrderCodAdjustmentSystemNote::build(500000);
        $expectedCombinedNote = "Nhan vien ghi chu tay\n{$expectedSystemNote}";

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/shipments/{$shipment->id}", [
                'cod_amount' => 9500000,
            ])
            ->assertOk()
            ->assertJsonPath('order.total_price', 9500000)
            ->assertJsonPath('order.discount', 500000)
            ->assertJsonPath('order.notes', $expectedCombinedNote);

        $order->refresh();
        $this->assertSame($expectedCombinedNote, $order->notes);
        $this->assertSame(1, substr_count((string) $order->notes, (string) $expectedSystemNote));

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/shipments/{$shipment->id}", [
                'cod_amount' => 9500000,
            ])
            ->assertOk();

        $order->refresh();
        $this->assertSame($expectedCombinedNote, $order->notes);
        $this->assertSame(1, substr_count((string) $order->notes, (string) $expectedSystemNote));

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/shipments/{$shipment->id}", [
                'cod_amount' => 10000000,
            ])
            ->assertOk()
            ->assertJsonPath('order.total_price', 10000000)
            ->assertJsonPath('order.discount', 0)
            ->assertJsonPath('order.notes', 'Nhan vien ghi chu tay');

        $order->refresh();
        $this->assertSame('Nhan vien ghi chu tay', $order->notes);
    }

    public function test_updating_shipment_cod_only_notes_the_additional_adjustment_beyond_existing_manual_discount(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'Bo su tap ghi chu them COD',
            'sku' => 'SYNC-NOTE-003',
            'price' => 10000000,
        ]);
        $order = $this->createOfficialOrder($account, $user, $product, [
            'total_price' => 9700000,
            'discount' => 300000,
            'notes' => 'Nhan vien da giam tay 300k',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'cod_amount' => 9700000,
            'shipping_cost' => 0,
            'actual_received_amount' => 9700000,
        ]);

        $expectedSystemNote = OrderCodAdjustmentSystemNote::build(200000, true);
        $expectedCombinedNote = "Nhan vien da giam tay 300k\n{$expectedSystemNote}";

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/shipments/{$shipment->id}", [
                'cod_amount' => 9500000,
            ])
            ->assertOk()
            ->assertJsonPath('order.total_price', 9500000)
            ->assertJsonPath('order.discount', 500000)
            ->assertJsonPath('order.notes', $expectedCombinedNote);

        $order->refresh();
        $this->assertSame(500000.0, (float) $order->discount);
        $this->assertSame($expectedCombinedNote, $order->notes);
        $this->assertSame(1, substr_count((string) $order->notes, (string) $expectedSystemNote));
    }

    public function test_order_save_preserves_manual_note_and_refreshes_system_note_for_active_shipment(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'Bo su tap cap nhat ghi chu COD',
            'sku' => 'SYNC-NOTE-002',
            'price' => 10000000,
        ]);
        $order = $this->createOfficialOrder($account, $user, $product, [
            'total_price' => 10000000,
            'discount' => 0,
            'notes' => 'Ghi chu cu',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'cod_amount' => 10000000,
            'shipping_cost' => 0,
            'actual_received_amount' => 10000000,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/shipments/{$shipment->id}", [
                'cod_amount' => 9500000,
            ])
            ->assertOk();

        $expected500kNote = "Nhan vien bo sung\n" . OrderCodAdjustmentSystemNote::build(500000);
        $expectedManualAndSystemNote = "Nhan vien bo sung\n" . OrderCodAdjustmentSystemNote::build(500000, true);

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$order->id}", [
                'notes' => 'Nhan vien bo sung',
            ])
            ->assertOk()
            ->assertJsonPath('notes', $expected500kNote)
            ->assertJsonPath('discount', 500000);

        $order->refresh();
        $shipment->refresh();

        $this->assertSame($expected500kNote, $order->notes);
        $this->assertSame(9500000.0, (float) $shipment->cod_amount);

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$order->id}", [
                'notes' => 'Nhan vien bo sung',
                'discount' => 700000,
            ])
            ->assertOk()
            ->assertJsonPath('notes', $expectedManualAndSystemNote)
            ->assertJsonPath('discount', 700000)
            ->assertJsonPath('total_price', 9300000);

        $order->refresh();
        $shipment->refresh();

        $this->assertSame(9300000.0, (float) $order->total_price);
        $this->assertSame(9300000.0, (float) $shipment->cod_amount);
        $this->assertSame($expectedManualAndSystemNote, $order->notes);
    }

    public function test_creating_shipment_syncs_internal_shipping_fee_without_changing_order_total(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'Bo su tap tao van don',
            'sku' => 'SYNC-SHIPMENT-001',
            'price' => 11420000,
        ]);
        $order = $this->createOfficialOrder($account, $user, $product, [
            'total_price' => 10000000,
            'shipping_fee' => 280000,
            'discount' => 1420000,
            'profit_total' => 10000000,
            'report_revenue_total' => 10000000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/shipments', [
                'order_id' => $order->id,
                'carrier_name' => 'Viettel Post',
                'tracking_number' => 'TRACK-SYNC-NEW-001',
                'shipping_cost' => 44000,
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('shipping_cost', 44000)
            ->assertJsonPath('order.total_price', 10000000)
            ->assertJsonPath('order.internal_shipping_fee', 44000);

        $order->refresh();

        $this->assertSame(10000000.0, (float) $order->total_price);
        $this->assertSame(280000.0, (float) $order->shipping_fee);
        $this->assertSame(44000.0, (float) $order->internal_shipping_fee);
        $this->assertSame(1420000.0, (float) $order->discount);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Order Shipment Sync Account',
            'domain' => 'sync-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'sync-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Order Shipment Sync Admin',
            'email' => 'sync-' . Str::lower(Str::random(6)) . '@example.com',
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
        $itemPrice = (float) ($overrides['item_price'] ?? $product->price ?? 11420000);
        unset($overrides['item_price']);

        $order = Order::query()->create(array_merge([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'OR' . random_int(10000, 99999) . 'A0',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 10000000,
            'status' => 'new',
            'customer_name' => 'Khach dong bo COD',
            'customer_email' => 'order-sync-' . Str::lower(Str::random(5)) . '@example.com',
            'customer_phone' => '090' . str_pad((string) random_int(1000000, 9999999), 7, '0', STR_PAD_LEFT),
            'shipping_address' => '123 Test Street',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'notes' => 'Don test dong bo COD',
            'source' => 'Website',
            'type' => 'Le',
            'shipment_status' => null,
            'shipping_fee' => 0,
            'internal_shipping_fee' => 0,
            'discount' => 1420000,
            'cost_total' => 0,
            'profit_total' => 10000000,
            'report_revenue_total' => 10000000,
            'report_cost_total' => 0,
            'report_profit_total' => 10000000,
            'shipping_status_source' => 'manual',
        ], $overrides));

        OrderItem::query()->create([
            'order_id' => $order->id,
            'account_id' => $account->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => 1,
            'price' => $itemPrice,
            'cost_price' => 0,
            'cost_total' => 0,
            'profit_total' => $itemPrice,
        ]);

        return $order;
    }

    private function createShipment(Order $order, User $user, array $overrides = []): Shipment
    {
        return Shipment::query()->create(array_merge([
            'account_id' => $order->account_id,
            'order_id' => $order->id,
            'order_code' => $order->order_number,
            'shipment_number' => 'VD-' . now()->format('Ymd') . '-' . Str::upper(Str::random(4)),
            'tracking_number' => 'TRACK-' . Str::upper(Str::random(8)),
            'carrier_tracking_code' => 'TRACK-' . Str::upper(Str::random(8)),
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
            'other_fee' => 0,
            'actual_received_amount' => (float) $order->total_price,
            'created_by' => $user->id,
            'shipped_at' => now(),
        ], $overrides));
    }
}
