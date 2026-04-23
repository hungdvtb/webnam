<?php

namespace Tests\Feature;

use App\Models\DailyAdsSpend;
use App\Models\FinDailyReportConfig;
use App\Services\FacebookAdsSyncService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class FacebookAdsSyncServiceTest extends TestCase
{
    use RefreshDatabase;

    public function test_sync_range_does_not_overwrite_existing_spend_when_all_requests_fail(): void
    {
        FinDailyReportConfig::query()->create([
            'fb_access_token' => 'token-1',
            'fb_ad_account_ids' => 'act_123',
        ]);

        DailyAdsSpend::query()->create([
            'date' => '2026-04-01',
            'amount' => 1000,
        ]);

        DailyAdsSpend::query()->create([
            'date' => '2026-04-02',
            'amount' => 2000,
        ]);

        Http::fake([
            'graph.facebook.com/*' => Http::response([
                'error' => ['message' => 'upstream failure'],
            ], 500),
        ]);

        $result = app(FacebookAdsSyncService::class)->syncRange('2026-04-01', '2026-04-02');

        $this->assertFalse($result);
        $this->assertSame(1000.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-01')->value('amount'));
        $this->assertSame(2000.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-02')->value('amount'));
    }

    public function test_sync_range_updates_only_dates_explicitly_returned_by_facebook(): void
    {
        FinDailyReportConfig::query()->create([
            'fb_access_token' => 'token-1',
            'fb_ad_account_ids' => 'act_123',
        ]);

        DailyAdsSpend::query()->create([
            'date' => '2026-04-01',
            'amount' => 1000,
        ]);

        DailyAdsSpend::query()->create([
            'date' => '2026-04-02',
            'amount' => 2000,
        ]);

        Http::fake([
            'graph.facebook.com/*' => Http::response([
                'data' => [
                    [
                        'date_start' => '2026-04-01',
                        'spend' => '1500',
                    ],
                ],
            ], 200),
        ]);

        $result = app(FacebookAdsSyncService::class)->syncRange('2026-04-01', '2026-04-02');

        $this->assertTrue($result);
        $this->assertSame(1500.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-01')->value('amount'));
        $this->assertSame(2000.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-02')->value('amount'));
    }
}
