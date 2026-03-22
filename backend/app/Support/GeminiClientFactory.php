<?php

namespace App\Support;

use Gemini;
use Gemini\Client as GeminiClient;
use GuzzleHttp\Client as GuzzleClient;
use InvalidArgumentException;

class GeminiClientFactory
{
    public function resolveApiKey(?string ...$candidates): ?string
    {
        foreach ($candidates as $candidate) {
            $normalized = trim((string) $candidate);
            if ($this->isConfiguredApiKey($normalized)) {
                return $normalized;
            }
        }

        return null;
    }

    public function make(?string $apiKey): GeminiClient
    {
        $normalizedApiKey = $this->resolveApiKey($apiKey);
        if ($normalizedApiKey === null) {
            throw new InvalidArgumentException('Chua cau hinh Gemini API key hop le.');
        }

        return Gemini::factory()
            ->withApiKey($normalizedApiKey)
            ->withBaseUrl((string) config('services.gemini.base_url', 'https://generativelanguage.googleapis.com/v1beta/'))
            ->withHttpClient(new GuzzleClient([
                'verify' => $this->resolveVerifyOption(),
                'timeout' => (int) config('services.gemini.timeout', 60),
                'connect_timeout' => (int) config('services.gemini.connect_timeout', 15),
            ]))
            ->make();
    }

    public function resolveVerifyOption(): bool|string
    {
        $verifySsl = config('services.gemini.verify_ssl', true);
        if ($verifySsl === false || $verifySsl === 'false' || $verifySsl === 0 || $verifySsl === '0') {
            return false;
        }

        $configuredBundle = config('services.gemini.ca_bundle_path');
        if (is_string($configuredBundle) && $configuredBundle !== '' && is_file($configuredBundle)) {
            return $configuredBundle;
        }

        $candidates = array_filter([
            env('SSL_CERT_FILE'),
            env('CURL_CA_BUNDLE'),
            'C:\\xampp\\apache\\bin\\curl-ca-bundle.crt',
            'C:\\xampp\\php\\extras\\ssl\\cacert.pem',
            base_path('vendor/composer/ca-bundle/res/cacert.pem'),
            ini_get('curl.cainfo') ?: null,
            ini_get('openssl.cafile') ?: null,
        ]);

        foreach ($candidates as $candidate) {
            if (is_string($candidate) && is_file($candidate)) {
                return $candidate;
            }
        }

        return app()->environment('local') ? false : true;
    }

    private function isConfiguredApiKey(string $value): bool
    {
        if ($value === '') {
            return false;
        }

        $normalized = strtolower($value);
        $placeholders = [
            'your_actual_gemini_api_key_here',
            'your_gemini_api_key',
            'gemini_api_key_here',
            'changeme',
        ];

        foreach ($placeholders as $placeholder) {
            if ($normalized === $placeholder) {
                return false;
            }
        }

        if (str_contains($normalized, 'your_actual') || str_contains($normalized, 'example')) {
            return false;
        }

        return true;
    }
}
