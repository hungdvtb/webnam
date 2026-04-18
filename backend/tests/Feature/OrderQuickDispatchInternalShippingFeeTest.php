<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryBatch;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\Shipment;
use App\Models\User;
use App\Services\Inventory\InventoryService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderQuickDispatchInternalShippingFeeTest extends TestCase
{
    use RefreshDatabase;

    public function test_quick_dispatch_manual_shipment_persists_internal_shipping_fee_without_changing_customer_total(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham gui qua don vi van chuyen',
            'sku' => 'INTERNAL-SHIP-FEE-001',
            'price' => 320000,
        ]);
        $this->createBatch($account, $product, 2, 150000, 'internal-ship-fee');
        $order = $this->createOfficialOrder($account, $user, $product);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/quick-dispatch', [
                'shipments' => [[
                    'order_id' => $order->id,
                    'dispatch_mode' => 'manual_shipment',
                    'tracking_number' => 'VTP-320001',
                    'carrier_name' => 'Viettel Post',
                    'shipping_cost' => 32000,
                ]],
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('success_count', 1)
            ->assertJsonPath('failed_count', 0)
            ->assertJsonPath('results.0.success', true)
            ->assertJsonPath('results.0.dispatch_mode', 'manual_shipment');

        $order->refresh();
        $shipment = Shipment::query()
            ->where('order_id', $order->id)
            ->latest('id')
            ->first();

        $this->assertNotNull($shipment);
        $this->assertSame(32000.0, (float) $shipment->shipping_cost);
        $this->assertSame(288000.0, (float) $shipment->actual_received_amount);
        $this->assertSame(0.0, (float) $order->shipping_fee);
        $this->assertSame(32000.0, (float) $order->internal_shipping_fee);
        $this->assertSame(320000.0, (float) $order->total_price);

        $showResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson("/api/orders/{$order->id}");

        $showResponse->assertOk();
        $showPayload = $showResponse->json();
        $this->assertSame(0.0, (float) ($showPayload['shipping_fee'] ?? 0));
        $this->assertSame(32000.0, (float) ($showPayload['internal_shipping_fee'] ?? 0));
        $this->assertSame(320000.0, (float) ($showPayload['total_price'] ?? 0));
        $this->assertSame(32000.0, (float) data_get($showPayload, 'active_shipment.shipping_cost', 0));

        $listResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?per_page=20');

        $listResponse->assertOk();
        $listRow = collect($listResponse->json('data'))->firstWhere('id', $order->id);
        $this->assertNotNull($listRow);
        $this->assertSame(0.0, (float) ($listRow['shipping_fee'] ?? 0));
        $this->assertSame(32000.0, (float) ($listRow['internal_shipping_fee'] ?? 0));
        $this->assertSame(320000.0, (float) ($listRow['total_price'] ?? 0));
        $this->assertSame(32000.0, (float) data_get($listRow, 'active_shipment.shipping_cost', 0));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Internal Shipping Fee Account',
            'domain' => 'internal-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'internal-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Internal Shipping Fee Admin',
            'email' => 'internal-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function createOfficialOrder(Account $account, User $user, Product $product, array $overrides = []): Order
    {
        $order = Order::query()->create(array_merge([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'OR' . random_int(10000, 99999) . 'A0',
            'order_kind' => Order::KIND_OFFICIAL,
            'total_price' => (float) ($product->price ?? 0),
            'status' => 'new',
            'customer_name' => 'Khach phi ship noi bo',
            'customer_email' => 'internal-order-' . Str::lower(Str::random(5)) . '@example.com',
            'customer_phone' => '090' . str_pad((string) random_int(1000000, 9999999), 7, '0', STR_PAD_LEFT),
            'shipping_address' => '789 Nguyen Hue',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'notes' => 'Don test phi ship noi bo',
            'source' => 'Website',
            'type' => 'Le',
            'shipment_status' => null,
            'shipping_fee' => 0,
            'internal_shipping_fee' => 0,
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
