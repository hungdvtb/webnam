<?php

namespace App\Services\AI;

use App\Models\Account;
use App\Models\SiteSetting;
use App\Support\GeminiClientFactory;
use Gemini\Data\Blob;
use Gemini\Enums\MimeType;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\Crypt;
use RuntimeException;

class GeminiService
{
    public const SETTING_API_KEY = 'ai_gemini_api_key';
    public const SETTING_KEYS = 'ai_gemini_keys'; // New setting for multiple keys with notes
    public const SETTING_MODEL = 'ai_gemini_model';
    public const SETTING_ENABLED = 'ai_gemini_enabled';
    public const DEFAULT_MODEL = 'gemini-2.5-flash';
    private const TRANSIENT_RETRY_DELAYS_MS = [1200, 2500];

    private const LEGACY_MODEL_ALIASES = [
        'gemini-1.5-flash' => self::DEFAULT_MODEL,
        'gemini-1.5-flash-001' => self::DEFAULT_MODEL,
        'gemini-1.5-flash-002' => self::DEFAULT_MODEL,
    ];

    public function __construct(
        private readonly GeminiClientFactory $geminiClientFactory,
    ) {
    }

    public function status(?int $accountId = null): array
    {
        $config = $this->resolveConfig($accountId);

        return [
            'provider' => 'gemini',
            'enabled' => $config['enabled'],
            'configured' => $config['configured'],
            'available' => $config['available'],
            'model' => $config['model'],
            'key_source' => $config['key_source'],
            'keys_count' => count($config['all_api_keys']),
        ];
    }

    public function generateText(string $prompt, ?int $accountId = null, ?string $model = null): array
    {
        $config = $this->assertAvailable($accountId, $model);

        return $this->generateContentWithFallback($config, $prompt);
    }

    public function readImage(
        string $base64,
        string $mimeType,
        string $prompt,
        ?int $accountId = null,
        ?string $model = null,
    ): array {
        $config = $this->assertAvailable($accountId, $model);
        $normalizedBase64 = preg_replace('/^data:[^;]+;base64,/', '', trim($base64)) ?: trim($base64);
        $blob = new Blob($this->resolveMimeType($mimeType), $normalizedBase64);

        return $this->generateContentWithFallback($config, $prompt, $blob);
    }

    public function decryptStoredApiKey(?string $value): ?string
    {
        $normalized = trim((string) $value);
        if ($normalized === '') {
            return null;
        }

        try {
            return Crypt::decryptString($normalized);
        } catch (DecryptException) {
            return $this->geminiClientFactory->resolveApiKey($normalized);
        }
    }

    public function normalizeModelName(?string $value): string
    {
        $normalized = strtolower(trim((string) $value));
        $normalized = preg_replace('/^models\//', '', $normalized) ?? $normalized;

        if ($normalized === '') {
            return self::DEFAULT_MODEL;
        }

        return self::LEGACY_MODEL_ALIASES[$normalized] ?? $normalized;
    }

    private function assertAvailable(?int $accountId, ?string $model = null): array
    {
        $config = $this->resolveConfig($accountId, $model);

        if (!$config['configured']) {
            throw new RuntimeException('Chưa cấu hình API key Gemini.');
        }

        if (!$config['enabled']) {
            throw new RuntimeException('AI đang tạm tắt trong Cài đặt web.');
        }

        return $config;
    }

