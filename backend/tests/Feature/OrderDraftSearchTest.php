<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Attribute;
use App\Models\Order;
use App\Models\OrderAttributeValue;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderDraftSearchTest extends TestCase
{
    use RefreshDatabase;

    public function test_draft_search_matches_customer_name_with_accents_compact_tokens_and_fuzzy_typo(): void
    {
        $this->skipUnlessPostgresSearchDriver();

        [$account, $user] = $this->authenticate();

        $accentedName = "Nguy\u{1EC5}n V\u{0103}n \u{00C1}nh";

        $target = $this->createDraftOrder($account, $user, [
            'customer_name' => $accentedName,
            'customer_phone' => '0906111222',
        ]);

        $this->createDraftOrder($account, $user, [
            'customer_name' => "Tr\u{1EA7}n B\u{00EC}nh Minh",
            'customer_phone' => '0906333444',
        ]);

        foreach ([
            $accentedName,
            'nguyen van anh',
            'NGUYEN VAN ANH',
            'nguyen anh',
            'nguyenvananh',
            'nguyn van anh',
        ] as $search) {
            $this->assertSame(
                [$target->id],
                $this->draftSearchIds($account, ['search' => $search]),
                "Unexpected result for search [{$search}]"
            );
        }

        $this->assertSame(
            [$target->id],
            $this->draftSearchIds($account, ['customer_name' => 'nguyen van anh'])
        );
    }

    public function test_draft_search_can_match_receiver_name_like_attribute_and_render_it_as_fallback_name(): void
    {
        $this->skipUnlessPostgresSearchDriver();

        [$account, $user] = $this->authenticate();

        $receiverName = "L\u{00EA} Th\u{1ECB} Nh\u{00E0}n";

        $receiverNameAttribute = Attribute::query()->create([
            'account_id' => $account->id,
            'entity_type' => 'order',
            'name' => "T\u{00EA}n ng\u{01B0}\u{1EDD}i nh\u{1EAD}n",
            'code' => 'receiver_name',
            'frontend_type' => 'text',
            'is_filterable' => false,
            'is_filterable_frontend' => false,
            'is_filterable_backend' => false,
            'is_required' => false,
            'is_variant' => false,
            'status' => true,
        ]);

        $target = $this->createDraftOrder($account, $user, [
            'customer_name' => '',
            'customer_phone' => '0907000888',
        ]);

        OrderAttributeValue::query()->create([
            'order_id' => $target->id,
            'attribute_id' => $receiverNameAttribute->id,
            'value' => $receiverName,
        ]);

        $searchResponse = $this->draftResponse($account, ['search' => 'le thi nhan']);
        $searchResponse
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $target->id)
            ->assertJsonPath('data.0.customer_name', $receiverName);

        $nameFilterResponse = $this->draftResponse($account, ['customer_name' => $receiverName]);
        $nameFilterResponse
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $target->id)
            ->assertJsonPath('data.0.customer_name', $receiverName);
    }

    public function test_draft_search_keeps_phone_order_number_and_tracking_code_lookup_working(): void
    {
        [$account, $user] = $this->authenticate();

        $target = $this->createDraftOrder($account, $user, [
            'customer_name' => 'Khach lookup',
            'customer_phone' => '0912345678',
            'shipping_tracking_code' => 'TRACK-DRAFT-001',
            'order_number' => 'DRLOOKUP001',
        ]);

        $this->assertSame([$target->id], $this->draftSearchIds($account, ['search' => '0912345678']));
        $this->assertSame([$target->id], $this->draftSearchIds($account, ['search' => 'DRLOOKUP001']));
        $this->assertSame([$target->id], $this->draftSearchIds($account, ['search' => 'TRACK-DRAFT-001']));
    }

    private function draftResponse(Account $account, array $params = [])
    {
        return $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders?' . http_build_query(array_merge([
                'order_kind' => Order::KIND_DRAFT,
                'per_page' => 100,
            ], $params)));
    }

    private function draftSearchIds(Account $account, array $params = []): array
    {
        return collect($this->draftResponse($account, $params)->assertOk()->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function skipUnlessPostgresSearchDriver(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            $this->markTestSkipped('PostgreSQL search functions are required for accent-insensitive draft name search.');
        }
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Draft Search Account',
            'domain' => 'draft-search-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'draft-search-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Draft Search Admin',
            'email' => 'draft-search-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function createDraftOrder(Account $account, User $user, array $overrides = []): Order
    {
        return Order::query()->create(array_merge([
            'user_id' => $user->id,
            'account_id' => $account->id,
            'order_number' => 'DR' . Str::upper(Str::random(8)),
            'order_kind' => Order::KIND_DRAFT,
            'order_type' => Order::TYPE_STANDARD,
            'total_price' => 0,
            'status' => 'new',
            'customer_name' => 'Khach nhap',
            'customer_email' => 'draft-' . Str::lower(Str::random(6)) . '@example.com',
            'customer_phone' => '090' . random_int(1000000, 9999999),
            'shipping_address' => '',
            'province' => null,
            'district' => null,
            'ward' => null,
            'notes' => null,
            'source' => 'Website',
            'type' => 'Le',
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 0,
            'profit_total' => 0,
            'shipping_status_source' => 'manual',
            'shipping_tracking_code' => null,
        ], $overrides));
    }
}
