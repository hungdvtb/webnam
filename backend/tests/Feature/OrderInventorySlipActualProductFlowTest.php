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

class OrderInventorySlipActualProductFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_export_slip_keeps_order_product_but_deducts_actual_product_stock(): void
    {
        [$account, $user] = $this->authenticate();
        [$order, $orderedProduct, $actualProduct] = $this->createReservedOrderScenario($account, $user);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$order->id}/inventory-slips", [
                'type' => 'export',
                'document_date' => now()->toDateString(),
                'notes' => 'Kho dong nham SKU',
                'items' => [[
                    'product_id' => $orderedProduct->id,
                    'quantity' => 1,
                    'actual_product_id' => $actualProduct->id,
                    'actual_quantity' => 1,
                    'actual_reason' => 'Kho dong nham va xuat sang SKU khac',
                ]],
            ]);

        $response->assertCreated();

        $documentId = (int) $response->json('id');

        $this->assertSame(3, (int) $orderedProduct->fresh()->stock_quantity);
        $this->assertSame(2, (int) $actualProduct->fresh()->stock_quantity);

        $this->assertDatabaseHas('inventory_document_items', [
            'inventory_document_id' => $documentId,
            'product_id' => $orderedProduct->id,
            'actual_product_id' => $actualProduct->id,
            'quantity' => 1,
            'actual_quantity' => 1,
            'variance_type' => 'product',
        ]);

        $this->assertDatabaseHas('inventory_document_item_order_releases', [
            'order_id' => $order->id,
            'product_id' => $orderedProduct->id,
            'quantity' => 1,
        ]);

        $this->assertDatabaseHas('inventory_document_allocations', [
            'product_id' => $actualProduct->id,
            'quantity' => 1,
        ]);

        $detailResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson("/api/orders/{$order->id}/inventory-slips");

        $detailResponse->assertOk()->assertJsonPath('summary.has_variance', true);

        $orderedRow = collect($detailResponse->json('products'))->firstWhere('product_id', $orderedProduct->id);
        $actualRow = collect($detailResponse->json('products'))->firstWhere('product_id', $actualProduct->id);

        $this->assertNotNull($orderedRow);
        $this->assertNotNull($actualRow);
        $this->assertSame(1, (int) ($orderedRow['document_export_quantity'] ?? 0));
        $this->assertSame(0, (int) ($orderedRow['actual_exported_quantity'] ?? 0));
        $this->assertSame(1, (int) ($actualRow['actual_exported_quantity'] ?? 0));
        $this->assertTrue((bool) ($actualRow['has_warning'] ?? false));
    }

    public function test_return_slip_uses_actual_export_history_and_delete_export_restores_old_reservation_flow(): void
    {
        [$account, $user] = $this->authenticate();
        [$order, $orderedProduct, $actualProduct] = $this->createReservedOrderScenario($account, $user);

        $exportResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$order->id}/inventory-slips", [
                'type' => 'export',
                'document_date' => now()->toDateString(),
                'items' => [[
                    'product_id' => $orderedProduct->id,
                    'quantity' => 1,
                    'actual_product_id' => $actualProduct->id,
                    'actual_quantity' => 1,
                    'actual_reason' => 'Xuat nham SKU',
                ]],
            ])
            ->assertCreated();

        $exportId = (int) $exportResponse->json('id');

        $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$order->id}/inventory-slips", [
                'type' => 'return',
                'document_date' => now()->toDateString(),
                'items' => [[
                    'product_id' => $actualProduct->id,
                    'quantity' => 1,
                    'actual_product_id' => $actualProduct->id,
                    'actual_quantity' => 1,
                ]],
            ])
            ->assertCreated();

        $this->assertSame(3, (int) $actualProduct->fresh()->stock_quantity);

        $detailResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson("/api/orders/{$order->id}/inventory-slips");

        $actualRow = collect($detailResponse->json('products'))->firstWhere('product_id', $actualProduct->id);
        $this->assertNotNull($actualRow);
        $this->assertSame(1, (int) ($actualRow['actual_returned_quantity'] ?? 0));
        $this->assertSame(0, (int) ($actualRow['reversible_planned_quantity'] ?? 0));

        $this
            ->withHeaders($this->headers($account))
            ->deleteJson("/api/orders/{$order->id}/inventory-slips/{$exportId}")
            ->assertStatus(422);

        $this->assertSame(3, (int) $orderedProduct->fresh()->stock_quantity);
        $this->assertSame(3, (int) $actualProduct->fresh()->stock_quantity);
    }

    public function test_deleting_export_slip_restores_order_reservation_and_reverts_actual_stock(): void
    {
        [$account, $user] = $this->authenticate();
        [$order, $orderedProduct, $actualProduct] = $this->createReservedOrderScenario($account, $user);

        $exportResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$order->id}/inventory-slips", [
                'type' => 'export',
                'document_date' => now()->toDateString(),
                'items' => [[
                    'product_id' => $orderedProduct->id,
                    'quantity' => 1,
                    'actual_product_id' => $actualProduct->id,
                    'actual_quantity' => 1,
                    'actual_reason' => 'Xuat nham SKU',
                ]],
            ])
            ->assertCreated();

        $exportId = (int) $exportResponse->json('id');

        $this
            ->withHeaders($this->headers($account))
            ->deleteJson("/api/orders/{$order->id}/inventory-slips/{$exportId}")
            ->assertOk();

        $this->assertSame(2, (int) $orderedProduct->fresh()->stock_quantity);
        $this->assertSame(3, (int) $actualProduct->fresh()->stock_quantity);

        $this->assertDatabaseMissing('inventory_documents', [
            'id' => $exportId,
        ]);
        $this->assertDatabaseMissing('inventory_document_allocations', [
            'product_id' => $actualProduct->id,
        ]);
        $this->assertDatabaseMissing('inventory_document_item_order_releases', [
            'order_id' => $order->id,
        ]);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Inventory Slip Account',
            'domain' => 'inventory-slip-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'inventory-slip-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Inventory Slip Admin',
            'email' => 'inventory-slip-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function createReservedOrderScenario(Account $account, User $user): array
    {
        $orderedProduct = $this->createProduct($account, 'ORDERED-001', 'San pham dat A');
        $actualProduct = $this->createProduct($account, 'ACTUAL-001', 'San pham gui B');

        $this->createBatch($account, $orderedProduct, 3, 100000, 'ord-a');
        $this->createBatch($account, $actualProduct, 3, 120000, 'act-b');

        $order = Order::query()->create([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'OR' . random_int(10000, 99999) . 'A0',
            'order_kind' => Order::KIND_OFFICIAL,
            'total_price' => 200000,
            'status' => 'new',
            'customer_name' => 'Khach test',
            'customer_email' => 'customer-' . Str::lower(Str::random(5)) . '@example.com',
            'customer_phone' => '090' . str_pad((string) random_int(1000000, 9999999), 7, '0', STR_PAD_LEFT),
            'shipping_address' => '123 Test street',
            'province' => 'Test province',
            'district' => 'Test district',
            'ward' => 'Test ward',
            'source' => 'Website',
            'type' => 'Le',
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => 0,
            'shipping_status_source' => 'manual',
        ]);

        $summary = app(InventoryService::class)->attachInventoryToOrder($order, [[
            'product_id' => $orderedProduct->id,
            'quantity' => 1,
            'price' => 200000,
        ]]);

        $order->forceFill([
            'total_price' => (float) ($summary['total_price'] ?? 0),
            'cost_total' => (float) ($summary['cost_total'] ?? 0),
            'profit_total' => (float) ($summary['profit_total'] ?? 0),
        ])->save();

        return [$order->fresh(['items.batchAllocations']), $orderedProduct->fresh(), $actualProduct->fresh()];
    }

    private function createProduct(Account $account, string $sku, string $name): Product
    {
        return Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(5)),
            'sku' => $sku,
            'price' => 200000,
            'expected_cost' => 100000,
            'stock_quantity' => 0,
            'status' => true,
        ]);
    }

    private function createBatch(Account $account, Product $product, int $quantity, float $unitCost, string $suffix): InventoryBatch
    {
        $batch = InventoryBatch::query()->create([
            'account_id' => $account->id,
            'product_id' => $product->id,
            'batch_number' => 'LOT-' . strtoupper($suffix) . '-' . Str::upper(Str::random(4)),
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
