<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
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
}
