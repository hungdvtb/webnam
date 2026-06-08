<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CarrierRawStatus;
use App\Models\CarrierStatusMapping;
use App\Models\Order;
use App\Models\OrderStatus;
use App\Models\Shipment;
use App\Models\User;
use App\Services\SimpleXlsxService;
use App\Services\Shipping\CarrierStatusMapper;
use App\Services\Shipping\ViettelPostReconciliationService;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class ShipmentStatusMappingToggleTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
        $this->rebuildSchema();
    }

    public function test_manual_shipment_status_update_does_not_sync_order_status_when_mapping_is_disabled(): void
    {
        [$account, $user] = $this->authenticate();
        $order = $this->createOrder($account, $user, [
            'status' => 'shipping',
            'shipping_status' => 'in_transit',
            'shipment_status' => 'shipped',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'carrier_code' => 'custom_carrier',
            'carrier_name' => 'Custom Carrier',
            'shipment_status' => 'in_transit',
            'status' => 'in_transit',
        ]);

        $this->createMapping($account, [
            'carrier_code' => 'custom_carrier',
            'carrier_raw_status' => 'manual_returned',
            'internal_shipment_status' => 'returned',
            'mapped_order_status' => 'returned',
            'is_active' => false,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/shipments/{$shipment->id}/status", [
                'status' => 'returned',
                'reason' => 'Manual test from shipment list',
                'admin_override' => true,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('shipment.shipment_status', 'returned');

        $order->refresh();
        $shipment->refresh();

        $this->assertSame('returned', (string) $shipment->shipment_status);
        $this->assertSame('shipping', (string) $order->status);
        $this->assertSame('returned', (string) $order->shipping_status);
        $this->assertDatabaseHas('order_status_logs', [
            'order_id' => $order->id,
            'from_status' => 'shipping',
            'to_status' => 'shipping',
            'to_shipping_status' => 'returned',
            'source' => 'manual',
        ]);
    }

    public function test_manual_shipment_status_update_syncs_order_status_when_mapping_is_active(): void
    {
        [$account, $user] = $this->authenticate();
        $order = $this->createOrder($account, $user, [
            'status' => 'shipping',
            'shipping_status' => 'out_for_delivery',
            'shipment_status' => 'shipped',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'carrier_code' => 'custom_carrier',
            'carrier_name' => 'Custom Carrier',
            'shipment_status' => 'out_for_delivery',
            'status' => 'out_for_delivery',
        ]);

        $this->createMapping($account, [
            'carrier_code' => 'custom_carrier',
            'carrier_raw_status' => 'manual_delivered',
            'internal_shipment_status' => 'delivered',
            'mapped_order_status' => 'completed',
            'is_active' => true,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/shipments/{$shipment->id}/status", [
                'status' => 'delivered',
                'reason' => 'Manual test from shipment list',
                'admin_override' => true,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('shipment.shipment_status', 'delivered')
            ;

        $order->refresh();
        $shipment->refresh();

        $this->assertSame('delivered', (string) $shipment->shipment_status);
        $this->assertSame('completed', (string) $order->status);
        $this->assertSame('delivered', (string) $order->shipping_status);
    }

    public function test_carrier_callback_does_not_apply_disabled_mapping_even_when_old_cache_was_warmed(): void
    {
        [$account, $user] = $this->authenticate();
        $order = $this->createOrder($account, $user, [
            'status' => 'shipping',
            'shipping_status' => 'in_transit',
            'shipment_status' => 'shipped',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'carrier_code' => 'custom_carrier',
            'carrier_name' => 'Custom Carrier',
            'shipment_status' => 'in_transit',
            'status' => 'in_transit',
        ]);
        $mapping = $this->createMapping($account, [
            'carrier_code' => 'custom_carrier',
            'carrier_raw_status' => 'returned',
            'internal_shipment_status' => 'returned',
            'mapped_order_status' => 'returned',
            'is_active' => true,
        ]);

        $mapper = $this->app->make(CarrierStatusMapper::class);
        $cachedBeforeToggle = $mapper->mapCarrierStatus('custom_carrier', 'returned', $account->id);
        $this->assertSame('returned', $cachedBeforeToggle['shipment_status']);

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/carrier-mappings/{$mapping->id}", [
                'is_active' => false,
            ])
            ->assertOk()
            ->assertJsonPath('is_active', false);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/shipments/carrier-callback', [
                'shipment_id' => $shipment->id,
                'carrier_code' => 'custom_carrier',
                'raw_status' => 'returned',
            ]);

        $response
            ->assertStatus(422)
            ->assertJsonPath('mapping_disabled', true);

        $order->refresh();
        $shipment->refresh();

        $this->assertSame('in_transit', (string) $shipment->shipment_status);
        $this->assertSame('shipping', (string) $order->status);
        $this->assertNull($shipment->carrier_status_raw);
        $this->assertNull($shipment->carrier_status_mapped);
    }

    public function test_active_mapping_without_mapped_order_status_does_not_fall_back_to_default_order_status(): void
    {
        [$account, $user] = $this->authenticate();
        $order = $this->createOrder($account, $user, [
            'status' => 'shipping',
            'shipping_status' => 'out_for_delivery',
            'shipment_status' => 'shipped',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'carrier_code' => 'custom_carrier',
            'carrier_name' => 'Custom Carrier',
            'shipment_status' => 'out_for_delivery',
            'status' => 'out_for_delivery',
        ]);

        $this->createMapping($account, [
            'carrier_code' => 'custom_carrier',
            'carrier_raw_status' => 'manual_delivered_no_order',
            'internal_shipment_status' => 'delivered',
            'mapped_order_status' => null,
            'is_active' => true,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/shipments/{$shipment->id}/status", [
                'status' => 'delivered',
                'reason' => 'Manual test without order mapping',
                'admin_override' => true,
            ])
            ->assertOk()
            ->assertJsonPath('shipment.shipment_status', 'delivered');

        $order->refresh();

        $this->assertSame('shipping', (string) $order->status);
        $this->assertSame('delivered', (string) $order->shipping_status);
    }

    public function test_partial_delivery_order_switches_to_partial_delivery_status_when_shipment_is_returned(): void
    {
        [$account, $user] = $this->authenticate();
        $order = $this->createOrder($account, $user, [
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'status' => 'shipping',
            'shipping_status' => 'out_for_delivery',
            'shipment_status' => 'shipped',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'shipment_status' => 'out_for_delivery',
            'status' => 'out_for_delivery',
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/shipments/{$shipment->id}/status", [
                'status' => 'returned',
                'reason' => 'Khach nhan mot phan, phan con lai da hoan ve',
                'admin_override' => true,
            ])
            ->assertOk()
            ->assertJsonPath('shipment.shipment_status', 'returned')
            ->assertJsonPath('shipment.order.status', 'partial_delivery');

        $order->refresh();
        $shipment->refresh();

        $this->assertSame('partial_delivery', (string) $order->status);
        $this->assertSame('returned', (string) $order->shipping_status);
        $this->assertSame('returned', (string) $shipment->shipment_status);
    }

    public function test_exchange_return_order_stays_pending_return_until_return_slip_is_created(): void
    {
        [$account, $user] = $this->authenticate();
        $order = $this->createOrder($account, $user, [
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'shipping',
            'shipping_status' => 'out_for_delivery',
            'shipment_status' => 'shipped',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'shipment_status' => 'out_for_delivery',
            'status' => 'out_for_delivery',
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/shipments/{$shipment->id}/status", [
                'status' => 'returned',
                'reason' => 'Don doi hang da nhan hang hoan ve',
                'admin_override' => true,
            ])
            ->assertOk()
            ->assertJsonPath('shipment.shipment_status', 'returned')
            ->assertJsonPath('shipment.order.status', 'pending_return');

        $order->refresh();

        $this->assertSame('pending_return', (string) $order->status);
        $this->assertSame('returned', (string) $order->shipping_status);
    }

    public function test_order_status_override_to_returned_updates_active_shipment_and_survives_reconciliation_reimport(): void
    {
        [$account, $user] = $this->authenticate();
        $this->ensureCarrier('viettel_post', 'Viettel Post');

        OrderStatus::query()->create([
            'account_id' => $account->id,
            'code' => 'pending_return',
            'name' => 'Chờ hoàn',
            'color' => '#f97316',
            'sort_order' => 91,
            'is_system' => true,
            'is_active' => true,
        ]);
        OrderStatus::query()->create([
            'account_id' => $account->id,
            'code' => 'returned',
            'name' => 'Đã hoàn',
            'color' => '#b91c1c',
            'sort_order' => 92,
            'is_system' => true,
            'is_active' => true,
        ]);

        $order = $this->createOrder($account, $user, [
            'status' => 'pending_return',
            'shipping_status' => 'returning',
            'shipment_status' => 'returned',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'carrier_code' => 'viettel_post',
            'carrier_name' => 'Viettel Post',
            'shipment_status' => 'returning',
            'status' => 'returning',
            'carrier_status_raw' => 'Đã trả chưa về',
            'carrier_status_mapped' => 'returning',
            'carrier_status_code' => 'Đã trả chưa về',
            'carrier_status_text' => 'Đã trả chưa về',
            'returning_at' => now(),
        ]);

        $this->createMapping($account, [
            'carrier_code' => 'viettel_post',
            'carrier_raw_status' => 'Đã trả chưa về',
            'internal_shipment_status' => 'returned',
            'mapped_order_status' => 'pending_return',
            'is_active' => true,
        ]);

        $mapper = $this->app->make(CarrierStatusMapper::class);
        $this->assertSame(
            'returning',
            $mapper->mapCarrierStatus('viettel_post', 'ÄÃ£ tráº£ chÆ°a vá»', $account->id)['shipment_status']
        );
        $this->assertSame(
            'returned',
            $mapper->resolveOrderStatusSync('viettel_post', 'returned', $account->id, 'ÄÃ£ tráº£ chÆ°a vá»')['order_status']
        );

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/orders/{$order->id}/status", [
                'status' => 'returned',
                'allow_shipping_override' => true,
                'reason' => 'Đã nhận hàng hoàn tại kho',
            ])
            ->assertOk()
            ->assertJsonPath('status', 'returned')
            ->assertJsonPath('shipping_status', 'returned');

        $order->refresh();
        $shipment->refresh();

        $this->assertSame('returned', (string) $order->status);
        $this->assertSame('returned', (string) $order->shipping_status);
        $this->assertSame('returned', (string) $shipment->shipment_status);

        $xlsxService = Mockery::mock(SimpleXlsxService::class);
        $xlsxService->shouldReceive('readRaw')->once()->andReturn([
            ['Mã Vận Đơn', 'Cước vận chuyển (3)= (1+2)', 'Tiền thu hộ (4)', 'Tổng phí (9)= (3)+(5)+(6)+(7)-(8)', 'Trạng Thái', 'Trạng thái đối soát COD'],
            [$shipment->tracking_number, '28750', '700000', '28750', 'Đã trả chưa về', 'Chưa đối soát COD'],
        ]);
        $this->app->instance(SimpleXlsxService::class, $xlsxService);

        $result = $this->app->make(ViettelPostReconciliationService::class)->processFile('fake.xlsx', $user->id, $account->id);

        $this->assertTrue($result['success']);

        $order->refresh();
        $shipment->refresh();

        $this->assertSame('returned', (string) $order->status);
        $this->assertSame('returned', (string) $order->shipping_status);
        $this->assertSame('returned', (string) $shipment->shipment_status);
    }

    public function test_admin_can_correct_returned_shipment_back_to_returning(): void
    {
        [$account, $user] = $this->authenticate();
        $order = $this->createOrder($account, $user, [
            'status' => 'returned',
            'shipping_status' => 'returned',
            'shipment_status' => 'returned',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'shipment_status' => 'returned',
            'status' => 'returned',
            'returned_at' => now(),
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/shipments/{$shipment->id}/status", [
                'status' => 'returning',
                'reason' => 'Điều chỉnh lại trạng thái hoàn tay trong admin',
                'admin_override' => true,
            ])
            ->assertOk()
            ->assertJsonPath('shipment.shipment_status', 'returning');

        $shipment->refresh();
        $order->refresh();

        $this->assertSame('returning', (string) $shipment->shipment_status);
        $this->assertSame('returning', (string) $order->shipping_status);
    }

    public function test_bulk_status_update_honors_admin_override_for_terminal_status_corrections(): void
    {
        [$account, $user] = $this->authenticate();
        $order = $this->createOrder($account, $user, [
            'status' => 'returned',
            'shipping_status' => 'returned',
            'shipment_status' => 'returned',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'shipment_status' => 'returned',
            'status' => 'returned',
            'returned_at' => now(),
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/shipments/bulk-status', [
                'ids' => [$shipment->id],
                'status' => 'returning',
                'reason' => 'Bulk chỉnh tay trạng thái hoàn',
                'admin_override' => true,
            ])
            ->assertOk()
            ->assertJsonPath('updated', 1)
            ->assertJsonPath('failed', 0);

        $shipment->refresh();

        $this->assertSame('returning', (string) $shipment->shipment_status);
    }

    public function test_manual_shipment_status_update_accepts_shipped_status_in_admin(): void
    {
        [$account, $user] = $this->authenticate();
        $order = $this->createOrder($account, $user, [
            'status' => 'shipping',
            'shipping_status' => 'picked_up',
            'shipment_status' => 'picked_up',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'shipment_status' => 'picked_up',
            'status' => 'picked_up',
            'picked_at' => now(),
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/shipments/{$shipment->id}/status", [
                'status' => 'shipped',
                'reason' => 'Chuyển sang trạng thái đã gửi',
                'admin_override' => true,
            ])
            ->assertOk()
            ->assertJsonPath('shipment.shipment_status', 'shipped');

        $shipment->refresh();

        $this->assertSame('shipped', (string) $shipment->shipment_status);
    }

    public function test_bulk_delete_removes_selected_carrier_mappings_and_releases_raw_statuses(): void
    {
        [$account] = $this->authenticate();

        $firstMapping = $this->createMapping($account, [
            'carrier_code' => 'custom_carrier',
            'carrier_raw_status' => 'legacy_100',
        ]);
        $secondMapping = $this->createMapping($account, [
            'carrier_code' => 'custom_carrier',
            'carrier_raw_status' => 'legacy_101',
        ]);
        $remainingMapping = $this->createMapping($account, [
            'carrier_code' => 'custom_carrier',
            'carrier_raw_status' => 'legacy_keep',
        ]);

        CarrierRawStatus::query()->insert([
            [
                'account_id' => $account->id,
                'carrier_code' => 'custom_carrier',
                'raw_status' => 'legacy_100',
                'first_seen_at' => now(),
                'last_seen_at' => now(),
                'is_mapped' => true,
                'mapping_id' => $firstMapping->id,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'account_id' => null,
                'carrier_code' => 'custom_carrier',
                'raw_status' => 'legacy_100',
                'first_seen_at' => now(),
                'last_seen_at' => now(),
                'is_mapped' => true,
                'mapping_id' => $firstMapping->id,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'account_id' => $account->id,
                'carrier_code' => 'custom_carrier',
                'raw_status' => 'legacy_101',
                'first_seen_at' => now(),
                'last_seen_at' => now(),
                'is_mapped' => true,
                'mapping_id' => $secondMapping->id,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'account_id' => $account->id,
                'carrier_code' => 'custom_carrier',
                'raw_status' => 'legacy_keep',
                'first_seen_at' => now(),
                'last_seen_at' => now(),
                'is_mapped' => true,
                'mapping_id' => $remainingMapping->id,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->deleteJson('/api/carrier-mappings', [
                'ids' => [$firstMapping->id, $secondMapping->id],
                'carrier_code' => 'custom_carrier',
            ])
            ->assertOk()
            ->assertJsonPath('deleted_count', 2);

        $this->assertDatabaseMissing('carrier_status_mappings', [
            'id' => $firstMapping->id,
        ]);
        $this->assertDatabaseMissing('carrier_status_mappings', [
            'id' => $secondMapping->id,
        ]);
        $this->assertDatabaseHas('carrier_status_mappings', [
            'id' => $remainingMapping->id,
        ]);

        $this->assertDatabaseHas('carrier_raw_statuses', [
            'account_id' => $account->id,
            'carrier_code' => 'custom_carrier',
            'raw_status' => 'legacy_100',
            'is_mapped' => 0,
            'mapping_id' => null,
        ]);
        $this->assertDatabaseHas('carrier_raw_statuses', [
            'account_id' => null,
            'carrier_code' => 'custom_carrier',
            'raw_status' => 'legacy_100',
            'is_mapped' => 0,
            'mapping_id' => null,
        ]);
        $this->assertDatabaseHas('carrier_raw_statuses', [
            'account_id' => $account->id,
            'carrier_code' => 'custom_carrier',
            'raw_status' => 'legacy_101',
            'is_mapped' => 0,
            'mapping_id' => null,
        ]);
        $this->assertDatabaseHas('carrier_raw_statuses', [
            'account_id' => $account->id,
            'carrier_code' => 'custom_carrier',
            'raw_status' => 'legacy_keep',
            'is_mapped' => 1,
            'mapping_id' => $remainingMapping->id,
        ]);
    }

    public function test_mapping_store_infers_internal_shipment_status_from_viettel_raw_status_when_field_is_omitted(): void
    {
        [$account] = $this->authenticate();
        $this->ensureCarrier('viettel_post', 'Viettel Post');

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/carrier-mappings', [
                'carrier_code' => 'viettel_post',
                'carrier_raw_status' => 'Đơn giao thành công tại kho',
                'mapped_order_status' => 'completed',
                'is_terminal' => true,
            ])
            ->assertCreated()
            ->assertJsonPath('internal_shipment_status', 'delivered')
            ->assertJsonPath('mapped_order_status', 'completed');
    }

    public function test_carrier_mapping_with_blank_internal_shipment_status_still_syncs_order_status_from_raw_status(): void
    {
        [$account, $user] = $this->authenticate();
        $this->ensureCarrier('viettel_post', 'Viettel Post');

        $order = $this->createOrder($account, $user, [
            'status' => 'shipping',
            'shipping_status' => 'in_transit',
            'shipment_status' => 'shipped',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'carrier_code' => 'viettel_post',
            'carrier_name' => 'Viettel Post',
            'shipment_status' => 'in_transit',
            'status' => 'in_transit',
        ]);

        $this->createMapping($account, [
            'carrier_code' => 'viettel_post',
            'carrier_raw_status' => 'Giao thành công',
            'internal_shipment_status' => null,
            'mapped_order_status' => 'completed',
            'is_active' => true,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/shipments/carrier-callback', [
                'shipment_id' => $shipment->id,
                'carrier_code' => 'viettel_post',
                'raw_status' => 'Giao thành công',
            ])
            ->assertOk()
            ->assertJsonPath('shipment.shipment_status', 'delivered')
            ;

        $shipment->refresh();
        $order->refresh();

        $this->assertSame('Giao thành công', (string) $shipment->carrier_status_raw);
        $this->assertSame('delivered', (string) $shipment->carrier_status_mapped);
        $this->assertSame('delivered', (string) $shipment->shipment_status);
        $this->assertSame('completed', (string) $order->status);
        $this->assertSame('delivered', (string) $order->shipping_status);
    }

    public function test_carrier_mapping_matches_viettel_raw_status_without_diacritics(): void
    {
        [$account, $user] = $this->authenticate();
        $this->ensureCarrier('viettel_post', 'Viettel Post');

        $order = $this->createOrder($account, $user, [
            'status' => 'shipping',
            'shipping_status' => 'in_transit',
            'shipment_status' => 'shipped',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'carrier_code' => 'viettel_post',
            'carrier_name' => 'Viettel Post',
            'shipment_status' => 'in_transit',
            'status' => 'in_transit',
        ]);

        $this->createMapping($account, [
            'carrier_code' => 'viettel_post',
            'carrier_raw_status' => 'Giao thành công',
            'internal_shipment_status' => 'delivered',
            'mapped_order_status' => 'completed',
            'is_active' => true,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/shipments/carrier-callback', [
                'shipment_id' => $shipment->id,
                'carrier_code' => 'viettel_post',
                'raw_status' => 'Giao thanh cong',
            ])
            ->assertOk()
            ->assertJsonPath('shipment.shipment_status', 'delivered');

        $shipment->refresh();
        $order->refresh();

        $this->assertSame('Giao thanh cong', (string) $shipment->carrier_status_raw);
        $this->assertSame('delivered', (string) $shipment->carrier_status_mapped);
        $this->assertSame('completed', (string) $order->status);
    }

    public function test_mapping_store_normalizes_order_status_name_to_code_and_canonicalizes_viettel_carrier_code(): void
    {
        [$account] = $this->authenticate();
        $this->ensureCarrier('viettel_post', 'Viettel Post');

        OrderStatus::query()->create([
            'account_id' => $account->id,
            'code' => 'completed',
            'name' => 'Giao hàng thành công',
            'color' => '#10b981',
            'sort_order' => 1,
            'is_system' => true,
            'is_active' => true,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/carrier-mappings', [
                'carrier_code' => 'viettelpost',
                'carrier_raw_status' => 'Giao thành công',
                'internal_shipment_status' => 'delivered',
                'mapped_order_status' => 'Giao hàng thành công',
                'is_terminal' => true,
            ])
            ->assertCreated()
            ->assertJsonPath('carrier_code', 'viettel_post')
            ->assertJsonPath('mapped_order_status', 'completed');

        $this->assertDatabaseHas('carrier_status_mappings', [
            'account_id' => $account->id,
            'carrier_code' => 'viettel_post',
            'carrier_raw_status' => 'Giao thành công',
            'mapped_order_status' => 'completed',
        ]);
    }

    public function test_carrier_callback_uses_request_carrier_code_when_shipment_has_no_carrier_code(): void
    {
        [$account, $user] = $this->authenticate();
        $order = $this->createOrder($account, $user, [
            'status' => 'shipping',
            'shipping_status' => 'in_transit',
            'shipment_status' => 'shipped',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'carrier_code' => null,
            'carrier_name' => null,
            'shipment_status' => 'in_transit',
            'status' => 'in_transit',
        ]);

        $this->createMapping($account, [
            'carrier_code' => 'custom_carrier',
            'carrier_raw_status' => 'delivered_callback',
            'internal_shipment_status' => 'delivered',
            'mapped_order_status' => 'completed',
            'is_active' => true,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/shipments/carrier-callback', [
                'shipment_id' => $shipment->id,
                'carrier_code' => 'custom_carrier',
                'raw_status' => 'delivered_callback',
            ])
            ->assertOk()
            ->assertJsonPath('shipment.shipment_status', 'delivered');

        $shipment->refresh();
        $order->refresh();

        $this->assertSame('custom_carrier', (string) $shipment->carrier_code);
        $this->assertSame('delivered', (string) $shipment->shipment_status);
        $this->assertSame('completed', (string) $order->status);
        $this->assertSame('delivered', (string) $order->shipping_status);
    }

    public function test_viettel_post_reconciliation_applies_raw_status_mapping_and_syncs_order_status_for_legacy_carrier_code(): void
    {
        [$account, $user] = $this->authenticate();
        $this->ensureCarrier('viettel_post', 'Viettel Post');

        $order = $this->createOrder($account, $user, [
            'status' => 'shipping',
            'shipping_status' => 'confirmed',
            'shipment_status' => 'shipped',
            'total_price' => 100000,
        ]);
        $shipment = $this->createShipment($order, $user, [
            'carrier_code' => 'viettelpost',
            'carrier_name' => 'Viettel Post',
            'tracking_number' => 'TRACK-VTP-001',
            'carrier_tracking_code' => 'TRACK-VTP-001',
            'shipment_status' => 'in_transit',
            'status' => 'in_transit',
            'cod_amount' => 100000,
            'shipping_cost' => 5000,
            'actual_received_amount' => 95000,
        ]);

        $this->createMapping($account, [
            'carrier_code' => 'viettel_post',
            'carrier_raw_status' => 'Giao thành công',
            'internal_shipment_status' => 'delivered',
            'mapped_order_status' => 'completed',
            'is_active' => true,
        ]);

        $xlsxService = Mockery::mock(SimpleXlsxService::class);
        $xlsxService->shouldReceive('readRaw')->once()->andReturn([
            [
                'Mã Vận Đơn',
                'Cước vận chuyển (3)= (1+2)',
                'Tiền thu hộ (4)',
                'Tổng phí (9)= (3)+(5)+(6)+(7)-(8)',
                'Trạng Thái',
                'Trạng thái đối soát COD',
            ],
            [
                'TRACK-VTP-001',
                '5000',
                '100000',
                '5000',
                'Giao thành công',
                'Đã nhận COD',
            ],
        ]);
        $this->app->instance(SimpleXlsxService::class, $xlsxService);

        $result = $this->app->make(ViettelPostReconciliationService::class)->processFile('fake.xlsx', $user->id);

        $this->assertTrue($result['success']);
        $this->assertSame(1, $result['summary']['received_cod']);

        $shipment->refresh();
        $order->refresh();

        $this->assertSame('viettel_post', (string) $shipment->carrier_code);
        $this->assertSame('Giao thành công', (string) $shipment->carrier_status_raw);
        $this->assertSame('delivered', (string) $shipment->shipment_status);
        $this->assertSame('received_cod', (string) $shipment->reconciliation_status);
        $this->assertSame('completed', (string) $order->status);
        $this->assertSame('delivered', (string) $order->shipping_status);
        $this->assertSame('carrier', (string) $order->shipping_status_source);
    }

    public function test_viettel_post_reconciliation_rejects_received_cod_row_that_would_make_received_amount_negative(): void
    {
        [$account, $user] = $this->authenticate();
        $this->ensureCarrier('viettel_post', 'Viettel Post');

        $order = $this->createOrder($account, $user, [
            'status' => 'shipping',
            'shipping_status' => 'out_for_delivery',
            'shipment_status' => 'out_for_delivery',
            'total_price' => 13900000,
        ]);
        $shipment = $this->createShipment($order, $user, [
            'carrier_code' => 'viettel_post',
            'carrier_name' => 'Viettel Post',
            'tracking_number' => '139763959535',
            'carrier_tracking_code' => '139763959535',
            'shipment_status' => 'out_for_delivery',
            'status' => 'out_for_delivery',
            'cod_amount' => 13900000,
            'shipping_cost' => 450000,
            'actual_received_amount' => 13450000,
            'reconciled_amount' => null,
        ]);

        $this->createMapping($account, [
            'carrier_code' => 'viettel_post',
            'carrier_raw_status' => 'Giao thÃ nh cÃ´ng',
            'internal_shipment_status' => 'delivered',
            'mapped_order_status' => 'completed',
            'is_active' => true,
        ]);

        $xlsxService = Mockery::mock(SimpleXlsxService::class);
        $xlsxService->shouldReceive('readRaw')->once()->andReturn([
            [
                'MÃ£ Váº­n ÄÆ¡n',
                'CÆ°á»›c váº­n chuyá»ƒn (3)= (1+2)',
                'Tiá»n thu há»™ (4)',
                'Tá»•ng phÃ­ (9)= (3)+(5)+(6)+(7)-(8)',
                'Tráº¡ng ThÃ¡i',
                'Tráº¡ng thÃ¡i Ä‘á»‘i soÃ¡t COD',
            ],
            [
                '139763959535',
                '393874',
                '1397',
                '393874',
                'Giao thÃ nh cÃ´ng',
                'ÄÃ£ nháº­n COD',
            ],
        ]);
        $this->app->instance(SimpleXlsxService::class, $xlsxService);

        $result = $this->app->make(ViettelPostReconciliationService::class)->processFile('fake.xlsx', $user->id, $account->id);

        $this->assertTrue($result['success']);
        $this->assertSame(0, $result['summary']['received_cod']);
        $this->assertCount(1, $result['summary']['errors']);
        $this->assertStringContainsString('COD doi soat VTP bat thuong', $result['summary']['errors'][0]);

        $shipment->refresh();
        $order->refresh();

        $this->assertSame('delivered', (string) $shipment->shipment_status);
        $this->assertSame('completed', (string) $order->status);
        $this->assertNull($shipment->reconciled_amount);
        $this->assertSame(0.0, (float) $shipment->reconciliation_diff_amount);
        $this->assertDatabaseMissing('shipment_reconciliations', [
            'shipment_id' => $shipment->id,
        ]);
    }

    public function test_viettel_post_return_reconciliation_preserves_manual_return_status_for_special_orders(): void
    {
        [$account, $user] = $this->authenticate();
        $this->ensureCarrier('viettel_post', 'Viettel Post');

        $exchangeBaseCode = '139850986571';
        $partialBaseCode = '139850986572';

        $exchangeOrder = $this->createOrder($account, $user, [
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'shipping',
            'shipping_status' => 'out_for_delivery',
            'shipment_status' => 'out_for_delivery',
            'return_tracking_code' => $exchangeBaseCode . 'DH',
            'return_status' => 'not_returned',
        ]);
        $exchangeShipment = $this->createShipment($exchangeOrder, $user, [
            'carrier_code' => 'viettel_post',
            'carrier_name' => 'Viettel Post',
            'tracking_number' => $exchangeBaseCode,
            'carrier_tracking_code' => $exchangeBaseCode,
            'shipment_status' => 'out_for_delivery',
            'status' => 'out_for_delivery',
        ]);

        $partialOrder = $this->createOrder($account, $user, [
            'order_type' => Order::TYPE_PARTIAL_DELIVERY,
            'status' => 'shipping',
            'shipping_status' => 'out_for_delivery',
            'shipment_status' => 'out_for_delivery',
            'return_tracking_code' => $partialBaseCode . '1P1',
            'return_status' => 'not_returned',
        ]);
        $partialShipment = $this->createShipment($partialOrder, $user, [
            'carrier_code' => 'viettel_post',
            'carrier_name' => 'Viettel Post',
            'tracking_number' => $partialBaseCode,
            'carrier_tracking_code' => $partialBaseCode,
            'shipment_status' => 'out_for_delivery',
            'status' => 'out_for_delivery',
        ]);

        $xlsxService = Mockery::mock(SimpleXlsxService::class);
        $xlsxService->shouldReceive('readRaw')->once()->andReturn([
            [
                'Mã Vận Đơn',
                'Cước vận chuyển (3)= (1+2)',
                'Tiền thu hộ (4)',
                'Tổng phí (9)= (3)+(5)+(6)+(7)-(8)',
                'Trạng Thái',
                'Trạng thái đối soát COD',
            ],
            [
                $exchangeBaseCode . 'DH',
                '10000',
                '0',
                '10000',
                'Giao thành công',
                'Không có COD',
            ],
            [
                $partialBaseCode . '1P1',
                '12000',
                '0',
                '12000',
                'Giao thành công',
                'Không có COD',
            ],
        ]);
        $this->app->instance(SimpleXlsxService::class, $xlsxService);

        $result = $this->app->make(ViettelPostReconciliationService::class)->processFile('fake.xlsx', $user->id, $account->id);

        $this->assertTrue($result['success']);
        $this->assertSame(1, $result['summary']['return_exchange']);
        $this->assertSame(1, $result['summary']['return_partial']);
        $this->assertFalse((bool) data_get($result, 'summary.results.0.return_status_updated'));
        $this->assertFalse((bool) data_get($result, 'summary.results.1.return_status_updated'));

        $exchangeOrder->refresh();
        $exchangeShipment->refresh();
        $partialOrder->refresh();
        $partialShipment->refresh();

        $this->assertSame('not_returned', (string) $exchangeOrder->return_status);
        $this->assertSame('not_returned', (string) $partialOrder->return_status);
        $this->assertSame('exchange_completed', (string) $exchangeOrder->status);
        $this->assertSame('partial_delivery', (string) $partialOrder->status);
        $this->assertSame('delivered', (string) $exchangeShipment->shipment_status);
        $this->assertSame('returned', (string) $partialShipment->shipment_status);
    }

    public function test_viettel_post_reconciliation_discovers_unmapped_raw_statuses_for_account_without_duplicates(): void
    {
        [$account, $user] = $this->authenticate();
        $this->ensureCarrier('viettel_post', 'Viettel Post');

        CarrierRawStatus::query()->create([
            'account_id' => $account->id,
            'carrier_code' => 'custom_carrier',
            'raw_status' => 'Đang vận chuyển',
            'first_seen_at' => now()->subDay(),
            'last_seen_at' => now()->subDay(),
            'is_mapped' => false,
            'mapping_id' => null,
            'sample_payload' => ['source' => 'existing_custom_carrier'],
        ]);

        $xlsxService = Mockery::mock(SimpleXlsxService::class);
        $xlsxService->shouldReceive('readRaw')->once()->andReturn([
            [
                'Mã Vận Đơn',
                'Cước vận chuyển (3)= (1+2)',
                'Tiền thu hộ (4)',
                'Tổng phí (9)= (3)+(5)+(6)+(7)-(8)',
                'Trạng Thái',
                'Trạng thái đối soát COD',
            ],
            [
                'TRACK-MISSING-001',
                '15000',
                '200000',
                '15000',
                'Đang vận chuyển',
                'Chưa đối soát COD',
            ],
            [
                'TRACK-MISSING-002',
                '15000',
                '200000',
                '15000',
                'Đang vận chuyển',
                'Chưa đối soát COD',
            ],
            [
                'TRACK-MISSING-003',
                '15000',
                '200000',
                '15000',
                'Chờ phát lại',
                'Chưa đối soát COD',
            ],
        ]);
        $this->app->instance(SimpleXlsxService::class, $xlsxService);

        $result = $this->app->make(ViettelPostReconciliationService::class)->processFile('fake.xlsx', $user->id, $account->id);

        $this->assertTrue($result['success']);

        $discoveredStatuses = CarrierRawStatus::query()
            ->where('account_id', $account->id)
            ->where('carrier_code', 'viettel_post')
            ->get();

        $this->assertCount(2, $discoveredStatuses);
        $this->assertEqualsCanonicalizing(
            ['Đang vận chuyển', 'Chờ phát lại'],
            $discoveredStatuses->pluck('raw_status')->all()
        );

        $discoveredStatuses->each(function (CarrierRawStatus $status): void {
            $this->assertFalse((bool) $status->is_mapped);
            $this->assertNull($status->mapping_id);
            $this->assertSame('viettel_post_reconciliation_import', data_get($status->sample_payload, 'source'));
        });

        $this->assertDatabaseHas('carrier_raw_statuses', [
            'account_id' => $account->id,
            'carrier_code' => 'custom_carrier',
            'raw_status' => 'Đang vận chuyển',
        ]);
    }

    public function test_viettel_post_reconciliation_updates_existing_raw_status_once_and_marks_it_mapped_when_mapping_exists(): void
    {
        [$account, $user] = $this->authenticate();
        $this->ensureCarrier('viettel_post', 'Viettel Post');

        $mapping = $this->createMapping($account, [
            'carrier_code' => 'viettel_post',
            'carrier_raw_status' => 'Đang giao hàng',
            'internal_shipment_status' => 'out_for_delivery',
            'mapped_order_status' => 'shipping',
            'is_active' => true,
        ]);

        CarrierRawStatus::query()->create([
            'account_id' => $account->id,
            'carrier_code' => 'viettel_post',
            'raw_status' => 'Đang giao hàng',
            'first_seen_at' => now()->subDay(),
            'last_seen_at' => now()->subDay(),
            'is_mapped' => false,
            'mapping_id' => null,
            'sample_payload' => ['source' => 'legacy_import'],
        ]);

        $xlsxService = Mockery::mock(SimpleXlsxService::class);
        $xlsxService->shouldReceive('readRaw')->once()->andReturn([
            [
                'Mã Vận Đơn',
                'Cước vận chuyển (3)= (1+2)',
                'Tiền thu hộ (4)',
                'Tổng phí (9)= (3)+(5)+(6)+(7)-(8)',
                'Trạng Thái',
                'Trạng thái đối soát COD',
            ],
            [
                'TRACK-MISSING-004',
                '12000',
                '120000',
                '12000',
                'Đang giao hàng',
                'Chưa đối soát COD',
            ],
            [
                'TRACK-MISSING-005',
                '12000',
                '120000',
                '12000',
                'Đang giao hàng',
                'Chưa đối soát COD',
            ],
        ]);
        $this->app->instance(SimpleXlsxService::class, $xlsxService);

        $result = $this->app->make(ViettelPostReconciliationService::class)->processFile('fake.xlsx', $user->id, $account->id);

        $this->assertTrue($result['success']);
        $this->assertSame(1, CarrierRawStatus::query()
            ->where('account_id', $account->id)
            ->where('carrier_code', 'viettel_post')
            ->where('raw_status', 'Đang giao hàng')
            ->count());

        $rawStatus = CarrierRawStatus::query()
            ->where('account_id', $account->id)
            ->where('carrier_code', 'viettel_post')
            ->where('raw_status', 'Đang giao hàng')
            ->firstOrFail();

        $this->assertTrue((bool) $rawStatus->is_mapped);
        $this->assertSame($mapping->id, (int) $rawStatus->mapping_id);
        $this->assertSame('viettel_post_reconciliation_import', data_get($rawStatus->sample_payload, 'source'));
    }

    public function test_mapping_store_reapplies_existing_giao_thanh_cong_shipment_and_shipment_list_returns_exchange_completed(): void
    {
        [$account, $user] = $this->authenticate();
        $this->ensureCarrier('viettel_post', 'Viettel Post');

        OrderStatus::query()->create([
            'account_id' => $account->id,
            'code' => 'exchange_completed',
            'name' => 'Đổi hàng thành công',
            'color' => '#15803d',
            'sort_order' => 90,
            'is_system' => true,
            'is_active' => true,
        ]);

        $order = $this->createOrder($account, $user, [
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'completed',
            'shipping_status' => 'delivered',
            'shipment_status' => 'delivered',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'carrier_code' => 'viettel_post',
            'carrier_name' => 'Viettel Post',
            'shipment_status' => 'delivered',
            'status' => 'delivered',
            'carrier_status_raw' => 'Giao thành công',
            'carrier_status_mapped' => 'delivered',
            'carrier_status_code' => 'Giao thành công',
            'carrier_status_text' => 'Giao thành công',
            'delivered_at' => now(),
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/carrier-mappings', [
                'carrier_code' => 'viettel_post',
                'carrier_raw_status' => 'Giao thành công',
                'mapped_order_status' => 'Đổi hàng thành công',
                'is_active' => true,
            ])
            ->assertCreated()
            ->assertJsonPath('internal_shipment_status', 'delivered')
            ->assertJsonPath('mapped_order_status', 'exchange_completed');

        $order->refresh();
        $shipment->refresh();

        $this->assertSame('exchange_completed', (string) $order->status);
        $this->assertSame('delivered', (string) $order->shipping_status);
        $this->assertSame('delivered', (string) $shipment->shipment_status);

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/shipments?' . http_build_query([
                'shipment_number' => $shipment->shipment_number,
            ]))
            ->assertOk()
            ->assertJsonPath('data.0.order.status', 'exchange_completed')
            ->assertJsonPath('data.0.carrier_status_raw', 'Giao thành công');
    }

    public function test_viettel_post_reconciliation_delivered_dh_marks_exchange_order_completed_not_pending_return(): void
    {
        [$account, $user] = $this->authenticate();
        $this->ensureCarrier('viettel_post', 'Viettel Post');

        $baseTrackingCode = '139850986571';
        $returnTrackingCode = $baseTrackingCode . 'DH';

        $order = $this->createOrder($account, $user, [
            'order_type' => Order::TYPE_EXCHANGE_RETURN,
            'status' => 'shipping',
            'shipping_status' => 'out_for_delivery',
            'shipment_status' => 'shipped',
            'return_tracking_code' => $returnTrackingCode,
            'return_status' => 'not_returned',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'carrier_code' => 'viettel_post',
            'carrier_name' => 'Viettel Post',
            'tracking_number' => $baseTrackingCode,
            'carrier_tracking_code' => $baseTrackingCode,
            'shipment_status' => 'shipped',
            'status' => 'shipped',
            'shipping_cost' => 30000,
            'reconciliation_status' => 'pending',
            'return_status' => 'not_returned',
        ]);

        $xlsxService = Mockery::mock(SimpleXlsxService::class);
        $xlsxService->shouldReceive('readRaw')->once()->andReturn([
            [
                'Mã Vận Đơn',
                'Cước vận chuyển',
                'Tiền thu hộ',
                'Tổng phí',
                'Trạng Thái',
                'Trạng thái đối soát COD',
            ],
            [
                $returnTrackingCode,
                '20000',
                '0',
                '20000',
                'Giao thành công',
                'Không có COD',
            ],
        ]);
        $this->app->instance(SimpleXlsxService::class, $xlsxService);

        $result = $this->app->make(ViettelPostReconciliationService::class)->processFile('fake.xlsx', $user->id, $account->id);

        $this->assertTrue($result['success']);
        $this->assertSame(1, $result['summary']['return_exchange']);

        $order->refresh();
        $shipment->refresh();

        $this->assertSame('exchange_completed', (string) $order->status);
        $this->assertNotSame('pending_return', (string) $order->status);
        $this->assertSame('delivered', (string) $shipment->shipment_status);
        $this->assertSame('return_exchange', (string) $shipment->reconciliation_status);
        $this->assertSame('exchanged', (string) $shipment->return_status);

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/shipments?' . http_build_query([
                'shipment_number' => $shipment->shipment_number,
            ]))
            ->assertOk()
            ->assertJsonPath('data.0.order.status', 'exchange_completed')
            ->assertJsonPath('data.0.shipment_status', 'delivered')
            ->assertJsonPath('data.0.reconciliation_status', 'return_exchange');
    }

    public function test_sync_endpoint_reapplies_legacy_da_tra_chua_ve_mapping_without_internal_status_and_updates_shipment_list(): void
    {
        [$account, $user] = $this->authenticate();
        $this->ensureCarrier('viettel_post', 'Viettel Post');

        OrderStatus::query()->create([
            'account_id' => $account->id,
            'code' => 'pending_return',
            'name' => 'Chờ hoàn',
            'color' => '#f97316',
            'sort_order' => 91,
            'is_system' => true,
            'is_active' => true,
        ]);

        $order = $this->createOrder($account, $user, [
            'status' => 'shipping',
            'shipping_status' => 'out_for_delivery',
            'shipment_status' => 'shipped',
        ]);
        $shipment = $this->createShipment($order, $user, [
            'carrier_code' => 'viettel_post',
            'carrier_name' => 'Viettel Post',
            'shipment_status' => 'out_for_delivery',
            'status' => 'out_for_delivery',
            'carrier_status_raw' => 'Đã trả chưa về',
            'carrier_status_mapped' => null,
            'carrier_status_code' => 'Đã trả chưa về',
            'carrier_status_text' => 'Đã trả chưa về',
        ]);

        $this->createMapping($account, [
            'carrier_code' => 'viettel_post',
            'carrier_raw_status' => 'Đã trả chưa về',
            'internal_shipment_status' => null,
            'mapped_order_status' => 'pending_return',
            'is_active' => true,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/shipments/sync', [
                'shipment_ids' => [$shipment->id],
                'mode' => 'selected',
            ])
            ->assertOk()
            ->assertJsonPath('reapplied_count', 1)
            ->assertJsonPath('shipments.0.shipment_status', 'returning');

        $order->refresh();
        $shipment->refresh();

        $this->assertSame('pending_return', (string) $order->status);
        $this->assertSame('returning', (string) $order->shipping_status);
        $this->assertSame('returning', (string) $shipment->shipment_status);
        $this->assertSame('returning', (string) $shipment->carrier_status_mapped);

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/shipments?' . http_build_query([
                'shipment_number' => $shipment->shipment_number,
            ]))
            ->assertOk()
            ->assertJsonPath('data.0.order.status', 'pending_return')
            ->assertJsonPath('data.0.carrier_status_raw', 'Đã trả chưa về');
    }

    private function authenticate(): array
    {
        $this->ensureCarrierExists();

        $account = Account::query()->create([
            'name' => 'Shipment Mapping Account',
            'domain' => 'shipment-mapping-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'shipment-mapping-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Shipment Mapping Admin',
            'email' => 'shipment-mapping-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function createOrder(Account $account, User $user, array $overrides = []): Order
    {
        return Order::query()->create(array_merge([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'OR' . random_int(10000, 99999) . 'A0',
            'order_kind' => Order::KIND_OFFICIAL,
            'total_price' => 250000,
            'status' => 'new',
            'customer_name' => 'Khach mapping',
            'customer_email' => 'mapping-' . Str::lower(Str::random(5)) . '@example.com',
            'customer_phone' => '090' . str_pad((string) random_int(1000000, 9999999), 7, '0', STR_PAD_LEFT),
            'shipping_address' => '123 Test Street',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'notes' => 'Shipment mapping test order',
            'source' => 'Website',
            'type' => 'Le',
            'shipment_status' => null,
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => 250000,
            'shipping_status_source' => 'manual',
        ], $overrides));
    }

    private function createShipment(Order $order, User $user, array $overrides = []): Shipment
    {
        return Shipment::query()->create(array_merge([
            'account_id' => $order->account_id,
            'order_id' => $order->id,
            'order_code' => $order->order_number,
            'shipment_number' => 'VD-' . now()->format('Ymd') . '-' . Str::upper(Str::random(4)),
            'tracking_number' => 'TRACK-' . Str::upper(Str::random(8)),
            'carrier_tracking_code' => 'TRACK-' . Str::upper(Str::random(8)),
            'carrier_code' => 'custom_carrier',
            'carrier_name' => 'Custom Carrier',
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
            'actual_received_amount' => (float) $order->total_price,
            'created_by' => $user->id,
            'shipped_at' => now(),
        ], $overrides));
    }

    private function createMapping(Account $account, array $overrides = []): CarrierStatusMapping
    {
        return CarrierStatusMapping::query()->create(array_merge([
            'account_id' => $account->id,
            'carrier_code' => 'custom_carrier',
            'carrier_raw_status' => 'raw_status_' . Str::lower(Str::random(5)),
            'internal_shipment_status' => 'delivered',
            'mapped_order_status' => 'completed',
            'is_terminal' => false,
            'sort_order' => 1,
            'is_active' => true,
        ], $overrides));
    }

    private function rebuildSchema(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP SCHEMA IF EXISTS public CASCADE');
            DB::statement('CREATE SCHEMA public');
            DB::statement('GRANT ALL ON SCHEMA public TO postgres');
            DB::statement('GRANT ALL ON SCHEMA public TO public');
        } else {
            Schema::disableForeignKeyConstraints();

            foreach ([
                'shipment_status_logs',
                'shipment_reconciliations',
                'order_status_logs',
                'carrier_raw_statuses',
                'carrier_status_mappings',
                'shipments',
                'order_statuses',
                'orders',
                'account_user',
                'carriers',
                'users',
                'accounts',
            ] as $table) {
                Schema::dropIfExists($table);
            }

            Schema::enableForeignKeyConstraints();
        }

        Schema::create('accounts', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('domain')->nullable();
            $table->string('subdomain')->nullable();
            $table->string('site_code')->nullable();
            $table->boolean('status')->default(true);
            $table->string('ai_api_key')->nullable();
            $table->timestamps();
        });

        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('password');
            $table->boolean('is_admin')->default(false);
            $table->timestamps();
        });

        Schema::create('account_user', function (Blueprint $table) {
            $table->unsignedBigInteger('account_id');
            $table->unsignedBigInteger('user_id');
            $table->string('role')->nullable();
            $table->timestamps();
        });

        Schema::create('carriers', function (Blueprint $table) {
            $table->id();
            $table->string('code')->unique();
            $table->string('name');
            $table->string('logo')->nullable();
            $table->integer('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->boolean('is_visible')->default(true);
            $table->string('color')->nullable();
            $table->timestamps();
        });

        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->unsignedBigInteger('user_id')->nullable();
            $table->string('order_number');
            $table->string('order_kind')->nullable();
            $table->string('order_type')->nullable();
            $table->decimal('total_price', 15, 2)->default(0);
            $table->string('status')->default('new');
            $table->string('customer_name')->nullable();
            $table->string('customer_email')->nullable();
            $table->string('customer_phone')->nullable();
            $table->text('shipping_address')->nullable();
            $table->string('province')->nullable();
            $table->string('district')->nullable();
            $table->string('ward')->nullable();
            $table->text('notes')->nullable();
            $table->string('source')->nullable();
            $table->string('type')->nullable();
            $table->string('shipment_status')->nullable();
            $table->decimal('shipping_fee', 15, 2)->default(0);
            $table->decimal('internal_shipping_fee', 15, 2)->nullable();
            $table->decimal('discount', 15, 2)->default(0);
            $table->decimal('settlement_delta', 15, 2)->default(0);
            $table->string('return_tracking_code', 120)->nullable();
            $table->string('return_status', 30)->default('not_returned');
            $table->decimal('cost_total', 15, 2)->default(0);
            $table->decimal('profit_total', 15, 2)->default(0);
            $table->decimal('supplement_items_total_price', 15, 2)->default(0);
            $table->decimal('supplement_items_cost_total', 15, 2)->default(0);
            $table->decimal('report_revenue_total', 15, 2)->default(0);
            $table->decimal('report_cost_total', 15, 2)->default(0);
            $table->decimal('report_profit_total', 15, 2)->default(0);
            $table->unsignedBigInteger('customer_id')->nullable();
            $table->string('shipping_status')->nullable();
            $table->timestamp('shipping_synced_at')->nullable();
            $table->string('shipping_status_source')->nullable();
            $table->string('shipping_carrier_code')->nullable();
            $table->string('shipping_carrier_name')->nullable();
            $table->string('shipping_tracking_code')->nullable();
            $table->timestamp('shipping_dispatched_at')->nullable();
            $table->string('shipping_issue_code')->nullable();
            $table->text('shipping_issue_message')->nullable();
            $table->timestamp('shipping_issue_detected_at')->nullable();
            $table->softDeletes();
            $table->timestamps();
        });

        Schema::create('shipments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->unsignedBigInteger('order_id')->nullable();
            $table->unsignedBigInteger('integration_id')->nullable();
            $table->unsignedBigInteger('warehouse_id')->nullable();
            $table->string('shipment_number');
            $table->string('tracking_number')->nullable();
            $table->string('carrier_tracking_code')->nullable();
            $table->string('carrier_code')->nullable();
            $table->string('carrier_name')->nullable();
            $table->string('order_code')->nullable();
            $table->string('channel')->nullable();
            $table->unsignedBigInteger('customer_id')->nullable();
            $table->string('customer_name')->nullable();
            $table->string('customer_phone')->nullable();
            $table->text('customer_address')->nullable();
            $table->string('customer_ward')->nullable();
            $table->string('customer_district')->nullable();
            $table->string('customer_province')->nullable();
            $table->string('sender_name')->nullable();
            $table->string('sender_phone')->nullable();
            $table->text('sender_address')->nullable();
            $table->string('status')->nullable();
            $table->string('shipment_status')->default('created');
            $table->string('shipment_sub_status')->nullable();
            $table->string('order_status_snapshot')->nullable();
            $table->string('carrier_status_raw')->nullable();
            $table->string('carrier_status_mapped')->nullable();
            $table->string('carrier_status_code')->nullable();
            $table->string('carrier_status_text')->nullable();
            $table->decimal('cod_amount', 15, 2)->default(0);
            $table->decimal('shipping_cost', 15, 2)->default(0);
            $table->decimal('service_fee', 15, 2)->default(0);
            $table->decimal('return_fee', 15, 2)->default(0);
            $table->decimal('insurance_fee', 15, 2)->default(0);
            $table->decimal('other_fee', 15, 2)->default(0);
            $table->decimal('reconciled_amount', 15, 2)->nullable();
            $table->decimal('actual_received_amount', 15, 2)->default(0);
            $table->decimal('reconciliation_diff_amount', 15, 2)->default(0);
            $table->string('reconciliation_status')->nullable();
            $table->string('return_status', 30)->nullable();
            $table->string('cod_status')->nullable();
            $table->integer('attempt_delivery_count')->default(0);
            $table->text('failed_reason')->nullable();
            $table->string('failed_reason_code')->nullable();
            $table->text('internal_note')->nullable();
            $table->text('notes')->nullable();
            $table->string('risk_flag')->nullable();
            $table->string('priority_level')->nullable();
            $table->string('problem_code')->nullable();
            $table->text('problem_message')->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('assigned_to')->nullable();
            $table->timestamp('shipped_at')->nullable();
            $table->timestamp('picked_at')->nullable();
            $table->timestamp('in_transit_at')->nullable();
            $table->timestamp('out_for_delivery_at')->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->timestamp('delivery_failed_at')->nullable();
            $table->timestamp('returning_at')->nullable();
            $table->timestamp('returned_at')->nullable();
            $table->timestamp('reconciled_at')->nullable();
            $table->timestamp('last_reconciled_at')->nullable();
            $table->timestamp('canceled_at')->nullable();
            $table->timestamp('last_synced_at')->nullable();
            $table->timestamp('problem_detected_at')->nullable();
            $table->timestamp('last_webhook_received_at')->nullable();
            $table->string('external_order_number')->nullable();
            $table->json('raw_tracking_payload')->nullable();
            $table->json('dispatch_payload')->nullable();
            $table->json('dispatch_response')->nullable();
            $table->json('extra_data')->nullable();
            $table->softDeletes();
            $table->timestamps();
        });

        Schema::create('carrier_status_mappings', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->string('carrier_code');
            $table->string('carrier_raw_status');
            $table->string('internal_shipment_status')->nullable();
            $table->string('mapped_order_status')->nullable();
            $table->text('description')->nullable();
            $table->boolean('is_terminal')->default(false);
            $table->integer('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('carrier_raw_statuses', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->string('carrier_code');
            $table->string('raw_status');
            $table->timestamp('first_seen_at')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->boolean('is_mapped')->default(false);
            $table->unsignedBigInteger('mapping_id')->nullable();
            $table->json('sample_payload')->nullable();
            $table->timestamps();
        });

        Schema::create('order_statuses', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->string('code');
            $table->string('name');
            $table->string('color')->nullable();
            $table->integer('sort_order')->default(0);
            $table->boolean('is_default')->default(false);
            $table->boolean('is_system')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('shipment_reconciliations', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('shipment_id');
            $table->string('reconciliation_code')->nullable();
            $table->string('carrier_code')->nullable();
            $table->decimal('cod_amount', 15, 2)->default(0);
            $table->decimal('shipping_fee', 15, 2)->default(0);
            $table->decimal('service_fee', 15, 2)->default(0);
            $table->decimal('return_fee', 15, 2)->default(0);
            $table->decimal('actual_received_amount', 15, 2)->default(0);
            $table->decimal('system_expected_amount', 15, 2)->default(0);
            $table->decimal('diff_amount', 15, 2)->default(0);
            $table->string('status')->nullable();
            $table->text('note')->nullable();
            $table->unsignedBigInteger('reconciled_by')->nullable();
            $table->timestamp('reconciled_at')->nullable();
            $table->timestamps();
        });

        Schema::create('order_status_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('order_id');
            $table->string('from_status')->nullable();
            $table->string('to_status');
            $table->string('from_shipping_status')->nullable();
            $table->string('to_shipping_status')->nullable();
            $table->string('source')->default('manual');
            $table->unsignedBigInteger('changed_by')->nullable();
            $table->text('reason')->nullable();
            $table->timestamps();
        });

        Schema::create('shipment_status_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('shipment_id');
            $table->string('from_status')->nullable();
            $table->string('to_status');
            $table->unsignedBigInteger('changed_by')->nullable();
            $table->string('change_source')->nullable();
            $table->text('reason')->nullable();
            $table->timestamps();
        });

    }

    private function ensureCarrierExists(): void
    {
        $this->ensureCarrier('custom_carrier', 'Custom Carrier');
    }

    private function ensureCarrier(string $code, string $name): void
    {
        \App\Models\Carrier::query()->updateOrCreate(
            ['code' => $code],
            [
                'name' => $name,
                'is_active' => true,
                'is_visible' => true,
                'sort_order' => 1,
            ]
        );
    }
}
