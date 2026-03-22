<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            if (!Schema::hasColumn('products', 'inventory_import_starred')) {
                $table->boolean('inventory_import_starred')->default(false)->after('inventory_unit_id');
                $table->index('inventory_import_starred', 'products_inventory_import_starred_idx');
            }
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            if (Schema::hasColumn('products', 'inventory_import_starred')) {
                $table->dropIndex('products_inventory_import_starred_idx');
                $table->dropColumn('inventory_import_starred');
            }
        });
    }
};
