<?php

namespace App\Services\Shipping;

use App\Models\ShippingIntegration;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Crypt;
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
        if (!$forceRefresh && $integration->access_token && $integration->token_expires_at && $integration->token_expires_at->isFuture()) {
            return (string) $integration->access_token;
        }

        $username = trim((string) $integration->username);
        $password = trim((string) $this->decryptPassword($integration));

        if ($username === '' || $password === '') {
            throw new RuntimeException('Thiếu tài khoản hoặc mật khẩu ViettelPost.');
        }

        $login = $this->baseRequest($integration)
            ->post($this->buildUrl($integration, '/v2/user/Login'), [
                'USERNAME' => $username,
                'PASSWORD' => $password,
            ])
            ->throw()
            ->json();

        $tempToken = $this->extractToken($login);
        if (!$tempToken) {
            throw new RuntimeException('Không lấy được token tạm từ ViettelPost.');
        }

        $ownerConnect = $this->baseRequest($integration)
            ->withHeaders(['Token' => $tempToken])
            ->post($this->buildUrl($integration, '/v2/user/ownerconnect'), [
                'USERNAME' => $username,
                'PASSWORD' => $password,
            ])
            ->throw()
            ->json();

        $accessToken = $this->extractToken($ownerConnect);
        if (!$accessToken) {
            throw new RuntimeException('Không lấy được access token ViettelPost.');
        }

        $integration->forceFill([
            'access_token' => $accessToken,
            'token_expires_at' => now()->addHours(20),
            'connection_status' => 'connected',
            'last_tested_at' => now(),
            'last_error_message' => null,
        ])->save();

        return $accessToken;
    }

    public function decryptPassword(ShippingIntegration $integration): string
    {
        if (!$integration->password_encrypted) {
            return '';
        }

        try {
            return (string) Crypt::decryptString($integration->password_encrypted);
        } catch (\Throwable $e) {
            return (string) $integration->password_encrypted;
        }
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
            throw new RuntimeException('ViettelPost API lỗi: ' . $message);
        }

        if ((int) Arr::get($json, 'status') >= 400) {
            $message = Arr::get($json, 'message') ?: Arr::get($json, 'error') ?: 'Phản hồi không hợp lệ từ ViettelPost.';
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
            ->timeout((int) data_get($integration->config_json, 'timeout', 30))
            ->retry(1, 300);
    }

    private function buildUrl(ShippingIntegration $integration, string $path): string
    {
        $base = rtrim((string) ($integration->api_base_url ?: 'https://partner.viettelpost.vn'), '/');
        return $base . '/' . ltrim($path, '/');
    }
}
