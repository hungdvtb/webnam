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
    public const SETTING_MODEL = 'ai_gemini_model';
    public const SETTING_ENABLED = 'ai_gemini_enabled';
    public const DEFAULT_MODEL = 'gemini-2.5-flash';

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

        $apiKey = $this->geminiClientFactory->resolveApiKey($storedApiKey, $legacyAccountKey, $envKey);

        $keySource = null;
        if ($apiKey !== null) {
            if ($storedApiKey !== null && $apiKey === $storedApiKey) {
                $keySource = 'site_setting';
            } elseif ($legacyAccountKey !== null && $apiKey === $legacyAccountKey) {
                $keySource = 'account';
            } else {
                $keySource = 'env';
            }
        }

        return [
            'api_key' => $apiKey,
            'configured' => $apiKey !== null,
            'enabled' => $enabled,
            'available' => $enabled && $apiKey !== null,
            'model' => $model !== '' ? $model : self::DEFAULT_MODEL,
            'key_source' => $keySource,
        ];
    }

    private function generateContentWithFallback(array $config, string $prompt, ?Blob $blob = null): array
    {
        $client = $this->geminiClientFactory->make($config['api_key']);
        $lastException = null;

        foreach ($this->resolveModelCandidates($config['model']) as $model) {
            try {
                $response = $blob === null
                    ? $client->generativeModel($model)->generateContent($prompt)
                    : $client->generativeModel($model)->generateContent($prompt, $blob);

                return [
                    'text' => trim((string) $response->text()),
                    'model' => $model,
                ];
            } catch (\Throwable $exception) {
                $lastException = $exception;

                if (!$this->shouldRetryWithFallbackModel($exception, $model)) {
                    throw $exception;
                }
            }
        }

        if ($lastException !== null) {
            throw $lastException;
        }

        throw new RuntimeException('Khong the ket noi Gemini.');
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
