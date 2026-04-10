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

        // Fix 1: Users with NULL permissions (created before the permissions column was added)
        DB::table('users')
            ->where('is_admin', false)
            ->whereNull('permissions')
            ->update([
                'permissions' => $legacyPermissions,
            ]);

        // Fix 2: Users with empty-array permissions '[]' (created via UserController after the
        // permissions column was added — it defaulted to [] instead of null, causing zero access
        // on the frontend because normalizeAdminPermissions() only falls back to legacy-all when
        // the value is strictly null, not an empty array).
        //
        // PostgreSQL's json type does not support direct string comparison so we use whereRaw
        // with an explicit cast to text for cross-database compat.
        DB::table('users')
            ->where('is_admin', false)
            ->whereRaw("permissions::text = ?", ['[]'])
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
