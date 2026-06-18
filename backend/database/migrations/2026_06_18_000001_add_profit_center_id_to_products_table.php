<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('products') || Schema::hasColumn('products', 'profit_center_id')) {
            return;
        }

        Schema::table('products', function (Blueprint $table) {
            $table->unsignedBigInteger('profit_center_id')->nullable()->after('site_domain_id')->index();
            $table->foreign('profit_center_id', 'products_profit_center_id_foreign')
                ->references('id')
                ->on('profit_centers')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('products') || !Schema::hasColumn('products', 'profit_center_id')) {
            return;
        }

        Schema::table('products', function (Blueprint $table) {
            $table->dropForeign('products_profit_center_id_foreign');
            $table->dropColumn('profit_center_id');
        });
    }
};
