<?php

namespace App\Services;

use App\Models\Account;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Laravel\Sanctum\PersonalAccessToken;

class AccessControlService
{
    public const MODULES = [
        'dashboard',
        'accounts',
        'products',
        'categories',
        'orders',
        'customers',
        'leads',
        'inventory',
        'warehouses',
        'attributes',
        'settings',
        'menus',
        'users',
        'blog',
        'reports',
        'payroll',
    ];

    public const ACTIONS = [
        'view',
        'create',
        'update',
        'delete_soft',
        'delete_permanent',
        'export',
    ];

    public const DATA_PERMISSIONS = [
        'cost.view',
        'profit.view',
        'finance.view',
    ];

    private const ROLE_ALIASES = [
        'owner' => 'owner',
        'manager' => 'manager',
        'staff' => 'sale',
        'sale' => 'sale',
        'sales' => 'sale',
        'warehouse' => 'warehouse',
        'viewer' => 'viewer',
        'custom' => 'custom',
    ];

    public static function permissionsForRole(string $role): array
    {
        $role = self::normalizeRole($role);
        $all = self::allActionPermissions();

        return match ($role) {
            'owner' => $all,
            'manager' => self::permissionsForModules([
                'dashboard',
                'products',
                'categories',
                'orders',
                'customers',
                'leads',
                'inventory',
                'warehouses',
                'attributes',
                'settings',
                'menus',
                'blog',
                'reports',
                'payroll',
            ], ['view', 'create', 'update', 'delete_soft', 'export']),
            'sale' => array_values(array_unique(array_merge(
                self::permissionsForModules(['dashboard'], ['view']),
                self::permissionsForModules(['orders'], ['view', 'create', 'update', 'delete_soft', 'export']),
                self::permissionsForModules(['products', 'inventory', 'warehouses'], ['view']),
                self::permissionsForModules(['customers', 'leads'], ['view', 'create', 'update'])
            ))),
            'warehouse' => array_values(array_unique(array_merge(
                self::permissionsForModules(['dashboard', 'orders', 'products'], ['view']),
                self::permissionsForModules(['inventory', 'warehouses'], ['view', 'create', 'update', 'delete_soft', 'export'])
            ))),
            'viewer' => self::permissionsForModules([
                'dashboard',
                'products',
                'orders',
                'customers',
                'leads',
                'inventory',
                'warehouses',
            ], ['view']),
            default => [],
        };
    }

    public static function dataPermissionsForRole(string $role): array
    {
        return match (self::normalizeRole($role)) {
            'owner', 'manager' => self::DATA_PERMISSIONS,
            default => [],
        };
    }

    public static function expandLegacyPermissions(?array $permissions): array
    {
        if ($permissions === null) {
            return self::permissionsForModules(self::MODULES, ['view', 'create', 'update', 'delete_soft', 'export']);
        }

        $expanded = [];
        foreach ($permissions as $permission) {
            $permission = trim((string) $permission);
            if ($permission === '') {
                continue;
            }

            if (str_contains($permission, '.')) {
                $expanded[] = $permission;
                continue;
            }

            if (!in_array($permission, self::MODULES, true)) {
                continue;
            }

            if ($permission === 'users') {
                $expanded[] = 'users.manage';
                $expanded[] = 'users.view';
                continue;
            }

            $actions = in_array($permission, ['dashboard', 'reports'], true)
                ? ['view', 'export']
                : ['view', 'create', 'update', 'delete_soft', 'export'];

            foreach ($actions as $action) {
                $expanded[] = "{$permission}.{$action}";
            }
        }

        return array_values(array_unique($expanded));
    }

    public static function normalizePermissions(mixed $permissions): array
    {
        if ($permissions === null) {
            return [];
        }

        if (is_string($permissions)) {
            $decoded = json_decode($permissions, true);
            $permissions = is_array($decoded) ? $decoded : [];
        }

        if (!is_array($permissions)) {
            return [];
        }

        $normalized = [];
        foreach ($permissions as $permission) {
            $permission = trim((string) $permission);
            if ($permission !== '') {
                $normalized[] = $permission;
            }
        }

        return array_values(array_unique($normalized));
    }

    public static function normalizeDataPermissions(mixed $permissions): array
    {
        $normalized = self::normalizePermissions($permissions);

        return array_values(array_intersect($normalized, self::DATA_PERMISSIONS));
    }

    public static function moduleIdsFromPermissions(array $permissions): array
    {
        $modules = [];
        foreach ($permissions as $permission) {
            $permission = trim((string) $permission);
            if ($permission === '') {
                continue;
            }

            $module = str_contains($permission, '.')
                ? explode('.', $permission, 2)[0]
                : $permission;

            if (in_array($module, self::MODULES, true)) {
                $modules[] = $module;
            }
        }

        return array_values(array_unique($modules));
    }

