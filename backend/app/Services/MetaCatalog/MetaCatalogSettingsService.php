<?php

namespace App\Services\MetaCatalog;

use App\Models\MetaCatalogConfig;
use App\Models\MetaCatalogSyncLog;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Throwable;

class MetaCatalogSettingsService
{
    private const SECRET_KEYS = ['access_token'];

    private const BOOLEAN_KEYS = [
        'enabled',
        'delete_stale',
    ];

    private const STORED_KEYS = [
        'enabled',
        'app_id',
        'catalog_id',
        'access_token',
        'graph_api_version',
        'brand',
        'currency',
        'fallback_image_url',
        'delete_stale',
        'sync_frequency',
    ];

    private const CONFIG_COLUMNS = [
        'enabled',
        'app_id',
        'catalog_id',
        'access_token',
        'graph_api_version',
        'brand',
        'currency',
        'fallback_image_url',
        'delete_stale',
        'sync_frequency',
    ];

    private ?bool $configTableExists = null;

    public function settingsFor(?int $accountId = null): array
    {
        $settings = $this->defaults();
        $stored = $this->configSettingsFor($accountId);

        return $this->normalize(array_replace($settings, $stored));
    }

    public function publicSettingsFor(?int $accountId = null): array
    {
        $settings = $this->settingsFor($accountId);
        $hasAccessToken = trim((string) ($settings['access_token'] ?? '')) !== '';
        unset($settings['access_token']);

        $settings['has_access_token'] = $hasAccessToken;
        $settings['feed_links'] = $this->feedLinks();
        $settings['last_run'] = $this->lastRun($accountId);
        $settings['next_run_at'] = $this->nextRunAt($accountId, $settings)?->toIso8601String();

        return $settings;
    }

    public function update(?int $accountId, array $input): array
    {
        if (!$this->configTableExists()) {
            throw new MetaCatalogProductSyncException('Bảng cấu hình Meta Catalog chưa được migrate.');
        }

        DB::transaction(function () use ($accountId, $input) {
            $updates = [];

            if (!empty($input['clear_access_token'])) {
                $updates['access_token'] = null;
            }

            foreach (self::STORED_KEYS as $key) {
                if (!array_key_exists($key, $input)) {
                    continue;
                }

                $value = $input[$key];
                if (in_array($key, self::SECRET_KEYS, true) && trim((string) $value) === '') {
                    continue;
                }

                $updates[$key] = $this->encodeValue($key, $value);
            }

            if (!empty($updates)) {
                MetaCatalogConfig::query()->updateOrCreate(
                    ['account_id' => $accountId],
                    $updates
                );
            }
        });

        return $this->publicSettingsFor($accountId);
    }

    public function applyToConfig(array $settings): void
    {
        foreach ([
            'enabled',
            'app_id',
            'catalog_id',
            'access_token',
            'graph_api_version',
            'brand',
            'currency',
            'fallback_image_url',
            'delete_stale',
        ] as $key) {
            config(["meta_catalog.{$key}" => $settings[$key] ?? null]);
        }
    }

    public function feedLinks(): array
    {
        $baseUrl = trim((string) config('app.frontend_url')) ?: 'https://gomdaithanh.com';
        if (!Str::startsWith($baseUrl, ['http://', 'https://'])) {
            $baseUrl = 'https://' . $baseUrl;
        }

        $baseUrl = rtrim($baseUrl, '/');

        return [
            'csv' => "{$baseUrl}/meta-feed.csv",
            'xml' => "{$baseUrl}/meta-feed.xml",
        ];
    }

    public function shouldRunScheduled(?int $accountId, ?array $settings = null): bool
    {
        $settings ??= $this->settingsFor($accountId);
        if (empty($settings['enabled'])) {
            return false;
        }

        $nextRunAt = $this->nextRunAt($accountId, $settings);

        return $nextRunAt === null || now()->greaterThanOrEqualTo($nextRunAt);
    }

    public function nextRunAt(?int $accountId, array $settings): ?Carbon
    {
        if (empty($settings['enabled'])) {
            return null;
        }

        $lastRun = MetaCatalogSyncLog::query()
            ->whereIn('operation', ['sync_live', 'scheduled_sync'])
            ->when($accountId !== null, fn ($query) => $query->where('account_id', $accountId))
            ->latest('finished_at')
            ->first();

        $anchor = $lastRun?->finished_at instanceof Carbon ? $lastRun->finished_at : now();

        if (!$lastRun) {
            return now();
        }

        return match ($this->normalizeFrequency($settings['sync_frequency'] ?? 'hourly')) {
            'six_hours' => $anchor->copy()->addHours(6),
            'daily' => $anchor->copy()->addDay(),
            default => $anchor->copy()->addHour(),
        };
    }

