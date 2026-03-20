<?php

namespace App\Services\Shipping;

use App\Models\ShippingIntegration;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class ViettelPostClient
{
    public function testConnection(ShippingIntegration $integration): array
    {
        $token = $this->authenticate($integration, true);
        $provinces = $this->request($integration, 'GET', '/v2/categories/listProvince', [], $token);

        return [
            'token' => $token,
            'provinces_count' => count($this->extractList($provinces)),
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
        return $this->request($integration, 'POST', '/v2/order/createOrder', $payload);
    }

    public function getPriceAll(ShippingIntegration $integration, array $payload): array
    {
        return $this->request($integration, 'POST', '/v2/order/getPriceAll', $payload);
    }

    public function authenticate(ShippingIntegration $integration, bool $forceRefresh = false): string
    {
        $authMode = (string) data_get($integration->config_json, 'auth_mode', 'api_key');

        if ($authMode !== 'api_key') {
            throw new RuntimeException('Che do dang nhap username/password da duoc tat. Vui long dung API key / token ViettelPost.');
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

    public function request(ShippingIntegration $integration, string $method, string $path, array $payload = [], ?string $token = null): array
    {
        $token = $token ?: $this->authenticate($integration);

        $request = $this->baseRequest($integration)->withHeaders([
            'Token' => $token,
        ]);

        $url = $this->buildUrl($integration, $path);
        $response = strtoupper($method) === 'GET'
            ? $request->get($url, $payload)
            : $request->post($url, $payload);

        $json = $response->json();

        if ($response->failed()) {
            $message = Arr::get($json, 'message')
                ?: Arr::get($json, 'error')
                ?: Arr::get($json, 'status')
                ?: $response->body();
            throw new RuntimeException('ViettelPost API loi: ' . $message);
        }

        if ((int) Arr::get($json, 'status') >= 400) {
            $message = Arr::get($json, 'message') ?: Arr::get($json, 'error') ?: 'Phan hoi khong hop le tu ViettelPost.';
            throw new RuntimeException($message);
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
