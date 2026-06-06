<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\SiteSetting;
use App\Support\OrderBootstrapCache;
use App\Services\AI\GeminiService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Validator;

class SiteSettingController extends Controller
{
    private const JSON_SETTING_KEYS = [
        'header_menu_items',
        'footer_menu_groups',
        'store_locations',
        'inventory_import_print_templates',
        'order_quick_pick_groups',
        'fb_pixels',
        'ga_trackings',
        'google_ads_conversions',
        'tt_pixels',
        GeminiService::SETTING_KEYS,
    ];

    private const BOOLEAN_SETTING_KEYS = [
        'fb_pixel_active',
        'ga_active',
        'tt_pixel_active',
        'ai_gemini_enabled',
        'order_product_quick_mode_default_enabled',
    ];

    private const DEFAULT_SETTING_VALUES = [
        'order_product_quick_mode_default_enabled' => true,
    ];

    private const SECRET_SETTING_KEYS = [
        GeminiService::SETTING_API_KEY,
    ];

    private const MULTILINE_TEXT_SETTING_KEYS = [
        'footer_address',
    ];

    public function __construct(
        private readonly GeminiService $geminiService,
    ) {
    }

    public function index(Request $request)
    {
        $accountId = $this->resolveAccountId($request);

        if (!$accountId) {
            return response()->json([]);
        }

        $settings = [];

        SiteSetting::query()
            ->where('account_id', $accountId)
            ->get(['key', 'value'])
            ->each(function (SiteSetting $setting) use (&$settings) {
                if (in_array($setting->key, self::SECRET_SETTING_KEYS, true)) {
                    return;
                }

                $value = $this->decodeSettingValue($setting->key, $setting->value);
                
                // Mask API keys for security while still allowing metadata editing
                if ($setting->key === GeminiService::SETTING_KEYS && is_array($value)) {
                    $value = array_map(function($item) {
                        $realKey = $item['key'] ?? '';
                        $status = 'ready';
                        $retryAfter = 0;

                        if (!empty($realKey)) {
                            $cacheKey = 'gemini_key_exhausted_' . md5(trim($realKey));
                            $exhaustedUntil = \Illuminate\Support\Facades\Cache::get($cacheKey);
                            if ($exhaustedUntil) {
                                $status = 'exhausted';
                                $retryAfter = max(0, (int) $exhaustedUntil - now()->timestamp);
                            }
                        }

                        if (is_string($realKey) && strlen($realKey) > 8) {
                            $item['key'] = substr($realKey, 0, 4) . '...' . substr($realKey, -4);
                        }

                        $item['status'] = $status;
                        $item['retry_after_seconds'] = $retryAfter;
                        
                        return $item;
                    }, $value);
                }

                $settings[$setting->key] = $value;
            });

        foreach (self::DEFAULT_SETTING_VALUES as $key => $value) {
            if (!array_key_exists($key, $settings)) {
                $settings[$key] = $value;
            }
        }

        $aiStatus = $this->geminiService->status($accountId);

        $settings[GeminiService::SETTING_MODEL] = trim((string) ($aiStatus['model'] ?? $settings[GeminiService::SETTING_MODEL] ?? GeminiService::DEFAULT_MODEL));
        $settings[GeminiService::SETTING_ENABLED] = (bool) ($settings[GeminiService::SETTING_ENABLED] ?? $aiStatus['enabled']);
        $settings['ai_gemini_has_api_key'] = (bool) $aiStatus['configured'];
        $settings['ai_gemini_available'] = (bool) $aiStatus['available'];
        $settings['ai_gemini_key_source'] = $aiStatus['key_source'];

        return response()->json($settings);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'account_id' => 'required|exists:accounts,id',
            'settings' => 'required|array',
        ]);

        $storeLocations = $validated['settings']['store_locations'] ?? null;
        if ($storeLocations !== null) {
            Validator::make(
                ['store_locations' => $storeLocations],
                [
                    'store_locations' => 'array',
                    'store_locations.*.id' => 'nullable|string|max:100',
                    'store_locations.*.name' => 'required|string|max:255',
                    'store_locations.*.city' => 'nullable|string|max:120',
                    'store_locations.*.tag' => 'nullable|string|max:120',
                    'store_locations.*.address' => 'required|string|max:500',
                    'store_locations.*.phone' => 'nullable|string|max:80',
                    'store_locations.*.hotline' => 'nullable|string|max:80',
                    'store_locations.*.email' => 'nullable|email|max:255',
                    'store_locations.*.opening_hours' => 'nullable|string|max:255',
                    'store_locations.*.google_maps_link' => 'nullable|url|max:1000',
                    'store_locations.*.image_url' => 'nullable|string|max:1000',
                    'store_locations.*.note' => 'nullable|string|max:4000',
                    'store_locations.*.order' => 'nullable|integer|min:1',
                    'store_locations.*.sort_order' => 'nullable|integer|min:1',
                    'store_locations.*.is_active' => 'nullable|boolean',
                ]
            )->validate();
        }

        $orderQuickPickGroups = $validated['settings']['order_quick_pick_groups'] ?? null;
        if ($orderQuickPickGroups !== null) {
            Validator::make(
                ['order_quick_pick_groups' => $orderQuickPickGroups],
                [
                    'order_quick_pick_groups' => 'array',
                    'order_quick_pick_groups.*.id' => 'nullable|string|max:100',
                    'order_quick_pick_groups.*.attribute_id' => 'required|integer|min:1',
                    'order_quick_pick_groups.*.attribute_value' => 'required|string|max:255',
                    'order_quick_pick_groups.*.items' => 'array|max:15',
                    'order_quick_pick_groups.*.items.*.id' => 'nullable|string|max:100',
                    'order_quick_pick_groups.*.items.*.target_product_id' => 'required|integer|min:1',
                    'order_quick_pick_groups.*.items.*.parent_product_id' => 'nullable|integer|min:1',
                    'order_quick_pick_groups.*.items.*.type' => 'nullable|string|in:product,variation',
                    'order_quick_pick_groups.*.items.*.display_name' => 'nullable|string|max:255',
                    'order_quick_pick_groups.*.items.*.display_sku' => 'nullable|string|max:100',
                    'order_quick_pick_groups.*.items.*.option_label' => 'nullable|string|max:255',
                    'order_quick_pick_groups.*.items.*.main_image' => 'nullable|string|max:1000',
                    'order_quick_pick_groups.*.items.*.price' => 'nullable|numeric|min:0',
                    'order_quick_pick_groups.*.items.*.cost_price' => 'nullable|numeric|min:0',
                    'order_quick_pick_groups.*.items.*.order' => 'nullable|integer|min:1',
                ]
            )->validate();
        }

        foreach ($validated['settings'] as $key => $value) {
            if ($key === GeminiService::SETTING_MODEL) {
                $value = $this->geminiService->normalizeModelName(is_scalar($value) ? (string) $value : null);
            }

            if ($key === GeminiService::SETTING_KEYS && is_array($value)) {
                $oldValue = SiteSetting::getValue(GeminiService::SETTING_KEYS, (int) $validated['account_id']);
                $oldDecoded = is_string($oldValue) ? json_decode($oldValue, true) : [];
                $oldKeyMap = [];
                if (is_array($oldDecoded)) {
                    foreach ($oldDecoded as $oldItem) {
                        if (isset($oldItem['id'], $oldItem['key'])) {
                            $oldKeyMap[$oldItem['id']] = $oldItem['key'];
                        }
                    }
                }

                $value = array_map(function($item) use ($oldKeyMap) {
                    if (isset($item['id'], $item['key']) && str_contains($item['key'], '...') && isset($oldKeyMap[$item['id']])) {
                        $item['key'] = $oldKeyMap[$item['id']];
                    }
                    return $item;
                }, $value);
            }

            if ($this->shouldSkipEmptySecretSetting($key, $value)) {
                continue;
            }

            SiteSetting::setValue(
                $key,
                $this->encodeSettingValue($key, $value),
                (int) $validated['account_id']
            );
        }

        OrderBootstrapCache::forget((int) $validated['account_id'], OrderBootstrapCache::MODE_FORM);

        return response()->json([
            'message' => 'Settings updated successfully',
            'ai' => $this->geminiService->status((int) $validated['account_id']),
        ]);
    }

    private function resolveAccountId(Request $request): ?int
    {
        if ($request->has('site_code')) {
            $account = Account::query()->where('site_code', $request->site_code)->first();

            return $account?->id;
        }

        $headerAccountId = $request->header('X-Account-Id');
        if ($headerAccountId && $headerAccountId !== 'all') {
            return (int) $headerAccountId;
        }

        $siteCode = $request->header('X-Site-Code');
        if ($siteCode) {
            $account = Account::query()->where('site_code', $siteCode)->first();

            return $account?->id;
        }

        return null;
    }

    private function decodeSettingValue(string $key, mixed $value): mixed
    {
        if (in_array($key, self::JSON_SETTING_KEYS, true)) {
            if (!is_string($value) || trim($value) === '') {
                return [];
            }

            $decoded = json_decode($value, true);

            return json_last_error() === JSON_ERROR_NONE && is_array($decoded) ? $decoded : [];
        }

        if (in_array($key, self::BOOLEAN_SETTING_KEYS, true)) {
            return $this->toBoolean($value);
        }

        if (in_array($key, self::MULTILINE_TEXT_SETTING_KEYS, true)) {
            return $this->normalizeMultilineText($value);
        }

        return $value;
    }

    private function encodeSettingValue(string $key, mixed $value): mixed
    {
        if (in_array($key, self::SECRET_SETTING_KEYS, true)) {
            return Crypt::encryptString(trim((string) $value));
        }

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

        if (in_array($key, self::BOOLEAN_SETTING_KEYS, true)) {
            return $this->toBoolean($value) ? '1' : '0';
        }

        if (in_array($key, self::MULTILINE_TEXT_SETTING_KEYS, true)) {
            return $this->normalizeMultilineText($value);
        }

        if (is_bool($value)) {
            return $value ? '1' : '0';
        }

        if (is_scalar($value) || $value === null) {
            return $value;
        }

        return json_encode($value, JSON_UNESCAPED_UNICODE);
    }

    private function normalizeMultilineText(mixed $value): string
    {
        if ($value === null) {
            return '';
        }

        $text = is_scalar($value)
            ? (string) $value
            : json_encode($value, JSON_UNESCAPED_UNICODE);

        if (!is_string($text)) {
            return '';
        }

        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $normalized = preg_replace('/\\\\r\\\\n|\\\\n|\\\\r/', "\n", $text);

        return $normalized ?? $text;
    }

    private function shouldSkipEmptySecretSetting(string $key, mixed $value): bool
    {
        if (!in_array($key, self::SECRET_SETTING_KEYS, true)) {
            return false;
        }

        return trim((string) $value) === '';
    }

    private function toBoolean(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        return match (strtolower(trim((string) $value))) {
            '1', 'true', 'yes', 'on' => true,
            default => false,
        };
    }
}
