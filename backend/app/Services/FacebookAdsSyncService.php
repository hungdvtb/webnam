<?php

namespace App\Services;

use App\Models\DailyAdsSpend;
use App\Models\FinDailyReportConfig;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class FacebookAdsSyncService
{
    private function normalizeDateKey(mixed $value): ?string
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }

        $dateString = trim((string) $value);

        if ($dateString === '') {
            return null;
        }

        try {
            return \Carbon\Carbon::parse($dateString)->format('Y-m-d');
        } catch (\Throwable) {
            return null;
        }
    }

    public function syncRange(string $startDate, string $endDate)
    {
        $config = FinDailyReportConfig::first();

        if (!$config) {
            Log::warning("Facebook Ads Sync: Missing configuration.");
            return false;
        }

        $tokenConfigs = [];
        if (!empty($config->fb_tokens_configs) && is_array($config->fb_tokens_configs)) {
            $tokenConfigs = $config->fb_tokens_configs;
        } else if ($config->fb_access_token && $config->fb_ad_account_ids) {
            $tokenConfigs = [
                [
                    'token' => $config->fb_access_token,
                    'account_ids' => $config->fb_ad_account_ids
                ]
            ];
        }

        if (empty($tokenConfigs)) {
            Log::warning("Facebook Ads Sync: No tokens/accounts configured.");
            return false;
        }

        $today = date('Y-m-d');

        // Find which dates we actually need to fetch
        $period = \Carbon\CarbonPeriod::create($startDate, $endDate);
        $allDates = [];
        foreach ($period as $date) {
            $allDates[] = $date->format('Y-m-d');
        }

        $existingSpendByDate = DailyAdsSpend::query()
            ->whereIn('date', $allDates)
            ->pluck('amount', 'date')
            ->mapWithKeys(function ($amount, $date) {
                $normalizedDate = $this->normalizeDateKey($date);

                return $normalizedDate ? [$normalizedDate => (float) $amount] : [];
            })
            ->toArray();

        $datesToFetch = [];
        foreach ($allDates as $d) {
            // Fetch if not exists in DB OR if it's today
            if (!array_key_exists($d, $existingSpendByDate) || $d === $today) {
                $datesToFetch[] = $d;
            }
        }

        if (empty($datesToFetch)) {
            // No new fetch needed, return existing aggregate
            return true;
        }

        $minFetchDate = min($datesToFetch);
        $maxFetchDate = max($datesToFetch);

        // Initialize an array to hold the sum per day
        $dailyTotals = [];
        foreach ($datesToFetch as $d) {
            $dailyTotals[$d] = 0;
        }

        $successfulRequestCount = 0;
        $returnedDates = [];

        foreach ($tokenConfigs as $tokenGroup) {
            $token = trim($tokenGroup['token'] ?? '');
            $accountIdsStr = trim($tokenGroup['account_ids'] ?? '');
            if (!$token || !$accountIdsStr) continue;

            $adAccountIds = explode(',', $accountIdsStr);

            foreach ($adAccountIds as $adAccountId) {
                $adAccountId = trim($adAccountId);
                if (!$adAccountId) continue;

                if (!str_starts_with($adAccountId, 'act_')) {
                    $adAccountId = 'act_' . $adAccountId;
                }

                try {
                    $response = Http::withoutVerifying()->get("https://graph.facebook.com/v20.0/{$adAccountId}/insights", [
                        'access_token' => $token,
                        'time_range' => json_encode(['since' => $minFetchDate, 'until' => $maxFetchDate]),
                        'time_increment' => 1,
                        'fields' => 'spend',
                    ]);

                    if ($response->successful()) {
                        $successfulRequestCount++;
                        $data = $response->json('data');
                        if (!empty($data)) {
                            foreach ($data as $dayData) {
                                $dateStr = $dayData['date_start'] ?? null;
                                if ($dateStr && isset($dailyTotals[$dateStr])) {
                                    $returnedDates[$dateStr] = true;
                                    $dailyTotals[$dateStr] += floatval($dayData['spend'] ?? 0);
                                }
                            }
                        }
                    } else {
                        Log::error("Facebook Ads Sync Error for {$adAccountId}: " . $response->body());
                    }
                } catch (\Exception $e) {
                    Log::error("Facebook Ads Sync Exception: " . $e->getMessage());
                }
            }
        }

        if ($successfulRequestCount === 0) {
            Log::warning('Facebook Ads Sync: No successful responses received; existing spend data was left unchanged.');

            return false;
        }

        // Save fetched data to DB
        foreach ($dailyTotals as $date => $totalSpend) {
            $hasExistingRow = array_key_exists($date, $existingSpendByDate);
            $dateWasReturned = array_key_exists($date, $returnedDates);

            if (!$dateWasReturned && $hasExistingRow) {
                continue;
            }

            DailyAdsSpend::updateOrCreate(
                ['date' => $date],
                ['amount' => $totalSpend]
            );
        }

        return true;
    }
}
