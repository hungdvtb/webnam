<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\Shipment;
use App\Models\User;
use App\Services\Shipping\ShipmentStatusSyncService;
use App\Services\Shipping\ViettelPostTrackingImportService;
use App\Services\SimpleXlsxService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

class ViettelPostTrackingImportTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_tracking_import_accepts_excel_extension_when_uploaded_mime_is_generic(): void
    {
        $this->withoutMiddleware(\App\Http\Middleware\AuditAdminAction::class);

        $user = User::factory()->create([
            'name' => 'VTP Upload Admin',
            'email' => 'vtp-upload-' . Str::lower(Str::random(6)) . '@example.com',
            'is_admin' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        $this->mock(ViettelPostTrackingImportService::class, function ($mock) use ($user) {
            $mock->shouldReceive('processFile')
                ->once()
                ->with(Mockery::type('string'), $user->id, null)
                ->andReturn([
                    'success' => true,
                    'summary' => [
                        'total_rows' => 1,
                        'success' => 1,
                        'failed' => 0,
                        'not_found' => 0,
                        'errors' => [],
                    ],
                ]);
        });

        $file = UploadedFile::fake()->createWithContent(
            'VTP_danh_sach_van_don_08_08_2026_08_51_50.xlsx',
            'plain export payload with an xlsx filename'
        );

        $this->post('/api/shipments/import-tracking/viettel-post', [
            'file' => $file,
        ])
            ->assertOk()
            ->assertJsonPath('total_rows', 1)
            ->assertJsonPath('success', 1);
    }

    public function test_tracking_import_only_updates_orders_in_requested_account_and_parses_fee(): void
    {
        $firstAccount = $this->createAccount('VTP Import Store 1');
        $secondAccount = $this->createAccount('VTP Import Store 2');
        $user = User::factory()->create([
            'name' => 'VTP Import Admin',
            'email' => 'vtp-import-' . Str::lower(Str::random(6)) . '@example.com',
            'is_admin' => true,
        ]);

        $user->accounts()->attach($firstAccount->id, ['role' => 'owner']);
        $user->accounts()->attach($secondAccount->id, ['role' => 'owner']);
        Sanctum::actingAs($user, ['*']);

        $secondOrder = $this->createOrder($secondAccount, $user, [
            'order_number' => 'OR-STORE-2-VTP-001',
            'total_price' => 500000,
        ]);

        $xlsxService = Mockery::mock(SimpleXlsxService::class);
        $xlsxService->shouldReceive('readRaw')->twice()->andReturn([
            ['Mã vận đơn', 'Mã đơn hàng', 'Tổng phí'],
            ['VTP-TRACK-STORE-2', 'OR-STORE-2-VTP-001', '45.000'],
        ]);

        $service = new ViettelPostTrackingImportService(
            $xlsxService,
            $this->app->make(ShipmentStatusSyncService::class)
        );

        $wrongAccountResult = $service->processFile('fake.xlsx', $user->id, $firstAccount->id);

        $this->assertTrue($wrongAccountResult['success']);
        $this->assertSame(0, $wrongAccountResult['summary']['success']);
        $this->assertSame(1, $wrongAccountResult['summary']['not_found']);

        $secondOrder->refresh();
        $this->assertNull($secondOrder->shipping_tracking_code);
        $this->assertSame(0, Shipment::withoutGlobalScope('account_id')
            ->where('order_id', $secondOrder->id)
            ->count());

        $result = $service->processFile('fake.xlsx', $user->id, $secondAccount->id);

        $this->assertTrue($result['success'], json_encode($result, JSON_UNESCAPED_UNICODE));
        $this->assertSame(1, $result['summary']['success']);
        $this->assertSame(0, $result['summary']['not_found']);
        $this->assertSame(0, $result['summary']['failed']);

        $secondOrder->refresh();

        $this->assertSame('VTP-TRACK-STORE-2', (string) $secondOrder->shipping_tracking_code);
        $this->assertSame(45000.0, (float) $secondOrder->shipping_fee);
        $this->assertSame(45000.0, (float) $secondOrder->internal_shipping_fee);

        $shipment = Shipment::withoutGlobalScope('account_id')
            ->where('order_id', $secondOrder->id)
            ->firstOrFail();

        $this->assertSame($secondAccount->id, (int) $shipment->account_id);
        $this->assertSame('VTP-TRACK-STORE-2', (string) $shipment->tracking_number);
        $this->assertSame(45000.0, (float) $shipment->shipping_cost);
        $this->assertSame(455000.0, (float) $shipment->actual_received_amount);
    }

    public function test_tracking_import_generates_globally_unique_shipment_number(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-07-20 09:00:00'));

        $firstAccount = $this->createAccount('VTP Import Store 1');
        $secondAccount = $this->createAccount('VTP Import Store 2');
        $user = User::factory()->create([
            'name' => 'VTP Import Admin',
            'email' => 'vtp-import-' . Str::lower(Str::random(6)) . '@example.com',
            'is_admin' => true,
        ]);

        $firstOrder = $this->createOrder($firstAccount, $user, [
            'order_number' => 'OR-STORE-1-SHIPMENT-001',
            'total_price' => 300000,
        ]);
        $secondOrder = $this->createOrder($secondAccount, $user, [
            'order_number' => 'OR-STORE-2-VTP-002',
            'total_price' => 500000,
        ]);

        Shipment::withoutGlobalScope('account_id')->create([
            'account_id' => $firstAccount->id,
            'order_id' => $firstOrder->id,
            'order_code' => $firstOrder->order_number,
            'shipment_number' => 'VD-20260720-0001',
            'tracking_number' => 'VTP-EXISTING-STORE-1',
            'carrier_code' => 'viettel_post',
            'carrier_name' => 'Viettel Post',
            'carrier_tracking_code' => 'VTP-EXISTING-STORE-1',
            'channel' => 'vtp_excel_import',
            'customer_name' => $firstOrder->customer_name,
            'customer_phone' => $firstOrder->customer_phone,
            'customer_address' => $firstOrder->shipping_address,
            'status' => 'waiting_pickup',
            'shipment_status' => 'waiting_pickup',
            'cod_amount' => $firstOrder->total_price,
            'shipping_cost' => 0,
            'actual_received_amount' => $firstOrder->total_price,
            'created_by' => $user->id,
        ]);

        $xlsxService = Mockery::mock(SimpleXlsxService::class);
        $xlsxService->shouldReceive('readRaw')->once()->andReturn([
            ['Mã vận đơn', 'Mã đơn hàng', 'Tổng phí'],
            ['VTP-TRACK-STORE-2-NEW', 'OR-STORE-2-VTP-002', '45.000'],
        ]);

        $service = new ViettelPostTrackingImportService(
            $xlsxService,
            $this->app->make(ShipmentStatusSyncService::class)
        );

        $result = $service->processFile('fake.xlsx', $user->id, $secondAccount->id);

        $this->assertTrue($result['success'], json_encode($result, JSON_UNESCAPED_UNICODE));
        $this->assertSame(1, $result['summary']['success']);
        $this->assertSame(0, $result['summary']['failed']);

        $shipment = Shipment::withoutGlobalScope('account_id')
            ->where('order_id', $secondOrder->id)
            ->firstOrFail();

        $this->assertSame('VD-20260720-0002', (string) $shipment->shipment_number);
        $this->assertSame('VTP-TRACK-STORE-2-NEW', (string) $shipment->tracking_number);
    }

    private function createAccount(string $name): Account
    {
        return Account::query()->create([
            'name' => $name,
            'domain' => Str::slug($name) . '-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => Str::slug($name) . '-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);
    }

    private function createOrder(Account $account, User $user, array $overrides = []): Order
    {
        return Order::query()->create(array_merge([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'OR' . random_int(10000, 99999) . 'A0',
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 300000,
            'status' => 'dispatched',
            'customer_name' => 'Khach VTP import',
            'customer_email' => 'vtp-order-' . Str::lower(Str::random(6)) . '@example.com',
            'customer_phone' => '090' . str_pad((string) random_int(1000000, 9999999), 7, '0', STR_PAD_LEFT),
            'shipping_address' => '123 Test Street',
            'province' => 'Tinh test',
            'district' => 'Huyen test',
            'ward' => 'Xa test',
            'source' => 'FB',
            'type' => 'Le',
            'shipping_fee' => 0,
            'internal_shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => 300000,
            'shipping_status_source' => 'manual',
        ], $overrides));
    }
}
