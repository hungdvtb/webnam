<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductSalesByDayProductFilterTest extends TestCase
{
    use RefreshDatabase;

    public function test_product_sales_by_day_can_filter_by_parent_product_id(): void
    {
        [$account, $user] = $this->authenticate();
        $supplier = $this->createSupplier($account);
        $parentProduct = $this->createProduct($account, $supplier, [
            'type' => 'configurable',
            'name' => 'Ao nhom',
            'sku' => 'PARENT-REPORT-001',
        ]);
        $childProduct = $this->createProduct($account, $supplier, [
            'type' => 'simple',
            'name' => 'Ao size M',
            'sku' => 'CHILD-REPORT-001',
        ]);
        $otherProduct = $this->createProduct($account, $supplier, [
            'type' => 'simple',
            'name' => 'Ao khac',
            'sku' => 'OTHER-REPORT-001',
        ]);

        DB::table('product_links')->insert([
            'product_id' => $parentProduct->id,
            'linked_product_id' => $childProduct->id,
            'link_type' => 'super_link',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $order = $this->createOrder($account, $user, [
            'order_number' => 'REPORT-PRODUCT-001',
            'status' => 'completed',
            'created_at' => now()->subDay(),
            'updated_at' => now()->subDay(),
        ]);

        $this->createOrderItem($account, $order, $childProduct, 4);
        $this->createOrderItem($account, $order, $otherProduct, 2);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/reports/product-sales-by-day?product_id=' . $parentProduct->id . '&date_from=' . now()->subDays(2)->toDateString() . '&date_to=' . now()->toDateString());

        $response->assertOk();

        $rows = $response->json('rows');
        $summary = $response->json('summary');
        $firstRow = $rows[0] ?? null;
        $firstChild = $firstRow['children'][0] ?? null;

        $this->assertSame($parentProduct->id, (int) ($firstRow['product_id'] ?? 0));
        $this->assertSame(4, (int) ($firstRow['totals']['quantity'] ?? 0));
        $this->assertSame($childProduct->id, (int) ($firstChild['product_id'] ?? 0));
        $this->assertSame(4, (int) ($firstChild['totals']['quantity'] ?? 0));
        $this->assertSame(4, (int) ($summary['total_quantity'] ?? 0));
        $this->assertSame($parentProduct->id, (int) ($response->json('filters.product_id') ?? 0));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Product Report ' . Str::upper(Str::random(4)),
            'domain' => 'product-report-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'product-report-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::factory()->create([
            'name' => 'Product Report Admin',
            'email' => 'product-report-' . Str::lower(Str::random(6)) . '@example.com',
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
            'status' => 'completed',
            'customer_name' => 'Khach report',
            'customer_email' => 'customer-' . Str::lower(Str::random(5)) . '@example.com',
            'customer_phone' => '090' . str_pad((string) random_int(1000000, 9999999), 7, '0', STR_PAD_LEFT),
            'shipping_address' => '123 Report street',
            'province' => 'Tinh report',
            'district' => 'Huyen report',
            'ward' => 'Xa report',
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
            'total_price' => (float) $order->total_price + $lineTotal,
            'cost_total' => (float) $order->cost_total + $costTotal,
            'profit_total' => ((float) $order->total_price + $lineTotal) - ((float) $order->cost_total + $costTotal),
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
