<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryBatch;
use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use App\Services\Inventory\InventoryService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderPricingAdjustmentTest extends TestCase
{
    use RefreshDatabase;

    public function test_storing_order_allows_negative_discount_and_ignores_shipping_fee_in_total(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham phu thu',
            'sku' => 'SURCHARGE-ORDER-001',
            'price' => 200000,
        ]);
        $this->createBatch($account, $product, 5, 80000, 'pricing-adjustment');

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_OFFICIAL,
                'customer_name' => 'Khach phu thu',
                'customer_phone' => '0912345678',
                'customer_email' => 'pricing-adjustment@example.com',
                'shipping_address' => '123 Nguyen Trai',
                'province' => 'Tinh test',
                'district' => 'Huyen test',
                'ward' => 'Xa test',
                'notes' => 'Don test phu thu',
                'source' => 'Website',
                'type' => 'Le',
                'shipment_status' => 'Chua giao',
                'shipping_fee' => 50000,
                'discount' => -30000,
                'items' => [[
                    'product_id' => $product->id,
                    'quantity' => 2,
                    'price' => 200000,
                ]],
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('shipping_fee', 50000)
            ->assertJsonPath('discount', -30000)
            ->assertJsonPath('total_price', 430000)
            ->assertJsonPath('report_revenue_total', 430000)
            ->assertJsonPath('internal_shipping_fee', 0);

        $order = Order::query()->findOrFail((int) $response->json('id'));

        $this->assertSame(430000.0, (float) $order->total_price);
        $this->assertSame(50000.0, (float) $order->shipping_fee);
        $this->assertSame(-30000.0, (float) $order->discount);
        $this->assertSame(430000.0, (float) ($order->report_revenue_total ?? 0));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Order Pricing Adjustment Account',
            'domain' => 'pricing-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'pricing-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Order Pricing Adjustment Admin',
            'email' => 'pricing-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function createProduct(Account $account, array $overrides = []): Product
    {
        $name = $overrides['name'] ?? ('San pham ' . Str::lower(Str::random(5)));
        $sku = $overrides['sku'] ?? ('SKU-' . Str::upper(Str::random(6)));

        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(5)),
            'sku' => $sku,
            'price' => 100000,
            'stock_quantity' => 0,
            'status' => true,
        ], $overrides));
    }

    private function createBatch(Account $account, Product $product, int $quantity, float $unitCost, string $suffix): InventoryBatch
    {
        $batch = InventoryBatch::query()->create([
            'account_id' => $account->id,
            'product_id' => $product->id,
            'batch_number' => 'BATCH-' . strtoupper($suffix) . '-' . Str::upper(Str::random(4)),
            'received_at' => now(),
            'quantity' => $quantity,
            'remaining_quantity' => $quantity,
            'unit_cost' => $unitCost,
            'status' => 'open',
            'meta' => ['source' => 'test'],
        ]);

        app(InventoryService::class)->refreshProducts([$product->id]);

        return $batch;
    }
}
