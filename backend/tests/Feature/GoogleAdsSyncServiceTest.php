<?php

namespace Tests\Feature;

use App\Models\DailyAdsSpend;
use App\Models\FinDailyReportConfig;
use App\Services\GoogleAdsSyncService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class GoogleAdsSyncServiceTest extends TestCase
{
    use RefreshDatabase;

    public function test_sync_range_stores_google_cost_micros_by_day_and_account(): void
    {
        FinDailyReportConfig::query()->create([
            'google_developer_token' => 'dev-token',
            'google_client_id' => 'client-id',
            'google_client_secret' => 'client-secret',
            'google_refresh_token' => 'refresh-token',
            'google_customer_ids' => '123-456-7890',
        ]);

        Http::fake([
            'www.googleapis.com/oauth2/v3/token' => Http::response([
                'access_token' => 'access-token',
            ], 200),
            'googleads.googleapis.com/*/customers/1234567890/googleAds:searchStream' => Http::response([
                [
                    'results' => [
                        [
                            'segments' => ['date' => '2026-05-01'],
                            'metrics' => ['costMicros' => '123000000'],
                        ],
                    ],
                ],
            ], 200),
        ]);

        $result = app(GoogleAdsSyncService::class)->syncRange('2026-05-01', '2026-05-02');

        $this->assertTrue($result);
        $this->assertSame(123.0, (float) DailyAdsSpend::query()
            ->where('platform', DailyAdsSpend::PLATFORM_GOOGLE)
            ->whereDate('date', '2026-05-01')
            ->where('account_id', 1234567890)
            ->value('amount'));
        $this->assertSame(0.0, (float) DailyAdsSpend::query()
            ->where('platform', DailyAdsSpend::PLATFORM_GOOGLE)
            ->whereDate('date', '2026-05-02')
            ->where('account_id', 1234567890)
            ->value('amount'));
        $this->assertSame(123.0, (float) DailyAdsSpend::query()
            ->where('platform', DailyAdsSpend::PLATFORM_GOOGLE)
            ->whereDate('date', '2026-05-01')
            ->whereNull('account_id')
            ->value('amount'));
    }

    public function test_sync_range_does_not_overwrite_existing_google_spend_when_requests_fail(): void
    {
        FinDailyReportConfig::query()->create([
            'google_developer_token' => 'dev-token',
            'google_client_id' => 'client-id',
            'google_client_secret' => 'client-secret',
            'google_refresh_token' => 'refresh-token',
            'google_customer_ids' => '1234567890',
        ]);

        DailyAdsSpend::query()->create([
            'platform' => DailyAdsSpend::PLATFORM_GOOGLE,
            'date' => '2026-05-01',
            'amount' => 500,
        ]);

        Http::fake([
            'www.googleapis.com/oauth2/v3/token' => Http::response([
                'access_token' => 'access-token',
            ], 200),
            'googleads.googleapis.com/*' => Http::response([
                'error' => ['message' => 'upstream failure'],
            ], 500),
        ]);

        $result = app(GoogleAdsSyncService::class)->syncRange('2026-05-01', '2026-05-01');

        $this->assertFalse($result);
        $this->assertSame(500.0, (float) DailyAdsSpend::query()
            ->where('platform', DailyAdsSpend::PLATFORM_GOOGLE)
            ->whereDate('date', '2026-05-01')
            ->whereNull('account_id')
            ->value('amount'));
    }
}
