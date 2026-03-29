<?php

namespace App\Support;

class SslVerifyOptionResolver
{
    public function resolve(
        mixed $verifySsl = true,
        ?string $configuredBundle = null,
        ?bool $isLocalEnvironment = null,
        ?array $candidatePaths = null
    ): bool|string {
        if ($this->shouldDisableVerification($verifySsl)) {
            return false;
        }

        $candidates = $configuredBundle !== null && trim($configuredBundle) !== ''
            ? [$configuredBundle]
            : [];

        if ($candidatePaths === null) {
            $candidatePaths = $this->defaultCandidatePaths();
        }

        foreach (array_merge($candidates, $candidatePaths) as $candidate) {
            if (!is_string($candidate) || trim($candidate) === '' || !is_file($candidate)) {
                continue;
            }

            return $candidate;
        }

        return ($isLocalEnvironment ?? app()->environment('local')) ? false : true;
    }

    private function shouldDisableVerification(mixed $verifySsl): bool
    {
        return $verifySsl === false
            || $verifySsl === 'false'
            || $verifySsl === 0
            || $verifySsl === '0';
    }

    /**
     * @return array<int, string|null>
     */
    private function defaultCandidatePaths(): array
    {
        return [
            env('SSL_CERT_FILE'),
            env('CURL_CA_BUNDLE'),
            'C:\\xampp\\apache\\bin\\curl-ca-bundle.crt',
            'C:\\xampp\\php\\extras\\ssl\\cacert.pem',
            base_path('vendor/composer/ca-bundle/res/cacert.pem'),
            ini_get('curl.cainfo') ?: null,
            ini_get('openssl.cafile') ?: null,
        ];
    }
}
