<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->string('product_name_snapshot')->nullable()->after('product_id')->comment('Tên sản phẩm lúc tạo đơn (fallback)');
            $table->string('product_sku_snapshot')->nullable()->after('product_name_snapshot')->comment('Mã SKU lúc tạo đơn (fallback)');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropColumn(['product_name_snapshot', 'product_sku_snapshot']);
        });
    }
};
