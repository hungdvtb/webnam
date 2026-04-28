<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryBatch;
use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use App\Services\Inventory\InventoryService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderPricingAdjustmentTest extends TestCase
{
    use RefreshDatabase;

    public function test_storing_order_allows_negative_discount_and_ignores_shipping_fee_in_total(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham phu thu',
            'sku' => 'SURCHARGE-ORDER-001',
            'price' => 200000,
        ]);
        $this->createBatch($account, $product, 5, 80000, 'pricing-adjustment');

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_OFFICIAL,
                'customer_name' => 'Khach phu thu',
                'customer_phone' => '0912345678',
                'customer_email' => 'pricing-adjustment@example.com',
                'shipping_address' => '123 Nguyen Trai',
                'province' => 'Tinh test',
                'district' => 'Huyen test',
                'ward' => 'Xa test',
                'notes' => 'Don test phu thu',
                'source' => 'Website',
                'type' => 'Le',
                'shipment_status' => 'Chua giao',
                'shipping_fee' => 50000,
                'discount' => -30000,
                'items' => [[
                    'product_id' => $product->id,
                    'quantity' => 2,
                    'price' => 200000,
                ]],
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('shipping_fee', 50000)
            ->assertJsonPath('discount', -30000)
            ->assertJsonPath('total_price', 430000)
            ->assertJsonPath('report_revenue_total', 430000)
            ->assertJsonPath('internal_shipping_fee', 0);

        $order = Order::query()->findOrFail((int) $response->json('id'));

        $this->assertSame(430000.0, (float) $order->total_price);
        $this->assertSame(50000.0, (float) $order->shipping_fee);
        $this->assertSame(-30000.0, (float) $order->discount);
        $this->assertSame(430000.0, (float) ($order->report_revenue_total ?? 0));
    }

    public function test_partial_delivery_order_automatically_moves_return_value_into_discount_and_notes(): void
    {
        [$account] = $this->authenticate();
        $mainProduct = $this->createProduct($account, [
            'name' => 'Don giao 1 phan',
            'sku' => 'PD-MAIN-001',
            'price' => 2200000,
        ]);
        $returnProduct = $this->createProduct($account, [
            'name' => 'Bo that bao',
            'sku' => 'PD-RETURN-001',
            'price' => 100000,
            'cost_price' => 40000,
        ]);

        $this->createBatch($account, $mainProduct, 5, 1000000, 'partial-delivery-main');

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_OFFICIAL,
                'order_type' => Order::TYPE_PARTIAL_DELIVERY,
                'customer_name' => 'Khach giao 1 phan',
                'customer_phone' => '0911111111',
                'customer_email' => 'partial-delivery@example.com',
                'shipping_address' => '456 Nguyen Hue',
                'province' => 'Tinh test',
                'district' => 'Huyen test',
                'ward' => 'Xa test',
                'notes' => 'Ghi chu tay cua nhan vien',
                'source' => 'Website',
                'type' => 'Le',
                'shipment_status' => 'Chua giao',
                'shipping_fee' => 0,
                'manual_discount' => 0,
                'discount' => 300000,
                'items' => [[
                    'product_id' => $mainProduct->id,
                    'quantity' => 3,
                    'price' => 2200000,
                ]],
                'supplement_items' => [[
                    'product_id' => $returnProduct->id,
                    'quantity' => 3,
                    'price' => 100000,
                    'cost_price' => 40000,
                    'name' => 'Bo that bao',
                    'sku' => 'PD-RETURN-001',
                ]],
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('manual_discount', 0)
            ->assertJsonPath('automatic_discount_adjustment', 300000)
            ->assertJsonPath('discount', 300000)
            ->assertJsonPath('total_price', 6300000)
            ->assertJsonPath('supplement_items_total_price', 300000)
            ->assertJsonPath('profit_total', 3420000)
            ->assertJsonPath('report_revenue_total', 6300000)
            ->assertJsonPath('report_cost_total', 2880000)
            ->assertJsonPath('report_profit_total', 3420000);

        $storedNotes = (string) $response->json('notes');
        $this->assertStringContainsString('Ghi chu tay cua nhan vien', $storedNotes);
        $this->assertStringContainsString('Ghi chú hệ thống: khách trả về 3 Bo that bao, phần điều chỉnh +300.000đ', $storedNotes);
        $this->assertSame(1, substr_count($storedNotes, 'Ghi chú hệ thống:'));

        $order = Order::query()->findOrFail((int) $response->json('id'));

        $this->assertSame(300000.0, (float) $order->discount);
        $this->assertSame(6300000.0, (float) $order->total_price);
        $this->assertSame(3420000.0, (float) ($order->profit_total ?? 0));
        $this->assertSame(6300000.0, (float) ($order->report_revenue_total ?? 0));
        $this->assertSame(2880000.0, (float) ($order->report_cost_total ?? 0));
        $this->assertSame(3420000.0, (float) ($order->report_profit_total ?? 0));
        $this->assertSame($storedNotes, (string) $order->notes);
    }

    public function test_partial_delivery_update_recalculates_discount_and_rewrites_single_system_note_when_return_items_change_or_are_removed(): void
    {
        [$account] = $this->authenticate();
        $mainProduct = $this->createProduct($account, [
            'name' => 'Don sua giao 1 phan',
            'sku' => 'PD-UPD-MAIN-001',
            'price' => 2200000,
        ]);
        $returnProduct = $this->createProduct($account, [
            'name' => 'Bo that bao',
            'sku' => 'PD-UPD-RETURN-001',
            'price' => 100000,
            'cost_price' => 40000,
        ]);
        $replacementReturnProduct = $this->createProduct($account, [
            'name' => 'Lo hoa',
            'sku' => 'PD-UPD-RETURN-002',
            'price' => 180000,
            'cost_price' => 70000,
        ]);

        $this->createBatch($account, $mainProduct, 5, 1000000, 'partial-delivery-update-main');

        $created = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_OFFICIAL,
                'order_type' => Order::TYPE_PARTIAL_DELIVERY,
                'customer_name' => 'Khach sua giao 1 phan',
                'customer_phone' => '0922222222',
                'customer_email' => 'partial-delivery-update@example.com',
                'shipping_address' => '789 Le Loi',
                'province' => 'Tinh test',
                'district' => 'Huyen test',
                'ward' => 'Xa test',
                'notes' => 'Ghi chu tay giu lai',
                'source' => 'Website',
                'type' => 'Le',
                'shipment_status' => 'Chua giao',
                'shipping_fee' => 0,
                'manual_discount' => 50000,
                'discount' => 350000,
                'items' => [[
                    'product_id' => $mainProduct->id,
                    'quantity' => 3,
                    'price' => 2200000,
                ]],
                'supplement_items' => [[
                    'product_id' => $returnProduct->id,
                    'quantity' => 3,
                    'price' => 100000,
                    'cost_price' => 40000,
                    'name' => 'Bo that bao',
                    'sku' => 'PD-UPD-RETURN-001',
                ]],
            ])
            ->assertCreated();

        $orderId = (int) $created->json('id');
        $initialNotes = (string) $created->json('notes');

        $updated = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$orderId}", [
                'order_type' => Order::TYPE_PARTIAL_DELIVERY,
                'notes' => $initialNotes,
                'discount' => 350000,
                'supplement_items' => [[
                    'product_id' => $replacementReturnProduct->id,
                    'quantity' => 2,
                    'price' => 180000,
                    'cost_price' => 70000,
                    'name' => 'Lo hoa',
                    'sku' => 'PD-UPD-RETURN-002',
                ]],
            ]);

        $updated
            ->assertOk()
            ->assertJsonPath('discount', 410000)
            ->assertJsonPath('manual_discount', 50000)
            ->assertJsonPath('automatic_discount_adjustment', 360000)
            ->assertJsonPath('total_price', 6190000)
            ->assertJsonPath('profit_total', 3330000)
            ->assertJsonPath('report_revenue_total', 6190000)
            ->assertJsonPath('report_cost_total', 2860000)
            ->assertJsonPath('report_profit_total', 3330000);

        $updatedNotes = (string) $updated->json('notes');
        $this->assertStringContainsString('Ghi chu tay giu lai', $updatedNotes);
        $this->assertStringContainsString('2 Lo hoa', $updatedNotes);
        $this->assertStringContainsString('+360.000', $updatedNotes);
        $this->assertStringNotContainsString('Bo that bao', $updatedNotes);
        $this->assertSame(1, substr_count($updatedNotes, 'Ghi chú hệ thống:'));

        $removed = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$orderId}", [
                'order_type' => Order::TYPE_PARTIAL_DELIVERY,
                'notes' => $updatedNotes,
                'discount' => 410000,
                'supplement_items' => [],
            ]);

        $removed
            ->assertOk()
            ->assertJsonPath('discount', 50000)
            ->assertJsonPath('manual_discount', 50000)
            ->assertJsonPath('automatic_discount_adjustment', 0)
            ->assertJsonPath('total_price', 6550000)
            ->assertJsonPath('profit_total', 3550000)
            ->assertJsonPath('report_revenue_total', 6550000)
            ->assertJsonPath('report_cost_total', 3000000)
            ->assertJsonPath('report_profit_total', 3550000);

        $removedNotes = (string) $removed->json('notes');
        $this->assertSame('Ghi chu tay giu lai', $removedNotes);

        $order = Order::query()->findOrFail($orderId);

        $this->assertSame(50000.0, (float) $order->discount);
        $this->assertSame(6550000.0, (float) $order->total_price);
        $this->assertSame(3550000.0, (float) ($order->profit_total ?? 0));
        $this->assertSame(6550000.0, (float) ($order->report_revenue_total ?? 0));
        $this->assertSame(3000000.0, (float) ($order->report_cost_total ?? 0));
        $this->assertSame(3550000.0, (float) ($order->report_profit_total ?? 0));
        $this->assertSame('Ghi chu tay giu lai', (string) $order->notes);
    }

    public function test_exchange_return_order_uses_customer_extra_payment_without_adding_return_value_to_discount(): void
    {
        [$account] = $this->authenticate();
        $sentProduct = $this->createProduct($account, [
            'name' => 'Hang gui doi',
            'sku' => 'EX-SENT-001',
            'price' => 300000,
        ]);
        $returnedProduct = $this->createProduct($account, [
            'name' => 'Hang khach tra',
            'sku' => 'EX-RETURN-001',
            'price' => 200000,
            'cost_price' => 80000,
        ]);

        $this->createBatch($account, $sentProduct, 5, 120000, 'exchange-return-sent');

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_OFFICIAL,
                'order_type' => Order::TYPE_EXCHANGE_RETURN,
                'customer_name' => 'Khach doi tra',
                'customer_phone' => '0933333333',
                'customer_email' => 'exchange-return@example.com',
                'shipping_address' => '100 Tran Phu',
                'province' => 'Tinh test',
                'district' => 'Huyen test',
                'ward' => 'Xa test',
                'notes' => 'Ghi chu doi tra',
                'source' => 'Website',
                'type' => 'Le',
                'shipment_status' => 'Chua giao',
                'manual_discount' => 0,
                'discount' => 0,
                'items' => [[
                    'product_id' => $sentProduct->id,
                    'quantity' => 1,
                    'price' => 300000,
                ]],
                'supplement_items' => [[
                    'product_id' => $returnedProduct->id,
                    'quantity' => 1,
                    'price' => 200000,
                    'cost_price' => 80000,
                    'name' => 'Hang khach tra',
                    'sku' => 'EX-RETURN-001',
                ]],
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('manual_discount', 0)
            ->assertJsonPath('automatic_discount_adjustment', 0)
            ->assertJsonPath('discount', 0)
            ->assertJsonPath('total_price', 100000)
            ->assertJsonPath('supplement_items_total_price', 200000)
            ->assertJsonPath('profit_total', 60000)
            ->assertJsonPath('report_revenue_total', 100000)
            ->assertJsonPath('report_cost_total', 40000)
            ->assertJsonPath('report_profit_total', 60000)
            ->assertJsonPath('return_status', 'not_returned');

        $storedNotes = (string) $response->json('notes');
        $this->assertSame('Ghi chu doi tra', $storedNotes);

        $order = Order::query()->findOrFail((int) $response->json('id'));
        $this->assertSame(0.0, (float) $order->discount);
        $this->assertSame(100000.0, (float) $order->total_price);
        $this->assertSame(100000.0, (float) ($order->report_revenue_total ?? 0));
        $this->assertSame(60000.0, (float) ($order->report_profit_total ?? 0));

        $order->forceFill(['shipping_tracking_code' => '139850986571'])->save();

        $updated = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$order->id}", [
                'order_type' => Order::TYPE_EXCHANGE_RETURN,
                'notes' => $storedNotes,
            ]);

        $updated
            ->assertOk()
            ->assertJsonPath('return_tracking_code', '139850986571DH')
            ->assertJsonPath('return_status', 'not_returned');
    }

    public function test_special_order_return_status_is_updated_manually_via_order_api(): void
    {
        [$account] = $this->authenticate();

        foreach ([Order::TYPE_EXCHANGE_RETURN, Order::TYPE_PARTIAL_DELIVERY] as $index => $orderType) {
            $sentProduct = $this->createProduct($account, [
                'name' => 'Hang gui manual ' . $index,
                'sku' => 'MANUAL-SENT-' . $index,
                'price' => 300000,
            ]);
            $returnedProduct = $this->createProduct($account, [
                'name' => 'Hang tra manual ' . $index,
                'sku' => 'MANUAL-RETURN-' . $index,
                'price' => 100000,
                'cost_price' => 50000,
            ]);

            $this->createBatch($account, $sentProduct, 5, 100000, 'manual-return-status-' . $index);

            $created = $this
                ->withHeaders($this->headers($account))
                ->postJson('/api/orders', [
                    'order_kind' => Order::KIND_OFFICIAL,
                    'order_type' => $orderType,
                    'customer_name' => 'Khach sua trang thai ' . $index,
                    'customer_phone' => '09555555' . $index . $index,
                    'customer_email' => 'manual-return-' . $index . '@example.com',
                    'shipping_address' => '102 Tran Phu',
                    'province' => 'Tinh test',
                    'district' => 'Huyen test',
                    'ward' => 'Xa test',
                    'notes' => 'Ghi chu sua tay trang thai',
                    'source' => 'Website',
                    'type' => 'Le',
                    'shipment_status' => 'Chua giao',
                    'return_status' => 'not_returned',
                    'items' => [[
                        'product_id' => $sentProduct->id,
                        'quantity' => 1,
                        'price' => 300000,
                    ]],
                    'supplement_items' => [[
                        'product_id' => $returnedProduct->id,
                        'quantity' => 1,
                        'price' => 100000,
                        'cost_price' => 50000,
                        'name' => 'Hang tra manual ' . $index,
                        'sku' => 'MANUAL-RETURN-' . $index,
                    ]],
                ]);

            $created
                ->assertCreated()
                ->assertJsonPath('return_status', 'not_returned');

            $orderId = (int) $created->json('id');

            $this
                ->withHeaders($this->headers($account))
                ->putJson("/api/orders/{$orderId}", [
                    'order_type' => $orderType,
                    'return_status' => 'returned',
                ])
                ->assertOk()
                ->assertJsonPath('return_status', 'returned');

            $this->assertSame('returned', (string) Order::query()->findOrFail($orderId)->return_status);

            $this
                ->withHeaders($this->headers($account))
                ->putJson("/api/orders/{$orderId}", [
                    'order_type' => $orderType,
                    'return_status' => 'not_returned',
                ])
                ->assertOk()
                ->assertJsonPath('return_status', 'not_returned');

            $this->assertSame('not_returned', (string) Order::query()->findOrFail($orderId)->return_status);
        }
    }

    public function test_exchange_return_order_caps_customer_payment_at_zero_and_adds_refund_note(): void
    {
        [$account] = $this->authenticate();
        $sentProduct = $this->createProduct($account, [
            'name' => 'Hang gui thap hon',
            'sku' => 'EX-REFUND-SENT-001',
            'price' => 200000,
        ]);
        $returnedProduct = $this->createProduct($account, [
            'name' => 'Hang tra cao hon',
            'sku' => 'EX-REFUND-RETURN-001',
            'price' => 300000,
            'cost_price' => 150000,
        ]);

        $this->createBatch($account, $sentProduct, 5, 100000, 'exchange-return-refund-sent');

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_OFFICIAL,
                'order_type' => Order::TYPE_EXCHANGE_RETURN,
                'customer_name' => 'Khach doi tra am',
                'customer_phone' => '0944444444',
                'customer_email' => 'exchange-return-refund@example.com',
                'shipping_address' => '101 Tran Phu',
                'province' => 'Tinh test',
                'district' => 'Huyen test',
                'ward' => 'Xa test',
                'notes' => 'Ghi chu hoan tien',
                'source' => 'Website',
                'type' => 'Le',
                'shipment_status' => 'Chua giao',
                'manual_discount' => 0,
                'discount' => 0,
                'items' => [[
                    'product_id' => $sentProduct->id,
                    'quantity' => 1,
                    'price' => 200000,
                ]],
                'supplement_items' => [[
                    'product_id' => $returnedProduct->id,
                    'quantity' => 1,
                    'price' => 300000,
                    'cost_price' => 150000,
                    'name' => 'Hang tra cao hon',
                    'sku' => 'EX-REFUND-RETURN-001',
                ]],
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('discount', 0)
            ->assertJsonPath('total_price', 0)
            ->assertJsonPath('supplement_items_total_price', 300000)
            ->assertJsonPath('profit_total', -50000)
            ->assertJsonPath('report_revenue_total', -100000)
            ->assertJsonPath('report_cost_total', -50000)
            ->assertJsonPath('report_profit_total', -50000);

        $storedNotes = (string) $response->json('notes');
        $this->assertStringContainsString('Ghi chu hoan tien', $storedNotes);
        $this->assertStringContainsString('Nhận hàng trả thì trả lại khách 100k', $storedNotes);

        $order = Order::query()->findOrFail((int) $response->json('id'));
        $this->assertSame(0.0, (float) $order->total_price);
        $this->assertSame(-100000.0, (float) ($order->report_revenue_total ?? 0));
        $this->assertSame(-50000.0, (float) ($order->report_profit_total ?? 0));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Order Pricing Adjustment Account',
            'domain' => 'pricing-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'pricing-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Order Pricing Adjustment Admin',
            'email' => 'pricing-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function createBatch(Account $account, Product $product, int $quantity, float $unitCost, string $suffix): InventoryBatch
    {
        $batch = InventoryBatch::query()->create([
            'account_id' => $account->id,
            'product_id' => $product->id,
            'batch_number' => 'BATCH-' . strtoupper($suffix) . '-' . Str::upper(Str::random(4)),
            'received_at' => now(),
            'quantity' => $quantity,
            'remaining_quantity' => $quantity,
            'unit_cost' => $unitCost,
            'status' => 'open',
            'meta' => ['source' => 'test'],
        ]);

        app(InventoryService::class)->refreshProducts([$product->id]);

        return $batch;
    }
}
