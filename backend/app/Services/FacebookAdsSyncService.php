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

    public function configuredAdAccounts(?FinDailyReportConfig $config = null): array
    {
        $config ??= FinDailyReportConfig::first();

        if (!$config) {
            return [];
        }

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

            $trackingByStorageId = $this->accountTrackingByStorageId($tokenGroup['account_tracking'] ?? []);
            $groupStartDate = $this->normalizeTrackingDate($tokenGroup['start_date'] ?? null);
            $groupEndDate = $this->normalizeTrackingDate($tokenGroup['end_date'] ?? null);

            foreach (preg_split('/[,\s]+/', $accountIdsStr) ?: [] as $rawAccountId) {
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
                $accountTracking = $trackingByStorageId[$storageAccountId] ?? [];
                $accounts[] = [
                    'token' => $token,
                    'graph_account_id' => $graphAccountId,
                    'storage_account_id' => $storageAccountId,
                    'start_date' => $accountTracking['start_date'] ?? $groupStartDate,
                    'end_date' => $accountTracking['end_date'] ?? $groupEndDate,
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

    private function normalizeTrackingDate(mixed $value): ?string
    {
        $date = trim((string) $value);
        if ($date === '') {
            return null;
        }

        try {
            return \Carbon\Carbon::parse($date)->toDateString();
        } catch (\Throwable) {
            return null;
        }
    }

    private function accountTrackingByStorageId(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $tracking = [];
        foreach ($value as $row) {
            if (!is_array($row)) {
                continue;
            }

            $storageAccountId = $this->normalizeStorageAccountId($row['account_id'] ?? $row['id'] ?? $row['accountId'] ?? null);
            if ($storageAccountId === null) {
                continue;
            }

            $tracking[$storageAccountId] = [
                'start_date' => $this->normalizeTrackingDate($row['start_date'] ?? $row['startDate'] ?? $row['date_from'] ?? $row['dateFrom'] ?? null),
                'end_date' => $this->normalizeTrackingDate($row['end_date'] ?? $row['endDate'] ?? $row['date_to'] ?? $row['dateTo'] ?? null),
            ];
        }

        return $tracking;
    }

    private function accountActiveOnDate(array $accountConfig, string $date): bool
    {
        $startDate = $accountConfig['start_date'] ?? null;
        $endDate = $accountConfig['end_date'] ?? null;

        return (!$startDate || $date >= $startDate)
            && (!$endDate || $date <= $endDate);
    }

    private function activeDateRangeForAccount(array $accountConfig, string $startDate, string $endDate): ?array
    {
        $activeStartDate = $accountConfig['start_date'] && $accountConfig['start_date'] > $startDate
            ? $accountConfig['start_date']
            : $startDate;
        $activeEndDate = $accountConfig['end_date'] && $accountConfig['end_date'] < $endDate
            ? $accountConfig['end_date']
            : $endDate;

        if ($activeStartDate > $activeEndDate) {
            return null;
        }

        return [$activeStartDate, $activeEndDate];
    }

    private function datesBetween(string $startDate, string $endDate): array
    {
        $period = \Carbon\CarbonPeriod::create($startDate, $endDate);
        $dates = [];
        foreach ($period as $date) {
            $dates[] = $date->format('Y-m-d');
        }

        return $dates;
    }

    public function configuredStorageAccountPeriods(?FinDailyReportConfig $config = null): array
    {
        $periods = [];
        $seen = [];

        foreach ($this->configuredAdAccounts($config) as $accountConfig) {
            $storageAccountId = (int) ($accountConfig['storage_account_id'] ?? 0);
            if ($storageAccountId <= 0) {
                continue;
            }

            $key = $storageAccountId . '|' . ($accountConfig['start_date'] ?? '') . '|' . ($accountConfig['end_date'] ?? '');
            if (isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;
            $periods[] = [
                'account_id' => $storageAccountId,
                'start_date' => $accountConfig['start_date'] ?? null,
                'end_date' => $accountConfig['end_date'] ?? null,
            ];
        }

        return $periods;
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

        $allDates = $this->datesBetween($startDate, $endDate);
        if (empty($allDates)) {
            return true;
        }

        $attemptedRequestCount = 0;
        $successfulRequestCount = 0;

        foreach ($configuredAccounts as $accountConfig) {
            $activeDateRange = $this->activeDateRangeForAccount($accountConfig, $startDate, $endDate);
            if ($activeDateRange === null) {
                continue;
            }

            [$minFetchDate, $maxFetchDate] = $activeDateRange;
            $datesToFetch = $this->datesBetween($minFetchDate, $maxFetchDate);
            if (empty($datesToFetch)) {
                continue;
            }

            $token = $accountConfig['token'];
            $adAccountId = $accountConfig['graph_account_id'];
            $storageAccountId = $accountConfig['storage_account_id'];

            try {
                $attemptedRequestCount++;
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
                            $storageAccountId,
                            $date
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

        if ($attemptedRequestCount > 0 && $successfulRequestCount === 0) {
            Log::warning('Facebook Ads Sync: No successful responses received; existing spend data was left unchanged.');

            return false;
        }

        $this->refreshLegacyDailyTotals($allDates, $configuredAccounts);

        return true;
    }

    private function refreshLegacyDailyTotals(array $dates, array $configuredAccounts): void
    {
        foreach ($dates as $date) {
            $activeAccountIds = collect($configuredAccounts)
                ->filter(fn (array $accountConfig) => $this->accountActiveOnDate($accountConfig, $date))
                ->pluck('storage_account_id')
                ->unique()
                ->values()
                ->all();

            $perAccountTotal = $activeAccountIds === []
                ? 0
                : DailyAdsSpend::query()
                    ->where('platform', DailyAdsSpend::PLATFORM_FACEBOOK)
                    ->whereDate('date', $date)
                    ->whereIn('account_id', $activeAccountIds)
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
