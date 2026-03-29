<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryDocument;
use App\Models\InventoryImport;
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

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class InventorySlipTrashTest extends TestCase
{
    use RefreshDatabase;

    public function test_inventory_slips_support_trash_restore_and_force_delete_lifecycle(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $inventoryService = app(InventoryService::class);

        $importProduct = $this->createProduct($account, $supplier, [
            'name' => 'San pham phieu nhap',
            'sku' => 'TRASH-IMPORT-001',
            'expected_cost' => 120000,
        ]);
        $adjustmentProduct = $this->createProduct($account, $supplier, [
            'name' => 'San pham phieu dieu chinh',
            'sku' => 'TRASH-ADJ-001',
            'expected_cost' => 85000,
        ]);
        $exportProduct = $this->createProduct($account, $supplier, [
            'name' => 'San pham phieu xuat',
            'sku' => 'TRASH-EXPORT-001',
            'expected_cost' => 65000,
            'price' => 99000,
        ]);

        $import = $inventoryService->createImport([
            'supplier_id' => $supplier->id,
            'import_date' => now()->toDateString(),
            'items' => [[
                'product_id' => $importProduct->id,
                'quantity' => 5,
                'received_quantity' => 5,
                'unit_cost' => 120000,
                'update_supplier_price' => false,
            ]],
        ], $account->id, $user->id);

        $inventoryService->createImport([
            'supplier_id' => $supplier->id,
            'import_date' => now()->toDateString(),
            'items' => [[
                'product_id' => $adjustmentProduct->id,
                'quantity' => 5,
                'received_quantity' => 5,
                'unit_cost' => 85000,
                'update_supplier_price' => false,
            ]],
        ], $account->id, $user->id);

        $adjustment = $inventoryService->createDocument('adjustment', [
            'document_date' => now()->toDateString(),
            'notes' => 'Adjustment trash test',
            'supplier_id' => null,
            'items' => [[
                'product_id' => $adjustmentProduct->id,
                'quantity' => -2,
                'unit_cost' => 85000,
                'notes' => 'Xuat dieu chinh',
            ]],
        ], $account->id, $user->id);

        $exportOrder = $this->createInventoryExportOrder($account, $user, $exportProduct, 4, 'PX-TRASH-0001');

        $this->withHeaders($this->headers($account))
            ->deleteJson("/api/inventory/imports/{$import->id}")
            ->assertOk();

        $this->withHeaders($this->headers($account))
            ->deleteJson("/api/inventory/documents/adjustment/{$adjustment->id}")
            ->assertOk();

        $this->withHeaders($this->headers($account))
            ->deleteJson("/api/orders/{$exportOrder->id}")
            ->assertOk();

        $this->assertSoftDeleted('imports', ['id' => $import->id]);
        $this->assertSoftDeleted('inventory_documents', ['id' => $adjustment->id]);
        $this->assertSoftDeleted('orders', ['id' => $exportOrder->id]);
        $this->assertSame(0, (int) $importProduct->fresh()->stock_quantity);
        $this->assertSame(5, (int) $adjustmentProduct->fresh()->stock_quantity);

        $trashRows = collect(
            $this->withHeaders($this->headers($account))
                ->getJson('/api/inventory/trash/slips?per_page=100')
                ->assertOk()
                ->json('data')
        );

        $importRow = $trashRows->firstWhere('code', $import->import_number);
        $adjustmentRow = $trashRows->firstWhere('code', $adjustment->document_number);
        $exportRow = $trashRows->firstWhere('code', $exportOrder->order_number);

        $this->assertSame('import', $importRow['slip_type_key'] ?? null);
        $this->assertSame('adjustment', $adjustmentRow['slip_type_key'] ?? null);
        $this->assertSame('export', $exportRow['slip_type_key'] ?? null);
        $this->assertSame(-2, (int) ($adjustmentRow['total_quantity'] ?? 0));
        $this->assertSame(-170000.0, (float) ($adjustmentRow['total_amount'] ?? 0));
        $this->assertSame(4, (int) ($exportRow['total_quantity'] ?? 0));

        $this->withHeaders($this->headers($account))
            ->postJson("/api/inventory/documents/adjustment/{$adjustment->id}/restore")
            ->assertOk();

        $this->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$exportOrder->id}/restore")
            ->assertOk();

        $this->withHeaders($this->headers($account))
            ->postJson("/api/inventory/imports/{$import->id}/restore")
            ->assertOk();

        $this->assertFalse(InventoryDocument::withTrashed()->findOrFail($adjustment->id)->trashed());
        $this->assertFalse(Order::withTrashed()->findOrFail($exportOrder->id)->trashed());
        $this->assertFalse(InventoryImport::withTrashed()->findOrFail($import->id)->trashed());
        $this->assertSame(3, (int) $adjustmentProduct->fresh()->stock_quantity);
        $this->assertSame(5, (int) $importProduct->fresh()->stock_quantity);

        $this->withHeaders($this->headers($account))
            ->deleteJson("/api/inventory/imports/{$import->id}")
            ->assertOk();
        $this->withHeaders($this->headers($account))
            ->deleteJson("/api/inventory/imports/{$import->id}/force")
            ->assertOk();

        $this->withHeaders($this->headers($account))
            ->deleteJson("/api/inventory/documents/adjustment/{$adjustment->id}")
            ->assertOk();
        $this->withHeaders($this->headers($account))
            ->deleteJson("/api/inventory/documents/adjustment/{$adjustment->id}/force")
            ->assertOk();

        $this->withHeaders($this->headers($account))
            ->deleteJson("/api/orders/{$exportOrder->id}")
            ->assertOk();
        $this->withHeaders($this->headers($account))
            ->deleteJson("/api/orders/{$exportOrder->id}/force")
            ->assertOk();

        $this->assertDatabaseMissing('imports', ['id' => $import->id]);
        $this->assertDatabaseMissing('inventory_documents', ['id' => $adjustment->id]);
        $this->assertDatabaseMissing('orders', ['id' => $exportOrder->id]);
        $this->assertSame(0, (int) $importProduct->fresh()->stock_quantity);
        $this->assertSame(5, (int) $adjustmentProduct->fresh()->stock_quantity);

        $remainingTrashRows = collect(
            $this->withHeaders($this->headers($account))
                ->getJson('/api/inventory/trash/slips?per_page=100')
                ->assertOk()
                ->json('data')
        );

        $this->assertNull($remainingTrashRows->firstWhere('code', $import->import_number));
        $this->assertNull($remainingTrashRows->firstWhere('code', $adjustment->document_number));
        $this->assertNull($remainingTrashRows->firstWhere('code', $exportOrder->order_number));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Inventory Slip Trash ' . Str::upper(Str::random(4)),
            'domain' => 'inventory-slip-trash-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'inventory-slip-trash-' . Str::lower(Str::random(6)),
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
            'price' => 100000,
            'expected_cost' => 70000,
            'cost_price' => 70000,
            'stock_quantity' => 0,
            'damaged_quantity' => 0,
        ], $overrides));
    }

    private function createInventoryExportOrder(Account $account, User $user, Product $product, int $quantity, string $orderNumber): Order
    {
        $order = Order::query()->create([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => $orderNumber,
            'order_kind' => Order::KIND_DRAFT,
            'type' => 'inventory_export',
            'status' => 'draft',
            'customer_name' => 'Kho noi bo',
            'customer_phone' => '090' . random_int(1000000, 9999999),
            'shipping_address' => 'Kho test',
            'total_price' => $quantity * (float) ($product->price ?? 0),
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => $quantity * (float) ($product->cost_price ?? 0),
            'profit_total' => ($quantity * (float) ($product->price ?? 0)) - ($quantity * (float) ($product->cost_price ?? 0)),
        ]);

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
}
