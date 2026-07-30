<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryBatch;
use App\Models\InventoryBatchAllocation;
use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use App\Services\Inventory\InventoryService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class SharedAccountDataScopeTest extends TestCase
{
    use RefreshDatabase;

    public function test_linked_account_reads_shared_catalog_and_inventory(): void
    {
        [$sourceAccount, $linkedAccount, $otherAccount] = $this->createAccountSet();

        $sharedProduct = $this->createProduct($sourceAccount, ['sku' => 'SHARED-SKU']);
        $otherProduct = $this->createProduct($otherAccount, ['sku' => 'OTHER-SKU']);
        $sharedBatch = $this->createBatch($sourceAccount, $sharedProduct, 5);
        $this->createBatch($otherAccount, $otherProduct, 9);

        $this->app['request']->headers->set('X-Account-Id', (string) $linkedAccount->id);

        $this->assertSame([(int) $sharedProduct->id], Product::query()->pluck('id')->map(fn ($id) => (int) $id)->all());
        $this->assertSame([(int) $sharedBatch->id], InventoryBatch::query()->pluck('id')->map(fn ($id) => (int) $id)->all());
    }

    public function test_order_inventory_for_linked_account_allocates_from_shared_inventory(): void
    {
        [$sourceAccount, $linkedAccount] = $this->createAccountSet();

        $product = $this->createProduct($sourceAccount);
        $batch = $this->createBatch($sourceAccount, $product, 5);
        $order = Order::query()->create([
            'account_id' => $linkedAccount->id,
            'order_number' => 'ORD-' . Str::upper(Str::random(6)),
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'sales_channel' => Order::SALES_CHANNEL_ONLINE,
            'status' => 'new',
            'customer_name' => 'Shared Inventory Customer',
            'shipping_address' => 'Test shipping address',
            'total_price' => 0,
        ]);

        $this->app['request']->headers->set('X-Account-Id', (string) $linkedAccount->id);

        app(InventoryService::class)->attachInventoryToOrder($order, [[
            'product_id' => $product->id,
            'quantity' => 2,
            'price' => 100000,
        ]]);

        $allocation = InventoryBatchAllocation::withoutGlobalScopes()->firstOrFail();
        $orderItem = $order->items()->firstOrFail();

        $this->assertSame((int) $sourceAccount->id, (int) $allocation->account_id);
        $this->assertSame((int) $linkedAccount->id, (int) $orderItem->account_id);
        $this->assertSame(3.0, (float) $batch->fresh()->remaining_quantity);
    }

    public function test_cross_sell_order_keeps_item_on_order_account_and_allocates_source_inventory(): void
    {
        $sourceAccount = Account::query()->create([
            'name' => 'Dong ' . Str::upper(Str::random(4)),
            'subdomain' => 'dong-' . Str::lower(Str::random(8)),
            'status' => true,
        ]);
        $orderAccount = Account::query()->create([
            'name' => 'Su ' . Str::upper(Str::random(4)),
            'subdomain' => 'su-' . Str::lower(Str::random(8)),
            'status' => true,
        ]);

        $this->actingAs(User::factory()->create(['is_admin' => true]));

        $product = $this->createProduct($sourceAccount, [
            'price' => 100000,
            'expected_cost' => 60000,
            'cost_price' => 60000,
        ]);
        $batch = $this->createBatch($sourceAccount, $product, 5);
        $order = Order::query()->create([
            'account_id' => $orderAccount->id,
            'order_number' => 'ORD-' . Str::upper(Str::random(6)),
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'sales_channel' => Order::SALES_CHANNEL_ONLINE,
            'status' => 'new',
            'customer_name' => 'Cross Sell Customer',
            'shipping_address' => 'Test shipping address',
            'total_price' => 0,
        ]);

        $summary = app(InventoryService::class)->attachInventoryToOrder($order, [[
            'product_id' => $product->id,
            'product_source_account_id' => $sourceAccount->id,
            'inventory_source_account_id' => $sourceAccount->id,
            'quantity' => 2,
            'price' => 100000,
        ]]);

        $allocation = InventoryBatchAllocation::withoutGlobalScopes()->firstOrFail();
        $orderItem = $order->items()->firstOrFail();

        $this->assertSame((int) $orderAccount->id, (int) $orderItem->account_id);
        $this->assertSame((int) $sourceAccount->id, (int) $orderItem->product_source_account_id);
        $this->assertSame((int) $sourceAccount->id, (int) $orderItem->inventory_source_account_id);
        $this->assertSame((int) $sourceAccount->id, (int) $allocation->account_id);
        $this->assertSame(3.0, (float) $batch->fresh()->remaining_quantity);
        $this->assertSame(200000.0, (float) $summary['total_price']);
        $this->assertSame(120000.0, (float) $summary['cost_total']);
        $this->assertSame(80000.0, (float) $summary['profit_total']);
    }

    private function createAccountSet(): array
    {
        $sourceAccount = Account::query()->create([
            'name' => 'Source ' . Str::upper(Str::random(4)),
            'subdomain' => 'source-' . Str::lower(Str::random(8)),
            'status' => true,
        ]);

        $linkedAccount = Account::query()->create([
            'name' => 'Linked ' . Str::upper(Str::random(4)),
            'subdomain' => 'linked-' . Str::lower(Str::random(8)),
            'status' => true,
            'catalog_account_id' => $sourceAccount->id,
            'inventory_account_id' => $sourceAccount->id,
        ]);

        $otherAccount = Account::query()->create([
            'name' => 'Other ' . Str::upper(Str::random(4)),
            'subdomain' => 'other-' . Str::lower(Str::random(8)),
            'status' => true,
        ]);

        return [$sourceAccount, $linkedAccount, $otherAccount];
    }

    private function createProduct(Account $account, array $overrides = []): Product
    {
        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Product ' . Str::upper(Str::random(6)),
            'slug' => 'product-' . Str::lower(Str::random(8)),
            'sku' => 'SKU-' . Str::upper(Str::random(8)),
            'status' => true,
            'price' => 100000,
            'expected_cost' => 60000,
            'cost_price' => 60000,
            'stock_quantity' => 0,
        ], $overrides));
    }

    private function createBatch(Account $account, Product $product, int $quantity): InventoryBatch
    {
        return InventoryBatch::query()->create([
            'account_id' => $account->id,
            'product_id' => $product->id,
            'batch_number' => 'BATCH-' . Str::upper(Str::random(8)),
            'received_at' => now(),
            'quantity' => $quantity,
            'remaining_quantity' => $quantity,
            'unit_cost' => 60000,
            'status' => 'open',
        ]);
    }
}
