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
        Schema::table('orders', function (Blueprint $table) {
            $table->string('source')->nullable()->after('status');
            $table->string('type')->nullable()->after('source');
            $table->string('district')->nullable()->after('shipping_address');
            $table->string('ward')->nullable()->after('district');
            $table->string('shipment_status')->nullable()->after('type');
            $table->decimal('shipping_fee', 15, 2)->default(0)->after('total_price');
            $table->decimal('discount', 15, 2)->default(0)->after('shipping_fee');
            $table->decimal('cost_total', 15, 2)->default(0)->after('discount');
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->decimal('cost_price', 15, 2)->default(0)->after('price');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['source', 'type', 'district', 'ward', 'shipment_status', 'shipping_fee', 'discount', 'cost_total']);
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->dropColumn('cost_price');
        });
    }
};
