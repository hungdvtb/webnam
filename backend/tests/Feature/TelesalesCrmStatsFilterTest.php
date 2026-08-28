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

class TelesalesCrmStatsFilterTest extends TestCase
{
    use RefreshDatabase;

    public function test_telesales_queue_stats_respect_the_table_date_filter(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-08-26 09:00:00'));

        [$account] = $this->authenticate();
        $defaultStatus = LeadStatus::ensureDefaultsForAccount($account->id)
            ->firstWhere('is_default', true);

        $this->createLead($account, [
            'lead_status_id' => $defaultStatus?->id,
            'status' => $defaultStatus?->code ?? 'don-moi',
            'customer_name' => 'Khach thang 7',
            'phone' => '0911111111',
            'placed_at' => Carbon::parse('2026-07-10 10:00:00'),
        ]);

        $filteredResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/telesales/leads?' . http_build_query([
                'queue' => 'all',
                'date_from' => '2026-08-01',
                'date_to' => '2026-08-31',
            ]))
            ->assertOk();

        $this->assertSame(0, $filteredResponse->json('total'));
        $this->assertSame([], $filteredResponse->json('data'));
        $this->assertSame(0, $filteredResponse->json('stats.total'));
        $this->assertSame(0, $filteredResponse->json('stats.today_due'));
        $this->assertSame(0, $filteredResponse->json('stats.new_today'));
        $this->assertSame(0, $filteredResponse->json('stats.overdue'));

        $unfilteredResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/telesales/leads?' . http_build_query([
                'queue' => 'all',
            ]))
            ->assertOk();

        $this->assertSame(1, $unfilteredResponse->json('total'));
        $this->assertSame(1, $unfilteredResponse->json('stats.total'));
        $this->assertSame(1, $unfilteredResponse->json('stats.today_due'));
        $this->assertSame(1, $unfilteredResponse->json('stats.new_today'));
        $this->assertSame(1, $unfilteredResponse->json('stats.overdue'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Telesales Stats',
            'domain' => 'telesales-stats-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'telesales-stats-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Telesales Admin',
            'email' => 'telesales-stats-' . Str::lower(Str::random(6)) . '@example.com',
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
