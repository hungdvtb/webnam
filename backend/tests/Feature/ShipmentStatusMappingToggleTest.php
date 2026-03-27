<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CarrierStatusMapping;
use App\Models\Order;
use App\Models\Shipment;
use App\Models\User;
use App\Services\Shipping\CarrierStatusMapper;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

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
            ->assertJsonPath('shipment.order.status', 'completed');

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
                'order_status_logs',
                'carrier_status_mappings',
                'shipments',
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
            $table->decimal('discount', 15, 2)->default(0);
            $table->decimal('cost_total', 15, 2)->default(0);
            $table->decimal('profit_total', 15, 2)->default(0);
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
            $table->string('internal_shipment_status');
            $table->string('mapped_order_status')->nullable();
            $table->text('description')->nullable();
            $table->boolean('is_terminal')->default(false);
            $table->integer('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
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
        \App\Models\Carrier::query()->updateOrCreate(
            ['code' => 'custom_carrier'],
            [
                'name' => 'Custom Carrier',
                'is_active' => true,
                'is_visible' => true,
                'sort_order' => 1,
            ]
        );
    }
}
