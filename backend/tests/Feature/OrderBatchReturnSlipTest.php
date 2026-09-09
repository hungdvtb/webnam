<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryBatch;
use App\Models\InventoryDocument;
use App\Models\InventoryDocumentItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderSupplementItem;
use App\Models\Product;
use App\Models\Shipment;
use App\Models\User;
use App\Services\AccessControlService;
use App\Services\Shipping\ShipmentStatusSyncService;
use App\Support\OrderStatusCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
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

        $firstOrder = $this->createOfficialOrder($account, $user, $mainProduct, 4, 'OR-BATCH-0001', [
            'status' => 'pending_return',
        ]);
        $secondOrder = $this->createOfficialOrder($account, $user, $mainProduct, 6, 'OR-BATCH-0002', [
            'status' => 'pending_return',
        ]);

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
            'from_status' => 'pending_return',
            'to_status' => 'returned',
            'source' => 'system',
        ]);
        $this->assertDatabaseHas('order_status_logs', [
            'order_id' => $secondOrder->id,
            'from_status' => 'pending_return',
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

    public function test_managed_batch_return_extra_variant_uses_child_sku_name_and_cost(): void
    {
        [$account, $user] = $this->authenticate();

        $mainProduct = $this->createProduct($account, [
            'name' => 'San pham nguon cho bien the',
            'sku' => 'BATCH-VARIANT-SOURCE',
            'price' => 180000,
            'cost_price' => 100000,
            'expected_cost' => 100000,
            'status' => true,
        ]);

        $variantParent = $this->createProduct($account, [
            'name' => 'Ao hoan bien the',
            'sku' => 'BATCH-VARIANT-PARENT',
            'type' => 'configurable',
            'price' => 250000,
            'cost_price' => 150000,
            'expected_cost' => 150000,
            'stock_quantity' => 1,
            'status' => true,
        ]);

        $variantChild = $this->createProduct($account, [
            'name' => 'Ao hoan bien the - Do M',
            'sku' => 'BATCH-VARIANT-RED-M',
            'type' => 'simple',
            'price' => 260000,
            'cost_price' => 175000,
            'expected_cost' => 175000,
            'stock_quantity' => 8,
            'status' => true,
        ]);

        DB::table('product_links')->insert([
            'account_id' => $account->id,
            'product_id' => $variantParent->id,
            'linked_product_id' => $variantChild->id,
            'link_type' => 'super_link',
            'position' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $pickerResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'picker' => 1,
                'allow_variants' => 1,
                'search' => 'BATCH-VARIANT-RED-M',
                'per_page' => 20,
            ]));

        $pickerResponse->assertOk();
        $pickerRows = collect($pickerResponse->json('data'));
        $topLevelVariant = $pickerRows->firstWhere('id', $variantChild->id);
        $parentRow = $pickerRows->firstWhere('id', $variantParent->id);
        $nestedVariant = collect($parentRow['variations'] ?? [])->firstWhere('id', $variantChild->id);

        $this->assertNotNull($topLevelVariant);
        $this->assertSame('variation', $topLevelVariant['entry_kind']);
        $this->assertSame($variantParent->id, $topLevelVariant['parent_product_id']);
        $this->assertSame('BATCH-VARIANT-RED-M', $topLevelVariant['sku']);
        $this->assertSame(175000.0, (float) $topLevelVariant['cost_price']);
        $this->assertSame(8.0, (float) $topLevelVariant['stock_quantity']);
        $this->assertNotNull($nestedVariant);
        $this->assertSame('variation', $nestedVariant['entry_kind']);
        $this->assertSame($variantParent->id, $nestedVariant['parent_product_id']);

        $order = $this->createOfficialOrder($account, $user, $mainProduct, 1, 'OR-BATCH-VARIANT-0001');
        $this->createExportDocument($account, $order, $mainProduct, 1, 'PXK-BATCH-VARIANT-0001');

        $createResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/inventory-returns/batch', [
                'order_ids' => [$order->id],
                'document_date' => now()->toDateString(),
                'notes' => 'Batch return extra variant',
                'items' => [
                    [
                        'product_id' => $mainProduct->id,
                        'quantity' => 1,
                    ],
                    [
                        'product_id' => $variantChild->id,
                        'quantity' => 2,
                        'product_name' => 'Ao hoan bien the - Do M',
                        'product_sku' => 'BATCH-VARIANT-RED-M',
                        'is_extra_product' => true,
                    ],
                ],
            ]);

        $createResponse
            ->assertCreated()
            ->assertJsonPath('summary.exported_quantity', 1)
            ->assertJsonPath('summary.actual_quantity', 3)
            ->assertJsonPath('summary.discrepancy_quantity', 2);

        $returnDocumentId = (int) $createResponse->json('document.id');
        $extraItem = InventoryDocumentItem::query()
            ->where('inventory_document_id', $returnDocumentId)
            ->where('product_id', $variantChild->id)
            ->firstOrFail();

        $this->assertSame('BATCH-VARIANT-RED-M', $extraItem->product_sku_snapshot);
        $this->assertSame('Ao hoan bien the - Do M', $extraItem->product_name_snapshot);
        $this->assertSame(2, (int) $extraItem->quantity);
        $this->assertSame(175000.0, (float) $extraItem->unit_cost);
        $this->assertSame(350000.0, (float) $extraItem->total_cost);
        $this->assertTrue((bool) (($extraItem->meta ?? [])['is_extra_product'] ?? false));

        $responseVariantRow = collect($createResponse->json('products'))->firstWhere('product_id', $variantChild->id);
        $this->assertSame('BATCH-VARIANT-RED-M', $responseVariantRow['product_sku'] ?? null);
        $this->assertSame(175000.0, (float) ($responseVariantRow['cost_price'] ?? 0));
        $this->assertTrue((bool) ($responseVariantRow['is_extra_product'] ?? false));
        $this->assertSame('variation', $responseVariantRow['entry_kind'] ?? null);
        $this->assertSame($variantParent->id, $responseVariantRow['parent_product_id'] ?? null);
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

    public function test_managed_batch_return_marks_special_orders_returned_without_changing_order_statuses(): void
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

        $exchangeOrder->refresh();
        $partialOrder->refresh();

        $this->assertSame('pending_return', (string) $exchangeOrder->status);
        $this->assertSame('pending_return', (string) $partialOrder->status);
        $this->assertSame('returned', (string) $exchangeOrder->return_status);
        $this->assertSame('returned', (string) $partialOrder->return_status);
        $this->assertDatabaseMissing('order_status_logs', [
            'order_id' => $exchangeOrder->id,
            'from_status' => 'pending_return',
            'to_status' => 'exchange_completed',
            'source' => 'system',
        ]);
        $this->assertDatabaseMissing('order_status_logs', [
            'order_id' => $partialOrder->id,
            'from_status' => 'pending_return',
            'to_status' => 'partial_delivery',
            'source' => 'system',
        ]);
    }

    public function test_single_return_slip_marks_special_order_returned_without_changing_order_status(): void
    {
        [$account, $user] = $this->authenticate();

        $product = $this->createProduct($account, [
            'name' => 'San pham single return',
            'sku' => 'SINGLE-RETURN-001',
            'price' => 140000,
            'cost_price' => 88000,
            'expected_cost' => 88000,
        ]);

        $exchangeOrder = $this->createOfficialOrder($account, $user, $product, 2, 'OR-SINGLE-RETURN-0001', [
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'pending_return',
        ]);
        $partialOrder = $this->createOfficialOrder($account, $user, $product, 1, 'OR-SINGLE-RETURN-0002', [
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'status' => 'pending_return',
        ]);

        $this->createExportDocument($account, $exchangeOrder, $product, 2, 'PXK-SINGLE-RETURN-0001');
        $this->createExportDocument($account, $partialOrder, $product, 1, 'PXK-SINGLE-RETURN-0002');

        $documentIds = [];

        foreach ([[$exchangeOrder, 2], [$partialOrder, 1]] as [$order, $quantity]) {
            $createResponse = $this
                ->withHeaders($this->headers($account))
                ->postJson("/api/orders/{$order->id}/inventory-slips", [
                    'type' => 'return',
                    'document_date' => now()->toDateString(),
                    'notes' => 'Single return workflow',
                    'items' => [
                        [
                            'product_id' => $product->id,
                            'quantity' => $quantity,
                        ],
                    ],
                ])
                ->assertCreated();

            $documentIds[(int) $order->id] = (int) $createResponse->json('id');
        }

        $exchangeOrder->refresh();
        $partialOrder->refresh();

        $this->assertSame('pending_return', (string) $exchangeOrder->status);
        $this->assertSame('pending_return', (string) $partialOrder->status);
        $this->assertSame('returned', (string) $exchangeOrder->return_status);
        $this->assertSame('returned', (string) $partialOrder->return_status);
        $this->assertDatabaseMissing('order_status_logs', [
            'order_id' => $exchangeOrder->id,
            'from_status' => 'pending_return',
            'to_status' => 'exchange_completed',
            'source' => 'system',
        ]);
        $this->assertDatabaseMissing('order_status_logs', [
            'order_id' => $partialOrder->id,
            'from_status' => 'pending_return',
            'to_status' => 'partial_delivery',
            'source' => 'system',
        ]);

        foreach ([$exchangeOrder, $partialOrder] as $order) {
            $this
                ->withHeaders($this->headers($account))
                ->deleteJson("/api/orders/{$order->id}/inventory-slips/{$documentIds[(int) $order->id]}")
                ->assertOk();
        }

        $this->assertSame('pending_return', (string) $exchangeOrder->fresh()->status);
        $this->assertSame('pending_return', (string) $partialOrder->fresh()->status);
        $this->assertSame('not_returned', (string) $exchangeOrder->fresh()->return_status);
        $this->assertSame('not_returned', (string) $partialOrder->fresh()->return_status);
    }

    public function test_auto_return_slip_skips_orders_created_before_rollout_cutoff(): void
    {
        [$account, $user] = $this->authenticate();
        OrderStatusCatalog::ensureDefaultSystemStatuses((int) $account->id);

        DB::table('system_settings')->updateOrInsert(
            ['key' => 'orders.auto_return_slip_start_at'],
            [
                'value' => now()->toDateTimeString(),
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        $oldCreatedAt = now()->subDay();

        $product = $this->createProduct($account, [
            'name' => 'San pham don cu da can kho',
            'sku' => 'OLD-AUTO-RETURNED-001',
            'price' => 150000,
            'cost_price' => 70000,
            'expected_cost' => 70000,
        ]);

        $oldReturnedOrder = $this->createOfficialOrder($account, $user, $product, 2, 'OR-OLD-AUTO-RETURNED-0001', [
            'status' => 'shipping',
            'return_status' => 'not_returned',
        ]);
        $oldReturnedOrder->forceFill([
            'created_at' => $oldCreatedAt,
            'updated_at' => $oldCreatedAt,
            'officialized_at' => $oldCreatedAt,
        ])->save();
        $this->createExportDocument($account, $oldReturnedOrder, $product, 2, 'PXK-OLD-AUTO-RETURNED-0001');

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$oldReturnedOrder->id}/status", [
                'status' => OrderStatusCatalog::RETURNED_CODE,
            ])
            ->assertOk()
            ->assertJsonPath('status', OrderStatusCatalog::RETURNED_CODE);

        $this->assertSame(0, InventoryDocument::query()
            ->where('type', 'return')
            ->where('reference_type', 'order')
            ->where('reference_id', $oldReturnedOrder->id)
            ->count());

        $sentProduct = $this->createProduct($account, [
            'name' => 'San pham doi don cu',
            'sku' => 'OLD-EXCHANGE-SENT-001',
        ]);
        $returnedProduct = $this->createProduct($account, [
            'name' => 'San pham doi ve don cu',
            'sku' => 'OLD-EXCHANGE-RETURNED-001',
            'price' => 125000,
            'cost_price' => 65000,
            'expected_cost' => 65000,
        ]);

        $oldExchangeOrder = $this->createOfficialOrder($account, $user, $sentProduct, 1, 'OR-OLD-AUTO-EXCHANGE-0001', [
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'pending_return',
            'return_status' => 'not_returned',
        ]);
        $oldExchangeOrder->forceFill([
            'created_at' => $oldCreatedAt,
            'updated_at' => $oldCreatedAt,
            'officialized_at' => $oldCreatedAt,
        ])->save();

        OrderSupplementItem::query()->create([
            'order_id' => $oldExchangeOrder->id,
            'account_id' => $account->id,
            'product_id' => $returnedProduct->id,
            'product_name_snapshot' => $returnedProduct->name,
            'product_sku_snapshot' => $returnedProduct->sku,
            'quantity' => 1,
            'price' => 125000,
            'cost_price' => 65000,
            'total_price' => 125000,
            'total_cost' => 65000,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$oldExchangeOrder->id}/status", [
                'status' => OrderStatusCatalog::EXCHANGE_COMPLETED_CODE,
            ])
            ->assertOk()
            ->assertJsonPath('status', OrderStatusCatalog::EXCHANGE_COMPLETED_CODE);

        $this->assertSame(0, InventoryDocument::query()
            ->where('type', 'return')
            ->where('reference_type', 'order')
            ->where('reference_id', $oldExchangeOrder->id)
            ->count());
        $this->assertSame('not_returned', (string) $oldExchangeOrder->fresh()->return_status);
        $this->assertSame('0.000', (string) $returnedProduct->fresh()->stock_quantity);
    }

    public function test_pending_return_quantity_and_drilldown_ignore_orders_before_rollout_cutoff(): void
    {
        [$account, $user] = $this->authenticate();

        DB::table('system_settings')->updateOrInsert(
            ['key' => 'orders.auto_return_slip_start_at'],
            [
                'value' => now()->toDateTimeString(),
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        $product = $this->createProduct($account, [
            'name' => 'San pham cho hoan tinh tu don moi',
            'sku' => 'ROLLOUT-PENDING-RETURN-001',
        ]);

        $oldCreatedAt = now()->subDay();
        $oldOrder = $this->createOfficialOrder($account, $user, $product, 4, 'OR-OLD-PENDING-RETURN-0001', [
            'status' => 'pending_return',
        ]);
        $oldOrder->forceFill([
            'created_at' => $oldCreatedAt,
            'updated_at' => $oldCreatedAt,
            'officialized_at' => $oldCreatedAt,
        ])->save();

        $newOrder = $this->createOfficialOrder($account, $user, $product, 2, 'OR-NEW-PENDING-RETURN-0001', [
            'status' => 'pending_return',
        ]);

        $inventoryResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/inventory/products?' . http_build_query([
                'per_page' => 20,
            ]));

        $inventoryResponse->assertOk();

        $row = collect($inventoryResponse->json('data'))->firstWhere('id', $product->id);
        $summary = $inventoryResponse->json('summary');

        $this->assertNotNull($row);
        $this->assertSame(2, (int) ($row['pending_return_quantity'] ?? 0));
        $this->assertSame(2, (int) ($summary['total_pending_return'] ?? 0));

        $ordersResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?' . http_build_query([
                'inventory_stock_scope' => 'pending_return',
                'inventory_product_ids' => $product->id,
                'per_page' => 100,
            ]));

        $ordersResponse->assertOk();

        $returnedIds = collect($ordersResponse->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertContains($newOrder->id, $returnedIds);
        $this->assertNotContains($oldOrder->id, $returnedIds);
    }

    public function test_returned_status_auto_creates_return_slip_for_exported_order_items(): void
    {
        [$account, $user] = $this->authenticate();
        OrderStatusCatalog::ensureDefaultSystemStatuses((int) $account->id);

        $product = $this->createProduct($account, [
            'name' => 'San pham da hoan tu dong',
            'sku' => 'AUTO-RETURNED-001',
            'price' => 150000,
            'cost_price' => 70000,
            'expected_cost' => 70000,
        ]);

        $order = $this->createOfficialOrder($account, $user, $product, 3, 'OR-AUTO-RETURNED-0001', [
            'status' => 'shipping',
            'return_status' => 'not_returned',
        ]);
        $this->createExportDocument($account, $order, $product, 3, 'PXK-AUTO-RETURNED-0001');

        $response = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$order->id}/status", [
                'status' => OrderStatusCatalog::RETURNED_CODE,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('status', OrderStatusCatalog::RETURNED_CODE);

        $document = InventoryDocument::query()
            ->where('type', 'return')
            ->where('reference_type', 'order')
            ->where('reference_id', $order->id)
            ->firstOrFail();

        $this->assertSame('completed', (string) $document->status);
        $this->assertSame('returned_order_auto_return', (string) data_get($document->meta, 'source'));
        $this->assertSame('order_status_update', (string) data_get($document->meta, 'created_from'));
        $this->assertSame('3.000', (string) $document->total_quantity);
        $this->assertSame('210000.00', (string) $document->total_amount);
        $this->assertDatabaseHas('inventory_document_items', [
            'inventory_document_id' => $document->id,
            'product_id' => $product->id,
            'quantity' => 3,
            'direction' => 'in',
            'unit_cost' => 70000,
            'total_cost' => 210000,
        ]);

        $repeatResponse = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$order->id}/status", [
                'status' => OrderStatusCatalog::RETURNED_CODE,
            ]);

        $repeatResponse->assertOk();
        $this->assertSame(1, InventoryDocument::query()
            ->where('type', 'return')
            ->where('reference_type', 'order')
            ->where('reference_id', $order->id)
            ->count());
    }

    public function test_returned_shipment_sync_auto_creates_return_slip_for_order_items(): void
    {
        [$account, $user] = $this->authenticate();
        OrderStatusCatalog::ensureDefaultSystemStatuses((int) $account->id);

        $product = $this->createProduct($account, [
            'name' => 'San pham van don da hoan',
            'sku' => 'AUTO-SHIP-RETURNED-001',
            'price' => 170000,
            'cost_price' => 90000,
            'expected_cost' => 90000,
        ]);

        $order = $this->createOfficialOrder($account, $user, $product, 2, 'OR-AUTO-SHIP-RETURNED-0001', [
            'status' => 'shipping',
            'return_status' => 'not_returned',
        ]);

        $shipment = Shipment::query()->create([
            'account_id' => $account->id,
            'order_id' => $order->id,
            'order_code' => $order->order_number,
            'shipment_number' => 'VD-AUTO-SHIP-RETURNED',
            'tracking_number' => 'TRACK-AUTO-SHIP-RETURNED',
            'carrier_tracking_code' => 'TRACK-AUTO-SHIP-RETURNED',
            'carrier_name' => 'Manual Carrier',
            'channel' => 'manual',
            'customer_name' => $order->customer_name,
            'customer_phone' => $order->customer_phone,
            'customer_address' => $order->shipping_address,
            'status' => 'returned',
            'shipment_status' => 'returned',
            'cod_amount' => (float) $order->total_price,
            'shipping_cost' => 0,
            'service_fee' => 0,
            'actual_received_amount' => 0,
            'created_by' => $user->id,
            'shipped_at' => now(),
            'returned_at' => now(),
        ]);

        $synced = app(ShipmentStatusSyncService::class)->syncOrderFromShipment(
            $shipment->fresh(),
            'shipment_sync',
            $user->id
        );

        $this->assertTrue($synced);
        $order->refresh();
        $this->assertSame(OrderStatusCatalog::RETURNED_CODE, (string) $order->status);

        $document = InventoryDocument::query()
            ->where('type', 'return')
            ->where('reference_type', 'order')
            ->where('reference_id', $order->id)
            ->firstOrFail();

        $this->assertSame('returned_order_auto_return', (string) data_get($document->meta, 'source'));
        $this->assertSame('shipment_sync', (string) data_get($document->meta, 'created_from'));
        $this->assertDatabaseHas('inventory_document_items', [
            'inventory_document_id' => $document->id,
            'product_id' => $product->id,
            'quantity' => 2,
            'direction' => 'in',
            'unit_cost' => 90000,
            'total_cost' => 180000,
        ]);
    }

    public function test_exchange_completed_status_auto_creates_return_slip_for_supplement_items(): void
    {
        [$account, $user] = $this->authenticate();
        OrderStatusCatalog::ensureDefaultSystemStatuses((int) $account->id);

        $sentProduct = $this->createProduct($account, [
            'name' => 'San pham gui doi',
            'sku' => 'EXCHANGE-SENT-001',
            'price' => 180000,
            'cost_price' => 90000,
            'expected_cost' => 90000,
        ]);
        $returnedProduct = $this->createProduct($account, [
            'name' => 'San pham khach doi ve',
            'sku' => 'EXCHANGE-RETURNED-001',
            'price' => 220000,
            'cost_price' => 80000,
            'expected_cost' => 80000,
        ]);

        $order = $this->createOfficialOrder($account, $user, $sentProduct, 1, 'OR-AUTO-EXCHANGE-0001', [
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'pending_return',
            'return_status' => 'not_returned',
        ]);

        OrderSupplementItem::query()->create([
            'order_id' => $order->id,
            'account_id' => $account->id,
            'product_id' => $returnedProduct->id,
            'product_name_snapshot' => $returnedProduct->name,
            'product_sku_snapshot' => $returnedProduct->sku,
            'quantity' => 2,
            'price' => 220000,
            'cost_price' => 80000,
            'total_price' => 440000,
            'total_cost' => 160000,
            'notes' => 'Hang khach doi ve',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$order->id}/status", [
                'status' => OrderStatusCatalog::EXCHANGE_COMPLETED_CODE,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('status', OrderStatusCatalog::EXCHANGE_COMPLETED_CODE)
            ->assertJsonPath('return_status', 'returned');

        $document = InventoryDocument::query()
            ->where('type', 'return')
            ->where('reference_type', 'order')
            ->where('reference_id', $order->id)
            ->firstOrFail();

        $this->assertSame('completed', (string) $document->status);
        $this->assertSame('exchange_completed_auto_return', (string) data_get($document->meta, 'source'));
        $this->assertSame('order_status_update', (string) data_get($document->meta, 'created_from'));
        $this->assertSame('2.000', (string) $document->total_quantity);
        $this->assertSame('160000.00', (string) $document->total_amount);

        $this->assertDatabaseHas('inventory_document_items', [
            'inventory_document_id' => $document->id,
            'product_id' => $returnedProduct->id,
            'quantity' => 2,
            'direction' => 'in',
            'unit_cost' => 80000,
            'total_cost' => 160000,
        ]);
        $this->assertDatabaseMissing('inventory_document_items', [
            'inventory_document_id' => $document->id,
            'product_id' => $sentProduct->id,
        ]);
        $this->assertDatabaseHas('inventory_batches', [
            'source_type' => 'document',
            'source_id' => $document->id,
            'product_id' => $returnedProduct->id,
            'quantity' => 2,
            'remaining_quantity' => 2,
            'unit_cost' => 80000,
            'status' => 'open',
        ]);

        $returnedProduct->refresh();
        $this->assertSame('2.000', (string) $returnedProduct->stock_quantity);

        $repeatResponse = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$order->id}/status", [
                'status' => OrderStatusCatalog::EXCHANGE_COMPLETED_CODE,
            ]);

        $repeatResponse->assertOk();
        $this->assertSame(1, InventoryDocument::query()
            ->where('type', 'return')
            ->where('reference_type', 'order')
            ->where('reference_id', $order->id)
            ->count());
        $this->assertSame(1, InventoryBatch::query()
            ->where('source_type', 'document')
            ->where('source_id', $document->id)
            ->where('product_id', $returnedProduct->id)
            ->count());
    }

    public function test_exchange_delivery_shipment_sync_auto_creates_return_slip(): void
    {
        [$account, $user] = $this->authenticate();
        OrderStatusCatalog::ensureDefaultSystemStatuses((int) $account->id);

        $sentProduct = $this->createProduct($account, [
            'name' => 'San pham gui doi qua van don',
            'sku' => 'EXCHANGE-SHIP-SENT-001',
        ]);
        $returnedProduct = $this->createProduct($account, [
            'name' => 'San pham doi ve qua van don',
            'sku' => 'EXCHANGE-SHIP-RETURNED-001',
            'price' => 125000,
            'cost_price' => 65000,
            'expected_cost' => 65000,
        ]);

        $order = $this->createOfficialOrder($account, $user, $sentProduct, 1, 'OR-AUTO-EXCHANGE-SHIP-0001', [
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'pending_return',
            'return_status' => 'not_returned',
            'return_tracking_code' => 'TRACK-EXCHANGE-DH',
        ]);

        OrderSupplementItem::query()->create([
            'order_id' => $order->id,
            'account_id' => $account->id,
            'product_id' => $returnedProduct->id,
            'product_name_snapshot' => $returnedProduct->name,
            'product_sku_snapshot' => $returnedProduct->sku,
            'quantity' => 1,
            'price' => 125000,
            'cost_price' => 65000,
            'total_price' => 125000,
            'total_cost' => 65000,
        ]);

        $shipment = Shipment::query()->create([
            'account_id' => $account->id,
            'order_id' => $order->id,
            'order_code' => $order->order_number,
            'shipment_number' => 'VD-AUTO-EXCHANGE-SHIP',
            'tracking_number' => 'TRACK-EXCHANGE-DH',
            'carrier_tracking_code' => 'TRACK-EXCHANGE-DH',
            'carrier_name' => 'Manual Carrier',
            'channel' => 'manual',
            'customer_name' => $order->customer_name,
            'customer_phone' => $order->customer_phone,
            'customer_address' => $order->shipping_address,
            'status' => 'delivered',
            'shipment_status' => 'delivered',
            'cod_amount' => (float) $order->total_price,
            'shipping_cost' => 0,
            'service_fee' => 0,
            'actual_received_amount' => (float) $order->total_price,
            'created_by' => $user->id,
            'shipped_at' => now(),
            'delivered_at' => now(),
        ]);

        $synced = app(ShipmentStatusSyncService::class)->syncOrderFromShipment(
            $shipment->fresh(),
            'shipment_sync',
            $user->id
        );

        $this->assertTrue($synced);
        $order->refresh();
        $this->assertSame(OrderStatusCatalog::EXCHANGE_COMPLETED_CODE, (string) $order->status);
        $this->assertSame('returned', (string) $order->return_status);
        $this->assertSame(1, InventoryDocument::query()
            ->where('type', 'return')
            ->where('reference_type', 'order')
            ->where('reference_id', $order->id)
            ->count());
        $this->assertDatabaseHas('inventory_document_items', [
            'product_id' => $returnedProduct->id,
            'quantity' => 1,
            'direction' => 'in',
            'unit_cost' => 65000,
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
        $user->accounts()->attach($account->id, [
            'role' => 'owner',
            'status' => 1,
            'permissions' => json_encode(AccessControlService::permissionsForRole('owner')),
            'data_permissions' => json_encode(AccessControlService::dataPermissionsForRole('owner')),
        ]);

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
