<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Lead;
use App\Models\LeadStatus;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class LeadDraftStatusCompatibilityTest extends TestCase
{
    use RefreshDatabase;

    public function test_legacy_draft_leads_are_returned_under_draft_tab_and_counted_correctly(): void
    {
        [$account] = $this->authenticate();
        $statuses = LeadStatus::ensureDefaultsForAccount($account->id);
        $draftStatus = $statuses->firstWhere('code', 'don-nhap');
        $defaultStatus = $statuses->firstWhere('is_default', true);

        $this->createLead($account, [
            'lead_number' => 'LD10000A0',
            'customer_name' => 'Legacy Draft Token',
            'phone' => '0911111111',
            'status' => 'draft',
            'lead_status_id' => null,
            'is_draft' => false,
            'draft_token' => 'legacy-draft-token',
            'converted_at' => null,
            'order_id' => null,
        ]);

        $legacyNamedStatus = LeadStatus::query()->create([
            'account_id' => $account->id,
            'code' => 'cart-abandon',
            'name' => 'Don nhap',
            'color' => '#64748b',
            'sort_order' => 99,
            'is_default' => false,
            'blocks_order_create' => false,
            'is_active' => true,
        ]);

        $this->createLead($account, [
            'lead_number' => 'LD10001A0',
            'customer_name' => 'Legacy Draft Name',
            'phone' => '0922222222',
            'status' => 'cart-abandon',
            'lead_status_id' => $legacyNamedStatus->id,
            'is_draft' => false,
            'draft_token' => null,
            'converted_at' => null,
            'order_id' => null,
        ]);

        $this->createLead($account, [
            'lead_number' => 'LD10002A0',
            'customer_name' => 'Official Lead',
            'phone' => '0933333333',
            'status' => $defaultStatus?->code ?? 'don-moi',
            'lead_status_id' => $defaultStatus?->id,
            'is_draft' => false,
            'draft_token' => 'official-token',
            'converted_at' => now(),
            'order_id' => null,
        ]);

        $allResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/leads')
            ->assertOk();

        $draftCount = collect($allResponse->json('statuses'))
            ->firstWhere('code', 'don-nhap')['count'] ?? null;
        $defaultCount = collect($allResponse->json('statuses'))
            ->firstWhere('id', $defaultStatus?->id)['count'] ?? null;

        $this->assertSame(2, $draftCount);
        $this->assertSame(1, $defaultCount);

        $draftResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/leads?status=' . $draftStatus?->id)
            ->assertOk();

        $this->assertCount(2, $draftResponse->json('data'));
        $this->assertEqualsCanonicalizing(
            ['Legacy Draft Token', 'Legacy Draft Name'],
            collect($draftResponse->json('data'))->pluck('customer_name')->all()
        );

        foreach ($draftResponse->json('data') as $lead) {
            $this->assertTrue((bool) $lead['is_draft']);
            $this->assertSame($draftStatus?->id, $lead['lead_status_id']);
            $this->assertSame('don-nhap', $lead['status']);
            $this->assertSame('don-nhap', data_get($lead, 'status_config.code'));
        }

        $defaultResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/leads?status=' . $defaultStatus?->id)
            ->assertOk();

        $this->assertCount(1, $defaultResponse->json('data'));
        $this->assertSame('Official Lead', data_get($defaultResponse->json('data'), '0.customer_name'));
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Lead Draft Compatibility',
            'domain' => 'lead-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'lead-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Lead Draft Admin',
            'email' => 'lead-draft-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function createLead(Account $account, array $overrides = []): Lead
    {
        return Lead::query()->create(array_merge([
            'account_id' => $account->id,
            'lead_number' => 'LD' . random_int(10000, 99999) . 'A0',
            'customer_name' => 'Lead Test',
            'phone' => '0900000000',
            'status' => 'don-moi',
            'is_draft' => false,
            'placed_at' => now(),
            'draft_captured_at' => now(),
            'total_amount' => 0,
            'discount_amount' => 0,
            'payload_snapshot' => [],
            'conversion_data' => [],
        ], $overrides));
    }
}
