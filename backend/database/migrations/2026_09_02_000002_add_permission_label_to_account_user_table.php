<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('account_user')) {
            return;
        }

        if (!Schema::hasColumn('account_user', 'permission_label')) {
            Schema::table('account_user', function (Blueprint $table) {
                $table->string('permission_label')->nullable()->after('role');
            });
        }

        $now = now();

        DB::table('account_user')
            ->leftJoin('users', 'users.id', '=', 'account_user.user_id')
            ->select('account_user.id', 'account_user.role', 'account_user.permission_label', 'users.name as user_name')
            ->orderBy('account_user.id')
            ->each(function ($pivot) use ($now) {
                if (trim((string) ($pivot->permission_label ?? '')) !== '') {
                    return;
                }

                $label = trim((string) ($pivot->user_name ?? ''));
                if ($label === '') {
                    $label = $this->labelForRole($pivot->role ?? '');
                }

                DB::table('account_user')
                    ->where('id', $pivot->id)
                    ->update([
                        'permission_label' => $label,
                        'updated_at' => $now,
                    ]);
            });
    }

    public function down(): void
    {
        if (!Schema::hasTable('account_user') || !Schema::hasColumn('account_user', 'permission_label')) {
            return;
        }

        Schema::table('account_user', function (Blueprint $table) {
            $table->dropColumn('permission_label');
        });
    }

    private function labelForRole(mixed $role): string
    {
        return match (strtolower(trim((string) $role))) {
            'owner' => 'Chủ / Toàn quyền',
            'manager' => 'Quản lý',
            'staff', 'sale' => 'Nhân viên sale',
            'warehouse' => 'Nhân viên kho',
            'employee', 'nhan_vien', 'nhanvien' => 'Nhân viên',
            'viewer' => 'Chỉ xem',
            default => 'Tùy chỉnh',
        };
    }
};