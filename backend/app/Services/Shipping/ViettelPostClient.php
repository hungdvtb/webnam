<?php

namespace App\Services\Shipping;

use App\Models\ShippingIntegration;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;
use RuntimeException;

class ViettelPostClient
{
    public function testConnection(ShippingIntegration $integration): array
    {
        $token = $this->authenticate($integration, true);
        $provinces = $this->request($integration, 'GET', '/v2/categories/listProvince', [], $token);
        $orderScopeCheck = $this->validateOrderScope($integration, $token);

        return [
            'token' => $token,
            'provinces_count' => count($this->extractList($provinces)),
            'order_scope_check' => $orderScopeCheck,
            'raw' => $provinces,
        ];
    }

    public function listProvinces(ShippingIntegration $integration): array
    {
        return $this->extractList(
            $this->request($integration, 'GET', '/v2/categories/listProvince')
        );
    }

    public function listDistricts(ShippingIntegration $integration, int $provinceId): array
    {
        return $this->extractList(
            $this->request($integration, 'GET', '/v2/categories/listDistrict', ['provinceId' => $provinceId])
        );
    }

    public function listWards(ShippingIntegration $integration, int $districtId): array
    {
        return $this->extractList(
            $this->request($integration, 'GET', '/v2/categories/listWards', ['districtId' => $districtId])
        );
    }

    public function createOrder(ShippingIntegration $integration, array $payload): array
    {
        try {
            return $this->request(
                $integration,
                'POST',
                '/v2/order/createOrderNlp',
                $payload,
                null,
                true,
                ['Cookie' => 'SERVERID=A']
            );
        } catch (RuntimeException $exception) {
            if (!$this->isTokenInvalidMessage($exception->getMessage())) {
                throw $exception;
            }

            return $this->request(
                $integration,
                'POST',
                '/v2/order/createOrder',
                $payload,
                null,
                true,
                ['Cookie' => 'SERVERID=A']
            );
        }
    }

    public function getPriceAll(ShippingIntegration $integration, array $payload): array
    {
        return $this->request($integration, 'POST', '/v2/order/getPriceAll', $payload);
    }

    public function authenticate(ShippingIntegration $integration, bool $forceRefresh = false, bool $preferCredentials = false): string
    {
        $authMode = (string) data_get($integration->config_json, 'auth_mode', 'api_key');
        $hasCredentials = $this->hasStoredCredentials($integration);

        if ($preferCredentials || $authMode === 'credentials') {
            return $this->authenticateWithCredentials($integration, $forceRefresh);
        }

        $token = trim((string) $integration->access_token);
        if ($token === '') {
            throw new RuntimeException('Chua cau hinh API key / token ViettelPost.');
        }

        if ($integration->connection_status !== 'connected' || $forceRefresh) {
            $integration->forceFill([
                'connection_status' => 'connected',
                'last_tested_at' => now(),
                'last_error_message' => null,
            ])->save();
        }

        return $token;
    }

    public function request(
        ShippingIntegration $integration,
        string $method,
        string $path,
        array $payload = [],
        ?string $token = null,
        bool $retryOnAuthFailure = true,
        array $extraHeaders = []
    ): array
    {
        $token = $token ?: $this->authenticate($integration);

        $request = $this->baseRequest($integration)->withHeaders(array_merge([
            'Token' => $token,
        ], $extraHeaders));

        $url = $this->buildUrl($integration, $path);
        $response = strtoupper($method) === 'GET'
            ? $request->get($url, $payload)
            : $request->post($url, $payload);

        $json = $response->json();

        $message = Arr::get($json, 'message')
            ?: Arr::get($json, 'error')
            ?: Arr::get($json, 'status')
            ?: $response->body();

        $errorFlag = Arr::get($json, 'error');
        $hasApiError = $response->failed()
            || $errorFlag === true
            || $errorFlag === 'true'
            || $errorFlag === 1
            || $errorFlag === '1'
            || (is_numeric(Arr::get($json, 'status')) && (int) Arr::get($json, 'status') >= 400);

        if ($hasApiError) {
            if (
                $retryOnAuthFailure
                && $this->isTokenInvalidMessage($message)
                && (string) data_get($integration->config_json, 'auth_mode', 'api_key') === 'credentials'
                && $this->hasStoredCredentials($integration)
            ) {
                $freshToken = $this->authenticate($integration, true, true);
                return $this->request($integration, $method, $path, $payload, $freshToken, false);
            }

            if (
                $this->isTokenInvalidMessage($message)
                && (string) data_get($integration->config_json, 'auth_mode', 'api_key') === 'api_key'
            ) {
                throw new RuntimeException('ViettelPost API loi: Token invalid. Vui long dung token tao don / client token.');
            }

            throw new RuntimeException('ViettelPost API loi: ' . $message);
        }

        return is_array($json) ? $json : [];
    }

    public function extractList(array $response): array
    {
        $data = Arr::get($response, 'data');

        if (is_array($data)) {
            if (array_is_list($data)) {
                return $data;
            }

            foreach (['LIST', 'list', 'data', 'DATA'] as $key) {
                $candidate = Arr::get($data, $key);
                if (is_array($candidate) && array_is_list($candidate)) {
                    return $candidate;
                }
            }
        }

        return [];
    }

