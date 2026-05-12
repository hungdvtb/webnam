<?php

namespace App\Services\GoogleMerchant;

use App\Models\GoogleMerchantConfig;
use App\Models\SiteSetting;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Throwable;

class GoogleMerchantSettingsService
{
    public const KEY_PREFIX = 'google_merchant_';

    private ?bool $configTableExists = null;

    private const SECRET_KEYS = [
        'service_account_json',
        'oauth_client_secret',
        'oauth_refresh_token',
        'access_token',
    ];

    private const BOOLEAN_KEYS = [
        'enabled',
    ];

    private const STORED_KEYS = [
        'enabled',
        'merchant_id',
        'data_source_id',
        'data_source_name',
        'developer_email',
        'credential_type',
        'service_account_json',
        'oauth_client_id',
        'oauth_client_secret',
        'oauth_refresh_token',
        'access_token',
        'content_language',
        'feed_label',
        'currency',
        'offer_id_field',
        'product_url_base',
        'default_brand',
        'default_google_product_category',
        'inactive_action',
    ];

    private const CONFIG_COLUMNS = [
        'enabled',
        'merchant_id',
        'data_source_id',
        'data_source_name',
        'developer_email',
        'credential_type',
        'service_account_json',
        'oauth_client_id',
        'oauth_client_secret',
        'oauth_refresh_token',
        'access_token',
        'content_language',
        'feed_label',
        'currency',
        'offer_id_field',
        'product_url_base',
        'default_brand',
        'default_google_product_category',
        'inactive_action',
        'service_account_manifest_name',
    ];

    public function settingsFor(?int $accountId = null): array
    {
        $settings = $this->defaults();

        if ($accountId !== null && $accountId > 0) {
            $stored = $this->configSettingsFor($accountId) ?: $this->legacySiteSettingsFor($accountId);
            $settings = array_replace($settings, $stored);
        }

        $settings['merchant_id'] = trim((string) ($settings['merchant_id'] ?? ''));
        $settings['data_source_id'] = trim((string) ($settings['data_source_id'] ?? ''));
        $settings['data_source_name'] = trim((string) ($settings['data_source_name'] ?? ''));
        $settings['service_account_manifest_name'] = trim((string) ($settings['service_account_manifest_name'] ?? ''));
        $settings['credential_type'] = $this->normalizeCredentialType($settings['credential_type'] ?? 'service_account');
        $settings['content_language'] = Str::lower(trim((string) ($settings['content_language'] ?? 'vi'))) ?: 'vi';
        $settings['feed_label'] = Str::upper(trim((string) ($settings['feed_label'] ?? 'VN'))) ?: 'VN';
        $settings['currency'] = Str::upper(trim((string) ($settings['currency'] ?? 'VND'))) ?: 'VND';
        $settings['offer_id_field'] = Str::lower(trim((string) ($settings['offer_id_field'] ?? 'sku'))) === 'id' ? 'id' : 'sku';
        $settings['inactive_action'] = $this->normalizeInactiveAction($settings['inactive_action'] ?? 'out_of_stock');

        return $settings;
    }

    public function publicSettingsFor(?int $accountId = null): array
    {
        $settings = $this->settingsFor($accountId);
        $serviceAccountEmail = $this->serviceAccountEmail($settings['service_account_json'] ?? '');
        $hasServiceAccount = $serviceAccountEmail !== null
            || trim((string) config('google_merchant.service_account_json_path', '')) !== '';
        $hasOauthClientSecret = trim((string) ($settings['oauth_client_secret'] ?? '')) !== '';
        $hasOauthRefreshToken = trim((string) ($settings['oauth_refresh_token'] ?? '')) !== '';
        $hasAccessToken = trim((string) ($settings['access_token'] ?? '')) !== '';
        $hasCredentials = $this->hasCredentials($settings);

        foreach (self::SECRET_KEYS as $key) {
            unset($settings[$key]);
        }

        $settings['has_service_account_json'] = $hasServiceAccount;
        $settings['service_account_email'] = $serviceAccountEmail;
        $settings['has_oauth_client_secret'] = $hasOauthClientSecret;
        $settings['has_oauth_refresh_token'] = $hasOauthRefreshToken;
        $settings['has_access_token'] = $hasAccessToken;
        $settings['has_credentials'] = $hasCredentials;

        return $settings;
    }

