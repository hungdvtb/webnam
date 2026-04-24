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
                    'product_id' => $returnProduct->id,
                    'quantity' => 1,
                    'price' => 100000,
                    'cost_price' => 40000,
                    'name' => 'Bo that bao',
                    'sku' => 'PD-UPD-RETURN-001',
                ]],
            ]);

        $updated
            ->assertOk()
            ->assertJsonPath('discount', 150000)
            ->assertJsonPath('manual_discount', 50000)
            ->assertJsonPath('automatic_discount_adjustment', 100000)
            ->assertJsonPath('total_price', 6450000)
            ->assertJsonPath('report_revenue_total', 6450000)
            ->assertJsonPath('report_cost_total', 2960000)
            ->assertJsonPath('report_profit_total', 3490000);

        $updatedNotes = (string) $updated->json('notes');
        $this->assertStringContainsString('Ghi chu tay giu lai', $updatedNotes);
        $this->assertStringContainsString('Ghi chú hệ thống: khách trả về 1 Bo that bao, phần điều chỉnh +100.000đ', $updatedNotes);
        $this->assertSame(1, substr_count($updatedNotes, 'Ghi chú hệ thống:'));

        $removed = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$orderId}", [
                'order_type' => Order::TYPE_PARTIAL_DELIVERY,
                'notes' => $updatedNotes,
                'discount' => 150000,
                'supplement_items' => [],
            ]);

        $removed
            ->assertOk()
            ->assertJsonPath('discount', 50000)
            ->assertJsonPath('manual_discount', 50000)
            ->assertJsonPath('automatic_discount_adjustment', 0)
            ->assertJsonPath('total_price', 6550000)
            ->assertJsonPath('report_revenue_total', 6550000)
            ->assertJsonPath('report_cost_total', 3000000)
            ->assertJsonPath('report_profit_total', 3550000);

        $removedNotes = (string) $removed->json('notes');
        $this->assertSame('Ghi chu tay giu lai', $removedNotes);

        $order = Order::query()->findOrFail($orderId);

        $this->assertSame(50000.0, (float) $order->discount);
        $this->assertSame(6550000.0, (float) $order->total_price);
        $this->assertSame(6550000.0, (float) ($order->report_revenue_total ?? 0));
        $this->assertSame(3000000.0, (float) ($order->report_cost_total ?? 0));
        $this->assertSame(3550000.0, (float) ($order->report_profit_total ?? 0));
        $this->assertSame('Ghi chu tay giu lai', (string) $order->notes);
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
