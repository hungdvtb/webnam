<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Attribute;
use App\Models\Order;
use App\Models\OrderAttributeValue;
use App\Models\ProfitCenter;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderBulkUpdateAndProfitManagerFilterTest extends TestCase
{
    use RefreshDatabase;

    public function test_bulk_update_changes_attributes_and_manager_only_for_orders_in_the_active_account(): void
    {
        [$account, $user] = $this->authenticate();
        $otherAccount = $this->createAccount('other');
        $user->accounts()->attach($otherAccount->id, ['role' => 'owner']);

        $manager = User::factory()->create(['name' => 'Quan ly Loi Lo']);
        $profitCenter = $this->createProfitCenter($account, $manager, 'TEAM-A');
        $attribute = $this->createOrderAttribute($account, 'customer_tier');
        $accountOrder = $this->createOrder($account, $user, 'OR-BULK-ACCOUNT');
        $otherOrder = $this->createOrder($otherAccount, $user, 'OR-BULK-OTHER');

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/bulk-update', [
                'ids' => [$accountOrder->id, $otherOrder->id],
                'profit_center_id' => $profitCenter->id,
                'custom_attributes' => [
                    $attribute->id => 'VIP',
                ],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('updated_count', 1);

        $this->assertSame($profitCenter->id, (int) $accountOrder->fresh()->profit_center_id);
        $this->assertNull($otherOrder->fresh()->profit_center_id);
        $this->assertDatabaseHas('order_attribute_values', [
            'order_id' => $accountOrder->id,
            'attribute_id' => $attribute->id,
            'value' => 'VIP',
        ]);
        $this->assertDatabaseMissing('order_attribute_values', [
            'order_id' => $otherOrder->id,
            'attribute_id' => $attribute->id,
        ]);
    }

    public function test_bulk_update_can_clear_an_order_attribute(): void
    {
        [$account, $user] = $this->authenticate();
        $attribute = $this->createOrderAttribute($account, 'delivery_note');
        $order = $this->createOrder($account, $user, 'OR-BULK-CLEAR');
        OrderAttributeValue::query()->create([
            'order_id' => $order->id,
            'attribute_id' => $attribute->id,
            'value' => 'Giao buoi sang',
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/bulk-update', [
                'ids' => [$order->id],
                'custom_attributes' => [$attribute->id => null],
            ])
            ->assertOk();

        $this->assertDatabaseMissing('order_attribute_values', [
            'order_id' => $order->id,
            'attribute_id' => $attribute->id,
        ]);
    }

    public function test_order_list_filters_by_profit_manager_and_unassigned_orders(): void
    {
        [$account, $user] = $this->authenticate();
        $manager = User::factory()->create(['name' => 'Nguyen Quan Ly']);
        $otherManager = User::factory()->create(['name' => 'Tran Quan Ly']);
        $managedCenter = $this->createProfitCenter($account, $manager, 'TEAM-MANAGED');
        $otherCenter = $this->createProfitCenter($account, $otherManager, 'TEAM-OTHER');
        $centerWithoutManager = $this->createProfitCenter($account, null, 'TEAM-EMPTY');

        $managedOrder = $this->createOrder($account, $user, 'OR-MANAGER-A', $managedCenter->id);
        $otherManagedOrder = $this->createOrder($account, $user, 'OR-MANAGER-B', $otherCenter->id);
        $centerWithoutManagerOrder = $this->createOrder($account, $user, 'OR-MANAGER-EMPTY-CENTER', $centerWithoutManager->id);
        $noCenterOrder = $this->createOrder($account, $user, 'OR-MANAGER-NONE');

        $managerResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?per_page=100&profit_manager_id=' . $manager->id)
            ->assertOk();
        $managerIds = collect($managerResponse->json('data'))->pluck('id')->map(fn ($id) => (int) $id)->all();

        $this->assertContains($managedOrder->id, $managerIds);
        $this->assertNotContains($otherManagedOrder->id, $managerIds);
        $this->assertNotContains($centerWithoutManagerOrder->id, $managerIds);
        $this->assertNotContains($noCenterOrder->id, $managerIds);

        $unassignedResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?per_page=100&profit_manager_id=unassigned')
            ->assertOk();
        $unassignedIds = collect($unassignedResponse->json('data'))->pluck('id')->map(fn ($id) => (int) $id)->all();

        $this->assertNotContains($managedOrder->id, $unassignedIds);
        $this->assertNotContains($otherManagedOrder->id, $unassignedIds);
        $this->assertContains($centerWithoutManagerOrder->id, $unassignedIds);
        $this->assertContains($noCenterOrder->id, $unassignedIds);
    }

    private function authenticate(): array
    {
        $account = $this->createAccount('active');
        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user, ['*']);

        return [$account, $user];
    }

    private function createAccount(string $suffix): Account
    {
        $token = Str::lower(Str::random(8));

        return Account::query()->create([
            'name' => 'Order Bulk ' . $suffix . ' ' . $token,
            'domain' => "order-bulk-{$suffix}-{$token}.local",
            'subdomain' => "order-bulk-{$suffix}-{$token}",
            'status' => 'active',
        ]);
    }

    private function createProfitCenter(Account $account, ?User $manager, string $code): ProfitCenter
    {
        return ProfitCenter::query()->create([
            'account_id' => $account->id,
            'name' => $code,
            'code' => $code,
            'channel' => ProfitCenter::CHANNEL_SHARED,
            'manager_user_id' => $manager?->id,
            'is_active' => true,
            'sort_order' => 0,
        ]);
    }

    private function createOrderAttribute(Account $account, string $code): Attribute
    {
        return Attribute::query()->create([
            'account_id' => $account->id,
            'name' => Str::headline($code),
            'code' => $code . '_' . Str::lower(Str::random(6)),
            'entity_type' => 'order',
            'frontend_type' => 'text',
            'is_filterable' => true,
            'is_filterable_backend' => true,
            'is_required' => false,
            'status' => true,
            'sort_order' => 1,
        ]);
    }

    private function createOrder(Account $account, User $user, string $number, ?int $profitCenterId = null): Order
    {
        return Order::query()->create([
            'account_id' => $account->id,
            'user_id' => $user->id,
            'order_number' => $number,
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'status' => 'new',
            'customer_name' => 'Khach test',
            'customer_phone' => '090' . random_int(1000000, 9999999),
            'shipping_address' => 'Dia chi test',
            'total_price' => 120000,
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 80000,
            'profit_total' => 40000,
            'profit_center_id' => $profitCenterId,
        ]);
    }

    private function headers(Account $account): array
    {
        return [
            'X-Account-Id' => (string) $account->id,
            'Accept' => 'application/json',
        ];
    }
}
