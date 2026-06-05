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
    private const FALLBACK_MODELS = [
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-flash',
    ];

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

    public function generateText(string $prompt, ?int $accountId = null, ?string $model = null, array $options = []): array
    {
        $config = $this->assertAvailable($accountId, $model);

        return $this->generateContentWithFallback($config, $prompt, null, $options);
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

    private function generateContentWithFallback(array $config, string $prompt, ?Blob $blob = null, array $options = []): array
    {
        $allApiKeys = $config['all_api_keys'] ?: [$config['api_key']];
        $maxApiKeys = (int) ($options['max_api_keys'] ?? 0);
        if ($maxApiKeys > 0) {
            $allApiKeys = array_slice($allApiKeys, 0, $maxApiKeys);
        }

        $lastException = null;

        $requestedModels = preg_split('/[\s,;]+/', $config['model'], -1, PREG_SPLIT_NO_EMPTY);
        $modelCandidates = array_values(array_unique(array_merge(
            array_map(fn($m) => $this->normalizeModelName($m), $requestedModels),
            self::FALLBACK_MODELS
        )));
        $maxModelCandidates = (int) ($options['max_model_candidates'] ?? 0);
        if ($maxModelCandidates > 0) {
            $modelCandidates = array_slice($modelCandidates, 0, $maxModelCandidates);
        }

        $brokenKeys = [];
        $transientRetryDelaysMs = array_values(array_filter(
            (array) ($options['transient_retry_delays_ms'] ?? self::TRANSIENT_RETRY_DELAYS_MS),
            fn ($delayMs) => is_numeric($delayMs) && (int) $delayMs >= 0
        ));

        foreach ($allApiKeys as $keyIndex => $apiKey) {
            // Kiểm tra cache xem key này có đang bị rate limit không
            $keyHash = md5($apiKey);
            $cacheKey = 'gemini_key_exhausted_' . $keyHash;
            if (\Illuminate\Support\Facades\Cache::has($cacheKey)) {
                continue;
            }

            foreach ($modelCandidates as $model) {
                // Kiểm tra xem tổ hợp Key + Model này có bị exhausted không
                $modelKeyCacheKey = 'gemini_quota_exhausted_' . $keyHash . '_' . md5($model);
                if (\Illuminate\Support\Facades\Cache::has($modelKeyCacheKey)) {
                    continue;
                }

                $attemptCount = count($transientRetryDelaysMs) + 1;

                for ($attempt = 0; $attempt < $attemptCount; $attempt++) {
                    $requestSent = false;
                    $usage = null;

                    try {
                        $client = $this->geminiClientFactory->make($apiKey, $options);
                        $requestSent = true;
                        $response = $blob === null
                            ? $client->generativeModel($model)->generateContent($prompt)
                            : $client->generativeModel($model)->generateContent($prompt, $blob);
                        $usageMetadata = $response->usageMetadata ?? null;
                        $usage = $this->normalizeUsageMetadata(
                            is_object($usageMetadata) && method_exists($usageMetadata, 'toArray')
                                ? $usageMetadata->toArray()
                                : null
                        );
                        $text = trim((string) $response->text());

                        $this->notifyRequestAttempt($options, [
                            'provider' => 'gemini',
                            'status' => 'success',
                            'model' => $model,
                            'key_index' => $keyIndex + 1,
                            'attempt' => $attempt + 1,
                            'usage' => $usage,
                        ]);

                        return [
                            'text' => $text,
                            'model' => $model,
                            'usage' => $usage,
                        ];
                    } catch (\Throwable $exception) {
                        if (($requestSent ?? false) === true) {
                            $this->notifyRequestAttempt($options, [
                                'provider' => 'gemini',
                                'status' => 'failed',
                                'model' => $model,
                                'key_index' => $keyIndex + 1,
                                'attempt' => $attempt + 1,
                                'usage' => isset($usage) ? $this->normalizeUsageMetadata($usage) : null,
                                'error_class' => $exception::class,
                                'error_message' => $exception->getMessage(),
                            ]);
                        }

                        $lastException = $exception;
                        $message = strtolower($exception->getMessage());

                        // 1. Nếu khóa bị EXPIRED hoặc INVALID -> Đánh dấu hỏng và bỏ qua luôn khóa này
                        if (str_contains($message, 'expired') || str_contains($message, 'invalid') || str_contains($message, 'key not found')) {
                            $brokenKeys[] = $apiKey;
                            \Illuminate\Support\Facades\Log::warning("Gemini API Key hỏng/hết hạn: " . substr($apiKey, 0, 8) . "...");
                            continue 3; // Thử sang khóa tiếp theo (thoát cả vòng lặp Model)
                        }

                        // 2. Nếu Model bị lỗi (không tồn tại) -> Thử Model tiếp theo
                        if ($this->shouldRetryWithFallbackModel($exception, $model)) {
                            continue 2; 
                        }

                        // 3. Nếu bị Rate Limit (429) -> Đánh dấu tổ hợp này tạm nghỉ 65 giây (để reset giới hạn 5 API/phút của bản Free)
                        if ($this->isRateLimitFailure($exception)) {
                            \Illuminate\Support\Facades\Cache::put($modelKeyCacheKey, now()->addSeconds(65)->timestamp, 65);
                            continue 2; // Thử Model tiếp theo của cùng một khóa
                        }

                        // 4. Nếu lỗi tạm thời (Mạng, Demand cao) -> Thử lại chính khóa + model này
                        $delayMs = $transientRetryDelaysMs[$attempt] ?? null;
                        if ($delayMs !== null && $this->shouldRetryTransientFailure($exception)) {
                            usleep($delayMs * 1000);
                            continue;
                        }

                        // Nếu là lỗi không thể xử lý được bằng cách thử lại, ném ra
                        throw $exception;
                    }
                }
            }

            // Nếu đi đến đây nghĩa là khóa này đã thử hết mọi Model mà vẫn fail Quota
            // Đánh dấu exhausted cho toàn bộ khóa trong 60 giây
            \Illuminate\Support\Facades\Cache::put($cacheKey, now()->addSeconds(60)->timestamp, 60);
        }

        if ($lastException !== null) {
            throw $lastException;
        }

        throw new RuntimeException('Đã thử tất cả API Keys và các Model dự phòng nhưng không thành công. Vui lòng kiểm tra lại tài khoản Google AI Studio.');
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

    private function notifyRequestAttempt(array $options, array $payload): void
    {
        $callback = $options['on_request_attempt'] ?? null;
        if (!is_callable($callback)) {
            return;
        }

        try {
            $callback($payload);
        } catch (\Throwable) {
            // Telemetry callbacks must not affect the actual AI request flow.
        }
    }

    private function normalizeUsageMetadata(mixed $usage): array
    {
        if (!is_array($usage)) {
            return [
                'promptTokenCount' => null,
                'candidatesTokenCount' => null,
                'totalTokenCount' => null,
                'cachedContentTokenCount' => null,
            ];
        }

        return [
            'promptTokenCount' => isset($usage['promptTokenCount']) ? (int) $usage['promptTokenCount'] : null,
            'candidatesTokenCount' => isset($usage['candidatesTokenCount']) ? (int) $usage['candidatesTokenCount'] : null,
            'totalTokenCount' => isset($usage['totalTokenCount']) ? (int) $usage['totalTokenCount'] : null,
            'cachedContentTokenCount' => isset($usage['cachedContentTokenCount']) ? (int) $usage['cachedContentTokenCount'] : null,
        ];
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
