<?php

use App\Services\AccessControlService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('account_user', function (Blueprint $table) {
            if (!Schema::hasColumn('account_user', 'status')) {
                $table->tinyInteger('status')->default(1)->after('role');
            }

            if (!Schema::hasColumn('account_user', 'permissions')) {
                $table->json('permissions')->nullable()->after('status');
            }

            if (!Schema::hasColumn('account_user', 'data_permissions')) {
                $table->json('data_permissions')->nullable()->after('permissions');
            }
        });

        $now = now();

        DB::table('account_user')
            ->orderBy('id')
            ->each(function ($pivot) use ($now) {
                $user = DB::table('users')->where('id', $pivot->user_id)->first();
                if (!$user) {
                    return;
                }

                $role = (string) ($pivot->role ?: 'staff');
                $legacyPermissions = $this->decodeJsonValue($user->permissions);

                $permissions = AccessControlService::permissionsForRole($role);
                if ($legacyPermissions !== null) {
                    $permissions = AccessControlService::expandLegacyPermissions($legacyPermissions);
                }

                DB::table('account_user')
                    ->where('id', $pivot->id)
                    ->update([
                        'status' => 1,
                        'permissions' => json_encode(array_values($permissions)),
                        'data_permissions' => json_encode(AccessControlService::dataPermissionsForRole($role)),
                        'updated_at' => $now,
                    ]);
            });
    }

    public function down(): void
    {
        Schema::table('account_user', function (Blueprint $table) {
            if (Schema::hasColumn('account_user', 'data_permissions')) {
                $table->dropColumn('data_permissions');
            }

            if (Schema::hasColumn('account_user', 'permissions')) {
                $table->dropColumn('permissions');
            }

            if (Schema::hasColumn('account_user', 'status')) {
                $table->dropColumn('status');
            }
        });
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
