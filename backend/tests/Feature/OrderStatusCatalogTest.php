<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\OrderStatus;
use App\Models\User;
use App\Support\OrderStatusCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderStatusCatalogTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_repairs_account_that_only_has_late_system_statuses(): void
    {
        $account = $this->createAccount();

        foreach ([
            [OrderStatusCatalog::PRINTED_CODE, OrderStatusCatalog::PRINTED_NAME, OrderStatusCatalog::PRINTED_COLOR],
            [OrderStatusCatalog::EXCHANGE_COMPLETED_CODE, OrderStatusCatalog::EXCHANGE_COMPLETED_NAME, OrderStatusCatalog::EXCHANGE_COMPLETED_COLOR],
            [OrderStatusCatalog::PARTIAL_DELIVERY_CODE, OrderStatusCatalog::PARTIAL_DELIVERY_NAME, OrderStatusCatalog::PARTIAL_DELIVERY_COLOR],
        ] as $index => [$code, $name, $color]) {
            OrderStatus::query()->create([
                'account_id' => $account->id,
                'code' => $code,
                'name' => $name,
                'color' => $color,
                'sort_order' => $index + 1,
                'is_default' => false,
                'is_system' => true,
                'is_active' => true,
            ]);
        }

        OrderStatusCatalog::ensureDefaultSystemStatuses((int) $account->id);

        $statuses = $this->orderedStatuses($account);

        $this->assertSame($this->expectedCodes(), $statuses->pluck('code')->all());
        $this->assertSame(range(1, 12), $statuses->pluck('sort_order')->map(fn ($value) => (int) $value)->all());
        $this->assertTrue((bool) $statuses->firstWhere('code', OrderStatusCatalog::NEW_CODE)->is_default);
    }

    public function test_creating_account_through_api_seeds_full_order_status_catalog(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $response = $this->postJson('/api/accounts', [
            'name' => 'Order Status Catalog ' . Str::upper(Str::random(4)),
            'subdomain' => 'order-status-catalog-' . Str::lower(Str::random(6)),
            'site_code' => 'osc-' . Str::lower(Str::random(6)),
        ]);

        $response->assertCreated();

        $account = Account::query()->findOrFail((int) $response->json('id'));
        $statuses = $this->orderedStatuses($account);

        $this->assertSame($this->expectedCodes(), $statuses->pluck('code')->all());
        $this->assertSame(range(1, 12), $statuses->pluck('sort_order')->map(fn ($value) => (int) $value)->all());
    }

    public function test_repair_preserves_existing_custom_default_status(): void
    {
        $account = $this->createAccount();

        OrderStatus::query()->create([
            'account_id' => $account->id,
            'code' => 'packing',
            'name' => 'Packing',
            'color' => '#64748b',
            'sort_order' => 1,
            'is_default' => true,
            'is_system' => false,
            'is_active' => true,
        ]);

        OrderStatus::query()->create([
            'account_id' => $account->id,
            'code' => OrderStatusCatalog::PRINTED_CODE,
            'name' => OrderStatusCatalog::PRINTED_NAME,
            'color' => OrderStatusCatalog::PRINTED_COLOR,
            'sort_order' => 2,
            'is_default' => false,
            'is_system' => true,
            'is_active' => true,
        ]);

        OrderStatusCatalog::ensureDefaultSystemStatuses((int) $account->id);

        $this->assertTrue((bool) OrderStatus::query()
            ->where('account_id', $account->id)
            ->where('code', 'packing')
            ->value('is_default'));
        $this->assertFalse((bool) OrderStatus::query()
            ->where('account_id', $account->id)
            ->where('code', OrderStatusCatalog::NEW_CODE)
            ->value('is_default'));
    }

    private function createAccount(): Account
    {
        return Account::query()->create([
            'name' => 'Status Catalog ' . Str::upper(Str::random(4)),
            'domain' => 'status-catalog-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'status-catalog-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);
    }

    private function orderedStatuses(Account $account)
    {
        return OrderStatus::query()
            ->where('account_id', $account->id)
            ->orderBy('sort_order')
            ->get();
    }

    private function expectedCodes(): array
    {
        return array_column(OrderStatusCatalog::defaultSystemStatuses(), 'code');
    }
}
