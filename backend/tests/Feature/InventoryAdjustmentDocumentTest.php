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

class InventoryAdjustmentDocumentTest extends TestCase
{
    use RefreshDatabase;

    public function test_adjustment_document_accepts_signed_quantities_and_cost_fallbacks(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $inventoryService = app(InventoryService::class);

        $negativeProduct = $this->createProduct($account, $supplier, [
            'name' => 'San pham giam ton',
            'sku' => 'ADJ-NEG-001',
            'cost_price' => 125000,
            'expected_cost' => 110000,
        ]);
        $currentCostProduct = $this->createProduct($account, $supplier, [
            'name' => 'San pham gia von hien tai',
            'sku' => 'ADJ-CURRENT-001',
            'cost_price' => 135000,
            'expected_cost' => 120000,
        ]);
        $expectedCostProduct = $this->createProduct($account, $supplier, [
            'name' => 'San pham gia du kien',
            'sku' => 'ADJ-EXPECTED-001',
            'cost_price' => null,
            'expected_cost' => 98000,
        ]);

        $inventoryService->createImport([
            'supplier_id' => $supplier->id,
            'import_date' => now()->subDay()->toDateString(),
            'items' => [[
                'product_id' => $negativeProduct->id,
                'quantity' => 5,
                'received_quantity' => 5,
                'unit_cost' => 125000,
                'update_supplier_price' => false,
            ]],
        ], $account->id, $user->id);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/inventory/documents/adjustment', [
                'document_date' => now()->toDateString(),
                'supplier_id' => $supplier->id,
                'notes' => 'Signed adjustment test',
                'items' => [
                    [
                        'product_id' => $negativeProduct->id,
                        'quantity' => -2,
                    ],
                    [
                        'product_id' => $currentCostProduct->id,
                        'quantity' => 3,
                    ],
                    [
                        'product_id' => $expectedCostProduct->id,
                        'quantity' => 4,
                    ],
                ],
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('type', 'adjustment')
            ->assertJsonPath('total_quantity', 5)
            ->assertJsonPath('total_amount', 547000);

        /** @var InventoryDocument $document */
        $document = InventoryDocument::query()
            ->with('items')
            ->findOrFail((int) $response->json('id'));

        $this->assertSame(5, (int) $document->total_quantity);
        $this->assertSame(547000.0, (float) $document->total_amount);

        $negativeItem = $document->items->firstWhere('product_id', $negativeProduct->id);
        $currentCostItem = $document->items->firstWhere('product_id', $currentCostProduct->id);
        $expectedCostItem = $document->items->firstWhere('product_id', $expectedCostProduct->id);

        $this->assertNotNull($negativeItem);
        $this->assertNotNull($currentCostItem);
        $this->assertNotNull($expectedCostItem);

        $this->assertSame(2, (int) $negativeItem->quantity);
        $this->assertSame('out', (string) $negativeItem->direction);
        $this->assertSame(125000.0, (float) $negativeItem->unit_cost);
        $this->assertSame(250000.0, (float) $negativeItem->total_cost);

        $this->assertSame(3, (int) $currentCostItem->quantity);
        $this->assertSame('in', (string) $currentCostItem->direction);
        $this->assertSame(135000.0, (float) $currentCostItem->unit_cost);

        $this->assertSame(4, (int) $expectedCostItem->quantity);
        $this->assertSame('in', (string) $expectedCostItem->direction);
        $this->assertSame(98000.0, (float) $expectedCostItem->unit_cost);

        $this->assertSame(3, (int) $negativeProduct->fresh()->stock_quantity);
        $this->assertSame(3, (int) $currentCostProduct->fresh()->stock_quantity);
        $this->assertSame(4, (int) $expectedCostProduct->fresh()->stock_quantity);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Inventory Adjustment ' . Str::upper(Str::random(4)),
            'domain' => 'inventory-adjustment-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'inventory-adjustment-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::factory()->create([
            'name' => 'Inventory Adjustment Admin',
            'email' => 'inventory-adjustment-' . Str::lower(Str::random(6)) . '@example.com',
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
