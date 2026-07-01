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
        $this->assertSame(1000.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-01')->whereNull('account_id')->value('amount'));
        $this->assertSame(2000.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-02')->whereNull('account_id')->value('amount'));
    }

    public function test_sync_range_stores_per_account_rows_and_refreshes_legacy_daily_totals(): void
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
        $this->assertSame(1500.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-01')->where('account_id', 123)->value('amount'));
        $this->assertSame(0.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-02')->where('account_id', 123)->value('amount'));
        $this->assertSame(1500.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-01')->whereNull('account_id')->value('amount'));
        $this->assertSame(0.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-02')->whereNull('account_id')->value('amount'));
    }

    public function test_sync_range_respects_configured_account_tracking_dates(): void
    {
        FinDailyReportConfig::query()->create([
            'fb_tokens_configs' => [
                [
                    'token' => 'token-1',
                    'account_ids' => 'act_123, act_456',
                    'account_tracking' => [
                        ['account_id' => 'act_123', 'start_date' => '2026-04-02', 'end_date' => '2026-04-03'],
                        ['account_id' => 'act_456', 'end_date' => '2026-04-01'],
                    ],
                ],
            ],
        ]);

        $requestedRanges = [];

        Http::fake(function ($request) use (&$requestedRanges) {
            $path = parse_url($request->url(), PHP_URL_PATH) ?: '';
            $query = $request->data();
            if (!isset($query['time_range'])) {
                parse_str(parse_url($request->url(), PHP_URL_QUERY) ?: '', $query);
            }
            $range = json_decode($query['time_range'] ?? '{}', true);

            if (str_contains($path, '/act_123/insights')) {
                $requestedRanges['act_123'][] = ($range['since'] ?? '') . ':' . ($range['until'] ?? '');

                return Http::response([
                    'data' => [
                        ['date_start' => '2026-04-02', 'spend' => '200'],
                        ['date_start' => '2026-04-03', 'spend' => '300'],
                    ],
                ], 200);
            }

            if (str_contains($path, '/act_456/insights')) {
                $requestedRanges['act_456'][] = ($range['since'] ?? '') . ':' . ($range['until'] ?? '');

                return Http::response([
                    'data' => [
                        ['date_start' => '2026-04-01', 'spend' => '100'],
                    ],
                ], 200);
            }

            return Http::response(['data' => []], 200);
        });

        $result = app(FacebookAdsSyncService::class)->syncRange('2026-04-01', '2026-04-03');

        $this->assertTrue($result);
        $this->assertSame(['2026-04-02:2026-04-03'], $requestedRanges['act_123']);
        $this->assertSame(['2026-04-01:2026-04-01'], $requestedRanges['act_456']);
        $this->assertFalse(DailyAdsSpend::query()->whereDate('date', '2026-04-01')->where('account_id', 123)->exists());
        $this->assertSame(200.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-02')->where('account_id', 123)->value('amount'));
        $this->assertSame(300.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-03')->where('account_id', 123)->value('amount'));
        $this->assertSame(100.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-01')->where('account_id', 456)->value('amount'));
        $this->assertFalse(DailyAdsSpend::query()->whereDate('date', '2026-04-02')->where('account_id', 456)->exists());
        $this->assertSame(100.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-01')->whereNull('account_id')->value('amount'));
        $this->assertSame(200.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-02')->whereNull('account_id')->value('amount'));
        $this->assertSame(300.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-04-03')->whereNull('account_id')->value('amount'));
    }

    public function test_sync_range_reads_paginated_insights_before_writing_zeroes(): void
    {
        FinDailyReportConfig::query()->create([
            'fb_access_token' => 'token-1',
            'fb_ad_account_ids' => 'act_123',
        ]);

        Http::fake([
            'graph.facebook.com/*' => Http::sequence()
                ->push([
                    'data' => [
                        [
                            'date_start' => '2026-05-01',
                            'spend' => '100',
                        ],
                    ],
                    'paging' => [
                        'next' => 'https://graph.facebook.com/v20.0/act_123/insights?after=page-2',
                    ],
                ], 200)
                ->push([
                    'data' => [
                        [
                            'date_start' => '2026-05-30',
                            'spend' => '768574',
                        ],
                    ],
                ], 200),
        ]);

        $result = app(FacebookAdsSyncService::class)->syncRange('2026-05-01', '2026-05-31');

        $this->assertTrue($result);
        $this->assertSame(768574.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-05-30')->where('account_id', 123)->value('amount'));
        $this->assertSame(768574.0, (float) DailyAdsSpend::query()->whereDate('date', '2026-05-30')->whereNull('account_id')->value('amount'));
    }
}
