<?php

namespace App\Services;

use App\Models\DailyAdsSpend;
use App\Models\FinDailyReportConfig;
use Carbon\CarbonPeriod;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class GoogleAdsSyncService
{
    private const API_VERSION = 'v24';

    private function normalizeCustomerId(mixed $value): ?string
    {
        $digits = preg_replace('/\D+/', '', (string) $value);

        return $digits === '' ? null : $digits;
    }

    private function normalizeStorageAccountId(mixed $value): ?int
    {
        $digits = $this->normalizeCustomerId($value);

        return $digits === null ? null : (int) $digits;
    }

    private function configuredCustomerIds(FinDailyReportConfig $config): array
    {
        $customerIds = [];
        $seen = [];

        foreach (explode(',', (string) $config->google_customer_ids) as $rawCustomerId) {
            $customerId = $this->normalizeCustomerId($rawCustomerId);
            if ($customerId === null || isset($seen[$customerId])) {
                continue;
            }

            $seen[$customerId] = true;
            $customerIds[] = $customerId;
        }

        return $customerIds;
    }

    public function configuredStorageAccountIds(?FinDailyReportConfig $config = null): array
    {
        $config ??= FinDailyReportConfig::first();

        if (!$config) {
            return [];
        }

        return collect($this->configuredCustomerIds($config))
            ->map(fn (string $customerId) => $this->normalizeStorageAccountId($customerId))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function credentials(?FinDailyReportConfig $config = null, array $overrides = []): array
    {
        $config ??= FinDailyReportConfig::first();

        return [
            'developer_token' => trim((string) ($overrides['developer_token'] ?? $overrides['google_developer_token'] ?? $config?->google_developer_token ?? '')),
            'client_id' => trim((string) ($overrides['client_id'] ?? $overrides['google_client_id'] ?? $config?->google_client_id ?? '')),
            'client_secret' => trim((string) ($overrides['client_secret'] ?? $overrides['google_client_secret'] ?? $config?->google_client_secret ?? '')),
            'refresh_token' => trim((string) ($overrides['refresh_token'] ?? $overrides['google_refresh_token'] ?? $config?->google_refresh_token ?? '')),
            'login_customer_id' => $this->normalizeCustomerId($overrides['login_customer_id'] ?? $overrides['google_login_customer_id'] ?? $config?->google_login_customer_id ?? ''),
        ];
    }

    private function hasRequiredCredentials(array $credentials): bool
    {
        return $credentials['developer_token'] !== ''
            && $credentials['client_id'] !== ''
            && $credentials['client_secret'] !== ''
            && $credentials['refresh_token'] !== '';
    }

    private function hasAnyCredentialValue(array $credentials): bool
    {
        return collect($credentials)
            ->filter(fn ($value) => trim((string) $value) !== '')
            ->isNotEmpty();
    }

    private function accessToken(array $credentials): ?string
    {
        if (!$this->hasRequiredCredentials($credentials)) {
            return null;
        }

        $response = Http::withoutVerifying()
            ->asForm()
            ->post('https://www.googleapis.com/oauth2/v3/token', [
                'grant_type' => 'refresh_token',
                'client_id' => $credentials['client_id'],
                'client_secret' => $credentials['client_secret'],
                'refresh_token' => $credentials['refresh_token'],
            ]);

        if ($response->failed()) {
            Log::error('Google Ads Sync: OAuth token refresh failed.', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);

            return null;
        }

        return trim((string) $response->json('access_token')) ?: null;
    }

    private function headers(array $credentials, string $accessToken): array
    {
        $headers = [
            'Authorization' => 'Bearer ' . $accessToken,
            'developer-token' => $credentials['developer_token'],
            'Content-Type' => 'application/json',
        ];

        if (!empty($credentials['login_customer_id'])) {
            $headers['login-customer-id'] = $credentials['login_customer_id'];
        }

        return $headers;
    }

    private function searchStream(string $customerId, string $query, array $credentials, string $accessToken)
    {
        return Http::withoutVerifying()
            ->withHeaders($this->headers($credentials, $accessToken))
            ->post("https://googleads.googleapis.com/" . self::API_VERSION . "/customers/{$customerId}/googleAds:searchStream", [
                'query' => $query,
            ]);
    }

    private function streamResults(mixed $payload): array
    {
        if (!is_array($payload)) {
            return [];
        }

        $batches = array_is_list($payload) ? $payload : [$payload];
        $results = [];

        foreach ($batches as $batch) {
            foreach ((array) ($batch['results'] ?? []) as $row) {
                $results[] = $row;
            }
        }

        return $results;
    }

    public function syncRange(string $startDate, string $endDate)
    {
        $config = FinDailyReportConfig::first();

        if (!$config) {
            Log::warning('Google Ads Sync: Missing configuration.');
            return false;
        }

        $credentials = $this->credentials($config);
        if (!$this->hasRequiredCredentials($credentials)) {
            if ($this->hasAnyCredentialValue($credentials) || trim((string) $config->google_customer_ids) !== '') {
                Log::warning('Google Ads Sync: Missing OAuth/developer token configuration.');
            }

            return false;
        }

        $customerIds = $this->configuredCustomerIds($config);
        if ($customerIds === []) {
            Log::warning('Google Ads Sync: No customer IDs configured.');
            return false;
        }

        $accessToken = $this->accessToken($credentials);
        if (!$accessToken) {
            Log::warning('Google Ads Sync: Could not obtain access token.');
            return false;
        }

        $allDates = [];
        foreach (CarbonPeriod::create($startDate, $endDate) as $date) {
            $allDates[] = $date->format('Y-m-d');
        }

        if ($allDates === []) {
            return true;
        }

        $minFetchDate = min($allDates);
        $maxFetchDate = max($allDates);
        $successfulRequestCount = 0;

        foreach ($customerIds as $customerId) {
            $storageAccountId = $this->normalizeStorageAccountId($customerId);
            if (!$storageAccountId) {
                continue;
            }

            $query = sprintf(
                "SELECT segments.date, metrics.cost_micros FROM customer WHERE segments.date BETWEEN '%s' AND '%s' ORDER BY segments.date",
                $minFetchDate,
                $maxFetchDate
            );

            try {
                $response = $this->searchStream($customerId, $query, $credentials, $accessToken);

                if ($response->successful()) {
                    $successfulRequestCount++;
                    $dailyAmounts = array_fill_keys($allDates, 0.0);

                    foreach ($this->streamResults($response->json()) as $row) {
                        $dateStr = data_get($row, 'segments.date');
                        if (!$dateStr || !array_key_exists($dateStr, $dailyAmounts)) {
                            continue;
                        }

                        $costMicros = data_get($row, 'metrics.costMicros', data_get($row, 'metrics.cost_micros', 0));
                        $dailyAmounts[$dateStr] += ((float) $costMicros) / 1000000;
                    }

                    foreach ($dailyAmounts as $date => $amount) {
                        DailyAdsSpend::updateOrCreate(
                            [
                                'platform' => DailyAdsSpend::PLATFORM_GOOGLE,
                                'date' => $date,
                                'account_id' => $storageAccountId,
                            ],
                            ['amount' => $amount]
                        );
                    }
                } else {
                    Log::error("Google Ads Sync Error for {$customerId}: " . $response->body());
                }
            } catch (\Exception $exception) {
                Log::error('Google Ads Sync Exception: ' . $exception->getMessage());
            }
        }

        if ($successfulRequestCount === 0) {
            Log::warning('Google Ads Sync: No successful responses received; existing spend data was left unchanged.');

            return false;
        }

        $configuredAccountIds = $this->configuredStorageAccountIds($config);
        foreach ($allDates as $date) {
            $perAccountTotal = DailyAdsSpend::query()
                ->where('platform', DailyAdsSpend::PLATFORM_GOOGLE)
                ->whereDate('date', $date)
                ->whereIn('account_id', $configuredAccountIds)
                ->sum('amount');

            DailyAdsSpend::updateOrCreate(
                [
                    'platform' => DailyAdsSpend::PLATFORM_GOOGLE,
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
            ->where('platform', DailyAdsSpend::PLATFORM_GOOGLE)
            ->whereDate('date', $date)
            ->whereNull('account_id')
            ->value('amount');
    }

    public function listAccessibleCustomers(array $overrides = []): array
    {
        $credentials = $this->credentials(null, $overrides);
        if (!$this->hasRequiredCredentials($credentials)) {
            throw new RuntimeException('Chua cau hinh du thong tin Google Ads.');
        }

        $accessToken = $this->accessToken($credentials);
        if (!$accessToken) {
            throw new RuntimeException('Khong lay duoc access token tu Google.');
        }

        $response = Http::withoutVerifying()
            ->withHeaders($this->headers($credentials, $accessToken))
            ->get('https://googleads.googleapis.com/' . self::API_VERSION . '/customers:listAccessibleCustomers');

        if ($response->failed()) {
            throw new RuntimeException('Loi tu Google Ads: ' . $response->body());
        }

        $resourceNames = (array) $response->json('resourceNames', []);
        $accounts = [];

        foreach ($resourceNames as $resourceName) {
            $customerId = $this->normalizeCustomerId($resourceName);
            if (!$customerId) {
                continue;
            }

            $accounts[] = $this->customerSummary($customerId, $credentials, $accessToken);
        }

        return $accounts;
    }

    private function customerSummary(string $customerId, array $credentials, string $accessToken): array
    {
        $fallback = [
            'id' => $customerId,
            'name' => $customerId,
            'currency_code' => '',
            'time_zone' => '',
        ];

        try {
            $response = $this->searchStream(
                $customerId,
                'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1',
                $credentials,
                $accessToken
            );

            if ($response->failed()) {
                return $fallback;
            }

            $row = $this->streamResults($response->json())[0] ?? null;
            if (!$row) {
                return $fallback;
            }

            return [
                'id' => (string) data_get($row, 'customer.id', $customerId),
                'name' => (string) (data_get($row, 'customer.descriptiveName') ?: data_get($row, 'customer.descriptive_name') ?: $customerId),
                'currency_code' => (string) (data_get($row, 'customer.currencyCode') ?: data_get($row, 'customer.currency_code') ?: ''),
                'time_zone' => (string) (data_get($row, 'customer.timeZone') ?: data_get($row, 'customer.time_zone') ?: ''),
            ];
        } catch (\Exception) {
            return $fallback;
        }
    }
}
