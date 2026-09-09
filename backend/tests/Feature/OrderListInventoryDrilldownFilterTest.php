<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryDocument;
use App\Models\InventoryDocumentItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\User;
use App\Support\OrderStatusCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderListInventoryDrilldownFilterTest extends TestCase
{
    use RefreshDatabase;

    public function test_order_list_inventory_pending_export_scope_returns_orders_with_remaining_unexported_quantity(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $targetProduct = $this->createProduct($account, $supplier, ['sku' => 'DRILL-PENDING-EXPORT']);
        $otherProduct = $this->createProduct($account, $supplier, ['sku' => 'DRILL-OTHER']);

        $partialExportOrder = $this->createOrder($account, $user, [
            'order_number' => 'DRILL-EXPORT-PARTIAL',
            'status' => 'new',
        ]);
        $this->createOrderItem($account, $partialExportOrder, $targetProduct, 5);
        $this->createInventoryDocumentForOrder($account, $partialExportOrder, $targetProduct, 'export', 'DRILL-EXP-PARTIAL', 2);

        $fullyExportedOrder = $this->createOrder($account, $user, [
            'order_number' => 'DRILL-EXPORT-FULL',
            'status' => 'new',
        ]);
        $this->createOrderItem($account, $fullyExportedOrder, $targetProduct, 3);
        $this->createInventoryDocumentForOrder($account, $fullyExportedOrder, $targetProduct, 'export', 'DRILL-EXP-FULL', 3);

        $trackedOrder = $this->createOrder($account, $user, [
            'order_number' => 'DRILL-EXPORT-TRACKED',
            'status' => 'new',
            'shipping_tracking_code' => 'TRACK-001',
        ]);
        $this->createOrderItem($account, $trackedOrder, $targetProduct, 2);

        $returningOrder = $this->createOrder($account, $user, [
            'order_number' => 'DRILL-EXPORT-RETURNING',
            'status' => 'pending_return',
        ]);
        $this->createOrderItem($account, $returningOrder, $targetProduct, 2);

        $otherProductOrder = $this->createOrder($account, $user, [
            'order_number' => 'DRILL-EXPORT-OTHER-PRODUCT',
            'status' => 'new',
        ]);
        $this->createOrderItem($account, $otherProductOrder, $otherProduct, 7);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?per_page=100&inventory_stock_scope=pending_export&inventory_product_ids=' . $targetProduct->id);

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertContains($partialExportOrder->id, $returnedIds);
        $this->assertNotContains($fullyExportedOrder->id, $returnedIds);
        $this->assertNotContains($trackedOrder->id, $returnedIds);
        $this->assertNotContains($returningOrder->id, $returnedIds);
        $this->assertNotContains($otherProductOrder->id, $returnedIds);
    }

    public function test_order_list_inventory_pending_return_scope_returns_return_orders_without_return_slip_for_product(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $targetProduct = $this->createProduct($account, $supplier, ['sku' => 'DRILL-PENDING-RETURN']);
        $otherProduct = $this->createProduct($account, $supplier, ['sku' => 'DRILL-RETURN-OTHER']);

        $pendingReturnOrder = $this->createOrder($account, $user, [
            'order_number' => 'DRILL-RETURN-PENDING',
            'status' => 'pending_return',
        ]);
        $this->createOrderItem($account, $pendingReturnOrder, $targetProduct, 4);

        $partialDeliveryOrder = $this->createOrder($account, $user, [
            'order_number' => 'DRILL-RETURN-PARTIAL',
            'status' => OrderStatusCatalog::PARTIAL_DELIVERY_CODE,
        ]);
        $this->createOrderItem($account, $partialDeliveryOrder, $targetProduct, 2);

        $alreadyReturnedOrder = $this->createOrder($account, $user, [
            'order_number' => 'DRILL-RETURN-HAS-SLIP',
            'status' => 'returned',
        ]);
        $this->createOrderItem($account, $alreadyReturnedOrder, $targetProduct, 3);
        $this->createInventoryDocumentForOrder($account, $alreadyReturnedOrder, $targetProduct, 'return', 'DRILL-RET-HAS-SLIP', 3);

        $newOrder = $this->createOrder($account, $user, [
            'order_number' => 'DRILL-RETURN-NEW',
            'status' => 'new',
        ]);
        $this->createOrderItem($account, $newOrder, $targetProduct, 2);

        $otherProductReturnOrder = $this->createOrder($account, $user, [
            'order_number' => 'DRILL-RETURN-OTHER-PRODUCT',
            'status' => 'pending_return',
        ]);
        $this->createOrderItem($account, $otherProductReturnOrder, $otherProduct, 5);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?per_page=100&inventory_stock_scope=pending_return&inventory_product_ids=' . $targetProduct->id);

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertContains($pendingReturnOrder->id, $returnedIds);
        $this->assertContains($partialDeliveryOrder->id, $returnedIds);
        $this->assertNotContains($alreadyReturnedOrder->id, $returnedIds);
        $this->assertNotContains($newOrder->id, $returnedIds);
        $this->assertNotContains($otherProductReturnOrder->id, $returnedIds);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Order Inventory Drilldown ' . Str::upper(Str::random(4)),
            'domain' => 'order-inventory-drilldown-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'order-inventory-drilldown-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::factory()->create([
            'name' => 'Order Inventory Drilldown Admin',
            'email' => 'order-inventory-drilldown-' . Str::lower(Str::random(6)) . '@example.com',
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
            'name' => 'San pham drilldown ' . Str::upper(Str::random(4)),
            'slug' => 'san-pham-drilldown-' . Str::lower(Str::random(8)),
            'sku' => 'DRILL-' . Str::upper(Str::random(8)),
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
            'order_number' => 'DRILL-' . Str::upper(Str::random(8)),
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 0,
            'status' => 'new',
            'customer_name' => 'Khach drilldown',
            'customer_email' => 'customer-' . Str::lower(Str::random(5)) . '@example.com',
            'customer_phone' => '090' . str_pad((string) random_int(1000000, 9999999), 7, '0', STR_PAD_LEFT),
            'shipping_address' => '123 Test street',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
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
        ]);

        InventoryDocumentItem::query()->create([
            'account_id' => $account->id,
            'inventory_document_id' => $document->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => $quantity,
            'stock_bucket' => 'sellable',
            'direction' => $type === 'export' ? 'out' : 'in',
            'unit_cost' => 0,
            'total_cost' => 0,
        ]);

        return $document;
    }
}
