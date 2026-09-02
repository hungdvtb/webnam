<?php

use App\Services\AccessControlService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('account_user') || !Schema::hasColumn('account_user', 'permissions')) {
            return;
        }

        $now = now();
        $newPermissions = $this->employeeInventoryFeaturePermissions();

        DB::table('account_user')
            ->orderBy('id')
            ->each(function ($pivot) use ($newPermissions, $now) {
                if ($this->normalizeRole($pivot->role ?? '') !== 'employee') {
                    return;
                }

                $permissions = $this->decodeJsonValue($pivot->permissions ?? null);
                if ($permissions === null || $permissions === []) {
                    $permissions = AccessControlService::permissionsForRole('employee');
                } else {
                    $permissions = array_values(array_unique(array_merge($permissions, $newPermissions)));
                }

                DB::table('account_user')
                    ->where('id', $pivot->id)
                    ->update([
                        'permissions' => json_encode(AccessControlService::sanitizePermissionsForStorage($permissions)),
                        'updated_at' => $now,
                    ]);
            });
    }

    public function down(): void
    {
        if (!Schema::hasTable('account_user') || !Schema::hasColumn('account_user', 'permissions')) {
            return;
        }

        $now = now();
        $removePermissions = $this->employeeInventoryFeaturePermissions();

        DB::table('account_user')
            ->orderBy('id')
            ->each(function ($pivot) use ($removePermissions, $now) {
                if ($this->normalizeRole($pivot->role ?? '') !== 'employee') {
                    return;
                }

                $permissions = $this->decodeJsonValue($pivot->permissions ?? null);
                if ($permissions === null) {
                    return;
                }

                $permissions = collect($permissions)
                    ->reject(fn ($permission) => in_array($permission, $removePermissions, true))
                    ->values()
                    ->all();

                DB::table('account_user')
                    ->where('id', $pivot->id)
                    ->update([
                        'permissions' => json_encode($permissions),
                        'updated_at' => $now,
                    ]);
            });
    }

    private function employeeInventoryFeaturePermissions(): array
    {
        return [
            AccessControlService::INVENTORY_SHELF_LOCATION_PERMISSIONS['view'],
            AccessControlService::INVENTORY_SHELF_LOCATION_PERMISSIONS['create'],
            AccessControlService::INVENTORY_SHELF_LOCATION_PERMISSIONS['update'],
            AccessControlService::INVENTORY_REPLACEMENT_PERMISSIONS['view'],
            AccessControlService::INVENTORY_REPLACEMENT_PERMISSIONS['create'],
            AccessControlService::INVENTORY_REPLACEMENT_PERMISSIONS['update'],
            AccessControlService::INVENTORY_REPLACEMENT_LOOKUP_PERMISSION,
        ];
    }

    private function normalizeRole(mixed $role): string
    {
        $role = strtolower(trim((string) $role));

        return match ($role) {
            'staff', 'sales' => 'sale',
            'employee', 'nhan_vien', 'nhanvien' => 'employee',
            default => $role,
        };
    }

    private function decodeJsonValue(mixed $value): ?array
    {
        if (is_array($value)) {
            return $value;
        }

        if ($value === null || $value === '') {
            return null;
        }

        $decoded = json_decode((string) $value, true);

        return is_array($decoded) ? $decoded : null;
    }
};