    private function resolveConfig(?int $accountId = null, ?string $overrideModel = null): array
    {
        $account = $accountId ? Account::query()->find($accountId) : null;
        
        // 1. Resolve Keys from new JSON structure
        $keysJson = $accountId ? SiteSetting::getValue(self::SETTING_KEYS, $accountId) : null;
        $decodedKeys = is_string($keysJson) ? json_decode($keysJson, true) : [];
        $structuredKeys = [];
        if (is_array($decodedKeys)) {
            foreach ($decodedKeys as $item) {
                if (($item['is_active'] ?? true) && !empty($item['key'])) {
                    $structuredKeys[] = trim($item['key']);
                }
            }
        }

        // 2. Resolve Keys from legacy structure (and env)
        $storedEncryptedKey = $accountId ? SiteSetting::getValue(self::SETTING_API_KEY, $accountId) : null;
        $storedApiKey = $this->decryptStoredApiKey(is_string($storedEncryptedKey) ? $storedEncryptedKey : null);
        $legacyAccountKey = $this->geminiClientFactory->resolveApiKey($account?->ai_api_key);
        $envKey = $this->geminiClientFactory->resolveApiKey(env('GEMINI_API_KEY'));

        $storedModel = $accountId
            ? trim((string) SiteSetting::getValue(self::SETTING_MODEL, $accountId, ''))
            : '';
        $model = $this->normalizeModelName(
            $overrideModel ?: $storedModel ?: config('services.gemini.default_model', self::DEFAULT_MODEL)
        );

        $storedEnabled = $accountId ? SiteSetting::getValue(self::SETTING_ENABLED, $accountId) : null;
        $enabled = $accountId
            ? $this->normalizeBoolean($storedEnabled, true)
            : true;

        $allApiKeys = $this->geminiClientFactory->resolveAllApiKeys(
            implode(',', $structuredKeys), 
            $storedApiKey, 
            $legacyAccountKey, 
            $envKey
        );
        $apiKey = $allApiKeys[0] ?? null;

        $keySource = null;
        if ($apiKey !== null) {
            if ($keysJson !== null && count($structuredKeys) > 0) {
                $keySource = 'site_setting_batch';
            } elseif ($storedApiKey !== null && str_contains($storedApiKey, $apiKey)) {
                $keySource = 'site_setting';
            } elseif ($legacyAccountKey !== null && $apiKey === $legacyAccountKey) {
                $keySource = 'account';
            } else {
                $keySource = 'env';
            }
        }

        return [
            'api_key' => $apiKey,
            'all_api_keys' => $allApiKeys,
            'configured' => count($allApiKeys) > 0,
            'enabled' => $enabled,
            'available' => $enabled && count($allApiKeys) > 0,
            'model' => $model !== '' ? $model : self::DEFAULT_MODEL,
            'key_source' => $keySource,
        ];
    }

    private function generateContentWithFallback(array $config, string $prompt, ?Blob $blob = null): array
    {
        $allApiKeys = $config['all_api_keys'] ?: [$config['api_key']];
        $lastException = null;

        foreach ($this->resolveModelCandidates($config['model']) as $model) {
            
            // Lọc ra các key chưa bị khóa (exhausted)
            $availableKeys = [];
            $exhaustedCount = 0;
            foreach ($allApiKeys as $key) {
                $cacheKey = 'gemini_key_exhausted_' . md5($key);
                if (!\Illuminate\Support\Facades\Cache::has($cacheKey)) {
                    $availableKeys[] = $key;
                } else {
                    $exhaustedCount++;
                }
            }

            // Nếu tất cả các key đều bị khóa, ném ra lỗi rõ ràng bằng tiếng Việt
            if (empty($availableKeys) && $exhaustedCount > 0) {
                throw new RuntimeException('Tính năng xoay tua báo cáo: Toàn bộ ' . count($allApiKeys) . ' API Keys hiện tại đều đã hết hạn mức chờ (Rate Limit). Vui lòng thêm nhiều API Key hơn, hoặc hệ thống sẽ tự động chờ và thử lại sau ít phút.');
            }

            if (empty($availableKeys)) {
                $availableKeys = $allApiKeys; // Dự phòng rủi ro không có key nào nhưng cũng ko ai bị exhausted
            }

            foreach ($availableKeys as $index => $apiKey) {
                $attemptCount = count(self::TRANSIENT_RETRY_DELAYS_MS) + 1;

                for ($attempt = 0; $attempt < $attemptCount; $attempt++) {
                    try {
                        $client = $this->geminiClientFactory->make($apiKey);
                        $response = $blob === null
                            ? $client->generativeModel($model)->generateContent($prompt)
                            : $client->generativeModel($model)->generateContent($prompt, $blob);

                        return [
                            'text' => trim((string) $response->text()),
                            'model' => $model,
                        ];
                    } catch (\Throwable $exception) {
                        $lastException = $exception;

                        // Check if it's a rate limit error (Resource Exhausted)
                        if ($this->isRateLimitFailure($exception)) {
                            // Mark this key as exhausted for 60 seconds in cache
                            $cacheKey = 'gemini_key_exhausted_' . md5($apiKey);
                            \Illuminate\Support\Facades\Cache::put($cacheKey, now()->addSeconds(60)->timestamp, 60);

                            // If we have more keys in the available pool, try the next one
                            if (isset($availableKeys[$index + 1])) {
                                continue 2; // Move to the next API key in the inner loop
                            }
                            
                            // Nếu đã là key cuối cùng trong danh sách xoay vòng
                            throw new RuntimeException('Tính năng xoay tua báo cáo: Toàn bộ ' . count($allApiKeys) . ' API Keys đều đã chạm ngưỡng giới hạn (Rate Limit) của Google. Hệ thống sẽ tạm dừng và tự động thử lại sau ít phút.');
                        }

                        $delayMs = self::TRANSIENT_RETRY_DELAYS_MS[$attempt] ?? null;
                        if ($delayMs !== null && $this->shouldRetryTransientFailure($exception)) {
                            usleep($delayMs * 1000);
                            continue;
                        }

                        if (!$this->shouldRetryWithFallbackModel($exception, $model)) {
                            throw $exception;
                        }

                        break;
                    }
                }
            }
        }

        if ($lastException !== null) {
            throw $lastException;
        }

        throw new RuntimeException('Khong the ket noi Gemini sau khi thu tat ca API keys.');
    }

