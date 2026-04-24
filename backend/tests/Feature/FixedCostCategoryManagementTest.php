<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FixedCost;
use App\Models\FixedCostCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FixedCostCategoryManagementTest extends TestCase
{
    use RefreshDatabase;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();

        $account = Account::query()->create([
            'name' => 'Fixed Cost Category Test Account',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);

        Sanctum::actingAs($user);

        $this->headers = [
            'X-Account-Id' => (string) $account->id,
        ];
    }

    public function test_apply_creates_missing_category_records_and_returns_usage_counts(): void
    {
        $response = $this->postJson('/api/finance/fixed-costs/apply', [
            'apply_date' => '2026-04-24',
            'fixed_costs' => [
                [
                    'category' => 'Chi phí server',
                    'name' => 'VPS tháng',
                    'amount' => 350000,
                    'notes' => 'Máy chủ vận hành',
                ],
            ],
        ], $this->headers)->assertOk();

        $this->assertDatabaseHas('fixed_cost_categories', [
            'name' => 'Chi phí server',
        ]);

        $categories = collect($response->json('categories'));
        $serverCategory = $categories->firstWhere('name', 'Chi phí server');

        $this->assertNotNull($serverCategory);
        $this->assertSame(1, (int) ($serverCategory['usage_count'] ?? 0));
    }

    public function test_updating_category_renames_existing_fixed_cost_rows(): void
    {
        $categoryResponse = $this->postJson('/api/finance/fixed-costs/categories', [
            'name' => 'Marketing offline',
        ], $this->headers)->assertCreated();

        $categoryId = (int) $categoryResponse->json('data.category.id');

        FixedCost::query()->create([
            'category' => 'Marketing offline',
            'name' => 'In ấn',
            'amount' => 1200000,
            'notes' => '',
        ]);

        $this->putJson("/api/finance/fixed-costs/categories/{$categoryId}", [
            'name' => 'Marketing sự kiện',
        ], $this->headers)
            ->assertOk()
            ->assertJsonPath('data.old_name', 'Marketing offline')
            ->assertJsonPath('data.category.name', 'Marketing sự kiện');

        $this->assertDatabaseHas('fixed_cost_categories', [
            'id' => $categoryId,
            'name' => 'Marketing sự kiện',
        ]);

        $this->assertDatabaseHas('fixed_costs', [
            'name' => 'In ấn',
            'category' => 'Marketing sự kiện',
        ]);
    }

    public function test_delete_blocks_used_category_and_allows_unused_category(): void
    {
        $usedCategory = FixedCostCategory::query()->create([
            'name' => 'Mặt bằng phụ',
            'sort_order' => 99,
        ]);

        FixedCost::query()->create([
            'category' => 'Mặt bằng phụ',
            'name' => 'Thuê kho',
            'amount' => 2500000,
            'notes' => '',
        ]);

        $this->deleteJson("/api/finance/fixed-costs/categories/{$usedCategory->id}", [], $this->headers)
            ->assertStatus(422)
            ->assertJsonPath('usage_count', 1);

        $unusedCategory = FixedCostCategory::query()->create([
            'name' => 'Chi phí không dùng',
            'sort_order' => 100,
        ]);

        $this->deleteJson("/api/finance/fixed-costs/categories/{$unusedCategory->id}", [], $this->headers)
            ->assertOk()
            ->assertJsonPath('data.id', $unusedCategory->id);

        $this->assertDatabaseMissing('fixed_cost_categories', [
            'id' => $unusedCategory->id,
        ]);
    }
}
