<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryBatch;
use App\Models\InventoryDocument;
use App\Models\Order;
use App\Models\Product;
use App\Models\ReturnOrder;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ReturnOrderModuleTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_creates_an_independent_return_order_and_two_inventory_documents(): void
    {
        [$account, $user] = $this->authenticate();
        $productA = $this->createProduct($account, [
            'name' => 'San pham A',
            'sku' => 'RET-A-001',
            'price' => 150000,
            'cost_price' => 90000,
            'expected_cost' => 90000,
            'stock_quantity' => 0,
        ]);
        $productB = $this->createProduct($account, [
            'name' => 'San pham B',
            'sku' => 'RET-B-001',
            'price' => 220000,
            'cost_price' => 120000,
            'expected_cost' => 120000,
            'stock_quantity' => 5,
        ]);
        $this->createInventoryBatch($account, $productB, 5, 120000, 'ret-batch');
        $originOrder = $this->createOriginOrder($account, $user);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/return-orders', [
                'origin_order_id' => $originOrder->id,
                'exchange_date' => '2026-03-27',
                'notes' => 'Doi A sang B',
                'returned_items' => [
                    [
                        'product_id' => $productA->id,
                        'quantity' => 1,
                    ],
                ],
                'resent_items' => [
                    [
                        'product_id' => $productB->id,
                        'quantity' => 1,
                    ],
                ],
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('status', ReturnOrder::STATUS_NEW)
            ->assertJsonPath('origin_order.id', $originOrder->id)
            ->assertJsonPath('returned_total_amount', 150000)
            ->assertJsonPath('resent_total_amount', 220000)
            ->assertJsonPath('profit_loss_amount', -70000);

        $returnOrder = ReturnOrder::query()->firstOrFail();
        $productA->refresh();
        $productB->refresh();

        $this->assertSame('DTR26032700001', $returnOrder->return_number);
        $this->assertSame($originOrder->id, (int) $returnOrder->origin_order_id);
        $this->assertCount(2, $returnOrder->items);
        $this->assertNotNull($returnOrder->return_document_id);
        $this->assertNotNull($returnOrder->export_document_id);
        $this->assertSame(1, (int) $productA->stock_quantity);
        $this->assertSame(4, (int) $productB->stock_quantity);
        $this->assertSame(1, Order::query()->count());

        $this->assertDatabaseHas('inventory_documents', [
            'id' => $returnOrder->return_document_id,
            'type' => 'return',
            'reference_type' => 'return_order',
            'reference_id' => $returnOrder->id,
        ]);
        $this->assertDatabaseHas('inventory_documents', [
            'id' => $returnOrder->export_document_id,
            'type' => 'export',
            'reference_type' => 'return_order',
            'reference_id' => $returnOrder->id,
        ]);
    }

    public function test_cancelling_and_restoring_return_order_reverts_and_reapplies_inventory(): void
    {
        [$account, $user] = $this->authenticate();
        $productA = $this->createProduct($account, [
            'name' => 'San pham A',
            'sku' => 'RET-A-002',
            'price' => 160000,
            'cost_price' => 95000,
            'expected_cost' => 95000,
            'stock_quantity' => 0,
        ]);
        $productB = $this->createProduct($account, [
            'name' => 'San pham B',
            'sku' => 'RET-B-002',
            'price' => 230000,
            'cost_price' => 130000,
            'expected_cost' => 130000,
            'stock_quantity' => 5,
        ]);
        $this->createInventoryBatch($account, $productB, 5, 130000, 'ret-batch-restore');
        $originOrder = $this->createOriginOrder($account, $user, [
            'order_number' => 'OR-RESTORE-01',
        ]);

        $createResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/return-orders', [
                'origin_order_id' => $originOrder->id,
                'exchange_date' => '2026-03-27',
                'returned_items' => [
                    [
                        'product_id' => $productA->id,
                        'quantity' => 1,
                    ],
                ],
                'resent_items' => [
                    [
                        'product_id' => $productB->id,
                        'quantity' => 1,
                    ],
                ],
            ])
            ->assertCreated();

        $returnOrderId = (int) $createResponse->json('id');
        $returnOrder = ReturnOrder::query()->findOrFail($returnOrderId);

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/return-orders/{$returnOrderId}/status", [
                'status' => ReturnOrder::STATUS_CANCELLED,
            ])
            ->assertOk()
            ->assertJsonPath('status', ReturnOrder::STATUS_CANCELLED);

        $productA->refresh();
        $productB->refresh();

        $this->assertSame(0, (int) $productA->stock_quantity);
        $this->assertSame(5, (int) $productB->stock_quantity);
        $this->assertTrue(InventoryDocument::withTrashed()->findOrFail($returnOrder->return_document_id)->trashed());
        $this->assertTrue(InventoryDocument::withTrashed()->findOrFail($returnOrder->export_document_id)->trashed());

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/return-orders/{$returnOrderId}/status", [
                'status' => ReturnOrder::STATUS_COMPLETED,
            ])
            ->assertOk()
            ->assertJsonPath('status', ReturnOrder::STATUS_COMPLETED);

        $productA->refresh();
        $productB->refresh();

        $this->assertSame(1, (int) $productA->stock_quantity);
        $this->assertSame(4, (int) $productB->stock_quantity);
        $this->assertFalse(InventoryDocument::withTrashed()->findOrFail($returnOrder->return_document_id)->trashed());
        $this->assertFalse(InventoryDocument::withTrashed()->findOrFail($returnOrder->export_document_id)->trashed());
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Return Order Account',
            'domain' => 'return-order-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'return-order-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Return Order Admin',
            'email' => 'return-order-' . Str::lower(Str::random(6)) . '@example.com',
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
        $sku = (string) ($overrides['sku'] ?? 'SKU-' . Str::upper(Str::random(6)));

        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Test product',
            'slug' => Str::lower($sku),
            'sku' => $sku,
            'price' => 100000,
            'cost_price' => 60000,
            'expected_cost' => 60000,
            'stock_quantity' => 0,
            'damaged_quantity' => 0,
            'status' => true,
        ], $overrides));
    }

    private function createInventoryBatch(Account $account, Product $product, int $quantity, float $unitCost, string $suffix): InventoryBatch
    {
        return InventoryBatch::query()->create([
            'account_id' => $account->id,
            'product_id' => $product->id,
            'source_type' => 'import',
            'source_id' => 1,
            'batch_number' => 'LO-' . Str::upper($suffix),
            'received_at' => now(),
            'quantity' => $quantity,
            'remaining_quantity' => $quantity,
            'unit_cost' => $unitCost,
            'status' => 'open',
            'meta' => [
                'source_name' => 'Test import',
                'source_label' => 'TEST-' . Str::upper($suffix),
            ],
        ]);
    }

    private function createOriginOrder(Account $account, User $user, array $overrides = []): Order
    {
        return Order::query()->create(array_merge([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'OR' . random_int(10000, 99999) . 'RT',
            'order_kind' => Order::KIND_OFFICIAL,
            'total_price' => 180000,
            'status' => 'new',
            'customer_name' => 'Khach doi tra',
            'customer_email' => 'return-order@example.com',
            'customer_phone' => '0901234567',
            'shipping_address' => '123 Nguyen Trai',
            'province' => 'Tinh A',
            'district' => 'Quan B',
            'ward' => 'Phuong C',
            'notes' => 'Don goc test',
            'source' => 'Website',
            'type' => 'retail',
            'shipment_status' => 'pending',
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => 0,
            'shipping_status_source' => 'manual',
        ], $overrides));
    }
}
