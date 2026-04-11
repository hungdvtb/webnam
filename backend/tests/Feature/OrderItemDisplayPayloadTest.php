<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderItemDisplayPayloadTest extends TestCase
{
    use DatabaseTransactions;

    public function test_order_list_prefers_current_product_identity_but_keeps_snapshot_fields(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'Bo am tra cu',
            'sku' => 'AM-TRA-CU',
        ]);
        $order = $this->createDraftOrder($account, $user, $product);

        $product->update([
            'name' => 'Bo am tra moi',
            'sku' => 'AM-TRA-MOI',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?order_kind=draft&per_page=100')
            ->assertOk();

        $row = collect($response->json('data'))
            ->firstWhere('id', $order->id);

        $this->assertNotNull($row);
        $this->assertCount(1, $row['items'] ?? []);
        $this->assertSame('Bo am tra moi', data_get($row, 'items.0.display_name'));
        $this->assertSame('AM-TRA-MOI', data_get($row, 'items.0.display_sku'));
        $this->assertSame('Bo am tra cu', data_get($row, 'items.0.snapshot_name'));
        $this->assertSame('AM-TRA-CU', data_get($row, 'items.0.snapshot_sku'));
        $this->assertTrue((bool) data_get($row, 'items.0.has_product_snapshot_mismatch'));
        $this->assertSame('Bo am tra moi', data_get($row, 'items.0.product.name'));
        $this->assertSame('AM-TRA-MOI', data_get($row, 'items.0.product.sku'));
    }

    public function test_print_data_keeps_snapshot_identity_for_history_documents(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'Chen su cu',
            'sku' => 'CHEN-SU-CU',
        ]);
        $order = $this->createDraftOrder($account, $user, $product);

        $product->update([
            'name' => 'Chen su moi',
            'sku' => 'CHEN-SU-MOI',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/print-data', [
                'ids' => [$order->id],
            ])
            ->assertOk();

        $printedItem = data_get($response->json('data'), '0.items.0');

        $this->assertSame('Chen su cu', data_get($printedItem, 'name'));
        $this->assertSame('CHEN-SU-CU', data_get($printedItem, 'sku'));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Order Item Display Account',
            'domain' => 'order-item-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'order-item-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Order Item Display Admin',
            'email' => 'order-item-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function createDraftOrder(Account $account, User $user, Product $product): Order
    {
        $order = Order::query()->create([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'DR' . random_int(10000, 99999) . 'A0',
            'order_kind' => Order::KIND_DRAFT,
            'total_price' => 100000,
            'status' => 'new',
            'customer_name' => 'Khach test',
            'customer_email' => 'draft-' . Str::lower(Str::random(6)) . '@example.com',
            'customer_phone' => '090' . str_pad((string) random_int(1000000, 9999999), 7, '0', STR_PAD_LEFT),
            'shipping_address' => 'Dia chi test',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'notes' => 'Don nhap test',
            'source' => 'Website',
            'type' => 'Le',
            'shipment_status' => 'Chua giao',
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => 100000,
            'shipping_status_source' => 'manual',
        ]);

        OrderItem::query()->create([
            'order_id' => $order->id,
            'account_id' => $account->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => 1,
            'price' => 100000,
            'cost_price' => 0,
            'cost_total' => 0,
            'profit_total' => 100000,
        ]);

        return $order;
    }
}
