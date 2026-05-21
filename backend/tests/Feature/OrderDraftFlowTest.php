<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Attribute;
use App\Models\InventoryBatch;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
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
                'shipping_address' => '',
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

    public function test_save_draft_with_complete_customer_info_stores_official_order(): void
    {
        [$account] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham auto official',
            'sku' => 'AUTO-OFFICIAL-001',
            'price' => 150000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach du thong tin',
                'customer_phone' => '0912345678',
                'shipping_address' => '123 Nguyen Trai',
                'notes' => 'Bam nham luu nhap',
                'source' => 'Website',
                'shipping_fee' => 35000,
                'discount' => 10000,
                'items' => [
                    [
                        'product_id' => $product->id,
                        'quantity' => 2,
                        'price' => 150000,
                    ],
                ],
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('order_kind', Order::KIND_OFFICIAL)
            ->assertJsonPath('customer_name', 'Khach du thong tin')
            ->assertJsonPath('customer_phone', '0912345678')
            ->assertJsonPath('source', 'Website')
            ->assertJsonPath('notes', 'Bam nham luu nhap')
            ->assertJsonPath('shipping_fee', 35000)
            ->assertJsonPath('discount', 10000);

        $order = Order::query()->findOrFail((int) $response->json('id'));

        $this->assertSame(Order::KIND_OFFICIAL, $order->order_kind);
        $this->assertContains($order->id, collect($this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders')
            ->assertOk()
            ->json('data'))->pluck('id')->all());
        $this->assertNotContains($order->id, collect($this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?order_kind=draft')
            ->assertOk()
            ->json('data'))->pluck('id')->all());
    }

    public function test_update_draft_with_complete_customer_info_converts_to_official_order(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham update auto official',
            'sku' => 'AUTO-OFFICIAL-UPD-001',
            'price' => 175000,
        ]);

        $order = $this->createDraftOrder($account, $user, $product, [
            'customer_name' => 'Khach draft thieu dia chi',
            'customer_phone' => '0901111222',
            'shipping_address' => '',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$order->id}", [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach draft da du',
                'customer_phone' => '0901111222',
                'shipping_address' => '456 Le Loi',
                'notes' => 'Sua nhap thanh don chinh',
                'source' => 'FB',
                'shipping_fee' => 25000,
                'discount' => 5000,
                'items' => [
                    [
                        'product_id' => $product->id,
                        'quantity' => 1,
                        'price' => 175000,
                    ],
                ],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('id', $order->id)
            ->assertJsonPath('order_kind', Order::KIND_OFFICIAL)
            ->assertJsonPath('customer_name', 'Khach draft da du')
            ->assertJsonPath('shipping_address', '456 Le Loi')
            ->assertJsonPath('notes', 'Sua nhap thanh don chinh')
            ->assertJsonPath('source', 'FB')
            ->assertJsonPath('shipping_fee', 25000)
            ->assertJsonPath('discount', 5000);

        $order->refresh();

        $this->assertSame(Order::KIND_OFFICIAL, $order->order_kind);
        $this->assertSame('456 Le Loi', $order->shipping_address);
        $this->assertNotNull($order->officialized_at);
    }

    public function test_convert_to_draft_keeps_complete_official_order_in_main_orders(): void
    {
        [$account] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham keep official',
            'sku' => 'KEEP-OFFICIAL-001',
            'price' => 210000,
        ]);

        $storeResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', $this->officialOrderPayload($product));

        $storeResponse->assertCreated();
        $orderId = (int) $storeResponse->json('id');

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$orderId}/convert", [
                'target_kind' => Order::KIND_DRAFT,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('id', $orderId)
            ->assertJsonPath('order_kind', Order::KIND_OFFICIAL);

        $order = Order::query()->findOrFail($orderId);

        $this->assertSame(Order::KIND_OFFICIAL, $order->order_kind);
        $this->assertContains($orderId, collect($this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders')
            ->assertOk()
            ->json('data'))->pluck('id')->all());
        $this->assertNotContains($orderId, collect($this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?order_kind=draft')
            ->assertOk()
            ->json('data'))->pluck('id')->all());
    }

    public function test_store_draft_order_with_only_customer_name_and_no_items(): void
    {
        [$account] = $this->authenticate();

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach chi co ten',
                'customer_email' => '',
                'customer_phone' => '',
                'shipping_address' => '',
                'items' => [],
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('order_kind', Order::KIND_DRAFT)
            ->assertJsonPath('customer_name', 'Khach chi co ten')
            ->assertJsonPath('shipping_status_source', 'manual');

        $order = Order::query()->findOrFail((int) $response->json('id'));

        $this->assertSame(Order::KIND_DRAFT, $order->order_kind);
        $this->assertSame('Khach chi co ten', $order->customer_name);
        $this->assertSame('', (string) $order->customer_phone);
        $this->assertSame('', (string) $order->shipping_address);
        $this->assertSame(0.0, (float) $order->total_price);
        $this->assertSame(0.0, (float) $order->cost_total);
        $this->assertSame(0, $order->items()->count());
    }

    public function test_store_draft_order_with_only_customer_phone_and_no_items(): void
    {
        [$account] = $this->authenticate();

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => '',
                'customer_email' => '',
                'customer_phone' => '0912345678',
                'shipping_address' => '',
                'items' => [],
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('order_kind', Order::KIND_DRAFT)
            ->assertJsonPath('customer_phone', '0912345678')
            ->assertJsonPath('shipping_status_source', 'manual');

        $order = Order::query()->findOrFail((int) $response->json('id'));

        $this->assertSame(Order::KIND_DRAFT, $order->order_kind);
        $this->assertSame('', (string) $order->customer_name);
        $this->assertSame('0912345678', (string) $order->customer_phone);
        $this->assertSame('', (string) $order->shipping_address);
        $this->assertSame(0.0, (float) $order->total_price);
        $this->assertSame(0, $order->items()->count());
    }

    public function test_update_draft_order_can_clear_contact_fields_and_items_if_customer_name_exists(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham xoa thong tin',
            'sku' => 'DRAFT-CLEAR-001',
            'price' => 125000,
        ]);

        $order = $this->createDraftOrder($account, $user, $product, [
            'customer_name' => 'Khach cu',
            'customer_phone' => '0912345678',
            'shipping_address' => '123 Nguyen Trai',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$order->id}", [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach nhap toi gian',
                'customer_phone' => '',
                'shipping_address' => '',
                'items' => [],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('id', $order->id)
            ->assertJsonPath('order_kind', Order::KIND_DRAFT)
            ->assertJsonPath('customer_name', 'Khach nhap toi gian');

        $order->refresh();

        $this->assertSame(Order::KIND_DRAFT, $order->order_kind);
        $this->assertSame('Khach nhap toi gian', $order->customer_name);
        $this->assertSame('', (string) $order->customer_phone);
        $this->assertSame('', (string) $order->shipping_address);
        $this->assertSame(0.0, (float) $order->total_price);
        $this->assertSame(0.0, (float) $order->cost_total);
        $this->assertSame(0, $order->items()->count());
    }

    public function test_update_draft_order_can_keep_only_customer_phone(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham phone toi gian',
            'sku' => 'DRAFT-PHONE-ONLY-001',
            'price' => 145000,
        ]);

        $order = $this->createDraftOrder($account, $user, $product, [
            'customer_name' => 'Khach cu',
            'customer_phone' => '0912345678',
            'shipping_address' => '123 Nguyen Trai',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$order->id}", [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => '',
                'customer_phone' => '0987654321',
                'shipping_address' => '',
                'items' => [],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('id', $order->id)
            ->assertJsonPath('order_kind', Order::KIND_DRAFT)
            ->assertJsonPath('customer_name', '')
            ->assertJsonPath('customer_phone', '0987654321');

        $order->refresh();

        $this->assertSame(Order::KIND_DRAFT, $order->order_kind);
        $this->assertSame('', (string) $order->customer_name);
        $this->assertSame('0987654321', (string) $order->customer_phone);
        $this->assertSame('', (string) $order->shipping_address);
        $this->assertSame(0.0, (float) $order->total_price);
        $this->assertSame(0, $order->items()->count());
    }

    public function test_store_draft_order_reuses_existing_region_attributes_from_other_entity_types(): void
    {
        [$account] = $this->authenticate();
        $this->seedSharedRegionAttributes($account);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach draft dia gioi',
                'customer_phone' => '0912345678',
                'region_type' => 'new',
                'custom_attributes' => [
                    'region_type' => 'Dia gioi moi',
                    'full_region_path' => 'Xa moi, Huyen moi, Tinh moi',
                ],
                'items' => [],
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('order_kind', Order::KIND_DRAFT);

        $order = Order::query()
            ->with('attributeValues.attribute')
            ->findOrFail((int) $response->json('id'));

        $this->assertOrderAttributeValueByCode($order, 'region_type', 'Dia gioi moi');
        $this->assertOrderAttributeValueByCode($order, 'full_region_path', 'Xa moi, Huyen moi, Tinh moi');
        $this->assertSame('product', Attribute::withoutGlobalScope('account_id')->where('code', 'region_type')->value('entity_type'));
        $this->assertSame('product', Attribute::withoutGlobalScope('account_id')->where('code', 'full_region_path')->value('entity_type'));
    }

    public function test_convert_official_order_to_draft_reuses_existing_region_attributes_from_other_entity_types(): void
    {
        [$account] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham convert dia gioi',
            'sku' => 'CONVERT-REGION-001',
            'price' => 210000,
        ]);
        $this->seedSharedRegionAttributes($account);

        $storeResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', $this->officialOrderPayload($product));

        $storeResponse->assertCreated();

        $orderId = (int) $storeResponse->json('id');

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$orderId}/convert", [
                'target_kind' => Order::KIND_DRAFT,
                'region_type' => 'old',
                'shipping_address' => '',
                'custom_attributes' => [
                    'region_type' => 'Dia gioi cu',
                    'full_region_path' => 'Xa cu, Huyen cu, Tinh cu',
                ],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('id', $orderId)
            ->assertJsonPath('order_kind', Order::KIND_DRAFT);

        $order = Order::query()
            ->with('attributeValues.attribute')
            ->findOrFail($orderId);

        $this->assertSame(Order::KIND_DRAFT, $order->order_kind);
        $this->assertOrderAttributeValueByCode($order, 'region_type', 'Dia gioi cu');
        $this->assertOrderAttributeValueByCode($order, 'full_region_path', 'Xa cu, Huyen cu, Tinh cu');
    }

    public function test_draft_order_item_order_persists_across_reopen_and_multiple_updates(): void
    {
        [$account] = $this->authenticate();
        $productA = $this->createProduct($account, [
            'name' => 'San pham thu tu A',
            'sku' => 'DRAFT-ORDER-A',
            'price' => 110000,
        ]);
        $productB = $this->createProduct($account, [
            'name' => 'San pham thu tu B',
            'sku' => 'DRAFT-ORDER-B',
            'price' => 120000,
        ]);
        $productC = $this->createProduct($account, [
            'name' => 'San pham thu tu C',
            'sku' => 'DRAFT-ORDER-C',
            'price' => 130000,
        ]);
        $productD = $this->createProduct($account, [
            'name' => 'San pham thu tu D',
            'sku' => 'DRAFT-ORDER-D',
            'price' => 140000,
        ]);

        $storeResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach thu tu',
                'customer_phone' => '0912345678',
                'shipping_address' => '',
                'items' => [
                    $this->buildOrderItemPayload($productC, 1),
                    $this->buildOrderItemPayload($productA, 2),
                    $this->buildOrderItemPayload($productD, 1),
                    $this->buildOrderItemPayload($productB, 3),
                ],
            ]);

        $storeResponse->assertCreated();

        $orderId = (int) $storeResponse->json('id');
        $initialOrder = [$productC->id, $productA->id, $productD->id, $productB->id];

        $this->assertOrderItemSequence($account, $orderId, $initialOrder);
        $this->assertOrderItemSequence($account, $orderId, $initialOrder);

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$orderId}", [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach thu tu lan 2',
                'customer_phone' => '0912345678',
                'shipping_address' => '',
                'items' => [
                    $this->buildOrderItemPayload($productB, 1),
                    $this->buildOrderItemPayload($productD, 2),
                    $this->buildOrderItemPayload($productA, 1),
                    $this->buildOrderItemPayload($productC, 4),
                ],
            ])
            ->assertOk();

        $secondOrder = [$productB->id, $productD->id, $productA->id, $productC->id];

        $this->assertOrderItemSequence($account, $orderId, $secondOrder);
        $this->assertOrderItemSequence($account, $orderId, $secondOrder);

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$orderId}", [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach thu tu lan 3',
                'customer_phone' => '0912345678',
                'shipping_address' => '',
                'items' => [
                    $this->buildOrderItemPayload($productA, 2),
                    $this->buildOrderItemPayload($productC, 1),
                    $this->buildOrderItemPayload($productB, 2),
                    $this->buildOrderItemPayload($productD, 1),
                ],
            ])
            ->assertOk();

        $finalOrder = [$productA->id, $productC->id, $productB->id, $productD->id];

        $this->assertOrderItemSequence($account, $orderId, $finalOrder);
        $this->assertOrderItemSequence($account, $orderId, $finalOrder);
    }

    public function test_duplicate_draft_order_preserves_item_order_and_sort_order(): void
    {
        [$account] = $this->authenticate();
        $productA = $this->createProduct($account, [
            'name' => 'San pham duplicate A',
            'sku' => 'DRAFT-DUP-A',
            'price' => 210000,
        ]);
        $productB = $this->createProduct($account, [
            'name' => 'San pham duplicate B',
            'sku' => 'DRAFT-DUP-B',
            'price' => 220000,
        ]);
        $productC = $this->createProduct($account, [
            'name' => 'San pham duplicate C',
            'sku' => 'DRAFT-DUP-C',
            'price' => 230000,
        ]);

        $storeResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach duplicate',
                'customer_phone' => '0912345678',
                'shipping_address' => '',
                'items' => [
                    $this->buildOrderItemPayload($productB, 1),
                    $this->buildOrderItemPayload($productC, 2),
                    $this->buildOrderItemPayload($productA, 1),
                ],
            ]);

        $storeResponse->assertCreated();

        $sourceOrderId = (int) $storeResponse->json('id');
        $expectedOrder = [$productB->id, $productC->id, $productA->id];

        $duplicateResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/orders/{$sourceOrderId}/duplicate", [
                'target_kind' => Order::KIND_DRAFT,
            ]);

        $duplicateResponse
            ->assertOk()
            ->assertJsonPath('order_kind', Order::KIND_DRAFT);

        $duplicatedOrderId = (int) $duplicateResponse->json('id');

        $this->assertNotSame($sourceOrderId, $duplicatedOrderId);
        $this->assertOrderItemSequence($account, $sourceOrderId, $expectedOrder);
        $this->assertOrderItemSequence($account, $duplicatedOrderId, $expectedOrder);
    }

    public function test_draft_order_costs_round_up_to_the_nearest_thousand(): void
    {
        [$account] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham lam tron len',
            'sku' => 'ROUND-UP-001',
            'price' => 890000,
            'cost_price' => 526951.22,
            'expected_cost' => 526951.22,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', [
                'order_kind' => Order::KIND_DRAFT,
                'customer_name' => 'Khach lam tron len',
                'customer_phone' => '0911111111',
                'shipping_address' => '',
                'items' => [
                    [
                        'product_id' => $product->id,
                        'quantity' => 2,
                        'price' => 890000,
                    ],
                ],
            ]);

        $response->assertCreated();

        $order = Order::query()->with('items')->findOrFail((int) $response->json('id'));
        $item = $order->items->first();

        $this->assertSame(527000.0, (float) $item->cost_price);
        $this->assertSame(1054000.0, (float) $item->cost_total);
        $this->assertSame(1054000.0, (float) $order->cost_total);
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

    public function test_official_order_costs_round_down_to_the_nearest_thousand_while_batch_allocations_keep_raw_cost(): void
    {
        [$account] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham lam tron xuong',
            'sku' => 'ROUND-DOWN-001',
            'price' => 790000,
            'cost_price' => 526400,
            'expected_cost' => 526400,
            'stock_quantity' => 1,
        ]);
        $this->createInventoryBatch($account, $product, 1, 526400, 'round-down');

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders', $this->officialOrderPayload($product, [
                'quantity' => 1,
                'price' => 790000,
            ]));

        $response->assertCreated();

        $order = $this->loadOrderWithAllocations((int) $response->json('id'));
        $item = $order->items->first();
        $allocation = $item->batchAllocations->first();

        $this->assertSame(526000.0, (float) $item->cost_price);
        $this->assertSame(526000.0, (float) $item->cost_total);
        $this->assertSame(526400.0, (float) $allocation->total_cost);
        $this->assertSame(526400.0, (float) $allocation->unit_cost);
        $this->assertSame(526000.0, (float) $order->cost_total);
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
                'shipping_address' => '',
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
        $draftCreatedAt = Carbon::parse('2026-04-10 08:15:00');
        $officializedAt = Carbon::parse('2026-04-15 09:45:00');
        $this->forceOrderAttributes($order, [
            'created_at' => $draftCreatedAt,
            'updated_at' => $draftCreatedAt,
            'draft_created_at' => $draftCreatedAt,
            'officialized_at' => null,
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

        Carbon::setTestNow($officializedAt);

        try {
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
        } finally {
            Carbon::setTestNow();
        }

        $convertResponse
            ->assertOk()
            ->assertJsonPath('id', $order->id)
            ->assertJsonPath('order_kind', Order::KIND_OFFICIAL)
            ->assertJsonPath('shipping_status_source', 'manual')
            ->assertJsonPath('draft_created_at', $draftCreatedAt->toISOString())
            ->assertJsonPath('officialized_at', $officializedAt->toISOString())
            ->assertJsonPath('displayed_at', $officializedAt->toISOString());

        $order->refresh();

        $this->assertSame(Order::KIND_OFFICIAL, $order->order_kind);
        $this->assertStringStartsWith('OR', (string) $order->order_number);
        $this->assertNotSame('OR10000A0', (string) $order->order_number);
        $this->assertSame(1, Order::withTrashed()->where('order_number', $order->order_number)->count());
        $this->assertTrue($order->created_at->equalTo($draftCreatedAt));
        $this->assertTrue($order->draft_created_at->equalTo($draftCreatedAt));
        $this->assertTrue($order->officialized_at->equalTo($officializedAt));

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
        $mainListRow = collect($mainListAfter->json('data'))
            ->firstWhere('id', $order->id);
        $this->assertSame($draftCreatedAt->toISOString(), $mainListRow['draft_created_at'] ?? null);
        $this->assertSame($officializedAt->toISOString(), $mainListRow['officialized_at'] ?? null);
        $this->assertSame($officializedAt->toISOString(), $mainListRow['displayed_at'] ?? null);
    }

    public function test_order_list_uses_displayed_at_for_sorting_and_date_filters_after_draft_conversion(): void
    {
        [$account, $user] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'San pham sort timestamp',
            'sku' => 'SORT-TS-001',
            'price' => 155000,
        ]);

        $legacyOfficial = Order::query()->create([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'OR-SORT-0001',
            'order_kind' => Order::KIND_OFFICIAL,
            'total_price' => 155000,
            'status' => 'new',
            'customer_name' => 'Khach official cu',
            'customer_email' => 'legacy-official@example.com',
            'customer_phone' => '0901000001',
            'shipping_address' => 'Dia chi official cu',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'source' => 'Website',
            'type' => 'Le',
            'shipment_status' => 'Chua giao',
            'shipping_status_source' => 'manual',
            'officialized_at' => Carbon::parse('2026-04-11 07:00:00'),
        ]);
        $this->forceOrderAttributes($legacyOfficial, [
            'created_at' => Carbon::parse('2026-04-11 07:00:00'),
            'updated_at' => Carbon::parse('2026-04-11 07:00:00'),
        ]);

        $draft = $this->createDraftOrder($account, $user, $product, [
            'order_number' => 'DR-SORT-0001',
            'customer_name' => 'Khach draft doi gio',
            'customer_phone' => '0902000002',
        ]);
        $draftCreatedAt = Carbon::parse('2026-04-01 10:00:00');
        $officializedAt = Carbon::parse('2026-04-15 16:30:00');
        $this->forceOrderAttributes($draft, [
            'created_at' => $draftCreatedAt,
            'updated_at' => $draftCreatedAt,
            'draft_created_at' => $draftCreatedAt,
            'officialized_at' => null,
        ]);

        Carbon::setTestNow($officializedAt);

        try {
            $this
                ->withHeaders($this->headers($account))
                ->postJson("/api/orders/{$draft->id}/convert", [
                    'target_kind' => Order::KIND_OFFICIAL,
                    'region_type' => 'old',
                    'province' => 'Tinh test',
                    'district' => 'Huyen test',
                    'ward' => 'Xa test',
                    'shipping_address' => '789 Tran Hung Dao, Xa test, Huyen test, Tinh test',
                ])
                ->assertOk();
        } finally {
            Carbon::setTestNow();
        }

        $listResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders')
            ->assertOk();

        $firstRow = collect($listResponse->json('data'))->first();
        $convertedRow = collect($listResponse->json('data'))->firstWhere('id', $draft->id);

        $this->assertSame($draft->id, $firstRow['id'] ?? null);
        $this->assertSame($draftCreatedAt->toISOString(), $convertedRow['created_at'] ?? null);
        $this->assertSame($officializedAt->toISOString(), $convertedRow['displayed_at'] ?? null);

        $filteredResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?created_at_from=2026-04-15&created_at_to=2026-04-15')
            ->assertOk();

        $filteredIds = collect($filteredResponse->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertSame([$draft->id], $filteredIds);
    }

    public function test_convert_endpoint_persists_latest_draft_changes_before_officializing(): void
    {
        [$account, $user] = $this->authenticate();
        $originalProduct = $this->createProduct($account, [
            'name' => 'San pham draft goc',
            'sku' => 'DRAFT-CONVERT-OLD-001',
            'price' => 125000,
            'cost_price' => 70000,
            'stock_quantity' => 40,
        ]);
        $latestProduct = $this->createProduct($account, [
            'name' => 'San pham draft moi',
            'sku' => 'DRAFT-CONVERT-NEW-001',
            'price' => 210000,
            'cost_price' => 110000,
            'stock_quantity' => 40,
        ]);
        $this->createInventoryBatch($account, $originalProduct, 20, 70000, 'draft-convert-old');
        $this->createInventoryBatch($account, $latestProduct, 20, 110000, 'draft-convert-new');

        $order = $this->createDraftOrder($account, $user, $originalProduct, [
            'order_number' => 'DR-CONVERT-LATEST-001',
            'customer_name' => 'Khach draft cu',
            'customer_phone' => '0901111111',
            'notes' => 'Ban nhap ban dau',
        ]);
        $draftCreatedAt = Carbon::parse('2026-04-09 14:20:00');
        $officializedAt = Carbon::parse('2026-04-15 15:05:00');
        $this->forceOrderAttributes($order, [
            'created_at' => $draftCreatedAt,
            'updated_at' => $draftCreatedAt,
            'draft_created_at' => $draftCreatedAt,
            'officialized_at' => null,
        ]);

        Carbon::setTestNow($officializedAt);

        try {
            $response = $this
                ->withHeaders($this->headers($account))
                ->postJson("/api/orders/{$order->id}/convert", [
                    'target_kind' => Order::KIND_OFFICIAL,
                    'customer_name' => 'Khach draft da sua',
                    'customer_phone' => '0987654321',
                    'notes' => 'Ban da sua truoc khi chot',
                    'region_type' => 'old',
                    'province' => 'Tinh moi',
                    'district' => 'Huyen moi',
                    'ward' => 'Xa moi',
                    'shipping_address' => '456 Le Loi, Xa moi, Huyen moi, Tinh moi',
                    'items' => [
                        [
                            'product_id' => $latestProduct->id,
                            'quantity' => 2,
                            'price' => 210000,
                            'cost_price' => 110000,
                        ],
                    ],
                ]);
        } finally {
            Carbon::setTestNow();
        }

        $response
            ->assertOk()
            ->assertJsonPath('id', $order->id)
            ->assertJsonPath('order_kind', Order::KIND_OFFICIAL)
            ->assertJsonPath('customer_name', 'Khach draft da sua')
            ->assertJsonPath('customer_phone', '0987654321')
            ->assertJsonPath('notes', 'Ban da sua truoc khi chot')
            ->assertJsonPath('shipping_address', '456 Le Loi, Xa moi, Huyen moi, Tinh moi')
            ->assertJsonPath('officialized_at', $officializedAt->toISOString())
            ->assertJsonPath('displayed_at', $officializedAt->toISOString());

        $order = $this->loadOrderWithAllocations($order->id);

        $this->assertSame(Order::KIND_OFFICIAL, $order->order_kind);
        $this->assertSame('Khach draft da sua', $order->customer_name);
        $this->assertSame('0987654321', $order->customer_phone);
        $this->assertSame('Ban da sua truoc khi chot', $order->notes);
        $this->assertSame('Tinh moi', $order->province);
        $this->assertSame('Huyen moi', $order->district);
        $this->assertSame('Xa moi', $order->ward);
        $this->assertSame('456 Le Loi, Xa moi, Huyen moi, Tinh moi', $order->shipping_address);
        $this->assertTrue($order->draft_created_at->equalTo($draftCreatedAt));
        $this->assertTrue($order->officialized_at->equalTo($officializedAt));
        $this->assertSame(420000.0, (float) $order->total_price);
        $this->assertCount(1, $order->items);
        $this->assertSame($latestProduct->id, (int) $order->items[0]->product_id);
        $this->assertSame(2, (int) $order->items[0]->quantity);
        $this->assertSame(210000.0, (float) $order->items[0]->price);
        $this->assertSame(110000.0, (float) $order->items[0]->cost_price);
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
        $this->assertNotNull($draftOne->officialized_at);
        $this->assertNotNull($draftTwo->officialized_at);
    }

    private function assertOrderItemSequence(Account $account, int $orderId, array $expectedProductIds): void
    {
        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson("/api/orders/{$orderId}")
            ->assertOk();

        $responseItems = collect($response->json('items', []));

        $this->assertSame(
            $expectedProductIds,
            $responseItems->pluck('product_id')->map(fn ($productId) => (int) $productId)->all()
        );
        $this->assertSame(
            range(1, count($expectedProductIds)),
            $responseItems->pluck('sort_order')->map(fn ($sortOrder) => (int) $sortOrder)->all()
        );

        $storedItems = OrderItem::query()
            ->where('order_id', $orderId)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        $this->assertSame(
            $expectedProductIds,
            $storedItems->pluck('product_id')->map(fn ($productId) => (int) $productId)->all()
        );
        $this->assertSame(
            range(1, count($expectedProductIds)),
            $storedItems->pluck('sort_order')->map(fn ($sortOrder) => (int) $sortOrder)->all()
        );
    }

    private function buildOrderItemPayload(Product $product, int $quantity = 1, ?float $price = null): array
    {
        return [
            'product_id' => $product->id,
            'quantity' => $quantity,
            'price' => $price ?? (float) ($product->price ?? 0),
        ];
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
            'draft_created_at' => now(),
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

    private function seedSharedRegionAttributes(Account $account): void
    {
        foreach ([
            'region_type' => 'Region Type',
            'full_region_path' => 'Full Region Path',
        ] as $code => $name) {
            Attribute::query()->create([
                'account_id' => $account->id,
                'entity_type' => 'product',
                'code' => $code,
                'name' => $name,
                'frontend_type' => 'text',
                'status' => true,
            ]);
        }
    }

    private function assertOrderAttributeValueByCode(Order $order, string $code, string $expectedValue): void
    {
        $attributeId = (int) Attribute::withoutGlobalScope('account_id')->where('code', $code)->value('id');
        $attributeValue = $order->attributeValues->firstWhere('attribute_id', $attributeId);

        $this->assertGreaterThan(0, $attributeId);
        $this->assertNotNull($attributeValue);
        $this->assertSame($expectedValue, $attributeValue->value);
    }

    private function forceOrderAttributes(Order $order, array $attributes): void
    {
        $order->forceFill($attributes)->saveQuietly();
        $order->refresh();
    }
}
