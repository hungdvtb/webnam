<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Lead;
use App\Models\LeadStatus;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class LeadRealtimeApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_realtime_init_returns_cursor_without_replaying_existing_leads(): void
    {
        [$account] = $this->authenticate();
        $statuses = LeadStatus::ensureDefaultsForAccount($account->id);
        $defaultStatus = $statuses->firstWhere('is_default', true);

        Carbon::setTestNow(Carbon::parse('2026-05-13 08:00:00', 'UTC'));
        $lead = $this->createLead($account, [
            'lead_status_id' => $defaultStatus?->id,
            'status' => $defaultStatus?->code ?? 'don-moi',
            'customer_name' => 'Existing Lead',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/leads/realtime?init=1')
            ->assertOk();

        $this->assertSame([], $response->json('items'));
        $this->assertSame($lead->id, $response->json('realtime_cursor.id'));
        $this->assertNotEmpty($response->json('realtime_cursor.changed_at'));
    }

    public function test_realtime_detects_draft_conversion_without_new_id(): void
    {
        [$account] = $this->authenticate();
        $statuses = LeadStatus::ensureDefaultsForAccount($account->id);
        $draftStatus = $statuses->firstWhere('code', 'don-nhap');
        $defaultStatus = $statuses->firstWhere('is_default', true);

        Carbon::setTestNow(Carbon::parse('2026-05-13 08:00:00', 'UTC'));
        $lead = $this->createLead($account, [
            'lead_status_id' => $draftStatus?->id,
            'status' => 'don-nhap',
            'is_draft' => true,
            'draft_token' => 'draft-realtime-token',
            'customer_name' => 'Draft Before Checkout',
        ]);

        $cursor = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/leads/realtime?init=1')
            ->assertOk()
            ->json('realtime_cursor');

        Carbon::setTestNow(Carbon::parse('2026-05-13 08:02:00', 'UTC'));
        $lead->forceFill([
            'lead_status_id' => $defaultStatus?->id,
            'status' => $defaultStatus?->code ?? 'don-moi',
            'is_draft' => false,
            'placed_at' => now(),
            'converted_at' => now(),
            'customer_name' => 'Official Checkout',
        ])->save();

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/leads/realtime?' . http_build_query([
                'after_changed_at' => $cursor['changed_at'],
                'after_id' => $cursor['id'],
            ]))
            ->assertOk();

        $this->assertSame([$lead->id], collect($response->json('items'))->pluck('id')->all());
        $this->assertFalse((bool) $response->json('items.0.is_draft'));
        $this->assertSame('Official Checkout', $response->json('items.0.customer_name'));
        $this->assertSame($defaultStatus?->id, $response->json('items.0.lead_status_id'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Lead Realtime',
            'domain' => 'lead-realtime-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'lead-realtime-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Lead Realtime Admin',
            'email' => 'lead-realtime-' . Str::lower(Str::random(6)) . '@example.com',
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
        $lead = new Lead(array_merge([
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

        $lead->save();

        return $lead;
    }
}