    public function update(int $accountId, array $input): array
    {
        if (!$this->configTableExists()) {
            throw new GoogleMerchantProductSyncException('Bảng cấu hình Google Merchant chưa được migrate.');
        }

        DB::transaction(function () use ($accountId, $input) {
            $updates = [];

            if (!empty($input['clear_credentials'])) {
                foreach (self::SECRET_KEYS as $key) {
                    $updates[$key] = null;
                }
                $updates['service_account_manifest_name'] = null;
            }

            foreach (self::STORED_KEYS as $key) {
                if (!array_key_exists($key, $input)) {
                    continue;
                }

                $value = $input[$key];
                if (in_array($key, self::SECRET_KEYS, true) && trim((string) $value) === '') {
                    continue;
                }

                if ($key === 'service_account_json') {
                    $this->assertValidServiceAccountJson((string) $value);
                }

                $updates[$key] = $this->encodeValue($key, $value);
            }

            if (
                array_key_exists('service_account_manifest_name', $input)
                && array_key_exists('service_account_json', $updates)
            ) {
                $updates['service_account_manifest_name'] = trim((string) $input['service_account_manifest_name']);
            }

            if (!empty($updates)) {
                GoogleMerchantConfig::query()->updateOrCreate(
                    ['account_id' => $accountId],
                    $updates
                );
            }
        });

        return $this->publicSettingsFor($accountId);
    }

    public function enabledForAccount(?int $accountId = null): bool
    {
        return (bool) ($this->settingsFor($accountId)['enabled'] ?? false);
    }

    public function hasCredentials(array $settings): bool
    {
        $credentialType = $this->normalizeCredentialType($settings['credential_type'] ?? 'service_account');

        if ($credentialType === 'oauth2') {
            return trim((string) ($settings['oauth_client_id'] ?? '')) !== ''
                && trim((string) ($settings['oauth_client_secret'] ?? '')) !== ''
                && trim((string) ($settings['oauth_refresh_token'] ?? '')) !== '';
        }

        if ($credentialType === 'access_token') {
            return trim((string) ($settings['access_token'] ?? '')) !== '';
        }

        return trim((string) ($settings['service_account_json'] ?? '')) !== ''
            || trim((string) config('google_merchant.service_account_json_path', '')) !== '';
    }

    private function defaults(): array
    {
        return [
            'enabled' => (bool) config('google_merchant.enabled', false),
            'merchant_id' => (string) config('google_merchant.account_id', '5784047046'),
            'data_source_id' => (string) config('google_merchant.data_source_id', ''),
            'data_source_name' => (string) config('google_merchant.data_source_name', ''),
            'developer_email' => (string) config('google_merchant.developer_email', ''),
            'credential_type' => (string) config('google_merchant.credential_type', 'service_account'),
            'service_account_json' => (string) config('google_merchant.service_account_json', ''),
            'oauth_client_id' => (string) config('google_merchant.oauth_client_id', ''),
            'oauth_client_secret' => (string) config('google_merchant.oauth_client_secret', ''),
            'oauth_refresh_token' => (string) config('google_merchant.oauth_refresh_token', ''),
            'access_token' => (string) config('google_merchant.access_token', ''),
            'content_language' => (string) config('google_merchant.content_language', 'vi'),
            'feed_label' => (string) config('google_merchant.feed_label', 'VN'),
            'currency' => (string) config('google_merchant.currency', 'VND'),
            'offer_id_field' => (string) config('google_merchant.offer_id_field', 'sku'),
            'product_url_base' => (string) config('google_merchant.product_url_base', ''),
            'default_brand' => (string) config('google_merchant.default_brand', 'Gom Dai Thanh'),
            'default_google_product_category' => (string) config('google_merchant.default_google_product_category', ''),
            'inactive_action' => (string) config('google_merchant.inactive_action', 'out_of_stock'),
            'service_account_manifest_name' => '',
        ];
    }

