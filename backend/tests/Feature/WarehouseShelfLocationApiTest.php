<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\ProductReplacementGroup;
use App\Models\ProductReplacementItem;
use App\Models\User;
use App\Models\Warehouse;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class WarehouseShelfLocationApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_can_assign_skus_by_shelf_floor_and_search_location(): void
    {
        [$account] = $this->authenticate();
        $warehouse = $this->createWarehouse($account);
        $firstProduct = $this->createProduct($account, ['sku' => 'BAT-A-TRANG', 'warehouse_sequence' => 34]);
        $secondProduct = $this->createProduct($account, ['sku' => 'BAT-A-XANH', 'warehouse_sequence' => 35]);

        $shelfResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/warehouse-shelves', [
                'warehouse_id' => $warehouse->id,
                'name' => 'Kệ 1',
                'code' => 'K01',
                'floor_count' => 4,
            ])
            ->assertCreated()
            ->assertJsonPath('data.code', 'K01');

        $shelfId = $shelfResponse->json('data.id');

        $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/warehouse-shelves/{$shelfId}/assign", [
                'mode' => 'merge',
                'floors' => [
                    '1' => "BAT-A-TRANG\nBAT-A-XANH\nSKU-KHONG-CO",
                ],
            ])
            ->assertOk()
            ->assertJsonPath('data.assigned_count', 2)
            ->assertJsonPath('data.missing_skus.0', 'SKU-KHONG-CO');

        $showResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson("/api/warehouse-shelves/{$shelfId}")
            ->assertOk();

        $floorOne = collect($showResponse->json('data.floors'))->firstWhere('floor_number', 1);
        $this->assertCount(2, $floorOne['items']);

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/warehouse-shelves/search?' . http_build_query(['q' => 'BAT-A-TRANG']))
            ->assertOk()
            ->assertJsonPath('data.locations.0.product_sku', $firstProduct->sku)
            ->assertJsonPath('data.locations.0.product_warehouse_sequence', 34)
            ->assertJsonPath('data.locations.0.warehouse_pick_label', '34 - ' . $firstProduct->name)
            ->assertJsonPath('data.locations.0.location_label', 'Kệ 1 - Tầng 1');

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/warehouse-shelves/search?' . http_build_query(['q' => '34']))
            ->assertOk()
            ->assertJsonPath('data.locations.0.product_sku', $firstProduct->sku)
            ->assertJsonPath('data.locations.0.product_warehouse_sequence', 34);

        $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/warehouse-shelves/{$shelfId}/assign", [
                'mode' => 'merge',
                'floors' => [
                    '3' => 'BAT-A-TRANG',
                ],
            ])
            ->assertOk()
            ->assertJsonPath('data.moved_count', 1);

        $this->assertDatabaseHas('product_storage_locations', [
            'account_id' => $account->id,
            'product_id' => $firstProduct->id,
            'warehouse_shelf_id' => $shelfId,
            'floor_number' => 3,
        ]);
        $this->assertDatabaseHas('product_storage_locations', [
            'account_id' => $account->id,
            'product_id' => $secondProduct->id,
            'warehouse_shelf_id' => $shelfId,
            'floor_number' => 1,
        ]);
    }

    public function test_order_print_data_uses_actual_product_storage_location(): void
    {
        [$account, $user] = $this->authenticate();
        $warehouse = $this->createWarehouse($account);
        $orderedProduct = $this->createProduct($account, [
            'sku' => 'SKU-KHACH-DAT',
            'name' => 'Sản phẩm khách đặt',
        ]);
        $actualProduct = $this->createProduct($account, [
            'sku' => 'SKU-THUC-GUI',
            'name' => 'Sản phẩm thực gửi',
            'warehouse_sequence' => 77,
        ]);

        $shelfResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/warehouse-shelves', [
                'warehouse_id' => $warehouse->id,
                'name' => 'Kệ đổi hàng',
                'code' => 'KDH',
                'floor_count' => 4,
            ])
            ->assertCreated();

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/warehouse-shelves/' . $shelfResponse->json('data.id') . '/assign', [
                'mode' => 'merge',
                'floors' => [
                    '4' => 'SKU-THUC-GUI',
                ],
            ])
            ->assertOk();

        $order = $this->createOrder($account, $user);
        OrderItem::query()->create([
            'account_id' => $account->id,
            'order_id' => $order->id,
            'product_id' => $orderedProduct->id,
            'actual_product_id' => $actualProduct->id,
            'inventory_source_account_id' => $account->id,
            'product_name_snapshot' => $orderedProduct->name,
            'product_sku_snapshot' => $orderedProduct->sku,
            'actual_product_name_snapshot' => $actualProduct->name,
            'actual_product_sku_snapshot' => $actualProduct->sku,
            'quantity' => 1,
            'price' => 120000,
            'sort_order' => 1,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/print-data', [
                'ids' => [$order->id],
            ])
            ->assertOk()
            ->assertJsonPath('data.0.items.0.storage_location_label', 'Kệ đổi hàng - Tầng 4')
            ->assertJsonPath('data.0.items.0.storage_location_code', 'KDH-T4')
            ->assertJsonPath('data.0.items.0.warehouse_sequence', 77)
            ->assertJsonPath('data.0.items.0.storage_location.product_warehouse_sequence', 77)
            ->assertJsonPath('data.0.items.0.storage_location.warehouse_pick_label', '77 - Sản phẩm thực gửi');
    }

    public function test_order_print_data_includes_declared_replacement_product_location(): void
    {
        [$account, $user] = $this->authenticate();
        $warehouse = $this->createWarehouse($account);
        $orderedProduct = $this->createProduct($account, [
            'sku' => 'SKU-HET-HANG',
            'name' => 'Sản phẩm dễ hết hàng',
            'warehouse_sequence' => 41,
        ]);
        $replacementProduct = $this->createProduct($account, [
            'sku' => 'SKU-THAY-THE',
            'name' => 'Sản phẩm thay thế để nhặt',
            'warehouse_sequence' => 247,
        ]);

        $group = ProductReplacementGroup::query()->create([
            'account_id' => $account->id,
            'name' => 'Nhóm thay thế kho',
        ]);
        ProductReplacementItem::query()->create([
            'account_id' => $account->id,
            'group_id' => $group->id,
            'product_id' => $orderedProduct->id,
            'product_sku_snapshot' => $orderedProduct->sku,
            'product_name_snapshot' => $orderedProduct->name,
            'sort_order' => 1,
        ]);
        ProductReplacementItem::query()->create([
            'account_id' => $account->id,
            'group_id' => $group->id,
            'product_id' => $replacementProduct->id,
            'product_sku_snapshot' => $replacementProduct->sku,
            'product_name_snapshot' => $replacementProduct->name,
            'sort_order' => 2,
        ]);

        $shelfResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/warehouse-shelves', [
                'warehouse_id' => $warehouse->id,
                'name' => 'Kệ thay thế',
                'code' => 'KTT',
                'floor_count' => 4,
            ])
            ->assertCreated();

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/warehouse-shelves/' . $shelfResponse->json('data.id') . '/assign', [
                'mode' => 'merge',
                'floors' => [
                    '3' => 'SKU-THAY-THE',
                ],
            ])
            ->assertOk();

        $order = $this->createOrder($account, $user);
        OrderItem::query()->create([
            'account_id' => $account->id,
            'order_id' => $order->id,
            'product_id' => $orderedProduct->id,
            'inventory_source_account_id' => $account->id,
            'product_name_snapshot' => $orderedProduct->name,
            'product_sku_snapshot' => $orderedProduct->sku,
            'quantity' => 1,
            'price' => 120000,
            'sort_order' => 1,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/print-data', [
                'ids' => [$order->id],
            ])
            ->assertOk()
            ->assertJsonPath('data.0.items.0.replacement_product.name', 'Sản phẩm thay thế để nhặt')
            ->assertJsonPath('data.0.items.0.replacement_product.location_label', 'Kệ thay thế - Tầng 3 - STT kho 247')
            ->assertJsonPath('data.0.items.0.replacement_product.storage_location.product_warehouse_sequence', 247);
    }

    public function test_configurable_parent_and_bundle_do_not_show_warehouse_sequence(): void
    {
        [$account] = $this->authenticate();
        $warehouse = $this->createWarehouse($account);
        $parent = $this->createProduct($account, [
            'type' => 'configurable',
            'name' => 'Bộ ấm trà men lam',
            'sku' => 'AM-TRA-MEN-LAM',
        ]);
        $variant = $this->createProduct($account, [
            'name' => 'Bộ ấm trà men lam - S3',
            'sku' => 'AM-TRA-MEN-LAM-S3',
            'warehouse_sequence' => 93,
        ]);
        $bundle = $this->createProduct($account, [
            'type' => 'bundle',
            'name' => 'Combo bàn thờ men rạn',
            'sku' => 'COMBO-BAN-THO',
        ]);
        $legacyParent = $this->createProduct($account, [
            'type' => 'simple',
            'name' => 'Bộ chén men lam',
            'sku' => 'BO-CHEN-MEN-LAM',
            'warehouse_sequence' => 94,
        ]);
        $legacyVariant = $this->createProduct($account, [
            'type' => 'simple',
            'name' => 'Bộ chén men lam - 6 món',
            'sku' => 'BO-CHEN-MEN-LAM-6',
            'warehouse_sequence' => 95,
        ]);

        $parent->linkedProducts()->attach($variant->id, ['link_type' => 'super_link', 'position' => 0]);
        $legacyParent->linkedProducts()->attach($legacyVariant->id, ['link_type' => 'super_link', 'position' => 0]);
        DB::table('products')->where('id', $parent->id)->update(['warehouse_sequence' => 91]);
        DB::table('products')->where('id', $bundle->id)->update(['warehouse_sequence' => 92]);

        $shelfResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/warehouse-shelves', [
                'warehouse_id' => $warehouse->id,
                'name' => 'Kệ STT',
                'code' => 'KSTT',
                'floor_count' => 4,
            ])
            ->assertCreated();

        $shelfId = $shelfResponse->json('data.id');

        $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/warehouse-shelves/{$shelfId}/assign", [
                'mode' => 'merge',
                'floors' => [
                    '1' => "AM-TRA-MEN-LAM\nAM-TRA-MEN-LAM-S3\nCOMBO-BAN-THO\nBO-CHEN-MEN-LAM\nBO-CHEN-MEN-LAM-6",
                ],
            ])
            ->assertOk();

        $showResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson("/api/warehouse-shelves/{$shelfId}")
            ->assertOk();

        $itemsBySku = collect($showResponse->json('data.floors'))
            ->flatMap(fn (array $floor) => $floor['items'])
            ->keyBy('product_sku');

        $this->assertNull($itemsBySku['AM-TRA-MEN-LAM']['warehouse_sequence']);
        $this->assertNull($itemsBySku['AM-TRA-MEN-LAM']['product_warehouse_sequence']);
        $this->assertSame('Bộ ấm trà men lam', $itemsBySku['AM-TRA-MEN-LAM']['warehouse_pick_label']);
        $this->assertSame(93, $itemsBySku['AM-TRA-MEN-LAM-S3']['warehouse_sequence']);
        $this->assertSame('93 - Bộ ấm trà men lam - S3', $itemsBySku['AM-TRA-MEN-LAM-S3']['warehouse_pick_label']);
        $this->assertNull($itemsBySku['COMBO-BAN-THO']['warehouse_sequence']);
        $this->assertNull($itemsBySku['COMBO-BAN-THO']['product_warehouse_sequence']);
        $this->assertSame('Combo bàn thờ men rạn', $itemsBySku['COMBO-BAN-THO']['warehouse_pick_label']);
        $this->assertNull($itemsBySku['BO-CHEN-MEN-LAM']['warehouse_sequence']);
        $this->assertNull($itemsBySku['BO-CHEN-MEN-LAM']['product_warehouse_sequence']);
        $this->assertTrue($itemsBySku['BO-CHEN-MEN-LAM']['product_has_variations']);
        $this->assertSame('Bộ chén men lam', $itemsBySku['BO-CHEN-MEN-LAM']['warehouse_pick_label']);
        $this->assertSame(95, $itemsBySku['BO-CHEN-MEN-LAM-6']['warehouse_sequence']);
        $this->assertSame('95 - Bộ chén men lam - 6 món', $itemsBySku['BO-CHEN-MEN-LAM-6']['warehouse_pick_label']);

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/warehouse-shelves/search?' . http_build_query(['q' => '91']))
            ->assertOk()
            ->assertJsonCount(0, 'data.locations');

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/warehouse-shelves/search?' . http_build_query(['q' => '92']))
            ->assertOk()
            ->assertJsonCount(0, 'data.locations');

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/warehouse-shelves/search?' . http_build_query(['q' => '94']))
            ->assertOk()
            ->assertJsonCount(0, 'data.locations');

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/warehouse-shelves/search?' . http_build_query(['q' => '93']))
            ->assertOk()
            ->assertJsonPath('data.locations.0.product_sku', 'AM-TRA-MEN-LAM-S3')
            ->assertJsonPath('data.locations.0.product_warehouse_sequence', 93);

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/warehouse-shelves/search?' . http_build_query(['q' => '95']))
            ->assertOk()
            ->assertJsonPath('data.locations.0.product_sku', 'BO-CHEN-MEN-LAM-6')
            ->assertJsonPath('data.locations.0.product_warehouse_sequence', 95);

        $pickerResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'picker' => 1,
                'fast_picker' => 1,
                'allow_variants' => 1,
                'search' => '94',
            ]))
            ->assertOk();

        $this->assertNotContains('BO-CHEN-MEN-LAM', collect($pickerResponse->json('data'))->pluck('sku')->all());
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Shelf Account ' . Str::upper(Str::random(4)),
            'domain' => 'shelf-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'shelf-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Shelf Admin',
            'email' => 'shelf-admin-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function createWarehouse(Account $account): Warehouse
    {
        return Warehouse::query()->create([
            'account_id' => $account->id,
            'name' => 'Kho chính',
            'code' => 'WH-' . Str::upper(Str::random(6)),
            'is_active' => true,
        ]);
    }

    private function createProduct(Account $account, array $overrides = []): Product
    {
        $name = $overrides['name'] ?? ('Sản phẩm ' . Str::upper(Str::random(4)));

        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(5)),
            'sku' => 'SKU-' . Str::upper(Str::random(8)),
            'price' => 120000,
            'cost_price' => 70000,
            'stock_quantity' => 0,
            'status' => true,
        ], $overrides));
    }

    private function createOrder(Account $account, User $user): Order
    {
        return Order::query()->create([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'ORSHELF' . random_int(1000, 9999),
            'order_kind' => Order::KIND_OFFICIAL,
            'total_price' => 120000,
            'status' => 'new',
            'customer_name' => 'Khách lấy hàng',
            'customer_phone' => '0901234567',
            'shipping_address' => '123 Kho test',
            'province' => 'Tỉnh test',
            'district' => 'Huyện test',
            'ward' => 'Xã test',
            'notes' => '',
            'source' => 'Website',
            'type' => 'Le',
            'shipment_status' => 'Chưa giao',
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 70000,
            'profit_total' => 50000,
            'shipping_status_source' => 'manual',
            'print_count' => 0,
            'last_printed_at' => null,
        ]);
    }
}
