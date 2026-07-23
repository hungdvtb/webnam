<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (
            !Schema::hasTable('storefront_themes')
            || !Schema::hasColumn('storefront_themes', 'product_type')
        ) {
            return;
        }

        $now = now();
        $code = 'giao-dien-so-2';
        $payload = [
            'account_id' => null,
            'name' => 'Giao diện số 2',
            'folder' => $code,
            'description' => 'Mẫu giao diện số 2 cho sản phẩm bundle, copy từ giao diện bundle hiện tại để chỉnh thiết kế riêng.',
            'product_type' => 'bundle',
            'status' => true,
            'is_default' => false,
            'sort_order' => 2,
            'updated_at' => $now,
        ];

        $query = DB::table('storefront_themes')->where('code', $code);

        if ($query->exists()) {
            $query->update($payload);
            return;
        }

        DB::table('storefront_themes')->insert($payload + [
            'code' => $code,
            'created_at' => $now,
        ]);
    }

    public function down(): void
    {
        if (!Schema::hasTable('storefront_themes')) {
            return;
        }

        $themeId = DB::table('storefront_themes')
            ->where('code', 'giao-dien-so-2')
            ->value('id');

        if (!$themeId) {
            return;
        }

        foreach (['accounts', 'stores'] as $tableName) {
            if (!Schema::hasTable($tableName)) {
                continue;
            }

            foreach ([
                'storefront_theme_id',
                'simple_product_theme_id',
                'configurable_product_theme_id',
                'bundle_product_theme_id',
            ] as $columnName) {
                if (Schema::hasColumn($tableName, $columnName)) {
                    DB::table($tableName)
                        ->where($columnName, $themeId)
                        ->update([$columnName => null]);
                }
            }
        }

        DB::table('storefront_themes')
            ->where('id', $themeId)
            ->delete();
    }
};
