<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryDocument;
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
        $this->assertSame(80000.0, (float) ($row['display_cost'] ?? 0));
        $this->assertSame(560000.0, (float) ($row['inventory_value'] ?? 0));
        $this->assertSame('available', (string) ($row['stock_alert'] ?? ''));
        $this->assertSame(7, (int) $product->fresh()->stock_quantity);

        $this->assertSame(10, (int) ($summary['total_imported'] ?? 0));
        $this->assertSame(4, (int) ($summary['total_exported'] ?? 0));
        $this->assertSame(1, (int) ($summary['total_returned'] ?? 0));
        $this->assertSame(2, (int) ($summary['total_damaged'] ?? 0));
        $this->assertSame(2, (int) ($summary['total_adjusted'] ?? 0));
        $this->assertSame(7, (int) ($summary['total_stock'] ?? 0));
        $this->assertSame(7, (int) ($summary['total_sellable_stock'] ?? 0));
        $this->assertSame(560000.0, (float) ($summary['total_inventory_value'] ?? 0));
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
