<?php

namespace App\Services\Shipping;

use App\Models\ShippingIntegration;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use RuntimeException;

class ViettelPostAddressService
{
    public function __construct(private ViettelPostClient $client)
    {
    }

    public function resolveSenderIds(ShippingIntegration $integration, array $sender): array
    {
        return $this->resolveAddressIds($integration, $sender);
    }

    public function resolveReceiverIds(ShippingIntegration $integration, array $receiver): array
    {
        return $this->resolveAddressIds($integration, $receiver);
    }

    public function resolveAddressIds(ShippingIntegration $integration, array $address): array
    {
        $provinceName = trim((string) Arr::get($address, 'province'));
        $districtName = trim((string) Arr::get($address, 'district'));
        $wardName = trim((string) Arr::get($address, 'ward'));

        if ($provinceName === '' || $districtName === '' || $wardName === '') {
            throw new RuntimeException('Thiếu tỉnh/huyện/xã để map địa chỉ ViettelPost.');
        }

        $province = $this->matchByName($this->getProvinces($integration), $provinceName, ['PROVINCE_NAME', 'provinceName', 'name']);
        if (!$province) {
            throw new RuntimeException("Không map được tỉnh/thành ViettelPost cho '{$provinceName}'.");
        }

        $provinceId = (int) ($province['PROVINCE_ID'] ?? $province['provinceId'] ?? $province['id'] ?? 0);
        $district = $this->matchByName($this->getDistricts($integration, $provinceId), $districtName, ['DISTRICT_NAME', 'districtName', 'name']);
        if (!$district) {
            throw new RuntimeException("Không map được quận/huyện ViettelPost cho '{$districtName}'.");
        }

        $districtId = (int) ($district['DISTRICT_ID'] ?? $district['districtId'] ?? $district['id'] ?? 0);
        $ward = $this->matchByName($this->getWards($integration, $districtId), $wardName, ['WARDS_NAME', 'wardName', 'name']);
        if (!$ward) {
            throw new RuntimeException("Không map được phường/xã ViettelPost cho '{$wardName}'.");
        }

        return [
            'province_id' => $provinceId,
            'district_id' => $districtId,
            'ward_id' => (int) ($ward['WARDS_ID'] ?? $ward['wardId'] ?? $ward['id'] ?? 0),
            'province_name' => $province['PROVINCE_NAME'] ?? $province['provinceName'] ?? $provinceName,
            'district_name' => $district['DISTRICT_NAME'] ?? $district['districtName'] ?? $districtName,
            'ward_name' => $ward['WARDS_NAME'] ?? $ward['wardName'] ?? $wardName,
        ];
    }

    public function getProvinces(ShippingIntegration $integration): array
    {
        return Cache::remember(
            "vtp:{$integration->account_id}:{$integration->id}:provinces",
            now()->addHours(12),
            fn () => $this->client->listProvinces($integration)
        );
    }

    public function getDistricts(ShippingIntegration $integration, int $provinceId): array
    {
        return Cache::remember(
            "vtp:{$integration->account_id}:{$integration->id}:districts:{$provinceId}",
            now()->addHours(12),
            fn () => $this->client->listDistricts($integration, $provinceId)
        );
    }

    public function getWards(ShippingIntegration $integration, int $districtId): array
    {
        return Cache::remember(
            "vtp:{$integration->account_id}:{$integration->id}:wards:{$districtId}",
            now()->addHours(12),
            fn () => $this->client->listWards($integration, $districtId)
        );
    }

    private function matchByName(array $items, string $expected, array $keys): ?array
    {
        $normalizedExpected = $this->normalize($expected);

        foreach ($items as $item) {
            foreach ($keys as $key) {
                $candidate = trim((string) ($item[$key] ?? ''));
                if ($candidate !== '' && $this->normalize($candidate) === $normalizedExpected) {
                    return $item;
                }
            }
        }

        foreach ($items as $item) {
            foreach ($keys as $key) {
                $candidate = trim((string) ($item[$key] ?? ''));
                if ($candidate !== '' && str_contains($this->normalize($candidate), $normalizedExpected)) {
                    return $item;
                }
            }
        }

        return null;
    }

    private function normalize(string $value): string
    {
        return Str::of(Str::ascii($value))
            ->lower()
            ->replace(['-', ',', '.'], ' ')
            ->replaceMatches('/\s+/', ' ')
            ->trim()
            ->value();
    }
}
