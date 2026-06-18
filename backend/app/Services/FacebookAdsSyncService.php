<?php

namespace App\Services;

use App\Models\DailyAdsSpend;
use App\Models\FinDailyReportConfig;
use App\Models\AdAccountProfitCenter;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class FacebookAdsSyncService
{
    private const INSIGHTS_PAGE_LIMIT = 500;

    private const MAX_INSIGHTS_PAGES = 50;

    private function configuredAdAccounts(FinDailyReportConfig $config): array
    {
        $tokenConfigs = [];
        if (!empty($config->fb_tokens_configs) && is_array($config->fb_tokens_configs)) {
            $tokenConfigs = $config->fb_tokens_configs;
        } elseif ($config->fb_access_token && $config->fb_ad_account_ids) {
            $tokenConfigs = [
                [
                    'token' => $config->fb_access_token,
                    'account_ids' => $config->fb_ad_account_ids,
                ],
            ];
        }

        $accounts = [];
        $seen = [];
        foreach ($tokenConfigs as $tokenGroup) {
            $token = trim((string) ($tokenGroup['token'] ?? ''));
            $accountIdsStr = trim((string) ($tokenGroup['account_ids'] ?? ''));
            if ($token === '' || $accountIdsStr === '') {
                continue;
            }

            foreach (explode(',', $accountIdsStr) as $rawAccountId) {
                $graphAccountId = $this->normalizeGraphAccountId($rawAccountId);
                $storageAccountId = $this->normalizeStorageAccountId($graphAccountId);
                if ($graphAccountId === null || $storageAccountId === null) {
                    continue;
                }

                $dedupeKey = $token . '|' . $storageAccountId;
                if (isset($seen[$dedupeKey])) {
                    continue;
                }

                $seen[$dedupeKey] = true;
                $accounts[] = [
                    'token' => $token,
                    'graph_account_id' => $graphAccountId,
                    'storage_account_id' => $storageAccountId,
                ];
            }
        }

        return $accounts;
    }

    private function normalizeGraphAccountId(mixed $value): ?string
    {
        $accountId = trim((string) $value);
        if ($accountId === '') {
            return null;
        }

        return str_starts_with($accountId, 'act_') ? $accountId : 'act_' . $accountId;
    }

    private function normalizeStorageAccountId(mixed $value): ?int
    {
        $digits = preg_replace('/\D+/', '', (string) $value);

        return $digits === '' ? null : (int) $digits;
    }

    public function configuredStorageAccountIds(?FinDailyReportConfig $config = null): array
    {
        $config ??= FinDailyReportConfig::first();

        if (!$config) {
            return [];
        }

        return collect($this->configuredAdAccounts($config))
            ->pluck('storage_account_id')
            ->unique()
            ->values()
            ->all();
    }

    public function fetchDailyInsights(string $adAccountId, string $token, string $startDate, string $endDate, string $fields = 'spend'): array
    {
        $endpoint = "https://graph.facebook.com/v20.0/{$adAccountId}/insights";
        $params = [
            'access_token' => $token,
            'time_range' => json_encode(['since' => $startDate, 'until' => $endDate]),
            'time_increment' => 1,
            'fields' => $fields,
            'limit' => self::INSIGHTS_PAGE_LIMIT,
        ];

        $data = [];
        $nextUrl = null;

        for ($page = 0; $page < self::MAX_INSIGHTS_PAGES; $page++) {
            $response = $nextUrl
                ? Http::withoutVerifying()->get($nextUrl)
                : Http::withoutVerifying()->get($endpoint, $params);

            if (!$response->successful()) {
                return [
                    'successful' => false,
                    'data' => $data,
                    'error' => $response->body(),
                ];
            }

            $pageData = $response->json('data') ?? [];
            if (is_array($pageData) && $pageData !== []) {
                $data = array_merge($data, $pageData);
            }

            $nextUrl = $response->json('paging.next');
            if (!$nextUrl) {
                return [
                    'successful' => true,
                    'data' => $data,
                    'error' => null,
                ];
            }
        }

        return [
            'successful' => false,
            'data' => $data,
            'error' => 'Facebook insights pagination exceeded the configured page limit.',
        ];
    }

    public function syncRange(string $startDate, string $endDate)
    {
        $config = FinDailyReportConfig::first();

        if (!$config) {
            Log::warning("Facebook Ads Sync: Missing configuration.");
            return false;
        }

        $configuredAccounts = $this->configuredAdAccounts($config);

        if (empty($configuredAccounts)) {
            Log::warning("Facebook Ads Sync: No tokens/accounts configured.");
            return false;
        }

        // Find which dates we actually need to fetch
        $period = \Carbon\CarbonPeriod::create($startDate, $endDate);
        $allDates = [];
        foreach ($period as $date) {
            $allDates[] = $date->format('Y-m-d');
        }

        $datesToFetch = [];
        foreach ($allDates as $d) {
            // Facebook may adjust spend after the first pull. Re-fetch the requested
            // range so the report and split modal use the same current account set.
            $datesToFetch[] = $d;
        }

        if (empty($datesToFetch)) {
            // No new fetch needed, return existing aggregate
            return true;
        }

        $minFetchDate = min($datesToFetch);
        $maxFetchDate = max($datesToFetch);

        $successfulRequestCount = 0;

        foreach ($configuredAccounts as $accountConfig) {
            $token = $accountConfig['token'];
            $adAccountId = $accountConfig['graph_account_id'];
            $storageAccountId = $accountConfig['storage_account_id'];

            try {
                $response = $this->fetchDailyInsights($adAccountId, $token, $minFetchDate, $maxFetchDate);

                if ($response['successful']) {
                    $successfulRequestCount++;
                    $dailyAmounts = array_fill_keys($datesToFetch, 0.0);
                    $data = $response['data'] ?? [];
                    foreach ($data as $dayData) {
                        $dateStr = $dayData['date_start'] ?? null;
                        if ($dateStr && isset($dailyAmounts[$dateStr])) {
                            $dailyAmounts[$dateStr] += (float) ($dayData['spend'] ?? 0);
                        }
                    }

                    foreach ($dailyAmounts as $date => $amount) {
                        $profitCenterId = AdAccountProfitCenter::resolveProfitCenterId(
                            DailyAdsSpend::PLATFORM_FACEBOOK,
                            $storageAccountId
                        );

                        DailyAdsSpend::updateOrCreate(
                            [
                                'platform' => DailyAdsSpend::PLATFORM_FACEBOOK,
                                'date' => $date,
                                'account_id' => $storageAccountId,
                            ],
                            [
                                'amount' => $amount,
                                'profit_center_id' => $profitCenterId,
                            ]
                        );
                    }
                } else {
                    Log::error("Facebook Ads Sync Error for {$adAccountId}: " . $this->sanitizeForLog($response['error'] ?? '', [$token]));
                }
            } catch (\Exception $e) {
                Log::error("Facebook Ads Sync Exception: " . $this->sanitizeForLog($e->getMessage(), [$token]));
            }
        }

        if ($successfulRequestCount === 0) {
            Log::warning('Facebook Ads Sync: No successful responses received; existing spend data was left unchanged.');

            return false;
        }

        $configuredAccountIds = collect($configuredAccounts)->pluck('storage_account_id')->unique()->values()->all();
        foreach ($datesToFetch as $date) {
            $perAccountTotal = DailyAdsSpend::query()
                ->where('platform', DailyAdsSpend::PLATFORM_FACEBOOK)
                ->whereDate('date', $date)
                ->whereIn('account_id', $configuredAccountIds)
                ->sum('amount');

            DailyAdsSpend::updateOrCreate(
                [
                    'platform' => DailyAdsSpend::PLATFORM_FACEBOOK,
                    'date' => $date,
                    'account_id' => null,
                ],
                ['amount' => (float) $perAccountTotal]
            );
        }

        return true;
    }

    public function sync(string $date)
    {
        $this->syncRange($date, $date);

        return DailyAdsSpend::query()
            ->where('platform', DailyAdsSpend::PLATFORM_FACEBOOK)
            ->whereDate('date', $date)
            ->whereNull('account_id')
            ->value('amount');
    }

    private function sanitizeForLog(mixed $value, array $tokens = []): string
    {
        $message = (string) $value;

        foreach ($tokens as $token) {
            $token = trim((string) $token);
            if ($token !== '') {
                $message = str_replace($token, '[redacted]', $message);
            }
        }

        return preg_replace('/(access_token=)[^&\s"]+/i', '$1[redacted]', $message) ?? $message;
    }
}
