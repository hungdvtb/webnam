<?php

namespace App\Support;

use Gemini;
use Gemini\Client as GeminiClient;
use GuzzleHttp\Client as GuzzleClient;
use InvalidArgumentException;

class GeminiClientFactory
{
    public function __construct(
        private readonly SslVerifyOptionResolver $sslVerifyOptionResolver,
    ) {
    }

    public function resolveApiKey(?string ...$candidates): ?string
    {
        foreach ($candidates as $candidate) {
            $normalized = trim((string) $candidate);
            if ($normalized === '') {
                continue;
            }

            // Split by newline or comma to support multiple keys
            $keys = preg_split('/[\n,\s]+/', $normalized, -1, PREG_SPLIT_NO_EMPTY);
            $validKeys = array_filter($keys, fn ($k) => $this->isConfiguredApiKey($k));

            if (!empty($validKeys)) {
                // If there are multiple keys, pick one randomly for simple load balancing
                return $validKeys[array_rand($validKeys)];
            }
        }

        return null;
    }

    public function resolveAllApiKeys(?string ...$candidates): array
    {
        $allKeys = [];
        foreach ($candidates as $candidate) {
            $normalized = trim((string) $candidate);
            if ($normalized === '') {
                continue;
            }

            $keys = preg_split('/[\n,\s]+/', $normalized, -1, PREG_SPLIT_NO_EMPTY);
            foreach ($keys as $key) {
                if ($this->isConfiguredApiKey($key)) {
                    $allKeys[] = $key;
                }
            }
        }

        $uniqueKeys = array_values(array_unique($allKeys));
        shuffle($uniqueKeys); // Shuffle to distribute load evenly across all keys

        return $uniqueKeys;
    }

    public function make(?string $apiKey): GeminiClient
    {
        $normalizedApiKey = trim((string) $apiKey);
        if ($normalizedApiKey === '' || !$this->isConfiguredApiKey($normalizedApiKey)) {
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
        return $this->sslVerifyOptionResolver->resolve(
            config('services.gemini.verify_ssl', true),
            config('services.gemini.ca_bundle_path'),
            app()->environment('local')
        );
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
