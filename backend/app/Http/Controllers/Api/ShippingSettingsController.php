<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Carrier;
use App\Models\ShippingIntegration;
use App\Models\Warehouse;
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
            ->with('defaultWarehouse:id,name')
            ->get()
            ->keyBy('carrier_code');

        $warehouses = Warehouse::query()
            ->where('account_id', $accountId)
            ->orderByDesc('is_active')
            ->orderBy('name')
            ->get([
                'id',
                'name',
                'code',
                'contact_name',
                'phone',
                'email',
                'address',
                'city',
                'province_name',
                'district_name',
                'ward_name',
                'province_id',
                'district_id',
                'ward_id',
                'is_active',
            ]);

        $carriers = Carrier::query()
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get()
            ->map(function (Carrier $carrier) use ($integrations) {
                $integration = $integrations->get($carrier->code);
                $config = (array) ($integration?->config_json ?? []);
                $effectiveStatus = $integration?->connection_status ?? 'disconnected';
                $hasApiKey = (bool) $integration?->access_token;
                if (($integration?->is_enabled ?? false) && $hasApiKey && $effectiveStatus === 'disconnected') {
                    $effectiveStatus = 'configured';
                }

                return [
                    'carrier_code' => $carrier->code,
                    'carrier_name' => $carrier->name,
                    'color' => $carrier->color,
                    'logo' => $carrier->logo,
                    'is_platform_active' => (bool) $carrier->is_active,
                    'supports_api' => $carrier->code === 'viettel_post',
                    'integration' => [
                        'is_enabled' => (bool) ($integration?->is_enabled ?? false),
                        'connection_status' => $effectiveStatus,
                        'api_base_url' => $integration?->api_base_url ?: 'https://partner.viettelpost.vn',
                        'auth_mode' => $config['auth_mode'] ?? 'api_key',
                        'has_api_key' => $hasApiKey,
                        'username' => $integration?->username,
                        'has_password' => filled($integration?->password_encrypted),
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
                        'default_warehouse_id' => $integration?->default_warehouse_id,
                        'default_warehouse_name' => $integration?->defaultWarehouse?->name,
                        'webhook_url' => $integration?->webhook_url,
                        'last_tested_at' => optional($integration?->last_tested_at)?->format('Y-m-d H:i:s'),
                        'last_error_message' => $integration?->last_error_message,
                    ],
                ];
            })
            ->values();

        return response()->json([
            'carriers' => $carriers,
            'warehouses' => $warehouses,
        ]);
    }

    public function updateIntegration(Request $request, string $carrierCode)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $carrier = Carrier::query()->where('code', $carrierCode)->firstOrFail();

        $validated = $request->validate([
            'is_enabled' => 'nullable|boolean',
            'api_base_url' => 'nullable|url',
            'auth_mode' => 'nullable|string|in:api_key,credentials',
            'api_key' => 'nullable|string|max:4000',
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
            'default_warehouse_id' => 'nullable|integer',
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
        $configJson['auth_mode'] = $validated['auth_mode'] ?? ($configJson['auth_mode'] ?? 'api_key');

        $defaultWarehouse = null;
        if (!empty($validated['default_warehouse_id'])) {
            $defaultWarehouse = Warehouse::query()
                ->where('account_id', $accountId)
                ->find($validated['default_warehouse_id']);

            if (!$defaultWarehouse) {
                return response()->json(['message' => 'Kho mac dinh khong hop le cho tai khoan hien tai.'], 422);
            }
        }

        $integration->fill([
            'carrier_name' => $carrier->name,
            'is_enabled' => (bool) ($validated['is_enabled'] ?? $integration->is_enabled),
            'api_base_url' => $validated['api_base_url'] ?? $integration->api_base_url ?? 'https://partner.viettelpost.vn',
            'username' => $validated['username'] ?? $integration->username,
            'default_service_code' => $validated['default_service_code'] ?? $integration->default_service_code,
            'default_service_add' => $validated['default_service_add'] ?? $integration->default_service_add,
            'default_warehouse_id' => $defaultWarehouse?->id,
            'webhook_url' => $validated['webhook_url'] ?? $integration->webhook_url,
            'config_json' => $configJson,
        ]);

        if ($defaultWarehouse) {
            $integration->sender_name = $defaultWarehouse->contact_name ?: $defaultWarehouse->name;
            $integration->sender_phone = $defaultWarehouse->phone;
            $integration->sender_address = $defaultWarehouse->address;
            $integration->sender_province_id = $defaultWarehouse->province_id;
            $integration->sender_district_id = $defaultWarehouse->district_id;
            $integration->sender_ward_id = $defaultWarehouse->ward_id;
            $configJson['sender_province_name'] = $defaultWarehouse->province_name;
            $configJson['sender_district_name'] = $defaultWarehouse->district_name;
            $configJson['sender_ward_name'] = $defaultWarehouse->ward_name;
            $integration->config_json = $configJson;
        } else {
            $integration->sender_name = $validated['sender_name'] ?? $integration->sender_name;
            $integration->sender_phone = $validated['sender_phone'] ?? $integration->sender_phone;
            $integration->sender_address = $validated['sender_address'] ?? $integration->sender_address;
        }

        if (array_key_exists('api_key', $validated) && trim((string) $validated['api_key']) !== '') {
            $integration->access_token = trim((string) $validated['api_key']);
            $integration->token_expires_at = null;
        }

        if (array_key_exists('password', $validated) && trim((string) $validated['password']) !== '') {
            $integration->password_encrypted = Crypt::encryptString(trim((string) $validated['password']));
        }

        if (($configJson['auth_mode'] ?? 'api_key') === 'credentials' && (!$integration->username || !$integration->password_encrypted)) {
            return response()->json(['message' => 'Vui long nhap day du username va password ViettelPost de dung che do thong tin dang nhap.'], 422);
        }

        $hasToken = filled($integration->access_token);
        if ($integration->is_enabled && $hasToken) {
            if ($integration->connection_status !== 'connected') {
                $integration->connection_status = 'configured';
            }
            $integration->last_error_message = null;
        } elseif (!$integration->is_enabled) {
            $integration->connection_status = 'disconnected';
        }

        $integration->save();

        return response()->json([
            'message' => 'Da luu cai dat van chuyen.',
            'integration' => $integration->fresh('defaultWarehouse'),
        ]);
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
                throw new \RuntimeException('Hang nay chua ho tro test ket noi API.');
            }

            $result = $viettelPostClient->testConnection($integration);

            $integration->forceFill([
                'connection_status' => 'connected',
                'last_tested_at' => now(),
                'last_error_message' => null,
            ])->save();

            return response()->json([
                'message' => 'Ket noi ViettelPost thanh cong.',
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
