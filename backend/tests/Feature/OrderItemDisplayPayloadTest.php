<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryUnit;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderItemDisplayPayloadTest extends TestCase
{
    use RefreshDatabase;

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

    public function test_order_list_hydrates_placeholder_snapshot_names_from_product(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'Dia cau men ran sen',
            'sku' => 'DIA-CAU-RAN-SEN',
        ]);
        $order = $this->createDraftOrder($account, $user, $product, [
            'product_name_snapshot' => 'San pham #' . $product->id,
            'product_sku_snapshot' => 'N/A',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?order_kind=draft&per_page=100')
            ->assertOk();

        $row = collect($response->json('data'))
            ->firstWhere('id', $order->id);

        $this->assertNotNull($row);
        $this->assertSame($product->name, data_get($row, 'items.0.snapshot_name'));
        $this->assertSame($product->name, data_get($row, 'items.0.display_name'));
        $this->assertSame($product->name, data_get($row, 'items.0.product.name'));
    }

    public function test_print_data_keeps_snapshot_identity_for_history_documents(): void
    {
        [$account, $user] = $this->authenticate();
        $unit = $this->createInventoryUnit($account, 'Bo');
        $product = $this->createProduct($account, [
            'name' => 'Chen su cu',
            'sku' => 'CHEN-SU-CU',
            'inventory_unit_id' => $unit->id,
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
        $this->assertSame('Bo', data_get($printedItem, 'unit_name'));
    }

    public function test_order_list_exposes_actual_product_override_fields(): void
    {
        [$account, $user] = $this->authenticate();
        $orderedProduct = $this->createProduct($account, [
            'name' => 'Mam bong 28',
            'sku' => 'MAM-28',
        ]);
        $actualProduct = $this->createProduct($account, [
            'name' => 'Mam bong 30',
            'sku' => 'MAM-30',
        ]);
        $order = $this->createDraftOrder($account, $user, $orderedProduct, [
            'actual_product_id' => $actualProduct->id,
            'actual_product_name_snapshot' => $actualProduct->name,
            'actual_product_sku_snapshot' => $actualProduct->sku,
        ]);

        $actualProduct->update([
            'name' => 'Mam bong 30 moi',
            'sku' => 'MAM-30-MOI',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?order_kind=draft&per_page=100')
            ->assertOk();

        $row = collect($response->json('data'))
            ->firstWhere('id', $order->id);

        $this->assertNotNull($row);
        $this->assertTrue((bool) data_get($row, 'items.0.has_actual_product_override'));
        $this->assertSame('Mam bong 28', data_get($row, 'items.0.snapshot_name'));
        $this->assertSame('MAM-28', data_get($row, 'items.0.snapshot_sku'));
        $this->assertSame('Mam bong 30', data_get($row, 'items.0.actual_snapshot_name'));
        $this->assertSame('MAM-30', data_get($row, 'items.0.actual_snapshot_sku'));
        $this->assertSame('Mam bong 30 moi', data_get($row, 'items.0.actual_display_name'));
        $this->assertSame('MAM-30-MOI', data_get($row, 'items.0.actual_display_sku'));
        $this->assertSame('Mam bong 30 moi', data_get($row, 'items.0.actual_product.name'));
        $this->assertSame('MAM-30-MOI', data_get($row, 'items.0.actual_product.sku'));
    }

    public function test_order_detail_current_cost_metrics_use_actual_product_when_overridden(): void
    {
        [$account, $user] = $this->authenticate();
        $orderedProduct = $this->createProduct($account, [
            'name' => 'Mam bong 28',
            'sku' => 'MAM-28',
            'cost_price' => 120000,
            'expected_cost' => 120000,
        ]);
        $actualProduct = $this->createProduct($account, [
            'name' => 'Mam bong 30',
            'sku' => 'MAM-30',
            'cost_price' => 150000,
            'expected_cost' => 150000,
        ]);
        $order = $this->createDraftOrder($account, $user, $orderedProduct, [
            'actual_product_id' => $actualProduct->id,
            'actual_product_name_snapshot' => $actualProduct->name,
            'actual_product_sku_snapshot' => $actualProduct->sku,
            'cost_price' => 150000,
            'cost_total' => 150000,
            'profit_total' => -50000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson("/api/orders/{$order->id}")
            ->assertOk();

        $item = data_get($response->json(), 'items.0');

        $this->assertSame($actualProduct->id, data_get($item, 'actual_product_id'));
        $this->assertSame(120000.0, (float) data_get($item, 'ordered_current_cost_price'));
        $this->assertSame(150000.0, (float) data_get($item, 'current_cost_price'));
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

    private function createInventoryUnit(Account $account, string $name): InventoryUnit
    {
        return InventoryUnit::query()->create([
            'account_id' => $account->id,
            'name' => $name,
            'normalized_name' => Str::slug($name),
            'sort_order' => 1,
        ]);
    }

    private function createDraftOrder(Account $account, User $user, Product $product, array $itemOverrides = []): Order
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

        OrderItem::query()->create(array_merge([
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
        ], $itemOverrides));

        return $order;
    }
}
