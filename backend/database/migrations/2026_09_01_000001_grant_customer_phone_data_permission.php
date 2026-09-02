<?php

use App\Services\AccessControlService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('account_user') || !Schema::hasColumn('account_user', 'data_permissions')) {
            return;
        }

        $now = now();

        DB::table('account_user')
            ->orderBy('id')
            ->each(function ($pivot) use ($now) {
                $role = $this->normalizeRole($pivot->role ?? '');
                if ($role === 'employee') {
                    return;
                }

                $permissions = $this->decodeJsonValue($pivot->permissions ?? null);
                if (!$this->hasOrderAccess($role, $permissions)) {
                    return;
                }

                $dataPermissions = $this->decodeJsonValue($pivot->data_permissions ?? null) ?? [];
                $dataPermissions[] = AccessControlService::CUSTOMER_PHONE_DATA_PERMISSION;

                DB::table('account_user')
                    ->where('id', $pivot->id)
                    ->update([
                        'data_permissions' => json_encode(array_values(array_unique($dataPermissions))),
                        'updated_at' => $now,
                    ]);
            });
    }

    public function down(): void
    {
        if (!Schema::hasTable('account_user') || !Schema::hasColumn('account_user', 'data_permissions')) {
            return;
        }

        $now = now();

        DB::table('account_user')
            ->orderBy('id')
            ->each(function ($pivot) use ($now) {
                $dataPermissions = collect($this->decodeJsonValue($pivot->data_permissions ?? null) ?? [])
                    ->reject(fn ($permission) => $permission === AccessControlService::CUSTOMER_PHONE_DATA_PERMISSION)
                    ->values()
                    ->all();

                DB::table('account_user')
                    ->where('id', $pivot->id)
                    ->update([
                        'data_permissions' => json_encode($dataPermissions),
                        'updated_at' => $now,
                    ]);
            });
    }

    private function hasOrderAccess(string $role, ?array $permissions): bool
    {
        if (in_array($role, ['owner', 'manager', 'sale', 'warehouse', 'viewer'], true)) {
            return true;
        }

        if ($permissions === null) {
            return true;
        }

        return collect($permissions)
            ->map(fn ($permission) => trim((string) $permission))
            ->contains(fn ($permission) => in_array($permission, ['orders', 'orders.view', 'orders.*'], true));
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
