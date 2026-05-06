<?php

namespace App\Services;

use App\Models\DailyAdsSpend;
use App\Models\FinDailyReportConfig;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class FacebookAdsSyncService
{
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
                $response = Http::withoutVerifying()->get("https://graph.facebook.com/v20.0/{$adAccountId}/insights", [
                    'access_token' => $token,
                    'time_range' => json_encode(['since' => $minFetchDate, 'until' => $maxFetchDate]),
                    'time_increment' => 1,
                    'fields' => 'spend',
                ]);

                if ($response->successful()) {
                    $successfulRequestCount++;
                    $dailyAmounts = array_fill_keys($datesToFetch, 0.0);
                    $data = $response->json('data') ?? [];
                    foreach ($data as $dayData) {
                        $dateStr = $dayData['date_start'] ?? null;
                        if ($dateStr && isset($dailyAmounts[$dateStr])) {
                            $dailyAmounts[$dateStr] += (float) ($dayData['spend'] ?? 0);
                        }
                    }

                    foreach ($dailyAmounts as $date => $amount) {
                        DailyAdsSpend::updateOrCreate(
                            [
                                'date' => $date,
                                'account_id' => $storageAccountId,
                            ],
                            ['amount' => $amount]
                        );
                    }
                } else {
                    Log::error("Facebook Ads Sync Error for {$adAccountId}: " . $response->body());
                }
            } catch (\Exception $e) {
                Log::error("Facebook Ads Sync Exception: " . $e->getMessage());
            }
        }

        if ($successfulRequestCount === 0) {
            Log::warning('Facebook Ads Sync: No successful responses received; existing spend data was left unchanged.');

            return false;
        }

        $configuredAccountIds = collect($configuredAccounts)->pluck('storage_account_id')->unique()->values()->all();
        foreach ($datesToFetch as $date) {
            $perAccountTotal = DailyAdsSpend::query()
                ->whereDate('date', $date)
                ->whereIn('account_id', $configuredAccountIds)
                ->sum('amount');

            DailyAdsSpend::updateOrCreate(
                ['date' => $date, 'account_id' => null],
                ['amount' => (float) $perAccountTotal]
            );
        }

        return true;
    }

    public function sync(string $date)
    {
        $this->syncRange($date, $date);

        return DailyAdsSpend::query()
            ->whereDate('date', $date)
            ->whereNull('account_id')
            ->value('amount');
    }
}
