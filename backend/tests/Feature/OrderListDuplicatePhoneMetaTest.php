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

class OrderListDuplicatePhoneMetaTest extends TestCase
{
    use DatabaseTransactions;

    public function test_order_list_marks_duplicate_phone_only_when_another_active_order_exists(): void
    {
        [$account, $user] = $this->authenticate();
        $productA = $this->createProduct($account, ['sku' => 'PHONE-RED-A']);
        $productB = $this->createProduct($account, ['sku' => 'PHONE-RED-B']);

        $orderOne = $this->createDraftOrder($account, $user, $productA, [
            'customer_name' => 'Khach 1',
            'customer_phone' => '0901000001',
        ]);

        $storeResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach 2',
                'customer_phone' => '0901000001',
                'customer_email' => 'khach2@example.com',
                'shipping_address' => 'So 2 Nguyen Trai',
                'notes' => 'Don tao moi',
                'source' => 'Website',
                'type' => 'Le',
                'shipment_status' => 'Chua giao',
                'items' => [
                    [
                        'product_id' => $productB->id,
                        'quantity' => 1,
                        'price' => 100000,
                    ],
                ],
            ])
            ->assertCreated();

        $orderTwoId = (int) $storeResponse->json('id');

        $afterCreate = $this->draftOrderMap($account);
        $this->assertDuplicatePhoneState($afterCreate[$orderOne->id], true, false, 'red');
        $this->assertDuplicatePhoneState($afterCreate[$orderTwoId], true, false, 'red');

        $this
            ->withHeaders($this->headers($account))
            ->deleteJson("/api/orders/{$orderTwoId}")
            ->assertOk();

        $afterTrash = $this->draftOrderMap($account);
        $this->assertDuplicatePhoneState($afterTrash[$orderOne->id], false, false, 'default');

        $trashMap = $this->trashedOrderMap($account);
        $this->assertArrayHasKey($orderTwoId, $trashMap);
        $this->assertDuplicatePhoneState($trashMap[$orderTwoId], false, false, 'default');

        $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$orderTwoId}/restore")
            ->assertOk();

        $afterRestore = $this->draftOrderMap($account);
        $this->assertDuplicatePhoneState($afterRestore[$orderOne->id], true, false, 'red');
        $this->assertDuplicatePhoneState($afterRestore[$orderTwoId], true, false, 'red');
    }

    public function test_order_list_marks_phone_plus_matching_sku_as_blue(): void
    {
        [$account, $user] = $this->authenticate();
        $productShared = $this->createProduct($account, ['sku' => 'PHONE-BLUE-SHARED']);

        $orderOne = $this->createDraftOrder($account, $user, $productShared, [
            'customer_name' => 'Khach A',
            'customer_phone' => '0902000002',
        ]);
        $orderTwo = $this->createDraftOrder($account, $user, $productShared, [
            'customer_name' => 'Khach B',
            'customer_phone' => '0902000002',
        ]);

        $orders = $this->draftOrderMap($account);

        $this->assertDuplicatePhoneState($orders[$orderOne->id], true, true, 'blue');
        $this->assertDuplicatePhoneState($orders[$orderTwo->id], true, true, 'blue');
    }

    public function test_order_list_recomputes_duplicate_flags_after_updating_phone_and_items(): void
    {
        [$account, $user] = $this->authenticate();
        $productA = $this->createProduct($account, ['sku' => 'PHONE-EDIT-A']);
        $productB = $this->createProduct($account, ['sku' => 'PHONE-EDIT-B']);

        $orderOne = $this->createDraftOrder($account, $user, $productA, [
            'customer_name' => 'Khach Goc',
            'customer_phone' => '0903000003',
        ]);
        $orderTwo = $this->createDraftOrder($account, $user, $productB, [
            'customer_name' => 'Khach Sua',
            'customer_phone' => '0903999999',
        ]);

        $initialOrders = $this->draftOrderMap($account);
        $this->assertDuplicatePhoneState($initialOrders[$orderOne->id], false, false, 'default');
        $this->assertDuplicatePhoneState($initialOrders[$orderTwo->id], false, false, 'default');

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$orderTwo->id}", [
                'customer_phone' => '0903000003',
                'items' => [
                    [
                        'product_id' => $productB->id,
                        'quantity' => 1,
                        'price' => 100000,
                    ],
                ],
            ])
            ->assertOk();

        $afterPhoneUpdate = $this->draftOrderMap($account);
        $this->assertDuplicatePhoneState($afterPhoneUpdate[$orderOne->id], true, false, 'red');
        $this->assertDuplicatePhoneState($afterPhoneUpdate[$orderTwo->id], true, false, 'red');

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$orderTwo->id}", [
                'customer_phone' => '0903000003',
                'items' => [
                    [
                        'product_id' => $productA->id,
                        'quantity' => 1,
                        'price' => 100000,
                    ],
                ],
            ])
            ->assertOk();

        $afterSkuUpdate = $this->draftOrderMap($account);
        $this->assertDuplicatePhoneState($afterSkuUpdate[$orderOne->id], true, true, 'blue');
        $this->assertDuplicatePhoneState($afterSkuUpdate[$orderTwo->id], true, true, 'blue');

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$orderTwo->id}", [
                'customer_phone' => '0903001234',
                'items' => [
                    [
                        'product_id' => $productA->id,
                        'quantity' => 1,
                        'price' => 100000,
                    ],
                ],
            ])
            ->assertOk();

        $afterUniqueUpdate = $this->draftOrderMap($account);
        $this->assertDuplicatePhoneState($afterUniqueUpdate[$orderOne->id], false, false, 'default');
        $this->assertDuplicatePhoneState($afterUniqueUpdate[$orderTwo->id], false, false, 'default');
    }

    public function test_order_list_does_not_mark_blue_for_similar_but_not_exact_skus(): void
    {
        [$account, $user] = $this->authenticate();
        $productA = $this->createProduct($account, ['sku' => 'SIM-100']);
        $productB = $this->createProduct($account, ['sku' => 'SIM-100-X']);

        $orderOne = $this->createDraftOrder($account, $user, $productA, [
            'customer_phone' => '0904000004',
        ]);
        $orderTwo = $this->createDraftOrder($account, $user, $productB, [
            'customer_phone' => '0904000004',
        ]);

        $orders = $this->draftOrderMap($account);

        $this->assertDuplicatePhoneState($orders[$orderOne->id], true, false, 'red');
        $this->assertDuplicatePhoneState($orders[$orderTwo->id], true, false, 'red');
    }

    public function test_order_list_keeps_mixed_same_phone_groups_red_even_if_some_orders_share_the_same_product_set(): void
    {
        [$account, $user] = $this->authenticate();
        $productA = $this->createProduct($account, ['sku' => 'SET-A']);
        $productB = $this->createProduct($account, ['sku' => 'SET-B']);
        $productC = $this->createProduct($account, ['sku' => 'SET-C']);

        $orderOne = $this->createDraftOrderWithProducts($account, $user, [
            ['product' => $productA],
            ['product' => $productB],
        ], [
            'customer_phone' => '0905000005',
        ]);
        $orderTwo = $this->createDraftOrderWithProducts($account, $user, [
            ['product' => $productC],
        ], [
            'customer_phone' => '0905000005',
        ]);
        $orderThree = $this->createDraftOrderWithProducts($account, $user, [
            ['product' => $productB],
            ['product' => $productA],
        ], [
            'customer_phone' => '0905000005',
        ]);

        $orders = $this->draftOrderMap($account);

        $this->assertDuplicatePhoneState($orders[$orderOne->id], true, false, 'red');
        $this->assertDuplicatePhoneState($orders[$orderTwo->id], true, false, 'red');
        $this->assertDuplicatePhoneState($orders[$orderThree->id], true, false, 'red');
    }

    private function draftOrderMap(Account $account): array
    {
        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?order_kind=draft&per_page=100')
            ->assertOk();

        return $this->keyOrdersById($response->json('data'));
    }

    private function trashedOrderMap(Account $account): array
    {
        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?trashed=1&per_page=100')
            ->assertOk();

        return $this->keyOrdersById($response->json('data'));
    }

    private function keyOrdersById(array $rows): array
    {
        return collect($rows)
            ->keyBy(fn (array $row) => (int) $row['id'])
            ->all();
    }

    private function assertDuplicatePhoneState(array $order, bool $hasDuplicatePhone, bool $hasMatchingProduct, string $expectedColor): void
    {
        $this->assertSame($hasDuplicatePhone, (bool) ($order['has_duplicate_phone'] ?? false));
        $this->assertSame($hasMatchingProduct, (bool) ($order['has_duplicate_phone_with_matching_product'] ?? false));
        $this->assertSame($expectedColor, (string) ($order['duplicate_phone_color'] ?? 'default'));
        $this->assertSame($hasDuplicatePhone, (bool) ($order['is_repeat_customer_phone'] ?? false));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Duplicate Order Account',
            'domain' => 'orders-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'orders-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Order Duplicate Admin',
            'email' => 'order-duplicate-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function createDraftOrder(Account $account, User $user, Product $product, array $overrides = []): Order
    {
        return $this->createDraftOrderWithProducts($account, $user, [
            [
                'product' => $product,
                'quantity' => (int) ($overrides['item_quantity'] ?? 1),
                'price' => (float) ($overrides['item_price'] ?? $product->price ?? 0),
                'cost_price' => (float) ($overrides['item_cost_price'] ?? $product->cost_price ?? 0),
            ],
        ], $overrides);
    }

    private function createDraftOrderWithProducts(Account $account, User $user, array $items, array $overrides = []): Order
    {
        $normalizedItems = collect($items)->map(function (array $item) {
            /** @var Product $product */
            $product = $item['product'];
            $quantity = (int) ($item['quantity'] ?? 1);
            $price = (float) ($item['price'] ?? $product->price ?? 0);
            $costPrice = (float) ($item['cost_price'] ?? $product->cost_price ?? 0);
            $lineTotal = round($price * $quantity, 2);
            $costTotal = round($costPrice * $quantity, 2);

            return [
                'product' => $product,
                'quantity' => $quantity,
                'price' => $price,
                'cost_price' => $costPrice,
                'line_total' => $lineTotal,
                'cost_total' => $costTotal,
                'profit_total' => round($lineTotal - $costTotal, 2),
            ];
        })->values();

        $lineTotal = round((float) $normalizedItems->sum('line_total'), 2);
        $costTotal = round((float) $normalizedItems->sum('cost_total'), 2);

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

        foreach ($normalizedItems as $item) {
            $product = $item['product'];

            OrderItem::query()->create([
                'order_id' => $order->id,
                'account_id' => $account->id,
                'product_id' => $product->id,
                'product_name_snapshot' => $product->name,
                'product_sku_snapshot' => $product->sku,
                'quantity' => $item['quantity'],
                'price' => $item['price'],
                'cost_price' => $item['cost_price'],
                'cost_total' => $item['cost_total'],
                'profit_total' => $item['profit_total'],
            ]);
        }

        return $order;
    }
}
