<?php

namespace App\Services;

use App\Models\DailyAdsSpend;
use App\Models\FinDailyReportConfig;
use App\Models\AdAccountProfitCenter;
use Carbon\CarbonPeriod;
use Illuminate\Http\Client\Response;
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

    private function oauthFailureContext(Response $response): array
    {
        return [
            'status' => $response->status(),
            'oauth_error' => (string) $response->json('error', ''),
            'oauth_error_description' => (string) $response->json('error_description', ''),
        ];
    }

    private function oauthFailureMessage(Response $response): string
    {
        $context = $this->oauthFailureContext($response);
        $error = strtolower($context['oauth_error']);
        $description = strtolower($context['oauth_error_description']);

        if ($error === 'invalid_client' && str_contains($description, 'client secret')) {
            return 'Google OAuth bao loi Client Secret khong hop le. Hay kiem tra OAuth Client Secret dung voi OAuth Client ID dang nhap.';
        }

        if ($error === 'invalid_client') {
            return 'Google OAuth bao loi OAuth Client ID hoac Client Secret khong hop le.';
        }

        if ($error === 'invalid_grant') {
            return 'Google OAuth bao loi Refresh Token khong hop le, da bi thu hoi, hoac khong duoc tao tu OAuth Client ID nay.';
        }

        if ($error === 'unauthorized_client') {
            return 'Google OAuth bao loi OAuth Client chua duoc phep lay access token.';
        }

        $details = trim($context['oauth_error'] . ($context['oauth_error_description'] !== '' ? ': ' . $context['oauth_error_description'] : ''));

        return $details !== ''
            ? 'Google OAuth tra loi ' . $details
            : 'Khong lay duoc access token tu Google OAuth (HTTP ' . $context['status'] . ').';
    }

    private function accessToken(array $credentials, bool $throwOnFailure = false): ?string
    {
        if (!$this->hasRequiredCredentials($credentials)) {
            if ($throwOnFailure) {
                throw new RuntimeException('Chua cau hinh du thong tin Google Ads.');
            }

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
            $message = $this->oauthFailureMessage($response);
            Log::error('Google Ads Sync: OAuth token refresh failed.', $this->oauthFailureContext($response) + [
                'message' => $message,
            ]);

            if ($throwOnFailure) {
                throw new RuntimeException($message);
            }

            return null;
        }

        $accessToken = trim((string) $response->json('access_token'));
        if ($accessToken === '') {
            $message = 'Google OAuth khong tra access token.';
            Log::error('Google Ads Sync: OAuth token response did not include an access token.', [
                'status' => $response->status(),
            ]);

            if ($throwOnFailure) {
                throw new RuntimeException($message);
            }

            return null;
        }

        return $accessToken;
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

    private function firstGoogleAdsErrorCode(array $errorCode): string
    {
        foreach ($errorCode as $value) {
            if (trim((string) $value) !== '') {
                return (string) $value;
            }
        }

        return '';
    }

    private function googleAdsFailureMessage(Response $response, string $customerId): string
    {
        $payload = $response->json();
        $items = is_array($payload) && array_is_list($payload) ? $payload : [$payload];
        $messages = [];

        foreach ($items as $item) {
            $status = (string) data_get($item, 'error.status', '');
            $topMessage = (string) data_get($item, 'error.message', $response->body());

            foreach ((array) data_get($item, 'error.details', []) as $detail) {
                foreach ((array) data_get($detail, 'errors', []) as $error) {
                    $code = $this->firstGoogleAdsErrorCode((array) data_get($error, 'errorCode', []));
                    $message = (string) data_get($error, 'message', $topMessage);

                    $messages[] = match ($code) {
                        'REQUESTED_METRICS_FOR_MANAGER' => "Customer ID {$customerId} la tai khoan MCC/manager nen khong the lay chi phi. Hay bo ID nay khoi Customer ID dang chon va chi de no o Login Customer ID.",
                        'CUSTOMER_NOT_ENABLED' => "Customer ID {$customerId} chua kich hoat hoac da bi vo hieu hoa. Hay chon tai khoan Google Ads con dang active.",
                        'USER_PERMISSION_DENIED' => "Tai khoan Google dang ket noi khong co quyen truy cap Customer ID {$customerId}.",
                        default => trim("Customer ID {$customerId}: {$code} {$message}"),
                    };
                }
            }

            if ($messages === []) {
                $messages[] = trim("Customer ID {$customerId}: {$status} {$topMessage}");
            }
        }

        return implode(' | ', array_values(array_unique(array_filter($messages))));
    }

    public function syncRange(string $startDate, string $endDate, bool $throwOnFailure = false)
    {
        $config = FinDailyReportConfig::first();

        if (!$config) {
            Log::warning('Google Ads Sync: Missing configuration.');
            if ($throwOnFailure) {
                throw new RuntimeException('Chua cau hinh Google Ads.');
            }

            return false;
        }

        $credentials = $this->credentials($config);
        if (!$this->hasRequiredCredentials($credentials)) {
            if ($this->hasAnyCredentialValue($credentials) || trim((string) $config->google_customer_ids) !== '') {
                Log::warning('Google Ads Sync: Missing OAuth/developer token configuration.');
            }

            if ($throwOnFailure) {
                throw new RuntimeException('Chua cau hinh du Developer Token, OAuth Client ID, OAuth Client Secret va Refresh Token.');
            }

            return false;
        }

        $customerIds = $this->configuredCustomerIds($config);
        if ($customerIds === []) {
            Log::warning('Google Ads Sync: No customer IDs configured.');
            if ($throwOnFailure) {
                throw new RuntimeException('Chua chon Customer ID Google Ads de dong bo.');
            }

            return false;
        }

        $accessToken = $this->accessToken($credentials);
        if (!$accessToken) {
            Log::warning('Google Ads Sync: Could not obtain access token.');
            if ($throwOnFailure) {
                throw new RuntimeException('Khong lay duoc access token tu Google.');
            }

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
        $failureMessages = [];

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
                        $profitCenterId = AdAccountProfitCenter::resolveProfitCenterId(
                            DailyAdsSpend::PLATFORM_GOOGLE,
                            $storageAccountId,
                            $date
                        );

                        DailyAdsSpend::updateOrCreate(
                            [
                                'platform' => DailyAdsSpend::PLATFORM_GOOGLE,
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
                    $failureMessage = $this->googleAdsFailureMessage($response, $customerId);
                    $failureMessages[] = $failureMessage;
                    Log::error("Google Ads Sync Error for {$customerId}: " . $response->body(), [
                        'message' => $failureMessage,
                    ]);
                }
            } catch (\Exception $exception) {
                $failureMessages[] = "Customer ID {$customerId}: " . $exception->getMessage();
                Log::error('Google Ads Sync Exception: ' . $exception->getMessage());
            }
        }

        if ($successfulRequestCount === 0) {
            Log::warning('Google Ads Sync: No successful responses received; existing spend data was left unchanged.');

            if ($throwOnFailure) {
                $message = implode(' ', array_values(array_unique(array_filter($failureMessages))));
                throw new RuntimeException($message !== '' ? $message : 'Khong dong bo duoc du lieu Google Ads.');
            }

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

        $accessToken = $this->accessToken($credentials, true);
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
            'manager' => false,
        ];

        try {
            $response = $this->searchStream(
                $customerId,
                'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1',
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
                'manager' => (bool) data_get($row, 'customer.manager', false),
            ];
        } catch (\Exception) {
            return $fallback;
        }
    }
}
