<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        $legacyPermissions = json_encode([
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
        ]);

        DB::table('users')
            ->where('is_admin', false)
            ->whereNull('permissions')
            ->update([
                'permissions' => $legacyPermissions,
            ]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // No-op: this migration only repairs legacy permission data.
    }
};