    private function configSettingsFor(int $accountId): array
    {
        if (!$this->configTableExists()) {
            return [];
        }

        try {
            $config = GoogleMerchantConfig::query()
                ->where('account_id', $accountId)
                ->first();
        } catch (Throwable $exception) {
            if (!app()->runningUnitTests()) {
                throw $exception;
            }

            return [];
        }

        if (!$config) {
            return [];
        }

        $settings = [];
        foreach (self::CONFIG_COLUMNS as $key) {
            $value = $config->getAttribute($key);
            if ($value === null) {
                continue;
            }

            $settings[$key] = $this->decodeValue($key, $value);
        }

        return $settings;
    }

    private function legacySiteSettingsFor(int $accountId): array
    {
        try {
            $stored = SiteSetting::query()
                ->where('account_id', $accountId)
                ->whereIn('key', array_map(fn (string $key) => $this->storageKey($key), self::STORED_KEYS))
                ->get(['key', 'value'])
                ->keyBy('key');
        } catch (Throwable $exception) {
            if (!app()->runningUnitTests()) {
                throw $exception;
            }

            $stored = collect();
        }

        $settings = [];
        foreach (self::STORED_KEYS as $key) {
            $setting = $stored->get($this->storageKey($key));
            if (!$setting) {
                continue;
            }

            $settings[$key] = $this->decodeValue($key, $setting->value);
        }

        return $settings;
    }

    private function configTableExists(): bool
    {
        if ($this->configTableExists !== null) {
            return $this->configTableExists;
        }

        try {
            return $this->configTableExists = Schema::hasTable('google_merchant_configs');
        } catch (Throwable $exception) {
            if (!app()->runningUnitTests()) {
                throw $exception;
            }

            return $this->configTableExists = false;
        }
    }

    private function storageKey(string $key): string
    {
        return self::KEY_PREFIX . $key;
    }

    private function decodeValue(string $key, mixed $value): mixed
    {
        if (in_array($key, self::SECRET_KEYS, true)) {
            try {
                return Crypt::decryptString((string) $value);
            } catch (Throwable) {
                return '';
            }
        }

        if (in_array($key, self::BOOLEAN_KEYS, true)) {
            return filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
        }

        return $value;
    }

    private function encodeValue(string $key, mixed $value): mixed
    {
        if (in_array($key, self::SECRET_KEYS, true)) {
            return Crypt::encryptString(trim((string) $value));
        }

        if (in_array($key, self::BOOLEAN_KEYS, true)) {
            return filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
        }

        if ($key === 'credential_type') {
            return $this->normalizeCredentialType($value);
        }

        if ($key === 'inactive_action') {
            return $this->normalizeInactiveAction($value);
        }

        return is_scalar($value) || $value === null ? trim((string) $value) : '';
    }

    private function normalizeCredentialType(mixed $value): string
    {
        return match (trim((string) $value)) {
            'oauth2' => 'oauth2',
            'access_token' => 'access_token',
            default => 'service_account',
        };
    }

    private function normalizeInactiveAction(mixed $value): string
    {
        return trim((string) $value) === 'delete' ? 'delete' : 'out_of_stock';
    }

    private function serviceAccountEmail(string $json): ?string
    {
        $json = trim($json);
        if ($json === '') {
            return null;
        }

        try {
            $decoded = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            return null;
        }

        $email = trim((string) ($decoded['client_email'] ?? ''));

        return filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : null;
    }

    private function assertValidServiceAccountJson(string $json): void
    {
        $json = trim($json);
        if ($json === '') {
            return;
        }

        try {
            $decoded = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        } catch (Throwable $exception) {
            throw new GoogleMerchantProductSyncException('Service account JSON không hợp lệ.', 0, $exception);
        }

        if (!is_array($decoded) || empty($decoded['client_email']) || empty($decoded['private_key'])) {
            throw new GoogleMerchantProductSyncException('Service account JSON phải có client_email và private_key.');
        }
    }
}
