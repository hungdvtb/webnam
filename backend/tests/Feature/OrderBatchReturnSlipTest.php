<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryDocument;
use App\Models\InventoryDocumentItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class OrderBatchReturnSlipTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_creates_and_updates_managed_batch_return_with_adjustment_reconciliation(): void
    {
        [$account, $user] = $this->authenticate();

        $mainProduct = $this->createProduct($account, [
            'name' => 'San pham batch return',
            'sku' => 'BATCH-RETURN-001',
            'price' => 180000,
            'cost_price' => 110000,
            'expected_cost' => 110000,
        ]);

        $extraProduct = $this->createProduct($account, [
            'name' => 'San pham gui nham',
            'sku' => 'BATCH-RETURN-EXTRA',
            'price' => 90000,
            'cost_price' => 55000,
            'expected_cost' => 55000,
        ]);

        $firstOrder = $this->createOfficialOrder($account, $user, $mainProduct, 4, 'OR-BATCH-0001');
        $secondOrder = $this->createOfficialOrder($account, $user, $mainProduct, 6, 'OR-BATCH-0002');

        $this->createExportDocument($account, $firstOrder, $mainProduct, 4, 'PXK-BATCH-0001');
        $this->createExportDocument($account, $secondOrder, $mainProduct, 6, 'PXK-BATCH-0002');

        $createResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/inventory-returns/batch', [
                'order_ids' => [$firstOrder->id, $secondOrder->id],
                'document_date' => now()->toDateString(),
                'notes' => 'Batch return test',
                'items' => [
                    [
                        'product_id' => $mainProduct->id,
                        'quantity' => 9,
                    ],
                    [
                        'product_id' => $extraProduct->id,
                        'quantity' => 2,
                    ],
                ],
            ]);

        $createResponse
            ->assertCreated()
            ->assertJsonPath('summary.exported_quantity', 10)
            ->assertJsonPath('summary.actual_quantity', 11)
            ->assertJsonPath('summary.discrepancy_quantity', 1);

        $returnDocumentId = (int) $createResponse->json('document.id');

        $returnDocument = InventoryDocument::query()->findOrFail($returnDocumentId);
        $adjustmentDocument = InventoryDocument::query()
            ->where('type', 'adjustment')
            ->where('parent_document_id', $returnDocumentId)
            ->first();

        $this->assertNotNull($adjustmentDocument);
        $this->assertSame(InventoryDocument::ADJUSTMENT_KIND_EXPORT, (string) $adjustmentDocument->adjustment_kind);
        $this->assertSame(InventoryDocument::ADJUSTMENT_SOURCE_RETURN_RECONCILIATION, (string) $adjustmentDocument->adjustment_source);
        $this->assertDatabaseCount('inventory_document_order_links', 2);
        $this->assertDatabaseHas('inventory_document_items', [
            'inventory_document_id' => $returnDocumentId,
            'product_id' => $mainProduct->id,
            'quantity' => 9,
        ]);
        $this->assertDatabaseHas('inventory_document_items', [
            'inventory_document_id' => $returnDocumentId,
            'product_id' => $extraProduct->id,
            'quantity' => 2,
        ]);
        $this->assertDatabaseHas('inventory_document_item_order_links', [
            'order_id' => $secondOrder->id,
            'product_id' => $mainProduct->id,
            'actual_quantity' => 5,
            'export_adjustment_quantity' => -1,
        ]);
        $this->assertDatabaseHas('inventory_document_item_order_links', [
            'order_id' => $firstOrder->id,
            'product_id' => $extraProduct->id,
            'actual_quantity' => 2,
            'export_adjustment_quantity' => 2,
        ]);
        $this->assertDatabaseHas('inventory_document_items', [
            'inventory_document_id' => $adjustmentDocument->id,
            'product_id' => $mainProduct->id,
            'quantity' => 1,
            'direction' => 'out',
        ]);
        $this->assertDatabaseHas('inventory_document_items', [
            'inventory_document_id' => $adjustmentDocument->id,
            'product_id' => $extraProduct->id,
            'quantity' => 2,
            'direction' => 'in',
        ]);

        $firstOrder->refresh();
        $secondOrder->refresh();

        $this->assertSame('returned', (string) $firstOrder->status);
        $this->assertSame('returned', (string) $secondOrder->status);
        $this->assertDatabaseHas('order_status_logs', [
            'order_id' => $firstOrder->id,
            'from_status' => 'new',
            'to_status' => 'returned',
            'source' => 'system',
        ]);
        $this->assertDatabaseHas('order_status_logs', [
            'order_id' => $secondOrder->id,
            'from_status' => 'new',
            'to_status' => 'returned',
            'source' => 'system',
        ]);

        $updateResponse = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/inventory-returns/{$returnDocumentId}", [
                'document_date' => now()->toDateString(),
                'notes' => 'Batch return updated',
                'items' => [
                    [
                        'product_id' => $mainProduct->id,
                        'quantity' => 0,
                    ],
                    [
                        'product_id' => $extraProduct->id,
                        'quantity' => 2,
                    ],
                ],
            ]);

        $updateResponse
            ->assertOk()
            ->assertJsonPath('summary.exported_quantity', 10)
            ->assertJsonPath('summary.actual_quantity', 2)
            ->assertJsonPath('summary.discrepancy_quantity', -8);

        $updatedAdjustmentDocument = InventoryDocument::query()
            ->where('type', 'adjustment')
            ->where('parent_document_id', $returnDocumentId)
            ->first();

        $this->assertNotNull($updatedAdjustmentDocument);
        $this->assertDatabaseHas('inventory_document_items', [
            'inventory_document_id' => $returnDocumentId,
            'product_id' => $mainProduct->id,
            'quantity' => 0,
        ]);
        $this->assertDatabaseHas('inventory_document_item_order_links', [
            'order_id' => $firstOrder->id,
            'product_id' => $mainProduct->id,
            'actual_quantity' => 0,
            'export_adjustment_quantity' => -4,
        ]);
        $this->assertDatabaseHas('inventory_document_item_order_links', [
            'order_id' => $secondOrder->id,
            'product_id' => $mainProduct->id,
            'actual_quantity' => 0,
            'export_adjustment_quantity' => -6,
        ]);
        $this->assertDatabaseHas('inventory_document_items', [
            'inventory_document_id' => $updatedAdjustmentDocument->id,
            'product_id' => $mainProduct->id,
            'quantity' => 10,
            'direction' => 'out',
        ]);
        $this->assertDatabaseHas('inventory_document_items', [
            'inventory_document_id' => $updatedAdjustmentDocument->id,
            'product_id' => $extraProduct->id,
            'quantity' => 2,
            'direction' => 'in',
        ]);
    }

    public function test_managed_batch_return_delete_restore_and_force_delete_keep_parent_and_adjustment_in_sync(): void
    {
        [$account, $user] = $this->authenticate();

        $mainProduct = $this->createProduct($account, [
            'name' => 'San pham batch return trash',
            'sku' => 'BATCH-RETURN-TRASH-001',
            'price' => 210000,
            'cost_price' => 130000,
            'expected_cost' => 130000,
        ]);

        $extraProduct = $this->createProduct($account, [
            'name' => 'San pham chenh lech',
            'sku' => 'BATCH-RETURN-TRASH-EXTRA',
            'price' => 95000,
            'cost_price' => 60000,
            'expected_cost' => 60000,
        ]);

        $firstOrder = $this->createOfficialOrder($account, $user, $mainProduct, 3, 'OR-BATCH-TRASH-0001');
        $secondOrder = $this->createOfficialOrder($account, $user, $mainProduct, 2, 'OR-BATCH-TRASH-0002');

        $this->createExportDocument($account, $firstOrder, $mainProduct, 3, 'PXK-BATCH-TRASH-0001');
        $this->createExportDocument($account, $secondOrder, $mainProduct, 2, 'PXK-BATCH-TRASH-0002');

        $createResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/inventory-returns/batch', [
                'order_ids' => [$firstOrder->id, $secondOrder->id],
                'document_date' => now()->toDateString(),
                'notes' => 'Managed return trash test',
                'items' => [
                    [
                        'product_id' => $mainProduct->id,
                        'quantity' => 4,
                    ],
                    [
                        'product_id' => $extraProduct->id,
                        'quantity' => 1,
                    ],
                ],
            ]);

        $createResponse->assertCreated();

        $returnDocumentId = (int) $createResponse->json('document.id');
        $returnDocument = InventoryDocument::query()->findOrFail($returnDocumentId);
        $adjustmentDocument = InventoryDocument::query()
            ->where('type', 'adjustment')
            ->where('parent_document_id', $returnDocumentId)
            ->first();

        $this->assertNotNull($adjustmentDocument);
        $this->assertSame('returned', (string) $firstOrder->fresh()->status);
        $this->assertSame('returned', (string) $secondOrder->fresh()->status);

        $this->withHeaders($this->headers($account))
            ->deleteJson("/api/inventory/documents/adjustment/{$adjustmentDocument->id}")
            ->assertOk();

        $this->assertSoftDeleted('inventory_documents', ['id' => $returnDocumentId]);
        $this->assertSoftDeleted('inventory_documents', ['id' => $adjustmentDocument->id]);
        $this->assertSame('new', (string) $firstOrder->fresh()->status);
        $this->assertSame('new', (string) $secondOrder->fresh()->status);
        $this->assertDatabaseHas('order_status_logs', [
            'order_id' => $firstOrder->id,
            'from_status' => 'returned',
            'to_status' => 'new',
            'source' => 'system',
        ]);
        $this->assertDatabaseHas('order_status_logs', [
            'order_id' => $secondOrder->id,
            'from_status' => 'returned',
            'to_status' => 'new',
            'source' => 'system',
        ]);

        $trashRows = collect(
            $this->withHeaders($this->headers($account))
                ->getJson('/api/inventory/trash/slips?per_page=100')
                ->assertOk()
                ->json('data')
        );

        $returnRow = $trashRows->firstWhere('code', $returnDocument->document_number);
        $this->assertSame('return', $returnRow['slip_type_key'] ?? null);
        $this->assertNull($trashRows->firstWhere('code', $adjustmentDocument->document_number));

        $this->withHeaders($this->headers($account))
            ->postJson("/api/inventory/documents/return/{$returnDocumentId}/restore")
            ->assertOk();

        $this->assertFalse(InventoryDocument::withTrashed()->findOrFail($returnDocumentId)->trashed());
        $this->assertFalse(InventoryDocument::withTrashed()->findOrFail($adjustmentDocument->id)->trashed());
        $this->assertSame('returned', (string) $firstOrder->fresh()->status);
        $this->assertSame('returned', (string) $secondOrder->fresh()->status);

        $this->withHeaders($this->headers($account))
            ->deleteJson("/api/inventory/documents/return/{$returnDocumentId}")
            ->assertOk();
        $this->assertSame('new', (string) $firstOrder->fresh()->status);
        $this->assertSame('new', (string) $secondOrder->fresh()->status);

        $this->withHeaders($this->headers($account))
            ->deleteJson("/api/inventory/documents/return/{$returnDocumentId}/force")
            ->assertOk();

        $this->assertDatabaseMissing('inventory_documents', ['id' => $returnDocumentId]);
        $this->assertDatabaseMissing('inventory_documents', ['id' => $adjustmentDocument->id]);
    }

    public function test_managed_batch_return_applies_special_system_statuses_for_exchange_and_partial_orders(): void
    {
        [$account, $user] = $this->authenticate();

        $product = $this->createProduct($account, [
            'name' => 'San pham workflow return',
            'sku' => 'WORKFLOW-RETURN-001',
            'price' => 160000,
            'cost_price' => 95000,
            'expected_cost' => 95000,
        ]);

        $exchangeOrder = $this->createOfficialOrder($account, $user, $product, 2, 'OR-EXCHANGE-0001', [
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'pending_return',
        ]);
        $partialOrder = $this->createOfficialOrder($account, $user, $product, 1, 'OR-PARTIAL-0001', [
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'status' => 'pending_return',
        ]);

        $this->createExportDocument($account, $exchangeOrder, $product, 2, 'PXK-EXCHANGE-0001');
        $this->createExportDocument($account, $partialOrder, $product, 1, 'PXK-PARTIAL-0001');

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/inventory-returns/batch', [
                'order_ids' => [$exchangeOrder->id, $partialOrder->id],
                'document_date' => now()->toDateString(),
                'notes' => 'Return workflow special statuses',
                'items' => [
                    [
                        'product_id' => $product->id,
                        'quantity' => 3,
                    ],
                ],
            ])
            ->assertCreated();

        $this->assertSame('exchange_completed', (string) $exchangeOrder->fresh()->status);
        $this->assertSame('partial_delivery', (string) $partialOrder->fresh()->status);
        $this->assertDatabaseHas('order_status_logs', [
            'order_id' => $exchangeOrder->id,
            'from_status' => 'pending_return',
            'to_status' => 'exchange_completed',
            'source' => 'system',
        ]);
        $this->assertDatabaseHas('order_status_logs', [
            'order_id' => $partialOrder->id,
            'from_status' => 'pending_return',
            'to_status' => 'partial_delivery',
            'source' => 'system',
        ]);
        $this->assertDatabaseHas('order_statuses', [
            'account_id' => $account->id,
            'code' => 'exchange_completed',
            'is_system' => true,
        ]);
        $this->assertDatabaseHas('order_statuses', [
            'account_id' => $account->id,
            'code' => 'partial_delivery',
            'is_system' => true,
        ]);
    }

    public function test_single_return_slip_applies_exchange_completed_status_and_restores_previous_status_when_deleted(): void
    {
        [$account, $user] = $this->authenticate();

        $product = $this->createProduct($account, [
            'name' => 'San pham single return',
            'sku' => 'SINGLE-RETURN-001',
            'price' => 140000,
            'cost_price' => 88000,
            'expected_cost' => 88000,
        ]);

        $order = $this->createOfficialOrder($account, $user, $product, 2, 'OR-SINGLE-RETURN-0001', [
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'pending_return',
        ]);

        $this->createExportDocument($account, $order, $product, 2, 'PXK-SINGLE-RETURN-0001');

        $createResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$order->id}/inventory-slips", [
                'type' => 'return',
                'document_date' => now()->toDateString(),
                'notes' => 'Single return workflow',
                'items' => [
                    [
                        'product_id' => $product->id,
                        'quantity' => 2,
                    ],
                ],
            ])
            ->assertCreated();

        $documentId = (int) $createResponse->json('id');

        $this->assertSame('exchange_completed', (string) $order->fresh()->status);
        $this->assertDatabaseHas('order_status_logs', [
            'order_id' => $order->id,
            'from_status' => 'pending_return',
            'to_status' => 'exchange_completed',
            'source' => 'system',
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->deleteJson("/api/orders/{$order->id}/inventory-slips/{$documentId}")
            ->assertOk();

        $this->assertSame('pending_return', (string) $order->fresh()->status);
        $this->assertDatabaseHas('order_status_logs', [
            'order_id' => $order->id,
            'from_status' => 'exchange_completed',
            'to_status' => 'pending_return',
            'source' => 'system',
        ]);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Batch Return Test ' . Str::upper(Str::random(4)),
            'domain' => 'batch-return-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'batch-return-' . Str::lower(Str::random(6)),
            'status' => 'active',
        ]);

        $user = User::factory()->create();
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
        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'name' => 'San pham test ' . Str::upper(Str::random(3)),
            'sku' => 'SKU-' . Str::upper(Str::random(8)),
            'slug' => 'san-pham-' . Str::lower(Str::random(8)),
            'type' => 'simple',
            'status' => 'active',
            'price' => 100000,
            'cost_price' => 70000,
            'expected_cost' => 70000,
            'stock_quantity' => 0,
            'damaged_quantity' => 0,
        ], $overrides));
    }

    private function createOfficialOrder(Account $account, User $user, Product $product, int $quantity, string $orderNumber, array $overrides = []): Order
    {
        $order = Order::query()->create(array_merge([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => $orderNumber,
            'order_kind' => Order::KIND_OFFICIAL,
            'status' => 'new',
            'customer_name' => 'Khach ' . $orderNumber,
            'customer_phone' => '090' . random_int(1000000, 9999999),
            'shipping_address' => 'Dia chi test',
            'total_price' => $quantity * (float) ($product->price ?? 0),
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => $quantity * (float) ($product->cost_price ?? 0),
            'profit_total' => ($quantity * (float) ($product->price ?? 0)) - ($quantity * (float) ($product->cost_price ?? 0)),
        ], $overrides));

        OrderItem::query()->create([
            'order_id' => $order->id,
            'account_id' => $account->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => $quantity,
            'price' => $product->price,
            'cost_price' => $product->cost_price,
            'cost_total' => $quantity * (float) ($product->cost_price ?? 0),
            'profit_total' => ($quantity * (float) ($product->price ?? 0)) - ($quantity * (float) ($product->cost_price ?? 0)),
        ]);

        return $order;
    }

    private function createExportDocument(Account $account, Order $order, Product $product, int $quantity, string $documentNumber): InventoryDocument
    {
        $document = InventoryDocument::query()->create([
            'account_id' => $account->id,
            'document_number' => $documentNumber,
            'type' => 'export',
            'document_date' => now()->toDateString(),
            'status' => 'completed',
            'reference_type' => 'order',
            'reference_id' => $order->id,
            'total_quantity' => $quantity,
            'total_amount' => $quantity * (float) ($product->price ?? 0),
            'notes' => 'Export test',
        ]);

        InventoryDocumentItem::query()->create([
            'account_id' => $account->id,
            'inventory_document_id' => $document->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => $quantity,
            'stock_bucket' => 'sellable',
            'direction' => 'out',
            'unit_cost' => $product->cost_price ?? 0,
            'total_cost' => $quantity * (float) ($product->cost_price ?? 0),
            'unit_price' => $product->price ?? 0,
            'total_price' => $quantity * (float) ($product->price ?? 0),
        ]);

        return $document;
    }
}
