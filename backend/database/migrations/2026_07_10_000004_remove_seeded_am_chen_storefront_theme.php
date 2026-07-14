<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('storefront_themes')) {
            return;
        }

        $themeId = DB::table('storefront_themes')->where('code', 'am-chen')->value('id');
        if (!$themeId) {
            return;
        }

        if (Schema::hasTable('accounts') && Schema::hasColumn('accounts', 'storefront_theme_id')) {
            DB::table('accounts')
                ->where('storefront_theme_id', $themeId)
                ->update(['storefront_theme_id' => null]);
        }

        if (Schema::hasTable('stores') && Schema::hasColumn('stores', 'storefront_theme_id')) {
            DB::table('stores')
                ->where('storefront_theme_id', $themeId)
                ->update(['storefront_theme_id' => null]);
        }

        DB::table('storefront_themes')
            ->where('cloned_from_id', $themeId)
            ->update(['cloned_from_id' => null]);

        DB::table('storefront_themes')->where('id', $themeId)->delete();
    }

    public function down(): void
    {
        // The am-chen theme was an accidental sample seed, so rollback should not recreate it.
    }
};
