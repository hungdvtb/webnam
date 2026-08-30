<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryDocument;
use App\Models\InventoryImportStatus;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\User;
use App\Services\Inventory\InventoryService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class InventoryProductStockSummaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_inventory_products_use_real_slip_history_for_stock_statistics(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham thong ke ton kho',
            'sku' => 'TON-KHO-001',
        ]);

        $service = app(InventoryService::class);

        $service->createImport([
            'supplier_id' => $supplier->id,
            'inventory_import_status_id' => $this->completedImportStatusId(),
            'status_is_manual' => true,
            'import_date' => now()->subDays(5)->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 12,
                'received_quantity' => 10,
                'unit_cost' => 100000,
            ]],
        ], $account->id, $user->id);

        $service->createDocument('export', [
            'document_date' => now()->subDays(4)->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 4,
            ]],
        ], $account->id, $user->id);

        $service->createDocument('return', [
            'document_date' => now()->subDays(3)->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 1,
                'unit_cost' => 100000,
            ]],
        ], $account->id, $user->id);

        $service->createDocument('damaged', [
            'document_date' => now()->subDays(2)->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 2,
            ]],
        ], $account->id, $user->id);

        $service->createDocument('adjustment', [
            'document_date' => now()->subDay()->toDateString(),
            'items' => [
                [
                    'product_id' => $product->id,
                    'quantity' => 3,
                    'unit_cost' => 100000,
                ],
                [
                    'product_id' => $product->id,
                    'quantity' => -1,
                ],
            ],
        ], $account->id, $user->id);

        $order = $this->createOrder($account, $user, [
            'order_number' => 'ORD-NO-SLIP-001',
            'status' => 'draft',
        ]);
        $this->createOrderItem($account, $order, $product, 99);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/inventory/products?per_page=20');

        $response->assertOk();

        $row = collect($response->json('data'))->firstWhere('id', $product->id);
        $summary = $response->json('summary');

        $this->assertNotNull($row);
        $this->assertSame(10, (int) ($row['total_imported'] ?? 0));
        $this->assertSame(4, (int) ($row['total_exported'] ?? 0));
        $this->assertSame(1, (int) ($row['total_returned'] ?? 0));
        $this->assertSame(2, (int) ($row['total_damaged'] ?? 0));
        $this->assertSame(2, (int) ($row['total_adjusted'] ?? 0));
        $this->assertSame(7, (int) ($row['computed_stock'] ?? 0));
        $this->assertSame(100000.0, (float) ($row['display_cost'] ?? 0));
        $this->assertSame(700000.0, (float) ($row['inventory_value'] ?? 0));
        $this->assertSame('available', (string) ($row['stock_alert'] ?? ''));
        $this->assertSame(7, (int) $product->fresh()->stock_quantity);

        $this->assertSame(10, (int) ($summary['total_imported'] ?? 0));
        $this->assertSame(4, (int) ($summary['total_exported'] ?? 0));
        $this->assertSame(1, (int) ($summary['total_returned'] ?? 0));
        $this->assertSame(2, (int) ($summary['total_damaged'] ?? 0));
        $this->assertSame(2, (int) ($summary['total_adjusted'] ?? 0));
        $this->assertSame(7, (int) ($summary['total_stock'] ?? 0));
        $this->assertSame(7, (int) ($summary['total_sellable_stock'] ?? 0));
        $this->assertSame(700000.0, (float) ($summary['total_inventory_value'] ?? 0));
    }

    public function test_refresh_order_items_returns_inventory_snapshot_for_available_to_sell(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham cap nhat order form',
            'sku' => 'ORDER-FORM-STOCK-001',
        ]);

        $service = app(InventoryService::class);
        $service->createImport([
            'supplier_id' => $supplier->id,
            'inventory_import_status_id' => $this->completedImportStatusId(),
            'import_date' => now()->subDay()->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 10,
                'received_quantity' => 10,
                'unit_cost' => 100000,
            ]],
        ], $account->id, $user->id);

        $order = $this->createOrder($account, $user, [
            'order_number' => 'ORD-PENDING-EXPORT-001',
            'status' => 'new',
        ]);
        $this->createOrderItem($account, $order, $product, 3);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/products/refresh-order-items', [
                'items' => [[
                    'product_id' => $product->id,
                    'sku' => $product->sku,
                    'name' => $product->name,
                ]],
            ]);

        $response->assertOk();

        $item = collect($response->json('items'))->firstWhere('product_id', $product->id);

        $this->assertNotNull($item);
        $this->assertSame(10, (int) ($item['computed_stock'] ?? 0));
        $this->assertSame(3, (int) ($item['pending_export_quantity'] ?? 0));
        $this->assertSame(7, (int) ($item['available_to_sell'] ?? 0));
    }

    public function test_refresh_order_items_prefers_current_product_prices_for_bundle_option_items(): void
    {
        [$account] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $bundle = $this->createProduct($account, $supplier, [
            'type' => 'bundle',
            'name' => 'Tron bo do tho test',
            'sku' => 'BUNDLE-ORDER-REFRESH',
            'price' => 0,
            'bundle_title' => 'Chon kich thuoc',
        ]);
        $bundleItem = $this->createProduct($account, $supplier, [
            'name' => 'Bat huong phi 20',
            'sku' => 'BATHUONG-PHI20',
            'price' => 1000000,
            'expected_cost' => 380000,
            'cost_price' => 380000,
            'status' => true,
        ]);

        $bundle->bundleItems()->attach($bundleItem->id, [
            'link_type' => 'bundle',
            'position' => 0,
            'quantity' => 2,
            'is_required' => true,
            'option_title' => 'Ban tho 1m97',
            'bundle_option_uid' => 'order-refresh-option',
            'bundle_option_status' => 'visible',
            'price' => 700000,
            'cost_price' => 320000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/products/refresh-order-items', [
                'items' => [
                    [
                        'product_id' => $bundle->id,
                        'entry_kind' => 'bundle_option',
                        'bundle_parent_id' => $bundle->id,
                        'bundle_option_uid' => 'order-refresh-option',
                        'bundle_option_key' => 'uid:order-refresh-option',
                    ],
                    [
                        'product_id' => $bundleItem->id,
                        'entry_kind' => 'bundle_option',
                        'bundle_parent_id' => $bundle->id,
                        'bundle_option_uid' => 'order-refresh-option',
                        'bundle_option_key' => 'uid:order-refresh-option',
                        'bundle_item_base_product_id' => $bundleItem->id,
                    ],
                ],
            ]);

        $response->assertOk();

        $bundleOption = collect($response->json('items'))->firstWhere('entry_kind', 'bundle_option');
        $bundleLine = collect($response->json('items'))->firstWhere('entry_kind', 'bundle_item');

        $this->assertNotNull($bundleOption);
        $this->assertSame(2000000.0, (float) ($bundleOption['price'] ?? 0));
        $this->assertSame(2000000.0, (float) ($bundleOption['bundle_option_total_price'] ?? 0));
        $this->assertSame(1000000.0, (float) data_get($bundleOption, 'bundle_items.0.price'));

        $this->assertNotNull($bundleLine);
        $this->assertSame($bundleItem->id, (int) ($bundleLine['product_id'] ?? 0));
        $this->assertSame(1000000.0, (float) ($bundleLine['price'] ?? 0));
        $this->assertSame(320000.0, (float) ($bundleLine['cost_price'] ?? 0));
    }

    public function test_refresh_order_items_prefers_exact_bundle_variant_when_base_product_repeats(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $bundle = $this->createProduct($account, $supplier, [
            'type' => 'bundle',
            'name' => 'Tron bo nhieu bien the chung cha',
            'sku' => 'BUNDLE-SAME-BASE',
            'price' => 0,
            'status' => true,
            'bundle_title' => 'Chon kich thuoc',
        ]);
        $baseProduct = $this->createProduct($account, $supplier, [
            'type' => 'configurable',
            'name' => 'Bat huong men ran',
            'sku' => 'BASE-BAT-HUONG',
            'price' => 0,
            'status' => true,
        ]);
        $firstVariant = $this->createProduct($account, $supplier, [
            'name' => 'Bat huong phi 20',
            'sku' => 'BAT-HUONG-PHI20',
            'price' => 750000,
            'expected_cost' => 380000,
            'cost_price' => 380000,
            'status' => true,
        ]);
        $secondVariant = $this->createProduct($account, $supplier, [
            'name' => 'Bat huong phi 18',
            'sku' => 'BAT-HUONG-PHI18',
            'price' => 600000,
            'expected_cost' => 310000,
            'cost_price' => 310000,
            'status' => true,
        ]);

        $baseProduct->variations()->attach($firstVariant->id, [
            'link_type' => 'super_link',
            'position' => 0,
            'is_default' => true,
        ]);
        $baseProduct->variations()->attach($secondVariant->id, [
            'link_type' => 'super_link',
            'position' => 1,
            'is_default' => false,
        ]);

        $optionUid = 'shared-base-option';
        $bundle->bundleItems()->attach($baseProduct->id, [
            'link_type' => 'bundle',
            'position' => 0,
            'quantity' => 1,
            'is_required' => true,
            'option_title' => 'Ban tho 1m97',
            'bundle_option_uid' => $optionUid,
            'bundle_option_status' => 'visible',
            'variant_id' => $firstVariant->id,
            'price' => 750000,
            'cost_price' => 380000,
        ]);
        $bundle->bundleItems()->attach($baseProduct->id, [
            'link_type' => 'bundle',
            'position' => 1,
            'quantity' => 2,
            'is_required' => true,
            'option_title' => 'Ban tho 1m97',
            'bundle_option_uid' => $optionUid,
            'bundle_option_status' => 'visible',
            'variant_id' => $secondVariant->id,
            'price' => 600000,
            'cost_price' => 310000,
        ]);

        $service = app(InventoryService::class);
        $service->createImport([
            'supplier_id' => $supplier->id,
            'inventory_import_status_id' => $this->completedImportStatusId(),
            'import_date' => now()->subDay()->toDateString(),
            'items' => [
                [
                    'product_id' => $firstVariant->id,
                    'quantity' => 5,
                    'received_quantity' => 5,
                    'unit_cost' => 380000,
                ],
                [
                    'product_id' => $secondVariant->id,
                    'quantity' => 10,
                    'received_quantity' => 10,
                    'unit_cost' => 310000,
                ],
            ],
        ], $account->id, $user->id);

        $order = $this->createOrder($account, $user, [
            'order_number' => 'ORD-SAME-BASE-BUNDLE',
            'status' => 'new',
        ]);
        $this->createOrderItem($account, $order, $secondVariant, 3);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/products/refresh-order-items', [
                'items' => [[
                    'product_id' => $secondVariant->id,
                    'entry_kind' => 'bundle_option',
                    'bundle_parent_id' => $bundle->id,
                    'bundle_option_uid' => $optionUid,
                    'bundle_option_key' => 'uid:' . $optionUid,
                    'bundle_item_base_product_id' => $baseProduct->id,
                    'sku' => $secondVariant->sku,
                    'name' => $secondVariant->name,
                ]],
            ]);

        $response->assertOk();

        $bundleLine = collect($response->json('items'))->firstWhere('entry_kind', 'bundle_item');

        $this->assertNotNull($bundleLine);
        $this->assertSame($secondVariant->id, (int) ($bundleLine['product_id'] ?? 0));
        $this->assertSame('BAT-HUONG-PHI18', (string) ($bundleLine['sku'] ?? ''));
        $this->assertSame(10, (int) ($bundleLine['computed_stock'] ?? 0));
        $this->assertSame(3, (int) ($bundleLine['pending_export_quantity'] ?? 0));
        $this->assertSame(7, (int) ($bundleLine['available_to_sell'] ?? 0));
    }

    public function test_refresh_order_items_matches_inventory_available_to_sell_when_product_snapshot_has_drift(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham lech ton snapshot',
            'sku' => 'ORDER-FORM-DRIFT-001',
        ]);

        $service = app(InventoryService::class);
        $service->createImport([
            'supplier_id' => $supplier->id,
            'inventory_import_status_id' => $this->completedImportStatusId(),
            'import_date' => now()->subDay()->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 10,
                'received_quantity' => 10,
                'unit_cost' => 100000,
            ]],
        ], $account->id, $user->id);

        $order = $this->createOrder($account, $user, [
            'order_number' => 'ORD-PENDING-DRIFT-001',
            'status' => 'new',
        ]);
        $this->createOrderItem($account, $order, $product, 3);

        $product->forceFill(['stock_quantity' => 7])->save();

        $inventoryResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/inventory/products?per_page=20');

        $inventoryResponse->assertOk();
        $inventoryRow = collect($inventoryResponse->json('data'))->firstWhere('id', $product->id);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/products/refresh-order-items', [
                'items' => [[
                    'product_id' => $product->id,
                    'sku' => $product->sku,
                    'name' => $product->name,
                ]],
            ]);

        $response->assertOk();

        $item = collect($response->json('items'))->firstWhere('product_id', $product->id);

        $this->assertNotNull($inventoryRow);
        $this->assertSame(10, (int) ($inventoryRow['computed_stock'] ?? 0));
        $this->assertSame(3, (int) ($inventoryRow['pending_export_quantity'] ?? 0));
        $this->assertSame(7, (int) ($inventoryRow['actual_stock'] ?? 0));
        $this->assertNotNull($item);
        $this->assertSame(10, (int) ($item['computed_stock'] ?? 0));
        $this->assertSame(3, (int) ($item['pending_export_quantity'] ?? 0));
        $this->assertSame(7, (int) ($item['available_to_sell'] ?? 0));
    }

    public function test_refresh_order_items_excludes_quantities_already_on_draft_export_slips(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham da lap phieu xuat nhap',
            'sku' => 'ORDER-FORM-DRAFT-EXPORT-001',
        ]);

        $service = app(InventoryService::class);
        $service->createImport([
            'supplier_id' => $supplier->id,
            'inventory_import_status_id' => $this->completedImportStatusId(),
            'import_date' => now()->subDay()->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 10,
                'received_quantity' => 10,
                'unit_cost' => 100000,
            ]],
        ], $account->id, $user->id);

        $order = $this->createOrder($account, $user, [
            'order_number' => 'ORD-DRAFT-EXPORT-001',
            'status' => 'new',
        ]);
        $this->createOrderItem($account, $order, $product, 4);

        $document = InventoryDocument::query()->create([
            'account_id' => $account->id,
            'document_number' => 'PX-DRAFT-001',
            'type' => 'export',
            'document_date' => now()->toDateString(),
            'status' => 'draft',
            'reference_type' => 'order',
            'reference_id' => $order->id,
            'total_quantity' => 1,
            'total_amount' => 0,
            'created_by' => $user->id,
        ]);

        $document->items()->create([
            'account_id' => $account->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => 1,
            'stock_bucket' => 'sellable',
            'direction' => 'out',
            'unit_cost' => 100000,
            'total_cost' => 100000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/products/refresh-order-items', [
                'items' => [[
                    'product_id' => $product->id,
                    'sku' => $product->sku,
                    'name' => $product->name,
                ]],
            ]);

        $response->assertOk();

        $item = collect($response->json('items'))->firstWhere('product_id', $product->id);

        $this->assertNotNull($item);
        $this->assertSame(10, (int) ($item['computed_stock'] ?? 0));
        $this->assertSame(3, (int) ($item['pending_export_quantity'] ?? 0));
        $this->assertSame(7, (int) ($item['available_to_sell'] ?? 0));
    }

    public function test_refresh_order_items_can_return_negative_available_to_sell(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham am co the ban',
            'sku' => 'ORDER-FORM-NEGATIVE-001',
        ]);

        $order = $this->createOrder($account, $user, [
            'order_number' => 'ORD-NEGATIVE-AVAILABLE-001',
            'status' => 'new',
        ]);
        $this->createOrderItem($account, $order, $product, 3);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/products/refresh-order-items', [
                'items' => [[
                    'product_id' => $product->id,
                    'sku' => $product->sku,
                    'name' => $product->name,
                ]],
            ]);

        $response->assertOk();

        $item = collect($response->json('items'))->firstWhere('product_id', $product->id);

        $this->assertNotNull($item);
        $this->assertSame(0, (int) ($item['computed_stock'] ?? 0));
        $this->assertSame(3, (int) ($item['pending_export_quantity'] ?? 0));
        $this->assertSame(-3, (int) ($item['available_to_sell'] ?? 0));
    }

    public function test_inventory_products_do_not_add_pending_returns_into_actual_stock(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham dang cho hang hoan ve',
            'sku' => 'PENDING-RETURN-001',
        ]);

        $service = app(InventoryService::class);
        $service->createImport([
            'supplier_id' => $supplier->id,
            'inventory_import_status_id' => $this->completedImportStatusId(),
            'import_date' => now()->subDay()->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 5,
                'received_quantity' => 5,
                'unit_cost' => 100000,
            ]],
        ], $account->id, $user->id);

        $order = $this->createOrder($account, $user, [
            'order_number' => 'ORD-PENDING-RETURN-001',
            'status' => 'pending_return',
        ]);
        $this->createOrderItem($account, $order, $product, 4);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/inventory/products?per_page=20');

        $response->assertOk();

        $row = collect($response->json('data'))->firstWhere('id', $product->id);
        $summary = $response->json('summary');

        $this->assertNotNull($row);
        $this->assertSame(5, (int) ($row['computed_stock'] ?? 0));
        $this->assertSame(0, (int) ($row['pending_export_quantity'] ?? 0));
        $this->assertSame(4, (int) ($row['pending_return_quantity'] ?? 0));
        $this->assertSame(5, (int) ($row['actual_stock'] ?? 0));
        $this->assertSame(4, (int) ($summary['total_pending_return'] ?? 0));
        $this->assertSame(5, (int) ($summary['total_actual_stock'] ?? 0));
        $this->assertSame(5, (int) ($summary['total_sellable_stock'] ?? 0));
    }

    public function test_inventory_products_can_filter_low_stock_using_current_inventory_state(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $lowProduct = $this->createProduct($account, $supplier, [
            'name' => 'San pham sap het',
            'sku' => 'LOW-STOCK-001',
        ]);
        $healthyProduct = $this->createProduct($account, $supplier, [
            'name' => 'San pham ton on dinh',
            'sku' => 'SAFE-STOCK-001',
        ]);

        $service = app(InventoryService::class);

        $service->createImport([
            'supplier_id' => $supplier->id,
            'inventory_import_status_id' => $this->completedImportStatusId(),
            'import_date' => now()->subDays(2)->toDateString(),
            'items' => [
                [
                    'product_id' => $lowProduct->id,
                    'quantity' => 3,
                    'received_quantity' => 3,
                    'unit_cost' => 100000,
                ],
                [
                    'product_id' => $healthyProduct->id,
                    'quantity' => 9,
                    'received_quantity' => 9,
                    'unit_cost' => 100000,
                ],
            ],
        ], $account->id, $user->id);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/inventory/products?per_page=20&stock_alert=low');

        $response->assertOk();

        $rows = collect($response->json('data'));
        $summary = $response->json('summary');

        $this->assertCount(1, $rows);
        $this->assertSame($lowProduct->id, (int) ($rows->first()['id'] ?? 0));
        $this->assertSame('low', (string) ($rows->first()['stock_alert'] ?? ''));
        $this->assertSame(3, (int) ($rows->first()['computed_stock'] ?? 0));
        $this->assertSame(3, (int) ($summary['total_stock'] ?? 0));
    }

    public function test_export_adjustment_documents_revise_export_totals_without_touching_total_adjusted(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham sua lai xuat',
            'sku' => 'EXPORT-ADJ-001',
        ]);

        $service = app(InventoryService::class);

        $service->createImport([
            'supplier_id' => $supplier->id,
            'inventory_import_status_id' => $this->completedImportStatusId(),
            'import_date' => now()->subDays(2)->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 10,
                'received_quantity' => 10,
                'unit_cost' => 100000,
            ]],
        ], $account->id, $user->id);

        $service->createDocument('export', [
            'document_date' => now()->subDay()->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 4,
            ]],
        ], $account->id, $user->id);

        $service->createDocument('adjustment', [
            'document_date' => now()->toDateString(),
            'adjustment_kind' => InventoryDocument::ADJUSTMENT_KIND_EXPORT,
            'adjustment_source' => InventoryDocument::ADJUSTMENT_SOURCE_RETURN_RECONCILIATION,
            'notes' => 'Export correction',
            'items' => [[
                'product_id' => $product->id,
                'quantity' => -1,
                'unit_cost' => 100000,
                'quantity_scope' => 'export_quantity',
                'old_quantity' => 4,
                'new_quantity' => 3,
                'difference_quantity' => -1,
            ]],
        ], $account->id, $user->id);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/inventory/products?per_page=20');

        $response->assertOk();

        $row = collect($response->json('data'))->firstWhere('id', $product->id);
        $summary = $response->json('summary');

        $this->assertNotNull($row);
        $this->assertSame(10, (int) ($row['total_imported'] ?? 0));
        $this->assertSame(3, (int) ($row['total_exported'] ?? 0));
        $this->assertSame(0, (int) ($row['total_adjusted'] ?? 0));
        $this->assertSame(7, (int) ($row['computed_stock'] ?? 0));
        $this->assertSame(7, (int) $product->fresh()->stock_quantity);

        $this->assertSame(3, (int) ($summary['total_exported'] ?? 0));
        $this->assertSame(0, (int) ($summary['total_adjusted'] ?? 0));
        $this->assertSame(7, (int) ($summary['total_stock'] ?? 0));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Inventory Stock Summary ' . Str::upper(Str::random(4)),
            'domain' => 'inventory-stock-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'inventory-stock-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::factory()->create([
            'name' => 'Inventory Stock Admin',
            'email' => 'inventory-stock-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function completedImportStatusId(): int
    {
        $status = InventoryImportStatus::withoutGlobalScopes()
            ->where('code', 'hoan_thanh')
            ->firstOrNew(['account_id' => null, 'code' => 'hoan_thanh']);

        $status->forceFill([
            'name' => $status->name ?: 'Hoan thanh',
            'color' => $status->color ?: '#10B981',
            'sort_order' => $status->sort_order ?: 4,
            'is_default' => false,
            'is_system' => true,
            'is_active' => true,
            'affects_inventory' => true,
        ])->save();

        return (int) $status->id;
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
            'order_number' => 'ORD-' . Str::upper(Str::random(8)),
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
            'notes' => 'Order should not affect inventory stock table',
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
}