    private function isRateLimitFailure(\Throwable $exception): bool
    {
        $message = strtolower(trim((string) $exception->getMessage()));

        return str_contains($message, 'resource_exhausted') 
            || str_contains($message, 'rate limit') 
            || str_contains($message, 'rate-limit') 
            || str_contains($message, 'quota') 
            || str_contains($message, 'too many requests')
            || str_contains($message, '429');
    }

    private function resolveModelCandidates(string $requestedModel): array
    {
        $candidates = array_values(array_unique(array_filter([
            $this->normalizeModelName($requestedModel),
            self::DEFAULT_MODEL,
        ])));

        return $candidates !== [] ? $candidates : [self::DEFAULT_MODEL];
    }

    private function shouldRetryWithFallbackModel(\Throwable $exception, string $model): bool
    {
        if ($model === self::DEFAULT_MODEL) {
            return false;
        }

        $message = strtolower(trim($exception->getMessage()));
        if ($message === '') {
            return false;
        }

        foreach ([
            'not found',
            'not supported',
            'unsupported',
            'listmodels',
            'unknown model',
            'does not exist',
            '404',
        ] as $fragment) {
            if (str_contains($message, $fragment)) {
                return true;
            }
        }

        return false;
    }

    private function shouldRetryTransientFailure(\Throwable $exception): bool
    {
        $message = strtolower(trim((string) $exception->getMessage()));
        if ($message === '') {
            return false;
        }

        foreach ([
            'currently experiencing high demand',
            'high demand',
            'spikes in demand',
            'please try again later',
            'resource_exhausted',
            'rate limit',
            'rate-limit',
            'quota',
            'too many requests',
            'temporarily unavailable',
            'service unavailable',
            'overloaded',
            'deadline exceeded',
            'internal error encountered',
            'curl error',
            'connection was reset',
            'recv failure',
            'connection timeout',
            'ssl connection timeout',
            'failed to connect',
        ] as $fragment) {
            if (str_contains($message, $fragment)) {
                return true;
            }
        }

        return false;
    }

    private function normalizeBoolean(mixed $value, bool $default = false): bool
    {
        if ($value === null || $value === '') {
            return $default;
        }

        if (is_bool($value)) {
            return $value;
        }

        $normalized = strtolower(trim((string) $value));

        return match ($normalized) {
            '1', 'true', 'yes', 'on' => true,
            '0', 'false', 'no', 'off' => false,
            default => $default,
        };
    }

    private function resolveMimeType(string $value): MimeType
    {
        return match (strtolower(trim($value))) {
            'image/png' => MimeType::IMAGE_PNG,
            'image/jpeg', 'image/jpg' => MimeType::IMAGE_JPEG,
            'image/webp' => MimeType::IMAGE_WEBP,
            'image/heic' => MimeType::IMAGE_HEIC,
            'image/heif' => MimeType::IMAGE_HEIF,
            'text/plain' => MimeType::TEXT_PLAIN,
            'text/csv' => MimeType::TEXT_CSV,
            'application/json' => MimeType::APPLICATION_JSON,
            'application/pdf' => MimeType::APPLICATION_PDF,
            default => throw new RuntimeException('Định dạng tệp chưa được Gemini hỗ trợ: ' . $value),
        };
    }
}
