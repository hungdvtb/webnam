<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryImport;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\SupplierProductPrice;
use App\Models\User;
use App\Services\Inventory\InventoryService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class InventoryPricingConsistencyTest extends TestCase
{
    use RefreshDatabase;

    public function test_current_cost_uses_weighted_average_from_all_valid_imports(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham binh quan',
            'sku' => 'AVG-001',
            'expected_cost' => 320000,
        ]);

        $service = app(InventoryService::class);

        $service->createImport([
            'supplier_id' => $supplier->id,
            'import_date' => now()->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 2,
                'received_quantity' => 2,
                'unit_cost' => 350000,
                'update_supplier_price' => true,
            ]],
        ], $account->id, $user->id);

        $secondImport = $service->createImport([
            'supplier_id' => $supplier->id,
            'import_date' => now()->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 2,
                'received_quantity' => 2,
                'unit_cost' => 450000,
                'update_supplier_price' => true,
            ]],
        ], $account->id, $user->id);

        $this->assertSame('hoan_thanh', $secondImport->fresh()->status);

        $product->refresh();

        $this->assertSame(4, (int) $product->imported_quantity_total);
        $this->assertSame(1600000.0, (float) $product->imported_value_total);
        $this->assertSame(400000.0, (float) $product->cost_price);
        $this->assertSame(4, (int) $product->stock_quantity);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/inventory/products?per_page=20');

        $response->assertOk();
        $row = collect($response->json('data'))->firstWhere('id', $product->id);

        $this->assertNotNull($row);
        $this->assertSame(400000.0, (float) ($row['current_cost'] ?? 0));
        $this->assertSame(400000.0, (float) ($row['display_cost'] ?? 0));
    }

    public function test_expected_cost_syncs_bidirectionally_between_product_and_supplier_price(): void
    {
        [$account] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham sync gia du kien',
            'sku' => 'SYNC-001',
            'expected_cost' => 180000,
        ]);

        $this->withHeaders($this->headers($account))
            ->putJson("/api/inventory/products/{$product->id}", [
                'expected_cost' => 210000,
            ])
            ->assertOk()
            ->assertJsonPath('expected_cost', 210000.0);

        $product->refresh();
        $price = SupplierProductPrice::query()
            ->where('supplier_id', $supplier->id)
            ->where('product_id', $product->id)
            ->first();

        $this->assertNotNull($price);
        $this->assertSame(210000.0, (float) $product->expected_cost);
        $this->assertSame(210000.0, (float) $price->unit_cost);

        $this->withHeaders($this->headers($account))
            ->putJson("/api/inventory/suppliers/{$supplier->id}/prices/{$price->id}", [
                'unit_cost' => 260000,
                'supplier_product_code' => 'NCC-260',
            ])
            ->assertOk()
            ->assertJsonPath('product.expected_cost', 260000.0);

        $product->refresh();
        $price->refresh();

        $this->assertSame(260000.0, (float) $product->expected_cost);
        $this->assertSame($supplier->id, (int) $product->supplier_id);
        $this->assertSame(260000.0, (float) $price->unit_cost);
    }

    public function test_delete_and_restore_import_recomputes_only_affected_product_aggregate(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $productA = $this->createProduct($account, $supplier, [
            'name' => 'San pham A',
            'sku' => 'IMP-A',
            'expected_cost' => 150000,
        ]);
        $productB = $this->createProduct($account, $supplier, [
            'name' => 'San pham B',
            'sku' => 'IMP-B',
            'expected_cost' => 190000,
        ]);

        $service = app(InventoryService::class);
        $import = $service->createImport([
            'supplier_id' => $supplier->id,
            'import_date' => now()->toDateString(),
            'items' => [
                [
                    'product_id' => $productA->id,
                    'quantity' => 3,
                    'received_quantity' => 3,
                    'unit_cost' => 300000,
                    'update_supplier_price' => true,
                ],
                [
                    'product_id' => $productB->id,
                    'quantity' => 1,
                    'received_quantity' => 1,
                    'unit_cost' => 500000,
                    'update_supplier_price' => true,
                ],
            ],
        ], $account->id, $user->id);

        $import = InventoryImport::query()->findOrFail($import->id);

        $this->assertSame(300000.0, (float) $productA->fresh()->cost_price);
        $this->assertSame(500000.0, (float) $productB->fresh()->cost_price);

        $this->withHeaders($this->headers($account))
            ->deleteJson("/api/inventory/imports/{$import->id}")
            ->assertOk();

        $this->assertSoftDeleted('imports', ['id' => $import->id]);
        $this->assertSame(0, (int) $productA->fresh()->imported_quantity_total);
        $this->assertSame(0.0, (float) $productA->fresh()->imported_value_total);
        $this->assertNull($productA->fresh()->cost_price);
        $this->assertSame(0, (int) $productB->fresh()->imported_quantity_total);
        $this->assertNull($productB->fresh()->cost_price);

        $this->withHeaders($this->headers($account))
            ->postJson("/api/inventory/imports/{$import->id}/restore")
            ->assertOk();

        $this->assertSame(3, (int) $productA->fresh()->imported_quantity_total);
        $this->assertSame(900000.0, (float) $productA->fresh()->imported_value_total);
        $this->assertSame(300000.0, (float) $productA->fresh()->cost_price);
        $this->assertSame(1, (int) $productB->fresh()->imported_quantity_total);
        $this->assertSame(500000.0, (float) $productB->fresh()->cost_price);
    }

    public function test_updating_import_recomputes_weighted_average_for_only_the_affected_product(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham sua phieu nhap',
            'sku' => 'UPD-IMP-001',
            'expected_cost' => 200000,
        ]);

        $service = app(InventoryService::class);

        $firstImport = $service->createImport([
            'supplier_id' => $supplier->id,
            'import_date' => now()->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 2,
                'received_quantity' => 2,
                'unit_cost' => 350000,
                'update_supplier_price' => true,
            ]],
        ], $account->id, $user->id);

        $this->assertSame('hoan_thanh', $firstImport->fresh()->status);

        $secondImport = $service->createImport([
            'supplier_id' => $supplier->id,
            'import_date' => now()->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 2,
                'received_quantity' => 2,
                'unit_cost' => 450000,
                'update_supplier_price' => true,
            ]],
        ], $account->id, $user->id);

        $this->assertSame('hoan_thanh', $secondImport->fresh()->status);

        $service->updateImport(
            InventoryImport::query()->findOrFail($secondImport->id),
            [
                'supplier_id' => $supplier->id,
                'import_date' => now()->toDateString(),
                'items' => [[
                    'product_id' => $product->id,
                    'quantity' => 4,
                    'received_quantity' => 4,
                    'unit_cost' => 500000,
                    'update_supplier_price' => true,
                ]],
            ],
            $account->id,
            $user->id
        );

        $product->refresh();

        $this->assertSame(6, (int) $product->imported_quantity_total);
        $this->assertSame(2700000.0, (float) $product->imported_value_total);
        $this->assertSame(450000.0, (float) $product->cost_price);
        $this->assertSame(6, (int) $product->stock_quantity);

        $this->assertSame(
            2,
            InventoryImport::query()
                ->whereHas('items', fn ($query) => $query->where('product_id', $product->id))
                ->count()
        );

        $this->assertSame(350000.0, (float) $firstImport->fresh()->items()->first()->unit_cost);
    }

    public function test_inventory_product_payload_uses_expected_cost_as_display_fallback_without_imports(): void
    {
        [$account] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham chua nhap kho',
            'sku' => 'NO-IMP-001',
            'expected_cost' => 275000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/inventory/products?per_page=20');

        $response->assertOk();
        $row = collect($response->json('data'))->firstWhere('id', $product->id);

        $this->assertNotNull($row);
        $this->assertNull($row['current_cost']);
        $this->assertSame(275000.0, (float) ($row['expected_cost'] ?? 0));
        $this->assertSame(275000.0, (float) ($row['display_cost'] ?? 0));
        $this->assertSame('expected_cost', $row['cost_source']);
    }

    public function test_updating_secondary_supplier_price_switches_product_expected_cost_source(): void
    {
        [$account] = $this->authenticate();
        $primarySupplier = $this->createSupplier($account);
        $secondarySupplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $primarySupplier, [
            'name' => 'San pham nhieu nha cung cap',
            'sku' => 'MULTI-SUP-001',
            'expected_cost' => 180000,
        ]);

        DB::table('product_suppliers')->insert([
            'account_id' => $account->id,
            'product_id' => $product->id,
            'supplier_id' => $secondarySupplier->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $primaryPrice = SupplierProductPrice::query()->create([
            'account_id' => $account->id,
            'supplier_id' => $primarySupplier->id,
            'product_id' => $product->id,
            'unit_cost' => 180000,
        ]);

        $secondaryPrice = SupplierProductPrice::query()->create([
            'account_id' => $account->id,
            'supplier_id' => $secondarySupplier->id,
            'product_id' => $product->id,
            'unit_cost' => 220000,
        ]);

        $this->withHeaders($this->headers($account))
            ->putJson("/api/inventory/suppliers/{$secondarySupplier->id}/prices/{$secondaryPrice->id}", [
                'unit_cost' => 260000,
                'supplier_product_code' => 'ALT-260',
            ])
            ->assertOk()
            ->assertJsonPath('product.expected_cost', 260000.0);

        $product->refresh();

        $this->assertSame($secondarySupplier->id, (int) $product->supplier_id);
        $this->assertSame(260000.0, (float) $product->expected_cost);
        $this->assertSame(180000.0, (float) $primaryPrice->fresh()->unit_cost);
        $this->assertSame(260000.0, (float) $secondaryPrice->fresh()->unit_cost);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Inventory Pricing Account',
            'domain' => 'inventory-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'inventory-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Inventory Pricing Admin',
            'email' => 'inventory-pricing-' . Str::lower(Str::random(6)) . '@example.com',
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
        $product = Product::query()->create(array_merge([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'San pham ' . Str::lower(Str::random(4)),
            'slug' => 'san-pham-' . Str::lower(Str::random(8)),
            'sku' => 'SKU-' . Str::upper(Str::random(6)),
            'price' => 100000,
            'expected_cost' => 120000,
            'supplier_id' => $supplier->id,
            'stock_quantity' => 0,
            'status' => true,
        ], $overrides));

        DB::table('product_suppliers')->insert([
            'account_id' => $account->id,
            'product_id' => $product->id,
            'supplier_id' => $supplier->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $product;
    }
}
