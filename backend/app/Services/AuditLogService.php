<?php

namespace App\Services;

use App\Models\AuditLog;
use Illuminate\Http\Request;

class AuditLogService
{
    private const SENSITIVE_KEYS = [
        'password',
        'password_confirmation',
        'token',
        'access_token',
        'api_key',
        'ai_api_key',
        'secret',
    ];

    public function log(array $attributes): void
    {
        AuditLog::query()->create($attributes);
    }

    public function sanitizePayload(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }

        $sanitized = [];
        foreach ($value as $key => $item) {
            if (in_array(strtolower((string) $key), self::SENSITIVE_KEYS, true)) {
                $sanitized[$key] = '[redacted]';
                continue;
            }

            $sanitized[$key] = $this->sanitizePayload($item);
        }

        return $sanitized;
    }

    public function logFromRequest(Request $request, int $responseStatus, ?string $module = null, ?string $action = null): void
    {
        $user = $request->user();
        if (!$user) {
            return;
        }

        $accountId = app(AccessControlService::class)->resolveAccountIdFromRequest($request);

        $this->log([
            'user_id' => $user->id,
            'account_id' => $accountId,
            'action' => $action ?: strtolower($request->method()),
            'module' => $module,
            'entity_type' => $this->resolveEntityType($request),
            'entity_id' => $this->resolveEntityId($request),
            'method' => $request->method(),
            'path' => $request->path(),
            'after' => $this->sanitizePayload($request->except(self::SENSITIVE_KEYS)),
            'response_status' => $responseStatus,
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);
    }

    private function resolveEntityType(Request $request): ?string
    {
        $path = preg_replace('#^api/#', '', $request->path());
        $segment = explode('/', trim((string) $path, '/'))[0] ?? null;

        return $segment ?: null;
    }

    private function resolveEntityId(Request $request): ?string
    {
        foreach (['id', 'user', 'order', 'product', 'category'] as $key) {
            $value = $request->route($key);
            if ($value !== null) {
                return (string) $value;
            }
        }

        return null;
    }
}
