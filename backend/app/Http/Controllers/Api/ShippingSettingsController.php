<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Carrier;
use App\Models\ShippingIntegration;
use App\Services\Shipping\ViettelPostAddressService;
use App\Services\Shipping\ViettelPostClient;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;

class ShippingSettingsController extends Controller
{
    public function index(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $integrations = ShippingIntegration::query()
            ->where('account_id', $accountId)
            ->get()
            ->keyBy('carrier_code');

        $carriers = Carrier::query()
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get()
            ->map(function (Carrier $carrier) use ($integrations) {
                $integration = $integrations->get($carrier->code);
                $config = (array) ($integration?->config_json ?? []);

                return [
                    'carrier_code' => $carrier->code,
                    'carrier_name' => $carrier->name,
                    'color' => $carrier->color,
                    'logo' => $carrier->logo,
                    'is_platform_active' => (bool) $carrier->is_active,
                    'supports_api' => $carrier->code === 'viettel_post',
                    'integration' => [
                        'is_enabled' => (bool) ($integration?->is_enabled ?? false),
                        'connection_status' => $integration?->connection_status ?? 'disconnected',
                        'api_base_url' => $integration?->api_base_url ?: 'https://partner.viettelpost.vn',
                        'username' => $integration?->username,
                        'has_password' => (bool) $integration?->password_encrypted,
                        'sender_name' => $integration?->sender_name,
                        'sender_phone' => $integration?->sender_phone,
                        'sender_address' => $integration?->sender_address,
                        'sender_province_name' => $config['sender_province_name'] ?? '',
                        'sender_district_name' => $config['sender_district_name'] ?? '',
                        'sender_ward_name' => $config['sender_ward_name'] ?? '',
                        'sender_province_id' => $integration?->sender_province_id,
                        'sender_district_id' => $integration?->sender_district_id,
                        'sender_ward_id' => $integration?->sender_ward_id,
                        'default_service_code' => $integration?->default_service_code,
                        'default_service_add' => $integration?->default_service_add,
                        'webhook_url' => $integration?->webhook_url,
                        'last_tested_at' => optional($integration?->last_tested_at)?->format('Y-m-d H:i:s'),
                        'last_error_message' => $integration?->last_error_message,
                    ],
                ];
            })
            ->values();

        return response()->json([
            'carriers' => $carriers,
        ]);
    }

    public function updateIntegration(
        Request $request,
        string $carrierCode,
        ViettelPostAddressService $addressService
    ) {
        $accountId = (int) $request->header('X-Account-Id');
        $carrier = Carrier::query()->where('code', $carrierCode)->firstOrFail();

        $validated = $request->validate([
            'is_enabled' => 'nullable|boolean',
            'api_base_url' => 'nullable|url',
            'username' => 'nullable|string|max:255',
            'password' => 'nullable|string|max:255',
            'sender_name' => 'nullable|string|max:255',
            'sender_phone' => 'nullable|string|max:30',
            'sender_address' => 'nullable|string',
            'sender_province_name' => 'nullable|string|max:255',
            'sender_district_name' => 'nullable|string|max:255',
            'sender_ward_name' => 'nullable|string|max:255',
            'default_service_code' => 'nullable|string|max:30',
            'default_service_add' => 'nullable|string|max:50',
            'webhook_url' => 'nullable|url',
        ]);

        $integration = ShippingIntegration::query()->firstOrNew([
            'account_id' => $accountId,
            'carrier_code' => $carrierCode,
        ]);

        $configJson = (array) ($integration->config_json ?? []);
        foreach (['sender_province_name', 'sender_district_name', 'sender_ward_name'] as $key) {
            if (array_key_exists($key, $validated)) {
                $configJson[$key] = $validated[$key];
            }
        }

        $integration->fill([
            'carrier_name' => $carrier->name,
            'is_enabled' => (bool) ($validated['is_enabled'] ?? $integration->is_enabled),
            'api_base_url' => $validated['api_base_url'] ?? $integration->api_base_url ?? 'https://partner.viettelpost.vn',
            'username' => $validated['username'] ?? $integration->username,
            'sender_name' => $validated['sender_name'] ?? $integration->sender_name,
            'sender_phone' => $validated['sender_phone'] ?? $integration->sender_phone,
            'sender_address' => $validated['sender_address'] ?? $integration->sender_address,
            'default_service_code' => $validated['default_service_code'] ?? $integration->default_service_code,
            'default_service_add' => $validated['default_service_add'] ?? $integration->default_service_add,
            'webhook_url' => $validated['webhook_url'] ?? $integration->webhook_url,
            'config_json' => $configJson,
        ]);

        if (!empty($validated['password'])) {
            $integration->password_encrypted = Crypt::encryptString($validated['password']);
        }

        if (
            ($configJson['sender_province_name'] ?? '')
            && ($configJson['sender_district_name'] ?? '')
            && ($configJson['sender_ward_name'] ?? '')
            && $carrierCode === 'viettel_post'
        ) {
            $resolved = $addressService->resolveSenderIds($integration, [
                'province' => $configJson['sender_province_name'],
                'district' => $configJson['sender_district_name'],
                'ward' => $configJson['sender_ward_name'],
            ]);

            $integration->sender_province_id = $resolved['province_id'];
            $integration->sender_district_id = $resolved['district_id'];
            $integration->sender_ward_id = $resolved['ward_id'];
        }

        $integration->save();

        return response()->json(['message' => 'Đã lưu cài đặt vận chuyển.', 'integration' => $integration->fresh()]);
    }

    public function testIntegration(Request $request, string $carrierCode, ViettelPostClient $viettelPostClient)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $integration = ShippingIntegration::query()
            ->where('account_id', $accountId)
            ->where('carrier_code', $carrierCode)
            ->firstOrFail();

        try {
            if ($carrierCode !== 'viettel_post') {
                throw new \RuntimeException('Hãng này chưa hỗ trợ test kết nối API.');
            }

            $result = $viettelPostClient->testConnection($integration);

            $integration->forceFill([
                'connection_status' => 'connected',
                'last_tested_at' => now(),
                'last_error_message' => null,
            ])->save();

            return response()->json([
                'message' => 'Kết nối ViettelPost thành công.',
                'meta' => [
                    'provinces_count' => $result['provinces_count'],
                ],
            ]);
        } catch (\Throwable $e) {
            $integration->forceFill([
                'connection_status' => 'error',
                'last_tested_at' => now(),
                'last_error_message' => $e->getMessage(),
            ])->save();

            return response()->json(['message' => $e->getMessage()], 422);
        }
    }
}
