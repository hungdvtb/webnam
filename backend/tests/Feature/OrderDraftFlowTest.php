<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryBatch;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderDraftFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_store_and_update_draft_order_keep_manual_shipping_source(): void
    {
        [$account] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham draft',
            'sku' => 'DRAFT-001',
            'price' => 185000,
        ]);

        $storeResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach draft',
                'customer_phone' => '0912345678',
                'customer_email' => 'draft@example.com',
                'shipping_address' => '123 Nguyen Trai',
                'notes' => 'Ban nhap dau tien',
                'source' => 'Website',
                'type' => 'Le',
                'shipment_status' => 'Chua giao',
                'items' => [
                    [
                        'product_id' => $product->id,
                        'quantity' => 2,
                        'price' => 185000,
                    ],
                ],
            ]);

        $storeResponse
            ->assertCreated()
            ->assertJsonPath('order_kind', Order::KIND_DRAFT)
            ->assertJsonPath('shipping_status_source', 'manual');

        $order = Order::query()->findOrFail((int) $storeResponse->json('id'));

        $this->assertSame(Order::KIND_DRAFT, $order->order_kind);
        $this->assertSame('manual', $order->shipping_status_source);
        $this->assertNull($order->shipping_tracking_code);

        $updateResponse = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$order->id}", [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach draft da sua',
                'notes' => 'Ban nhap da cap nhat',
                'items' => [
                    [
                        'product_id' => $product->id,
                        'quantity' => 3,
                        'price' => 190000,
                    ],
                ],
            ]);

        $updateResponse
            ->assertOk()
            ->assertJsonPath('id', $order->id)
            ->assertJsonPath('shipping_status_source', 'manual');

        $order->refresh();

        $this->assertSame(Order::KIND_DRAFT, $order->order_kind);
        $this->assertSame('manual', $order->shipping_status_source);
        $this->assertNull($order->shipping_status);
        $this->assertNull($order->shipping_carrier_code);
        $this->assertNull($order->shipping_tracking_code);
        $this->assertSame('Khach draft da sua', $order->customer_name);
        $this->assertCount(1, $order->items);
        $this->assertSame(3, (int) $order->items()->first()->quantity);
    }

    public function test_store_official_order_allows_negative_inventory_when_stock_is_empty(): void
    {
        [$account] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham am kho',
            'sku' => 'NEG-STORE-001',
            'price' => 150000,
            'cost_price' => 90000,
            'expected_cost' => 90000,
            'stock_quantity' => 0,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', $this->officialOrderPayload($product));

        $response
            ->assertCreated()
            ->assertJsonPath('order_kind', Order::KIND_OFFICIAL);

        $order = $this->loadOrderWithAllocations((int) $response->json('id'));
        $product->refresh();

        $this->assertSame(-1, (int) $product->stock_quantity);
        $this->assertSame(1, $order->items->count());
        $this->assertSame(1, (int) $order->items->first()->batchAllocations->sum('quantity'));
        $this->assertSame(1, $this->oversoldAllocatedQuantity($order));
    }

    public function test_update_official_order_allows_negative_inventory_when_quantity_exceeds_available(): void
    {
        [$account] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham sua am kho',
            'sku' => 'NEG-UPDATE-001',
            'price' => 170000,
            'cost_price' => 100000,
            'expected_cost' => 100000,
            'stock_quantity' => 1,
        ]);
        $this->createInventoryBatch($account, $product, 1, 100000, 'neg-update');

        $storeResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', $this->officialOrderPayload($product));

        $storeResponse->assertCreated();

        $orderId = (int) $storeResponse->json('id');

        $updateResponse = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$orderId}", $this->officialOrderPayload($product, [
                'quantity' => 3,
                'price' => 170000,
            ]));

        $updateResponse->assertOk();

        $order = $this->loadOrderWithAllocations($orderId);
        $product->refresh();

        $this->assertSame(-2, (int) $product->stock_quantity);
        $this->assertSame(3, (int) $order->items->first()->batchAllocations->sum('quantity'));
        $this->assertSame(2, $this->oversoldAllocatedQuantity($order));
    }

    public function test_convert_draft_to_official_allows_negative_inventory(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham convert am kho',
            'sku' => 'NEG-CONVERT-001',
            'price' => 185000,
            'cost_price' => 110000,
            'expected_cost' => 110000,
        ]);

        $order = $this->createDraftOrder($account, $user, $product, [
            'order_number' => 'DR20001A0',
            'customer_name' => 'Draft am kho',
            'customer_phone' => '0901234509',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$order->id}/convert", [
                'target_kind' => Order::KIND_OFFICIAL,
                'region_type' => 'new',
                'shipping_address' => '123 Nguyen Trai',
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('order_kind', Order::KIND_OFFICIAL);

        $order = $this->loadOrderWithAllocations($order->id);
        $product->refresh();

        $this->assertSame(Order::KIND_OFFICIAL, $order->order_kind);
        $this->assertSame(-1, (int) $product->stock_quantity);
        $this->assertSame(1, $this->oversoldAllocatedQuantity($order));
    }

    public function test_duplicate_official_order_to_official_allows_negative_inventory(): void
    {
        [$account] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham duplicate am kho',
            'sku' => 'NEG-DUP-001',
            'price' => 195000,
            'cost_price' => 120000,
            'expected_cost' => 120000,
        ]);

        $storeResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', $this->officialOrderPayload($product));

        $storeResponse->assertCreated();

        $originalOrderId = (int) $storeResponse->json('id');

        $duplicateResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$originalOrderId}/duplicate", [
                'target_kind' => Order::KIND_OFFICIAL,
            ]);

        $duplicateResponse
            ->assertOk()
            ->assertJsonPath('order_kind', Order::KIND_OFFICIAL);

        $duplicatedOrder = $this->loadOrderWithAllocations((int) $duplicateResponse->json('id'));
        $product->refresh();

        $this->assertNotSame($originalOrderId, (int) $duplicatedOrder->id);
        $this->assertSame(-2, (int) $product->stock_quantity);
        $this->assertSame(1, $this->oversoldAllocatedQuantity($duplicatedOrder));
    }

    public function test_convert_official_order_to_draft_resets_shipping_summary_and_uses_manual_source(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham convert',
            'sku' => 'CONVERT-001',
            'price' => 210000,
        ]);

        $order = Order::query()->create([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'OR' . random_int(10000, 99999) . 'A0',
            'order_kind' => Order::KIND_OFFICIAL,
            'total_price' => 210000,
            'status' => 'shipping',
            'customer_name' => 'Khach official',
            'customer_email' => 'official@example.com',
            'customer_phone' => '0987654321',
            'shipping_address' => '456 Le Loi',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'notes' => 'Don dang giao',
            'source' => 'Website',
            'type' => 'Le',
            'shipment_status' => 'Shipped',
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => 210000,
            'shipping_status' => 'waiting_pickup',
            'shipping_synced_at' => now(),
            'shipping_status_source' => 'carrier',
            'shipping_carrier_code' => 'viettel_post',
            'shipping_carrier_name' => 'Viettel Post',
            'shipping_tracking_code' => 'TRACK-001',
            'shipping_dispatched_at' => now(),
        ]);

        OrderItem::query()->create([
            'order_id' => $order->id,
            'account_id' => $account->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => 1,
            'price' => 210000,
            'cost_price' => 0,
            'cost_total' => 0,
            'profit_total' => 210000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$order->id}/convert", [
                'target_kind' => Order::KIND_DRAFT,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('id', $order->id)
            ->assertJsonPath('order_kind', Order::KIND_DRAFT)
            ->assertJsonPath('shipping_status_source', 'manual');

        $order->refresh();

        $this->assertSame(Order::KIND_DRAFT, $order->order_kind);
        $this->assertSame('manual', $order->shipping_status_source);
        $this->assertNull($order->shipping_status);
        $this->assertNull($order->shipping_synced_at);
        $this->assertNull($order->shipping_carrier_code);
        $this->assertNull($order->shipping_carrier_name);
        $this->assertNull($order->shipping_tracking_code);
        $this->assertNull($order->shipping_dispatched_at);
        $this->assertSame($order->id, (int) $order->converted_from_order_id);
        $this->assertSame(Order::KIND_OFFICIAL, $order->converted_from_kind);
    }

    public function test_draft_orders_stay_in_draft_list_until_converted_back_to_official(): void
    {
        [$account, $user] = $this->authenticate();
        $otherAccount = $this->createAccountForUser($user);
        $product = $this->createProduct($account, [
            'name' => 'San pham draft main flow',
            'sku' => 'DRAFT-MAIN-001',
            'price' => 165000,
            'cost_price' => 90000,
            'stock_quantity' => 20,
        ]);
        $this->createInventoryBatch($account, $product, 5, 90000, 'main-flow');

        Order::query()->create([
            'user_id' => $user->id,
            'account_id' => $otherAccount->id,
            'order_number' => 'OR10000A0',
            'order_kind' => Order::KIND_OFFICIAL,
            'total_price' => 120000,
            'status' => 'new',
            'customer_name' => 'Khach da co ma OR',
            'customer_phone' => '0900000001',
            'shipping_address' => 'Dia chi khac',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'source' => 'Website',
            'type' => 'Le',
            'shipment_status' => 'Chua giao',
            'shipping_status_source' => 'manual',
        ]);

        $order = $this->createDraftOrder($account, $user, $product, [
            'order_number' => 'DR10000A0',
            'customer_name' => 'Khach draft quay lai',
            'customer_email' => 'draft-main@example.com',
            'customer_phone' => '0901234567',
            'shipping_address' => '789 Tran Hung Dao',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'notes' => 'Don dang o khu nhap',
        ]);

        $mainListBefore = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders')
            ->assertOk();

        $draftListBefore = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?order_kind=draft')
            ->assertOk();

        $this->assertNotContains($order->id, collect($mainListBefore->json('data'))->pluck('id')->all());
        $this->assertContains($order->id, collect($draftListBefore->json('data'))->pluck('id')->all());

        $convertResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$order->id}/convert", [
                'target_kind' => Order::KIND_OFFICIAL,
                'region_type' => 'old',
                'province' => 'Tinh test',
                'district' => 'Huyen test',
                'ward' => 'Xa test',
                'shipping_address' => '789 Tran Hung Dao, Xa test, Huyen test, Tinh test',
            ]);

        $convertResponse
            ->assertOk()
            ->assertJsonPath('id', $order->id)
            ->assertJsonPath('order_kind', Order::KIND_OFFICIAL)
            ->assertJsonPath('shipping_status_source', 'manual');

        $order->refresh();

        $this->assertSame(Order::KIND_OFFICIAL, $order->order_kind);
        $this->assertStringStartsWith('OR', (string) $order->order_number);
        $this->assertNotSame('OR10000A0', (string) $order->order_number);
        $this->assertSame(1, Order::withTrashed()->where('order_number', $order->order_number)->count());

        $mainListAfter = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders')
            ->assertOk();

        $draftListAfter = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?order_kind=draft')
            ->assertOk();

        $this->assertContains($order->id, collect($mainListAfter->json('data'))->pluck('id')->all());
        $this->assertNotContains($order->id, collect($draftListAfter->json('data'))->pluck('id')->all());
    }

    public function test_bulk_convert_drafts_to_official_assigns_distinct_unique_order_numbers(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham bulk convert',
            'sku' => 'BULK-CONVERT-001',
            'price' => 175000,
            'cost_price' => 95000,
            'stock_quantity' => 50,
        ]);
        $this->createInventoryBatch($account, $product, 20, 95000, 'bulk-convert');

        foreach (['OR10000A0', 'OR10001A0', 'OR10005A0'] as $existingOrderNumber) {
            Order::query()->create([
                'user_id' => $user->id,
                'account_id' => $account->id,
                'order_number' => $existingOrderNumber,
                'order_kind' => Order::KIND_OFFICIAL,
                'total_price' => 100000,
                'status' => 'new',
                'customer_name' => 'Khach cu ' . $existingOrderNumber,
                'customer_phone' => '0900' . substr(preg_replace('/\D+/', '', $existingOrderNumber), -6),
                'shipping_address' => 'Dia chi cu',
                'province' => 'Tinh test',
                'district' => 'Huyen test',
                'ward' => 'Xa test',
                'source' => 'Website',
                'type' => 'Le',
                'shipment_status' => 'Chua giao',
                'shipping_status_source' => 'manual',
            ]);
        }

        $draftOne = $this->createDraftOrder($account, $user, $product, [
            'order_number' => 'DR10001A0',
            'customer_name' => 'Draft bulk 1',
            'customer_phone' => '0901234501',
        ]);
        $draftTwo = $this->createDraftOrder($account, $user, $product, [
            'order_number' => 'DR10002A0',
            'customer_name' => 'Draft bulk 2',
            'customer_phone' => '0901234502',
            'item_quantity' => 2,
            'item_price' => 180000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/bulk-convert', [
                'ids' => [$draftOne->id, $draftTwo->id],
                'target_kind' => Order::KIND_OFFICIAL,
                'region_type' => 'old',
                'province' => 'Tinh test',
                'district' => 'Huyen test',
                'ward' => 'Xa test',
                'shipping_address' => '789 Tran Hung Dao, Xa test, Huyen test, Tinh test',
            ]);

        $response->assertOk();

        $draftOne->refresh();
        $draftTwo->refresh();

        $newOrderNumbers = [$draftOne->order_number, $draftTwo->order_number];

        $this->assertSame(Order::KIND_OFFICIAL, $draftOne->order_kind);
        $this->assertSame(Order::KIND_OFFICIAL, $draftTwo->order_kind);
        $this->assertCount(2, array_unique($newOrderNumbers));
        $this->assertNotContains('OR10000A0', $newOrderNumbers);
        $this->assertNotContains('OR10001A0', $newOrderNumbers);
        $this->assertNotContains('OR10005A0', $newOrderNumbers);
        $this->assertTrue(Str::startsWith($draftOne->order_number, 'OR'));
        $this->assertTrue(Str::startsWith($draftTwo->order_number, 'OR'));
        $this->assertSame(1, Order::withTrashed()->where('order_number', $draftOne->order_number)->count());
        $this->assertSame(1, Order::withTrashed()->where('order_number', $draftTwo->order_number)->count());
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Order Test Account',
            'domain' => 'orders-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'orders-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Order Admin',
            'email' => 'order-admin-' . Str::lower(Str::random(6)) . '@example.com',
            'password' => 'password',
            'is_admin' => true,
        ]);

        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user, ['*']);

        return [$account, $user];
    }

    private function createAccountForUser(User $user): Account
    {
        $account = Account::query()->create([
            'name' => 'Order Test Account ' . Str::upper(Str::random(3)),
            'domain' => 'orders-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'orders-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user->accounts()->attach($account->id, ['role' => 'owner']);

        return $account;
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

    private function createInventoryBatch(Account $account, Product $product, int $quantity, float $unitCost, string $suffix): InventoryBatch
    {
        return InventoryBatch::query()->create([
            'account_id' => $account->id,
            'product_id' => $product->id,
            'batch_number' => 'BATCH-' . strtoupper($suffix) . '-' . Str::upper(Str::random(6)),
            'received_at' => now(),
            'quantity' => $quantity,
            'remaining_quantity' => $quantity,
            'unit_cost' => $unitCost,
            'status' => 'open',
            'meta' => ['source' => 'test'],
        ]);
    }

    private function officialOrderPayload(Product $product, array $itemOverrides = [], array $overrides = []): array
    {
        return array_merge([
            'order_kind' => Order::KIND_OFFICIAL,
            'customer_name' => 'Khach official',
            'customer_phone' => '0912345678',
            'customer_email' => 'official@example.com',
            'shipping_address' => '123 Nguyen Trai',
            'notes' => 'Ban truoc nhap sau',
            'source' => 'Website',
            'type' => 'Le',
            'shipment_status' => 'Chua giao',
            'items' => [
                array_merge([
                    'product_id' => $product->id,
                    'quantity' => 1,
                    'price' => (float) ($product->price ?? 0),
                ], $itemOverrides),
            ],
        ], $overrides);
    }

    private function loadOrderWithAllocations(int $orderId): Order
    {
        return Order::query()
            ->with(['items.batchAllocations.batch'])
            ->findOrFail($orderId);
    }

    private function oversoldAllocatedQuantity(Order $order): int
    {
        return (int) $order->items
            ->flatMap(fn (OrderItem $item) => $item->batchAllocations)
            ->filter(fn ($allocation) => $allocation->batch?->source_type === 'oversold_reserve')
            ->sum('quantity');
    }

    private function createDraftOrder(Account $account, User $user, Product $product, array $overrides = []): Order
    {
        $quantity = (int) ($overrides['item_quantity'] ?? 1);
        $price = (float) ($overrides['item_price'] ?? $product->price ?? 0);
        $costPrice = (float) ($overrides['item_cost_price'] ?? $product->cost_price ?? 0);
        $lineTotal = round($price * $quantity, 2);
        $costTotal = round($costPrice * $quantity, 2);

        unset($overrides['item_quantity'], $overrides['item_price'], $overrides['item_cost_price']);

        $order = Order::query()->create(array_merge([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'DR' . random_int(10000, 99999) . 'A0',
            'order_kind' => Order::KIND_DRAFT,
            'total_price' => $lineTotal,
            'status' => 'new',
            'customer_name' => 'Khach draft',
            'customer_email' => 'draft-' . Str::lower(Str::random(6)) . '@example.com',
            'customer_phone' => '090' . str_pad((string) random_int(1000000, 9999999), 7, '0', STR_PAD_LEFT),
            'shipping_address' => 'Dia chi draft',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'notes' => 'Don nhap test',
            'source' => 'Website',
            'type' => 'Le',
            'shipment_status' => 'Chua giao',
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => $costTotal,
            'profit_total' => round($lineTotal - $costTotal, 2),
            'shipping_status_source' => 'manual',
        ], $overrides));

        OrderItem::query()->create([
            'order_id' => $order->id,
            'account_id' => $account->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => $quantity,
            'price' => $price,
            'cost_price' => $costPrice,
            'cost_total' => $costTotal,
            'profit_total' => round($lineTotal - $costTotal, 2),
        ]);

        return $order;
    }
}
