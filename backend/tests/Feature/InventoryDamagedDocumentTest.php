<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryDocument;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\User;
use App\Services\Inventory\InventoryService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class InventoryDamagedDocumentTest extends TestCase
{
    use RefreshDatabase;

    public function test_damaged_document_auto_uses_damaged_stock_when_sellable_stock_is_unavailable(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham ton hong',
            'sku' => 'DMG-STOCK-001',
            'cost_price' => 90000,
            'expected_cost' => 90000,
            'damaged_quantity' => 2,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/inventory/documents/damaged', [
                'document_date' => now()->toDateString(),
                'items' => [[
                    'product_id' => $product->id,
                    'quantity' => 1,
                ]],
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('type', 'damaged')
            ->assertJsonPath('total_quantity', 1)
            ->assertJsonPath('total_amount', 90000);

        $document = InventoryDocument::query()
            ->with('items')
            ->findOrFail((int) $response->json('id'));

        $item = $document->items->sole();

        $this->assertSame('damaged', (string) $item->stock_bucket);
        $this->assertSame('out', (string) $item->direction);
        $this->assertSame(90000.0, (float) $item->unit_cost);
        $this->assertSame(1, (int) $product->fresh()->damaged_quantity);
        $this->assertSame(0, (int) $product->fresh()->stock_quantity);
    }

    public function test_damaged_document_delete_and_restore_keep_sellable_and_damaged_stock_consistent(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $inventoryService = app(InventoryService::class);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham chuyen hong',
            'sku' => 'DMG-TRANSFER-001',
            'cost_price' => 120000,
            'expected_cost' => 120000,
        ]);

        $inventoryService->createImport([
            'supplier_id' => $supplier->id,
            'import_date' => now()->subDay()->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 4,
                'received_quantity' => 4,
                'unit_cost' => 120000,
                'update_supplier_price' => false,
            ]],
        ], $account->id, $user->id);

        $createResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/inventory/documents/damaged', [
                'document_date' => now()->toDateString(),
                'items' => [[
                    'product_id' => $product->id,
                    'quantity' => 2,
                ]],
            ]);

        $createResponse->assertCreated();

        $documentId = (int) $createResponse->json('id');
        $document = InventoryDocument::query()->with('items')->findOrFail($documentId);

        $this->assertSame('sellable', (string) $document->items->sole()->stock_bucket);
        $this->assertSame(2, (int) $product->fresh()->stock_quantity);
        $this->assertSame(2, (int) $product->fresh()->damaged_quantity);

        $this->withHeaders($this->headers($account))
            ->deleteJson("/api/inventory/documents/damaged/{$documentId}")
            ->assertOk();

        $this->assertSame(4, (int) $product->fresh()->stock_quantity);
        $this->assertSame(0, (int) $product->fresh()->damaged_quantity);

        $this->withHeaders($this->headers($account))
            ->postJson("/api/inventory/documents/damaged/{$documentId}/restore")
            ->assertOk();

        $this->assertSame(2, (int) $product->fresh()->stock_quantity);
        $this->assertSame(2, (int) $product->fresh()->damaged_quantity);
    }

    public function test_damaged_document_update_preserves_explicit_damaged_stock_bucket(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $inventoryService = app(InventoryService::class);
        $product = $this->createProduct($account, $supplier, [
            'name' => 'San pham sua phieu hong',
            'sku' => 'DMG-UPDATE-001',
            'cost_price' => 80000,
            'expected_cost' => 80000,
            'damaged_quantity' => 3,
        ]);

        $inventoryService->createImport([
            'supplier_id' => $supplier->id,
            'import_date' => now()->subDay()->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 5,
                'received_quantity' => 5,
                'unit_cost' => 80000,
                'update_supplier_price' => false,
            ]],
        ], $account->id, $user->id);

        $createResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/inventory/documents/damaged', [
                'document_date' => now()->toDateString(),
                'items' => [[
                    'product_id' => $product->id,
                    'quantity' => 1,
                    'stock_bucket' => 'damaged',
                ]],
            ]);

        $createResponse->assertCreated();
        $documentId = (int) $createResponse->json('id');

        $this->withHeaders($this->headers($account))
            ->putJson("/api/inventory/documents/damaged/{$documentId}", [
                'document_date' => now()->toDateString(),
                'items' => [[
                    'product_id' => $product->id,
                    'quantity' => 2,
                    'stock_bucket' => 'damaged',
                ]],
            ])
            ->assertOk();

        $document = InventoryDocument::query()->with('items')->findOrFail($documentId);

        $this->assertSame('damaged', (string) $document->items->sole()->stock_bucket);
        $this->assertSame(5, (int) $product->fresh()->stock_quantity);
        $this->assertSame(1, (int) $product->fresh()->damaged_quantity);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Inventory Damaged ' . Str::upper(Str::random(4)),
            'domain' => 'inventory-damaged-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'inventory-damaged-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::factory()->create([
            'name' => 'Inventory Damaged Admin',
            'email' => 'inventory-damaged-' . Str::lower(Str::random(6)) . '@example.com',
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
            'price' => 150000,
            'expected_cost' => 90000,
            'cost_price' => 90000,
            'stock_quantity' => 0,
            'damaged_quantity' => 0,
        ], $overrides));
    }
}
