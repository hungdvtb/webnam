<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('storefront_themes')) {
            return;
        }

        if (!Schema::hasColumn('storefront_themes', 'product_type')) {
            Schema::table('storefront_themes', function (Blueprint $table) {
                $table->string('product_type', 40)
                    ->default('simple')
                    ->after('description');

                $table->index(['product_type', 'status', 'sort_order'], 'storefront_themes_product_type_status_sort_idx');
            });
        }

        DB::table('storefront_themes')
            ->whereNull('product_type')
            ->orWhere('product_type', '')
            ->update(['product_type' => 'simple']);
    }

    public function down(): void
    {
        if (!Schema::hasTable('storefront_themes') || !Schema::hasColumn('storefront_themes', 'product_type')) {
            return;
        }

        Schema::table('storefront_themes', function (Blueprint $table) {
            $table->dropIndex('storefront_themes_product_type_status_sort_idx');
            $table->dropColumn('product_type');
        });
    }
};
