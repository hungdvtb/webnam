<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SiteSetting;
use App\Models\Account;
use Illuminate\Http\Request;

class SiteSettingController extends Controller
{
    private const JSON_SETTING_KEYS = [
        'header_menu_items',
        'footer_menu_groups',
        'inventory_import_print_templates',
    ];

    public function index(Request $request)
    {
        $accountId = null;
        if ($request->has('site_code')) {
            $account = Account::where('site_code', $request->site_code)->first();
            if ($account) {
                $accountId = $account->id;
            }
        } elseif ($request->header('X-Account-Id') && $request->header('X-Account-Id') !== 'all') {
            $accountId = $request->header('X-Account-Id');
        }

        if (!$accountId) {
            return response()->json([]);
        }

        $settings = SiteSetting::where('account_id', $accountId)
            ->get(['key', 'value'])
            ->mapWithKeys(function ($setting) {
                return [
                    $setting->key => $this->decodeSettingValue($setting->key, $setting->value),
                ];
            });

        return response()->json($settings);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'account_id' => 'required|exists:accounts,id',
            'settings' => 'required|array',
        ]);

        foreach ($validated['settings'] as $key => $value) {
            SiteSetting::setValue(
                $key,
                $this->encodeSettingValue($key, $value),
                $validated['account_id']
            );
        }

        return response()->json(['message' => 'Settings updated successfully']);
    }

    private function decodeSettingValue(string $key, $value)
    {
        if (in_array($key, self::JSON_SETTING_KEYS, true)) {
            if (!is_string($value) || trim($value) === '') {
                return [];
            }

            $decoded = json_decode($value, true);
            return json_last_error() === JSON_ERROR_NONE && is_array($decoded) ? $decoded : [];
        }

        return $value;
    }

    private function encodeSettingValue(string $key, $value)
    {
        if (in_array($key, self::JSON_SETTING_KEYS, true)) {
            if (is_string($value)) {
                $decoded = json_decode($value, true);
                if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                    return json_encode(array_values($decoded), JSON_UNESCAPED_UNICODE);
                }
                return json_encode([], JSON_UNESCAPED_UNICODE);
            }

            if (is_array($value)) {
                return json_encode(array_values($value), JSON_UNESCAPED_UNICODE);
            }

            return json_encode([], JSON_UNESCAPED_UNICODE);
        }

        if (is_bool($value)) {
            return $value ? '1' : '0';
        }

        if (is_scalar($value) || $value === null) {
            return $value;
        }

        return json_encode($value, JSON_UNESCAPED_UNICODE);
    }
}
