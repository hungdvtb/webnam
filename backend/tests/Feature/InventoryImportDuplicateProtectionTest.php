<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\ImportItem;
use App\Models\InventoryImport;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\User;
use App\Services\Inventory\InventoryService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class InventoryImportDuplicateProtectionTest extends TestCase
{
    use RefreshDatabase;

    public function test_create_import_api_rejects_duplicate_products(): void
    {
        [$account] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham trung tao moi',
            'sku' => 'IMP-DUP-CREATE-001',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/inventory/imports', [
                'supplier_id' => $supplier->id,
                'import_date' => now()->toDateString(),
                'items' => [
                    [
                        'product_id' => $product->id,
                        'quantity' => 2,
                        'received_quantity' => 2,
                        'unit_cost' => 110000,
                    ],
                    [
                        'product_id' => $product->id,
                        'quantity' => 1,
                        'received_quantity' => 1,
                        'unit_cost' => 110000,
                    ],
                ],
            ]);

        $response
            ->assertStatus(422)
            ->assertJsonValidationErrors(['items.1.product_id']);

        $this->assertStringContainsString(
            'Mỗi sản phẩm chỉ được chọn 1 lần',
            (string) data_get($response->json('errors'), 'items.1.product_id.0', '')
        );
        $this->assertSame(0, InventoryImport::query()->count());
    }

    public function test_update_import_api_rejects_duplicate_products(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $firstProduct = $this->createProduct($account, $supplier, [
            'name' => 'San pham goc',
            'sku' => 'IMP-DUP-UPDATE-001',
        ]);
        $secondProduct = $this->createProduct($account, $supplier, [
            'name' => 'San pham moi',
            'sku' => 'IMP-DUP-UPDATE-002',
        ]);

        $service = app(InventoryService::class);
        $import = $service->createImport([
            'supplier_id' => $supplier->id,
            'import_date' => now()->toDateString(),
            'items' => [[
                'product_id' => $firstProduct->id,
                'quantity' => 3,
                'received_quantity' => 3,
                'unit_cost' => 125000,
                'update_supplier_price' => false,
            ]],
        ], $account->id, $user->id);

        $response = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/inventory/imports/{$import->id}", [
                'supplier_id' => $supplier->id,
                'import_date' => now()->toDateString(),
                'items' => [
                    [
                        'product_id' => $firstProduct->id,
                        'quantity' => 3,
                        'received_quantity' => 3,
                        'unit_cost' => 125000,
                    ],
                    [
                        'product_id' => $firstProduct->id,
                        'quantity' => 2,
                        'received_quantity' => 2,
                        'unit_cost' => 130000,
                    ],
                    [
                        'product_id' => $secondProduct->id,
                        'quantity' => 1,
                        'received_quantity' => 1,
                        'unit_cost' => 99000,
                    ],
                ],
            ]);

        $response
            ->assertStatus(422)
            ->assertJsonValidationErrors(['items.1.product_id']);

        $this->assertSame(1, ImportItem::query()->where('import_id', $import->id)->count());
        $this->assertSame($firstProduct->id, (int) $import->fresh()->items()->value('product_id'));
    }

    public function test_inventory_service_rejects_duplicate_products_even_without_http_validation(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham trung service',
            'sku' => 'IMP-DUP-SERVICE-001',
        ]);

        $service = app(InventoryService::class);

        try {
            $service->createImport([
                'supplier_id' => $supplier->id,
                'import_date' => now()->toDateString(),
                'items' => [
                    [
                        'product_id' => $product->id,
                        'quantity' => 4,
                        'received_quantity' => 4,
                        'unit_cost' => 98000,
                    ],
                    [
                        'product_id' => $product->id,
                        'quantity' => 1,
                        'received_quantity' => 1,
                        'unit_cost' => 98000,
                    ],
                ],
            ], $account->id, $user->id);

            $this->fail('Expected duplicate import payload to be rejected.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString(
                'Moi san pham chi duoc chon 1 lan',
                (string) data_get($exception->errors(), 'items.0', '')
            );
        }

        $this->assertSame(0, InventoryImport::query()->count());
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Inventory Duplicate Account',
            'domain' => 'inventory-duplicate-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'inventory-duplicate-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Inventory Duplicate Admin',
            'email' => 'inventory-duplicate-' . Str::lower(Str::random(6)) . '@example.com',
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
