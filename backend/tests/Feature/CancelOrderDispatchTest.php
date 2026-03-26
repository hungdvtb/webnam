<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryBatch;
use App\Models\InventoryDocument;
use App\Models\InventoryDocumentAllocation;
use App\Models\InventoryDocumentItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\Shipment;
use App\Models\ShipmentItem;
use App\Models\User;
use App\Services\Inventory\InventoryService;
use App\Services\Shipping\ShipmentStatusSyncService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CancelOrderDispatchTest extends TestCase
{
    use RefreshDatabase;

    public function test_cancel_dispatch_reverts_order_and_restores_auto_export_stock(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham rollback shipment',
            'sku' => 'ROLLBACK-001',
            'price' => 240000,
        ]);
        $batch = $this->createBatch($account, $product, 2, 120000, 'rollback-auto');
        $order = $this->createOfficialOrder($account, $user, $product);
        $shipment = $this->createShipmentForOrder($order, $user, 'out_for_delivery', 'TRACK-CANCEL-001');
        $document = $this->createAutomaticExportDocument($account, $order, $product, $batch, 'TRACK-CANCEL-001', 1);

        $this->assertSame(1, (int) $batch->fresh()->remaining_quantity);
        $this->assertSame('shipping', (string) $order->fresh()->status);
        $this->assertSame('TRACK-CANCEL-001', (string) $order->fresh()->shipping_tracking_code);

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
        $shipment = Shipment::withTrashed()->findOrFail($shipment->id);
        $batch->refresh();
        $product->refresh();

        $this->assertSame('new', (string) $order->status);
        $this->assertNull($order->shipment_status);
        $this->assertNull($order->shipping_status);
        $this->assertSame('manual', (string) $order->shipping_status_source);
        $this->assertNull($order->shipping_tracking_code);
        $this->assertNull($order->shipping_carrier_code);
        $this->assertNull($order->shipping_carrier_name);
        $this->assertNull($order->shipping_dispatched_at);
        $this->assertNull($order->shipping_issue_code);

        $this->assertSame('canceled', (string) $shipment->shipment_status);
        $this->assertNotNull($shipment->deleted_at);
        $this->assertSame(0, Shipment::query()->where('order_id', $order->id)->count());

        $this->assertDatabaseMissing('inventory_documents', [
            'id' => $document->id,
        ]);
        $this->assertSame(2, (int) $batch->remaining_quantity);
        $this->assertSame(2, (int) $product->stock_quantity);
        $this->assertDatabaseHas('order_status_logs', [
            'order_id' => $order->id,
            'source' => 'dispatch_cancel',
            'to_status' => 'new',
        ]);
        $this->assertDatabaseHas('shipment_status_logs', [
            'shipment_id' => $shipment->id,
            'change_source' => 'dispatch_cancel',
            'to_status' => 'canceled',
        ]);
    }

    public function test_cancel_dispatch_supports_multiple_valid_orders(): void
    {
        [$account, $user] = $this->authenticate();
        $productA = $this->createProduct($account, [
            'name' => 'San pham A',
            'sku' => 'ROLLBACK-A',
            'price' => 180000,
        ]);
        $productB = $this->createProduct($account, [
            'name' => 'San pham B',
            'sku' => 'ROLLBACK-B',
            'price' => 190000,
        ]);

        $orderA = $this->createOfficialOrder($account, $user, $productA, [
            'order_number' => 'OR88001A0',
        ]);
        $orderB = $this->createOfficialOrder($account, $user, $productB, [
            'order_number' => 'OR88002A0',
        ]);

        $this->createShipmentForOrder($orderA, $user, 'waiting_pickup', 'TRACK-A');
        $this->createShipmentForOrder($orderB, $user, 'in_transit', 'TRACK-B');

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/dispatch/cancel', [
                'order_ids' => [$orderA->id, $orderB->id],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('success_count', 2)
            ->assertJsonPath('failed_count', 0);

        $this->assertSame('new', (string) $orderA->fresh()->status);
        $this->assertSame('new', (string) $orderB->fresh()->status);
        $this->assertNull($orderA->fresh()->shipping_tracking_code);
        $this->assertNull($orderB->fresh()->shipping_tracking_code);
    }

    public function test_cancel_dispatch_rejects_order_that_was_not_sent(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham chua gui',
            'sku' => 'NOT-SENT-001',
        ]);
        $order = $this->createOfficialOrder($account, $user, $product);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/dispatch/cancel', [
                'order_ids' => [$order->id],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('success_count', 0)
            ->assertJsonPath('failed_count', 1)
            ->assertJsonPath('results.0.success', false);

        $this->assertSame('new', (string) $order->fresh()->status);
        $this->assertNull($order->fresh()->shipping_tracking_code);
    }

    public function test_cancel_dispatch_rejects_invalid_shipment_status_for_rollback(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham giao loi',
            'sku' => 'FAILED-ROLLBACK-001',
        ]);
        $order = $this->createOfficialOrder($account, $user, $product);
        $shipment = $this->createShipmentForOrder($order, $user, 'delivery_failed', 'TRACK-FAILED');

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/dispatch/cancel', [
                'order_ids' => [$order->id],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('success_count', 0)
            ->assertJsonPath('failed_count', 1)
            ->assertJsonPath('results.0.success', false);

        $order->refresh();
        $shipment->refresh();

        $this->assertSame('processing', (string) $order->status);
        $this->assertSame('TRACK-FAILED', (string) $order->shipping_tracking_code);
        $this->assertSame('delivery_failed', (string) $shipment->shipment_status);
        $this->assertNull($shipment->deleted_at);
    }

    public function test_cancel_dispatch_rejects_order_with_return_or_damaged_slip_dependency(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham co phieu phu thuoc',
            'sku' => 'DEPENDENCY-001',
        ]);
        $order = $this->createOfficialOrder($account, $user, $product);
        $shipment = $this->createShipmentForOrder($order, $user, 'out_for_delivery', 'TRACK-DEPENDENCY');
        $this->createInventoryDocumentForOrder($account, $order, $product, 'return', 'RET-DEPENDENCY-001', 1);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/dispatch/cancel', [
                'order_ids' => [$order->id],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('success_count', 0)
            ->assertJsonPath('failed_count', 1)
            ->assertJsonPath('results.0.success', false);

        $order->refresh();
        $shipment->refresh();

        $this->assertNotSame('new', (string) $order->status);
        $this->assertSame('TRACK-DEPENDENCY', (string) $order->shipping_tracking_code);
        $this->assertSame('out_for_delivery', (string) $shipment->shipment_status);
        $this->assertNull($shipment->deleted_at);
        $this->assertDatabaseHas('inventory_documents', [
            'reference_type' => 'order',
            'reference_id' => $order->id,
            'type' => 'return',
            'document_number' => 'RET-DEPENDENCY-001',
        ]);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Rollback Shipment Account',
            'domain' => 'rollback-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'rollback-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Rollback Admin',
            'email' => 'rollback-' . Str::lower(Str::random(6)) . '@example.com',
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
            'customer_name' => 'Khach rollback',
            'customer_email' => 'rollback-' . Str::lower(Str::random(5)) . '@example.com',
            'customer_phone' => '090' . str_pad((string) random_int(1000000, 9999999), 7, '0', STR_PAD_LEFT),
            'shipping_address' => '123 Nguyen Trai',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'notes' => 'Don can rollback shipment',
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

    private function createShipmentForOrder(Order $order, User $user, string $shipmentStatus, string $trackingNumber): Shipment
    {
        $shipment = Shipment::query()->create([
            'account_id' => $order->account_id,
            'order_id' => $order->id,
            'order_code' => $order->order_number,
            'shipment_number' => 'VD-' . now()->format('Ymd') . '-' . Str::upper(Str::random(4)),
            'tracking_number' => $trackingNumber,
            'carrier_tracking_code' => $trackingNumber,
            'carrier_code' => 'viettel_post',
            'carrier_name' => 'Viettel Post',
            'channel' => 'api',
            'customer_name' => $order->customer_name,
            'customer_phone' => $order->customer_phone,
            'customer_address' => $order->shipping_address,
            'customer_ward' => $order->ward,
            'customer_district' => $order->district,
            'customer_province' => $order->province,
            'status' => $shipmentStatus,
            'shipment_status' => $shipmentStatus,
            'order_status_snapshot' => $order->status,
            'cod_amount' => (float) $order->total_price,
            'shipping_cost' => 0,
            'service_fee' => 0,
            'actual_received_amount' => (float) $order->total_price,
            'created_by' => $user->id,
            'shipped_at' => now(),
            'out_for_delivery_at' => in_array($shipmentStatus, ['out_for_delivery', 'delivery_failed'], true) ? now() : null,
            'delivery_failed_at' => $shipmentStatus === 'delivery_failed' ? now() : null,
            'failed_reason' => $shipmentStatus === 'delivery_failed' ? 'Khach hen lai' : null,
        ]);

        $orderItem = $order->items()->first();
        ShipmentItem::query()->create([
            'shipment_id' => $shipment->id,
            'order_item_id' => $orderItem->id,
            'qty' => 1,
        ]);

        app(ShipmentStatusSyncService::class)->syncOrderFromShipment($shipment, 'test_sync', $user->id);

        return $shipment->fresh();
    }

    private function createAutomaticExportDocument(
        Account $account,
        Order $order,
        Product $product,
        InventoryBatch $batch,
        string $marker,
        int $quantity
    ): InventoryDocument {
        $document = InventoryDocument::query()->create([
            'account_id' => $account->id,
            'document_number' => $marker,
            'type' => 'export',
            'document_date' => now()->toDateString(),
            'status' => 'completed',
            'reference_type' => 'order',
            'reference_id' => $order->id,
            'notes' => 'Tự tạo từ vận chuyển',
        ]);

        $documentItem = InventoryDocumentItem::query()->create([
            'account_id' => $account->id,
            'inventory_document_id' => $document->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => $quantity,
            'stock_bucket' => 'sellable',
            'direction' => 'out',
            'unit_cost' => 120000,
            'total_cost' => 120000 * $quantity,
        ]);

        $batch->remaining_quantity = max(0, (int) $batch->remaining_quantity - $quantity);
        $batch->status = (int) $batch->remaining_quantity > 0 ? 'open' : 'depleted';
        $batch->save();

        InventoryDocumentAllocation::query()->create([
            'account_id' => $account->id,
            'inventory_document_item_id' => $documentItem->id,
            'inventory_batch_id' => $batch->id,
            'product_id' => $product->id,
            'quantity' => $quantity,
            'unit_cost' => 120000,
            'total_cost' => 120000 * $quantity,
            'allocated_at' => now(),
        ]);

        $document->forceFill([
            'total_quantity' => $quantity,
            'total_amount' => 120000 * $quantity,
        ])->save();

        app(InventoryService::class)->refreshProducts([$product->id]);

        return $document;
    }

    private function createInventoryDocumentForOrder(
        Account $account,
        Order $order,
        Product $product,
        string $type,
        string $documentNumber,
        int $quantity
    ): InventoryDocument {
        $document = InventoryDocument::query()->create([
            'account_id' => $account->id,
            'document_number' => $documentNumber,
            'type' => $type,
            'document_date' => now()->toDateString(),
            'status' => 'completed',
            'reference_type' => 'order',
            'reference_id' => $order->id,
            'total_quantity' => $quantity,
            'total_amount' => 0,
            'notes' => 'Chung tu phu thuoc de chan rollback',
        ]);

        InventoryDocumentItem::query()->create([
            'account_id' => $account->id,
            'inventory_document_id' => $document->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => $quantity,
            'stock_bucket' => $type === 'damaged' ? 'damaged' : 'sellable',
            'direction' => 'in',
            'unit_cost' => 0,
            'total_cost' => 0,
        ]);

        return $document;
    }
}
