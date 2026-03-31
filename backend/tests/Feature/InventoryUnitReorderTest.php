<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\InventoryUnit;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class InventoryUnitReorderTest extends TestCase
{
    use RefreshDatabase;

    public function test_reorder_inventory_units_keeps_stale_draft_order_and_appends_new_visible_units(): void
    {
        [$account] = $this->authenticate();

        $accountUnit = InventoryUnit::query()->create([
            'account_id' => $account->id,
            'name' => 'Thùng',
            'normalized_name' => 'thung',
            'code' => 'THUNG',
            'is_default' => false,
            'is_system' => false,
            'sort_order' => 99,
        ]);

        $systemUnitIds = InventoryUnit::query()
            ->whereNull('account_id')
            ->orderBy('sort_order')
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values();

        $requestedIds = [
            $systemUnitIds[3],
            $systemUnitIds[0],
            $systemUnitIds[1],
            $systemUnitIds[2],
        ];

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/inventory/units/reorder', [
                'ids' => $requestedIds,
                'default_id' => $requestedIds[0],
            ]);

        $response->assertOk();

        $visibleUnits = InventoryUnit::query()
            ->where(function ($builder) use ($account) {
                $builder
                    ->whereNull('account_id')
                    ->orWhere('account_id', $account->id);
            })
            ->orderBy('sort_order')
            ->get(['id', 'is_default']);

        $this->assertSame($requestedIds, $visibleUnits->take(4)->pluck('id')->map(fn ($id) => (int) $id)->all());
        $this->assertSame((int) $accountUnit->id, (int) $visibleUnits->last()->id);
        $this->assertSame((int) $requestedIds[0], (int) $visibleUnits->firstWhere('is_default', true)?->id);
    }

    public function test_reorder_inventory_units_rejects_unknown_ids(): void
    {
        [$account] = $this->authenticate();

        $otherAccount = Account::query()->create([
            'name' => 'Inventory Other ' . Str::upper(Str::random(4)),
            'domain' => 'inventory-other-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'inventory-other-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $foreignUnit = InventoryUnit::query()->create([
            'account_id' => $otherAccount->id,
            'name' => 'Kiện',
            'normalized_name' => 'kien',
            'code' => 'KIEN',
            'is_default' => false,
            'is_system' => false,
            'sort_order' => 1,
        ]);

        $systemUnitIds = InventoryUnit::query()
            ->whereNull('account_id')
            ->orderBy('sort_order')
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values();

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/inventory/units/reorder', [
                'ids' => array_merge($systemUnitIds->all(), [$foreignUnit->id]),
                'default_id' => $systemUnitIds[0],
            ]);

        $response
            ->assertStatus(422)
            ->assertJsonValidationErrors(['ids']);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Inventory Reorder ' . Str::upper(Str::random(4)),
            'domain' => 'inventory-reorder-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'inventory-reorder-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::factory()->create([
            'name' => 'Inventory Reorder Admin',
            'email' => 'inventory-reorder-' . Str::lower(Str::random(6)) . '@example.com',
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
}
