<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\Shipment;
use App\Models\ShipmentItem;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class InventoryExportsParityTest extends TestCase
{
    use DatabaseTransactions;

    public function test_exports_include_orders_with_active_shipments_even_without_order_tracking_code(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham xuat parity',
            'sku' => 'PX-PARITY-001',
        ]);

        $autoOrder = $this->createOrder($account, $user, [
            'order_number' => 'PX-AUTO-ORDER',
            'status' => 'shipping',
            'shipping_tracking_code' => null,
            'shipping_carrier_name' => null,
        ]);
        $autoOrderItem = $this->createOrderItem($account, $autoOrder, $product, 3);
        $this->createShipment($account, $autoOrder, $user, [
            'shipment_number' => 'PX-AUTO-SHIP-001',
            'carrier_tracking_code' => 'AUTO-TRACK-001',
            'shipment_status' => 'shipped',
            'status' => 'shipped',
            'shipped_at' => now()->subDay(),
        ], [
            [
                'order_item_id' => $autoOrderItem->id,
                'qty' => 3,
            ],
        ]);

        $manualOrder = $this->createOrder($account, $user, [
            'order_number' => 'PX-MANUAL-ORDER',
            'type' => 'inventory_export',
            'status' => 'draft',
            'customer_name' => 'Kho noi bo',
        ]);
        $this->createOrderItem($account, $manualOrder, $product, 2);

        $ignoredOrder = $this->createOrder($account, $user, [
            'order_number' => 'PX-IGNORED-ORDER',
            'status' => 'new',
        ]);
        $this->createOrderItem($account, $ignoredOrder, $product, 1);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/inventory/exports?per_page=100');

        $response->assertOk();

        $payload = $response->json();
        $rows = collect($payload['data'] ?? []);

        $this->assertSame(2, (int) ($payload['total'] ?? 0));

        $autoRow = $rows->firstWhere('order_number', 'PX-AUTO-ORDER');
        $manualRow = $rows->firstWhere('order_number', 'PX-MANUAL-ORDER');

        $this->assertNotNull($autoRow);
        $this->assertNotNull($manualRow);
        $this->assertNull($rows->firstWhere('order_number', 'PX-IGNORED-ORDER'));

        $this->assertSame('dispatch_auto', $autoRow['export_kind'] ?? null);
        $this->assertSame('PX-AUTO-SHIP-001', $autoRow['code'] ?? null);
        $this->assertSame('AUTO-TRACK-001', $autoRow['shipping_tracking_code'] ?? null);
        $this->assertSame(3.0, (float) ($autoRow['total_quantity'] ?? 0));
        $this->assertFalse((bool) ($autoRow['can_delete'] ?? true));

        $this->assertSame('manual', $manualRow['export_kind'] ?? null);
        $this->assertSame('PX-MANUAL-ORDER', $manualRow['code'] ?? null);
        $this->assertSame(2.0, (float) ($manualRow['total_quantity'] ?? 0));
        $this->assertTrue((bool) ($manualRow['can_delete'] ?? false));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Inventory Exports ' . Str::upper(Str::random(4)),
            'domain' => 'inventory-exports-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'inventory-exports-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::factory()->create([
            'name' => 'Inventory Exports Admin',
            'email' => 'inventory-exports-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function createSupplier(Account $account): Supplier
    {
        return Supplier::query()->create([
            'account_id' => $account->id,
            'name' => 'Nha cung cap ' . Str::upper(Str::random(4)),
            'status' => true,
        ]);
    }

    private function createProduct(Account $account, Supplier $supplier, array $overrides = []): Product
    {
        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'supplier_id' => $supplier->id,
            'type' => 'simple',
            'name' => 'San pham ' . Str::upper(Str::random(4)),
            'slug' => 'san-pham-' . Str::lower(Str::random(8)),
            'sku' => 'SKU-' . Str::upper(Str::random(8)),
            'status' => 'active',
            'price' => 120000,
            'expected_cost' => 80000,
            'cost_price' => 80000,
            'stock_quantity' => 0,
            'damaged_quantity' => 0,
        ], $overrides));
    }

    private function createOrder(Account $account, User $user, array $overrides = []): Order
    {
        return Order::query()->create(array_merge([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'PX-' . Str::upper(Str::random(8)),
            'order_kind' => Order::KIND_OFFICIAL,
            'total_price' => 0,
            'status' => 'new',
            'customer_name' => 'Khach test',
            'customer_email' => 'customer-' . Str::lower(Str::random(5)) . '@example.com',
            'customer_phone' => '090' . str_pad((string) random_int(1000000, 9999999), 7, '0', STR_PAD_LEFT),
            'shipping_address' => '123 Test street',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'notes' => 'Order export parity',
            'source' => 'website',
            'type' => null,
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => 0,
            'shipping_status_source' => 'manual',
        ], $overrides));
    }

    private function createOrderItem(Account $account, Order $order, Product $product, int $quantity): OrderItem
    {
        $lineTotal = $quantity * (float) ($product->price ?? 0);
        $costTotal = $quantity * (float) ($product->cost_price ?? 0);

        $order->update([
            'total_price' => $lineTotal,
            'cost_total' => $costTotal,
            'profit_total' => $lineTotal - $costTotal,
        ]);

        return OrderItem::query()->create([
            'order_id' => $order->id,
            'account_id' => $account->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => $quantity,
            'price' => $product->price,
            'cost_price' => $product->cost_price,
            'cost_total' => $costTotal,
            'profit_total' => $lineTotal - $costTotal,
        ]);
    }

    private function createShipment(Account $account, Order $order, User $user, array $overrides = [], array $items = []): Shipment
    {
        $shipment = Shipment::query()->create(array_merge([
            'account_id' => $account->id,
            'order_id' => $order->id,
            'order_code' => $order->order_number,
            'shipment_number' => 'SHIP-' . Str::upper(Str::random(8)),
            'tracking_number' => 'TRACK-' . Str::upper(Str::random(6)),
            'carrier_tracking_code' => 'TRACK-' . Str::upper(Str::random(6)),
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
            'insurance_fee' => 0,
            'other_fee' => 0,
            'reconciled_amount' => 0,
            'actual_received_amount' => (float) $order->total_price,
            'reconciliation_status' => 'pending',
            'created_by' => $user->id,
        ], $overrides));

        foreach ($items as $item) {
            ShipmentItem::query()->create([
                'shipment_id' => $shipment->id,
                'order_item_id' => (int) ($item['order_item_id'] ?? 0),
                'qty' => (int) ($item['qty'] ?? 0),
            ]);
        }

        return $shipment;
    }
}
