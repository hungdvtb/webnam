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
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

class ViettelPostTrackingImportTest extends TestCase
{
    use RefreshDatabase;

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

        $this->assertTrue($result['success']);
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
