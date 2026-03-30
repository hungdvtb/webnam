<?php

namespace Tests\Feature;

use App\Models\Account;
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

class ProductListInventorySyncTest extends TestCase
{
    use RefreshDatabase;

    public function test_product_list_uses_actual_inventory_stock_for_display(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham dong bo ton',
            'sku' => 'SYNC-STOCK-001',
        ]);

        $service = app(InventoryService::class);
        $service->createImport([
            'supplier_id' => $supplier->id,
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
        $this->createOrderItem($account, $order, $product, 4);

        $this->assertSame(10, (int) $product->fresh()->stock_quantity);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?per_page=20');

        $response->assertOk();

        $row = collect($response->json('data'))->firstWhere('id', $product->id);

        $this->assertNotNull($row);
        $this->assertSame(6, (int) ($row['actual_stock'] ?? 0));
        $this->assertSame(6, (int) ($row['stock_quantity'] ?? 0));
    }

    public function test_product_list_stock_filters_use_actual_inventory_stock(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $pendingProduct = $this->createProduct($account, $supplier, [
            'name' => 'San pham co don cho xuat',
            'sku' => 'SYNC-FILTER-LOW',
        ]);
        $healthyProduct = $this->createProduct($account, $supplier, [
            'name' => 'San pham ton thuc te cao',
            'sku' => 'SYNC-FILTER-HIGH',
        ]);

        $service = app(InventoryService::class);
        $service->createImport([
            'supplier_id' => $supplier->id,
            'import_date' => now()->subDays(2)->toDateString(),
            'items' => [
                [
                    'product_id' => $pendingProduct->id,
                    'quantity' => 10,
                    'received_quantity' => 10,
                    'unit_cost' => 100000,
                ],
                [
                    'product_id' => $healthyProduct->id,
                    'quantity' => 8,
                    'received_quantity' => 8,
                    'unit_cost' => 100000,
                ],
            ],
        ], $account->id, $user->id);

        $order = $this->createOrder($account, $user, [
            'order_number' => 'ORD-PENDING-EXPORT-002',
            'status' => 'new',
        ]);
        $this->createOrderItem($account, $order, $pendingProduct, 4);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?per_page=20&min_stock=7');

        $response->assertOk();

        $rows = collect($response->json('data'));

        $this->assertFalse($rows->contains(fn (array $row) => (int) ($row['id'] ?? 0) === (int) $pendingProduct->id));
        $this->assertTrue($rows->contains(fn (array $row) => (int) ($row['id'] ?? 0) === (int) $healthyProduct->id));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Product Sync ' . Str::upper(Str::random(4)),
            'domain' => 'product-sync-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'product-sync-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::factory()->create([
            'name' => 'Product Sync Admin',
            'email' => 'product-sync-' . Str::lower(Str::random(6)) . '@example.com',
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
            'status' => true,
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
            'notes' => 'Order pending inventory export',
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