    public function can(User $user, string $permission, int|string|null $accountId = null): bool
    {
        if ((int) ($user->status ?? 1) !== 1) {
            return false;
        }

        if ($user->is_admin) {
            return true;
        }

        return $this->accountPivots($user, $accountId)->contains(function ($pivot) use ($user, $permission) {
            if ((int) ($pivot->status ?? 1) !== 1) {
                return false;
            }

            $permissions = self::normalizePermissions($pivot->permissions ?? null);
            if ($permissions === []) {
                $permissions = self::expandLegacyPermissions($this->legacyUserPermissions($user));
            }

            return $this->permissionsContain($permissions, $permission);
        });
    }

    public function canViewData(User $user, string $permission, int|string|null $accountId = null): bool
    {
        if ((int) ($user->status ?? 1) !== 1) {
            return false;
        }

        if ($user->is_admin) {
            return true;
        }

        return $this->accountPivots($user, $accountId)->contains(function ($pivot) use ($permission) {
            if ((int) ($pivot->status ?? 1) !== 1) {
                return false;
            }

            $permissions = self::normalizeDataPermissions($pivot->data_permissions ?? []);

            return in_array($permission, $permissions, true);
        });
    }

    public function resolveAccountIdFromRequest(Request $request): ?int
    {
        $raw = $request->header('X-Account-Id') ?: $request->header('X-Site-Code');
        $raw = trim((string) $raw);

        if ($raw === '' || $raw === 'all') {
            return null;
        }

        if (ctype_digit($raw)) {
            return (int) $raw;
        }

        return Account::query()->where('site_code', $raw)->value('id');
    }

    public function resolveUserFromRequest(Request $request): ?User
    {
        $user = $request->user();
        if ($user instanceof User) {
            return $user;
        }

        $token = trim((string) $request->bearerToken());
        if ($token === '') {
            return null;
        }

        $accessToken = PersonalAccessToken::findToken($token);
        $tokenable = $accessToken?->tokenable;

        return $tokenable instanceof User ? $tokenable : null;
    }

    public static function sanitizePermissionsForStorage(mixed $permissions): array
    {
        $permissions = self::normalizePermissions($permissions);
        $validDetailedPermissions = array_flip(array_merge(
            self::allActionPermissions(),
            ['users.manage']
        ));

        $sanitized = [];
        foreach ($permissions as $permission) {
            if (isset($validDetailedPermissions[$permission])) {
                $sanitized[] = $permission;
            }
        }

        return array_values(array_unique($sanitized));
    }

    private static function normalizeRole(string $role): string
    {
        $role = strtolower(trim($role));

        return self::ROLE_ALIASES[$role] ?? 'custom';
    }

    private static function allActionPermissions(): array
    {
        return self::permissionsForModules(self::MODULES, self::ACTIONS);
    }

    private static function permissionsForModules(array $modules, array $actions): array
    {
        $permissions = [];
        foreach ($modules as $module) {
            if (!in_array($module, self::MODULES, true)) {
                continue;
            }

            foreach ($actions as $action) {
                if (!in_array($action, self::ACTIONS, true)) {
                    continue;
                }

                $permissions[] = "{$module}.{$action}";
            }
        }

        return array_values(array_unique($permissions));
    }

    private function accountPivots(User $user, int|string|null $accountId = null): Collection
    {
        $user->loadMissing('accounts');
        $accounts = $user->accounts;

        if ($accountId !== null && $accountId !== '') {
            $accountId = (int) $accountId;
            $accounts = $accounts->filter(fn ($account) => (int) $account->id === $accountId);
        }

        return $accounts->map(fn ($account) => $account->pivot)->filter();
    }

    private function legacyUserPermissions(User $user): ?array
    {
        $permissions = $user->permissions;

        if ($permissions === null) {
            return null;
        }

        if (is_string($permissions)) {
            $decoded = json_decode($permissions, true);
            return is_array($decoded) ? $decoded : [];
        }

        return is_array($permissions) ? $permissions : [];
    }

    private function permissionsContain(array $permissions, string $requiredPermission): bool
    {
        if (in_array($requiredPermission, $permissions, true)) {
            return true;
        }

        [$module, $action] = array_pad(explode('.', $requiredPermission, 2), 2, null);

        if ($module && $action && in_array("{$module}.*", $permissions, true)) {
            return true;
        }

        if ($requiredPermission === 'users.manage') {
            return in_array('users.update', $permissions, true) || in_array('users.*', $permissions, true);
        }

        return false;
    }
}