    public function extractToken(array $response): ?string
    {
        $candidates = [
            Arr::get($response, 'data.token'),
            Arr::get($response, 'data.access_token'),
            Arr::get($response, 'token'),
            Arr::get($response, 'access_token'),
            Arr::get($response, 'data.TOKEN'),
        ];

        foreach ($candidates as $candidate) {
            if (is_string($candidate) && trim($candidate) !== '') {
                return trim($candidate);
            }
        }

        return null;
    }

    public function validateOrderScope(ShippingIntegration $integration, ?string $token = null): array
    {
        try {
            return $this->request(
                $integration,
                'POST',
                '/v2/order/printing-code',
                [
                    'EXPIRY_TIME' => 0,
                    'ORDER_ARRAY' => ['TOKEN-CHECK-ONLY'],
                ],
                $token,
                false,
                ['Cookie' => 'SERVERID=A']
            );
        } catch (RuntimeException $exception) {
            if ($this->isTokenInvalidMessage($exception->getMessage())) {
                throw new RuntimeException('Token hien tai khong du quyen tao don ViettelPost. Vui long dung token tao don / client token.');
            }

            return [
                'validated' => true,
                'message' => $exception->getMessage(),
            ];
        }
    }

    private function authenticateWithCredentials(ShippingIntegration $integration, bool $forceRefresh = false): string
    {
        $cachedToken = trim((string) $integration->access_token);
        if (!$forceRefresh && $cachedToken !== '') {
            return $cachedToken;
        }

        $username = trim((string) $integration->username);
        $password = $this->decryptPassword($integration);
        if ($username === '' || $password === '') {
            throw new RuntimeException('Chua cau hinh username/password ViettelPost.');
        }

        $loginResponse = $this->baseRequest($integration)
            ->post($this->buildUrl($integration, '/v2/user/Login'), [
                'USERNAME' => $username,
                'PASSWORD' => $password,
            ])
            ->json();

        $temporaryToken = $this->extractToken(is_array($loginResponse) ? $loginResponse : []);
        if (!filled($temporaryToken)) {
            $message = Arr::get($loginResponse, 'message') ?: 'Khong lay duoc token tam tu ViettelPost.';
            throw new RuntimeException($message);
        }

        $ownerConnectResponse = $this->baseRequest($integration)
            ->withHeaders(['Token' => $temporaryToken])
            ->post($this->buildUrl($integration, '/v2/user/ownerconnect'), [
                'USERNAME' => $username,
                'PASSWORD' => $password,
            ])
            ->json();

        $longLivedToken = $this->extractToken(is_array($ownerConnectResponse) ? $ownerConnectResponse : []);
        if (!filled($longLivedToken)) {
            $message = Arr::get($ownerConnectResponse, 'message') ?: 'Khong lay duoc token dai han tu ViettelPost.';
            throw new RuntimeException($message);
        }

        $integration->forceFill([
            'access_token' => $longLivedToken,
            'token_expires_at' => null,
            'connection_status' => 'connected',
            'last_tested_at' => now(),
            'last_error_message' => null,
        ])->save();

        return $longLivedToken;
    }

    private function hasStoredCredentials(ShippingIntegration $integration): bool
    {
        return filled($integration->username) && filled($integration->password_encrypted);
    }

    private function decryptPassword(ShippingIntegration $integration): string
    {
        try {
            return $integration->password_encrypted ? Crypt::decryptString($integration->password_encrypted) : '';
        } catch (\Throwable) {
            return '';
        }
    }

    private function isTokenInvalidMessage(string $message): bool
    {
        return Str::contains(Str::lower($message), ['token invalid', 'invalid token', 'unauthorized', 'khong hop le']);
    }

    private function baseRequest(ShippingIntegration $integration): PendingRequest
    {
        return Http::acceptJson()
            ->asJson()
            ->withOptions([
                'verify' => $this->resolveVerifyOption($integration),
            ])
            ->timeout((int) data_get($integration->config_json, 'timeout', 30))
            ->retry(1, 300);
    }

    private function buildUrl(ShippingIntegration $integration, string $path): string
    {
        $base = rtrim((string) ($integration->api_base_url ?: 'https://partner.viettelpost.vn'), '/');
        return $base . '/' . ltrim($path, '/');
    }

    private function resolveVerifyOption(ShippingIntegration $integration): bool|string
    {
        $verifySsl = data_get($integration->config_json, 'verify_ssl');
        if ($verifySsl === false || $verifySsl === 'false' || $verifySsl === 0 || $verifySsl === '0') {
            return false;
        }

        $configuredBundle = data_get($integration->config_json, 'ca_bundle_path');
        if (is_string($configuredBundle) && is_file($configuredBundle)) {
            return $configuredBundle;
        }

        $envBundle = env('SHIPPING_CA_BUNDLE_PATH');
        if (is_string($envBundle) && $envBundle !== '' && is_file($envBundle)) {
            return $envBundle;
        }

        $candidates = array_filter([
            'C:\\xampp\\apache\\bin\\curl-ca-bundle.crt',
            'C:\\xampp\\php\\extras\\ssl\\cacert.pem',
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
}
