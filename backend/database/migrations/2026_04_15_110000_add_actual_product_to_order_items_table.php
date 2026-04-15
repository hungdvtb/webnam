<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->foreignId('actual_product_id')
                ->nullable()
                ->after('product_id')
                ->constrained('products')
                ->nullOnDelete();
            $table->string('actual_product_name_snapshot')->nullable()->after('product_name_snapshot');
            $table->string('actual_product_sku_snapshot')->nullable()->after('product_sku_snapshot');
            $table->index('actual_product_id');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropIndex(['actual_product_id']);
            $table->dropConstrainedForeignId('actual_product_id');
            $table->dropColumn([
                'actual_product_name_snapshot',
                'actual_product_sku_snapshot',
            ]);
        });
    }
};
