<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (
            Schema::hasTable('accounts')
            && Schema::hasTable('storefront_themes')
            && !Schema::hasColumn('accounts', 'storefront_theme_id')
        ) {
            Schema::table('accounts', function (Blueprint $table) {
                $table->foreignId('storefront_theme_id')
                    ->nullable()
                    ->after('public_domain_id')
                    ->constrained('storefront_themes')
                    ->nullOnDelete();

                $table->index(['public_domain_id', 'storefront_theme_id'], 'accounts_public_domain_theme_idx');
            });
        }

        if (Schema::hasTable('storefront_themes')) {
            $now = now();

            DB::table('storefront_themes')->updateOrInsert(
                ['code' => 'do-tho'],
                [
                    'account_id' => null,
                    'name' => 'Giao diện số 1',
                    'folder' => 'do-tho',
                    'description' => 'Bộ giao diện sản phẩm hiện tại đã được lưu làm giao diện số 1.',
                    'status' => true,
                    'is_default' => true,
                    'sort_order' => 1,
                    'updated_at' => $now,
                    'created_at' => $now,
                ]
            );
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('accounts') && Schema::hasColumn('accounts', 'storefront_theme_id')) {
            Schema::table('accounts', function (Blueprint $table) {
                $table->dropIndex('accounts_public_domain_theme_idx');
                $table->dropForeign(['storefront_theme_id']);
                $table->dropColumn('storefront_theme_id');
            });
        }
    }
};
