<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\UserSetting;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Throwable;

class UserSettingController extends Controller
{
    private const STORAGE_AREAS = ['localStorage', 'sessionStorage'];
    private const RESERVED_KEYS = ['token', 'user'];

    public function show(Request $request): JsonResponse
    {
        if (!$this->hasUserSettingsTable()) {
            return response()->json($this->fallbackPayload());
        }

        try {
            $userSetting = $this->getOrCreateUserSetting($request);
        } catch (QueryException $exception) {
            if ($this->isMissingUserSettingsTableException($exception)) {
                return response()->json($this->fallbackPayload());
            }

            throw $exception;
        }

        return response()->json($this->present($userSetting));
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'localStorage' => 'nullable|array',
            'sessionStorage' => 'nullable|array',
        ]);

        if (!$this->hasUserSettingsTable()) {
            return response()->json($this->fallbackPayload($validated));
        }

        try {
            $userSetting = $this->getOrCreateUserSetting($request);
        } catch (QueryException $exception) {
            if ($this->isMissingUserSettingsTableException($exception)) {
                return response()->json($this->fallbackPayload($validated));
            }

            throw $exception;
        }

        $settings = $this->normalizeSettingsPayload($userSetting->settings);

        foreach (self::STORAGE_AREAS as $storageArea) {
            if (!array_key_exists($storageArea, $validated)) {
                continue;
            }

            $settings[$storageArea] = $this->mergeStorageBucket(
                $settings[$storageArea] ?? [],
                $validated[$storageArea] ?? []
            );
        }

        $userSetting->settings = $settings;
        $userSetting->save();

        return response()->json($this->present($userSetting));
    }

    protected function getOrCreateUserSetting(Request $request): UserSetting
    {
        return UserSetting::query()->firstOrCreate(
            ['user_id' => $request->user()->id],
            ['settings' => $this->normalizeSettingsPayload([])]
        );
    }

    protected function normalizeSettingsPayload($payload): array
    {
        $normalizedPayload = is_array($payload) ? $payload : [];

        foreach (self::STORAGE_AREAS as $storageArea) {
            $normalizedPayload[$storageArea] = $this->sanitizeStorageBucket($normalizedPayload[$storageArea] ?? []);
        }

        return $normalizedPayload;
    }

    protected function sanitizeStorageBucket($bucket): array
    {
        if (!is_array($bucket)) {
            return [];
        }

        $normalizedBucket = [];

        foreach ($bucket as $key => $value) {
            $normalizedKey = trim((string) $key);
            if ($normalizedKey === '' || in_array($normalizedKey, self::RESERVED_KEYS, true)) {
                continue;
            }

            if (is_array($value) || is_object($value)) {
                $normalizedBucket[$normalizedKey] = json_encode($value, JSON_UNESCAPED_UNICODE);
                continue;
            }

            if (is_bool($value)) {
                $normalizedBucket[$normalizedKey] = $value ? 'true' : 'false';
                continue;
            }

            if ($value === null) {
                continue;
            }

            $normalizedBucket[$normalizedKey] = (string) $value;
        }

        return $normalizedBucket;
    }

    protected function mergeStorageBucket($currentBucket, $incomingBucket): array
    {
        $mergedBucket = $this->sanitizeStorageBucket($currentBucket);

        if (!is_array($incomingBucket)) {
            return $mergedBucket;
        }

        foreach ($incomingBucket as $key => $value) {
            $normalizedKey = trim((string) $key);
            if ($normalizedKey === '' || in_array($normalizedKey, self::RESERVED_KEYS, true)) {
                continue;
            }

            if ($value === null) {
                unset($mergedBucket[$normalizedKey]);
                continue;
            }

            if (is_array($value) || is_object($value)) {
                $mergedBucket[$normalizedKey] = json_encode($value, JSON_UNESCAPED_UNICODE);
                continue;
            }

            if (is_bool($value)) {
                $mergedBucket[$normalizedKey] = $value ? 'true' : 'false';
                continue;
            }

            $mergedBucket[$normalizedKey] = (string) $value;
        }

        return $mergedBucket;
    }

    protected function present(UserSetting $userSetting): array
    {
        $settings = $this->normalizeSettingsPayload($userSetting->settings);

        return [
            'localStorage' => $settings['localStorage'],
            'sessionStorage' => $settings['sessionStorage'],
            'updated_at' => $userSetting->updated_at?->toISOString(),
        ];
    }

    protected function fallbackPayload(array $settings = []): array
    {
        $normalizedSettings = $this->normalizeSettingsPayload($settings);

        return [
            'localStorage' => $normalizedSettings['localStorage'],
            'sessionStorage' => $normalizedSettings['sessionStorage'],
            'updated_at' => null,
        ];
    }

    protected function hasUserSettingsTable(): bool
    {
        try {
            return Schema::hasTable('user_settings');
        } catch (Throwable) {
            return false;
        }
    }

    protected function isMissingUserSettingsTableException(QueryException $exception): bool
    {
        $message = strtolower($exception->getMessage());

        return str_contains($message, 'user_settings')
            && (
                str_contains($message, 'does not exist')
                || str_contains($message, 'undefined table')
                || str_contains($message, 'base table or view not found')
            );
    }
}
