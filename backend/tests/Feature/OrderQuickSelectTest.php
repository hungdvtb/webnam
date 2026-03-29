<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\Shipment;
use App\Models\ShipmentItem;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class OrderQuickSelectTest extends TestCase
{
    use RefreshDatabase;

    public function test_order_list_search_finds_order_by_trailing_fragment(): void
    {
        [$account] = $this->authenticate();

        $targetOrder = $this->createOrder($account, [
            'order_number' => 'OR-SEARCH-ABCDE12345',
            'customer_name' => 'Khach duoc tim',
        ]);

        $this->createOrder($account, [
            'order_number' => 'OR-SEARCH-OTHER99999',
            'customer_name' => 'Khach khac',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?search=12345');

        $response->assertOk();

        $orderIds = collect($response->json('data'))->pluck('id')->map(fn ($id) => (int) $id)->all();

        $this->assertContains($targetOrder->id, $orderIds);
        $this->assertCount(1, $orderIds);
    }

    public function test_order_list_search_matches_any_keyword_across_products_phone_and_tracking_code(): void
    {
        [$account, $user] = $this->authenticate();

        $alphaProduct = $this->createProduct($account, [
            'name' => 'San pham Alpha dac biet',
            'sku' => 'SKU-ALPHA-001',
        ]);
        $genericProduct = $this->createProduct($account, [
            'name' => 'San pham thong thuong',
            'sku' => 'SKU-GENERIC-001',
        ]);

        $productMatchOrder = $this->createOrder($account, [
            'order_number' => 'OR-MULTI-10001',
            'customer_name' => 'Khach San Pham',
        ]);
        $this->createOrderItem($account, $productMatchOrder, $alphaProduct);

        $phoneMatchOrder = $this->createOrder($account, [
            'order_number' => 'OR-MULTI-20002',
            'customer_name' => 'Khach Dien Thoai',
            'customer_phone' => '0987654321',
        ]);
        $this->createOrderItem($account, $phoneMatchOrder, $genericProduct);

        $trackingMatchOrder = $this->createOrder($account, [
            'order_number' => 'OR-MULTI-30003',
            'customer_name' => 'Khach Van Don',
        ]);
        $trackingItem = $this->createOrderItem($account, $trackingMatchOrder, $genericProduct);
        $this->createShipment($account, $trackingMatchOrder, $user, [
            'shipment_number' => 'SHIP-MULTI-30003',
            'carrier_tracking_code' => 'TRACK-MULTI-999',
        ], [
            [
                'order_item_id' => $trackingItem->id,
                'qty' => 1,
            ],
        ]);

        $ignoredOrder = $this->createOrder($account, [
            'order_number' => 'OR-MULTI-40004',
            'customer_name' => 'Khach Khong Khop',
        ]);
        $this->createOrderItem($account, $ignoredOrder, $genericProduct);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?search_terms[]=Alpha&search_terms[]=0987654321&search_terms[]=TRACK-MULTI-999');

        $response->assertOk();

        $orderNumbers = collect($response->json('data'))
            ->pluck('order_number')
            ->all();

        $this->assertEqualsCanonicalizing([
            'OR-MULTI-10001',
            'OR-MULTI-20002',
            'OR-MULTI-30003',
        ], $orderNumbers);
        $this->assertCount(3, $orderNumbers);
    }

    public function test_order_list_search_parses_comma_delimited_keywords_from_legacy_search_param(): void
    {
        [$account] = $this->authenticate();

        $skuProduct = $this->createProduct($account, [
            'name' => 'San pham SKU',
            'sku' => 'SKU-STACK-222',
        ]);
        $anotherProduct = $this->createProduct($account, [
            'name' => 'San pham khac',
            'sku' => 'SKU-OTHER-333',
        ]);

        $skuMatchOrder = $this->createOrder($account, [
            'order_number' => 'OR-DELIM-11111',
        ]);
        $this->createOrderItem($account, $skuMatchOrder, $skuProduct);

        $orderNumberMatchOrder = $this->createOrder($account, [
            'order_number' => 'OR-DELIM-33333',
        ]);
        $this->createOrderItem($account, $orderNumberMatchOrder, $anotherProduct);

        $ignoredOrder = $this->createOrder($account, [
            'order_number' => 'OR-DELIM-99999',
        ]);
        $this->createOrderItem($account, $ignoredOrder, $anotherProduct);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?search=SKU-STACK-222,OR-DELIM-33333');

        $response->assertOk();

        $orderNumbers = collect($response->json('data'))
            ->pluck('order_number')
            ->all();

        $this->assertEqualsCanonicalizing([
            'OR-DELIM-11111',
            'OR-DELIM-33333',
        ], $orderNumbers);
        $this->assertCount(2, $orderNumbers);
    }

    public function test_quick_select_reports_duplicates_and_missing_codes_without_auto_selecting_ambiguous_matches(): void
    {
        [$account] = $this->authenticate();

        $duplicateOne = $this->createOrder($account, [
            'order_number' => 'OR-RET-AAA-12345',
            'customer_name' => 'Khach A',
        ]);

        $duplicateTwo = $this->createOrder($account, [
            'order_number' => 'OR-RET-BBB-12345',
            'customer_name' => 'Khach B',
        ]);

        $uniqueOrder = $this->createOrder($account, [
            'order_number' => 'OR-RET-UNIQUE-67890',
            'customer_name' => 'Khach C',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/quick-select', [
                'codes' => ['12345', '67890', '00000'],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('summary.submitted_count', 3)
            ->assertJsonPath('summary.matched_count', 1)
            ->assertJsonPath('summary.missing_count', 1)
            ->assertJsonPath('summary.duplicate_count', 1)
            ->assertJsonPath('resolved_order_ids.0', $uniqueOrder->id)
            ->assertJsonPath('missing_codes.0', '00000')
            ->assertJsonPath('duplicate_codes.0.code', '12345')
            ->assertJsonPath('duplicate_codes.0.message', 'Mã này đang trùng, cần nhập thêm ký tự để xác định chính xác.');

        $duplicateMatchIds = collect($response->json('duplicate_codes.0.matches'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertEqualsCanonicalizing([$duplicateOne->id, $duplicateTwo->id], $duplicateMatchIds);
        $this->assertNotContains($duplicateOne->id, collect($response->json('resolved_order_ids'))->all());
        $this->assertNotContains($duplicateTwo->id, collect($response->json('resolved_order_ids'))->all());
    }

    public function test_quick_select_respects_existing_filters_to_resolve_duplicate_suffixes(): void
    {
        [$account] = $this->authenticate();

        $matchingOrder = $this->createOrder($account, [
            'order_number' => 'OR-FILTER-ABC-44556',
            'status' => 'shipping',
            'customer_name' => 'Khach dung filter',
        ]);

        $this->createOrder($account, [
            'order_number' => 'OR-FILTER-XYZ-44556',
            'status' => 'new',
            'customer_name' => 'Khach bi loai',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/quick-select', [
                'codes' => ['44556'],
                'status' => 'shipping',
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('summary.matched_count', 1)
            ->assertJsonPath('summary.missing_count', 0)
            ->assertJsonPath('summary.duplicate_count', 0)
            ->assertJsonPath('resolved_order_ids.0', $matchingOrder->id);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Quick Select ' . Str::upper(Str::random(4)),
            'domain' => 'quick-select-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'quick-select-' . Str::lower(Str::random(6)),
            'status' => 'active',
        ]);

        $user = User::factory()->create();
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

    private function createOrder(Account $account, array $overrides = []): Order
    {
        return Order::query()->create(array_merge([
            'account_id' => $account->id,
            'user_id' => User::query()->value('id'),
            'order_number' => 'OR-' . Str::upper(Str::random(10)),
            'order_kind' => Order::KIND_OFFICIAL,
            'status' => 'new',
            'customer_name' => 'Khach ' . Str::upper(Str::random(4)),
            'customer_phone' => '090' . random_int(1000000, 9999999),
            'shipping_address' => 'Dia chi test',
            'total_price' => 0,
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => 0,
            'shipping_status_source' => 'manual',
        ], $overrides));
    }

    private function createProduct(Account $account, array $overrides = []): Product
    {
        $name = $overrides['name'] ?? ('San pham ' . Str::lower(Str::random(5)));

        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(5)),
            'sku' => $overrides['sku'] ?? ('SKU-' . Str::upper(Str::random(6))),
            'price' => 100000,
            'stock_quantity' => 0,
            'status' => true,
        ], $overrides));
    }

    private function createOrderItem(Account $account, Order $order, Product $product, int $quantity = 1): OrderItem
    {
        return OrderItem::query()->create([
            'order_id' => $order->id,
            'account_id' => $account->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => $quantity,
            'price' => $product->price,
        ]);
    }

    private function createShipment(Account $account, Order $order, User $user, array $overrides = [], array $items = []): Shipment
    {
        $shipment = Shipment::query()->create(array_merge([
            'account_id' => $account->id,
            'order_id' => $order->id,
            'order_code' => $order->order_number,
            'shipment_number' => 'SHIP-' . Str::upper(Str::random(8)),
            'tracking_number' => 'TRACK-' . Str::upper(Str::random(6)),
            'carrier_tracking_code' => 'TRACK-' . Str::upper(Str::random(6)),
            'carrier_code' => 'viettel_post',
            'carrier_name' => 'Viettel Post',
            'channel' => 'manual',
            'customer_name' => $order->customer_name,
            'customer_phone' => $order->customer_phone,
            'customer_address' => $order->shipping_address,
            'customer_ward' => $order->ward,
            'customer_district' => $order->district,
            'customer_province' => $order->province,
            'status' => 'created',
            'shipment_status' => 'created',
            'order_status_snapshot' => $order->status,
            'cod_amount' => (float) $order->total_price,
            'shipping_cost' => 0,
            'service_fee' => 0,
            'return_fee' => 0,
            'insurance_fee' => 0,
            'other_fee' => 0,
            'reconciled_amount' => 0,
            'actual_received_amount' => (float) $order->total_price,
            'reconciliation_status' => 'pending',
            'created_by' => $user->id,
        ], $overrides));

        foreach ($items as $item) {
            ShipmentItem::query()->create([
                'shipment_id' => $shipment->id,
                'order_item_id' => (int) ($item['order_item_id'] ?? 0),
                'qty' => (int) ($item['qty'] ?? 0),
            ]);
        }

        return $shipment;
    }
}