    private function lastRun(?int $accountId): ?array
    {
        $log = MetaCatalogSyncLog::query()
            ->whereIn('operation', ['dry_run', 'sync_live', 'scheduled_sync'])
            ->when($accountId !== null, fn ($query) => $query->where('account_id', $accountId))
            ->with('user:id,name,email')
            ->latest('finished_at')
            ->first();

        if (!$log) {
            return null;
        }

        return [
            'id' => (int) $log->id,
            'operation' => $log->operation,
            'status' => $log->status,
            'finished_at' => $log->finished_at?->toIso8601String(),
            'summary' => $log->summary,
            'total_products' => $log->total_products,
            'valid_products' => $log->valid_products,
            'invalid_products' => $log->invalid_products,
            'create_count' => $log->create_count,
            'update_count' => $log->update_count,
            'delete_count' => $log->delete_count,
            'fallback_count' => $log->fallback_count,
            'user' => $log->user ? [
                'id' => (int) $log->user->id,
                'name' => $log->user->name,
                'email' => $log->user->email,
            ] : null,
        ];
    }

    private function defaults(): array
    {
        return [
            'enabled' => (bool) config('meta_catalog.enabled', false),
            'app_id' => (string) config('meta_catalog.app_id', ''),
            'catalog_id' => (string) config('meta_catalog.catalog_id', ''),
            'access_token' => (string) config('meta_catalog.access_token', ''),
            'graph_api_version' => (string) config('meta_catalog.graph_api_version', 'v25.0'),
            'brand' => (string) config('meta_catalog.brand', 'Gốm Đại Thành'),
            'currency' => (string) config('meta_catalog.currency', 'VND'),
            'fallback_image_url' => (string) config('meta_catalog.fallback_image_url', ''),
            'delete_stale' => (bool) config('meta_catalog.delete_stale', true),
            'sync_frequency' => 'hourly',
        ];
    }

    private function configSettingsFor(?int $accountId): array
    {
        if (!$this->configTableExists()) {
            return [];
        }

        try {
            $query = MetaCatalogConfig::query();
            if ($accountId !== null) {
                $query->where('account_id', $accountId);
            } else {
                $query->orderByRaw('CASE WHEN account_id IS NULL THEN 0 ELSE 1 END');
            }

            $config = $query->first();
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

    private function configTableExists(): bool
    {
        if ($this->configTableExists !== null) {
            return $this->configTableExists;
        }

        try {
            return $this->configTableExists = Schema::hasTable('meta_catalog_configs');
        } catch (Throwable $exception) {
            if (!app()->runningUnitTests()) {
                throw $exception;
            }

            return $this->configTableExists = false;
        }
    }

    private function normalize(array $settings): array
    {
        $settings['enabled'] = (bool) ($settings['enabled'] ?? false);
        $settings['app_id'] = trim((string) ($settings['app_id'] ?? ''));
        $settings['catalog_id'] = trim((string) ($settings['catalog_id'] ?? ''));
        $settings['access_token'] = trim((string) ($settings['access_token'] ?? ''));
        $settings['graph_api_version'] = trim((string) ($settings['graph_api_version'] ?? 'v25.0')) ?: 'v25.0';
        $settings['brand'] = trim((string) ($settings['brand'] ?? 'Gốm Đại Thành')) ?: 'Gốm Đại Thành';
        $settings['currency'] = Str::upper(trim((string) ($settings['currency'] ?? 'VND'))) ?: 'VND';
        $settings['fallback_image_url'] = trim((string) ($settings['fallback_image_url'] ?? ''));
        $settings['delete_stale'] = (bool) ($settings['delete_stale'] ?? true);
        $settings['sync_frequency'] = $this->normalizeFrequency($settings['sync_frequency'] ?? 'hourly');

        return $settings;
    }

    private function normalizeFrequency(mixed $value): string
    {
        return match (trim((string) $value)) {
            'six_hours' => 'six_hours',
            'daily' => 'daily',
            default => 'hourly',
        };
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

        if ($key === 'sync_frequency') {
            return $this->normalizeFrequency($value);
        }

        if ($key === 'currency') {
            return Str::upper(trim((string) $value));
        }

        return is_scalar($value) || $value === null ? trim((string) $value) : '';
    }
}
