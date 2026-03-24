<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->index(['account_id', 'shipping_carrier_code', 'shipping_dispatched_at'], 'idx_ord_acc_carrier_shipdate');
            $table->index(['account_id', 'shipping_tracking_code'], 'idx_ord_acc_tracking');
        });

        Schema::table('shipments', function (Blueprint $table) {
            $table->index(['order_id', 'shipment_status'], 'idx_ship_ord_status');
        });

        Schema::table('order_statuses', function (Blueprint $table) {
            $table->index(['account_id', 'code', 'sort_order'], 'idx_ord_status_acc_code_sort');
        });

        Schema::table('order_attribute_values', function (Blueprint $table) {
            $table->index(['attribute_id', 'order_id'], 'idx_ord_attr_attr_order');
        });
    }

    public function down(): void
    {
        Schema::table('order_attribute_values', function (Blueprint $table) {
            $table->dropIndex('idx_ord_attr_attr_order');
        });

        Schema::table('order_statuses', function (Blueprint $table) {
            $table->dropIndex('idx_ord_status_acc_code_sort');
        });

        Schema::table('shipments', function (Blueprint $table) {
            $table->dropIndex('idx_ship_ord_status');
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex('idx_ord_acc_carrier_shipdate');
            $table->dropIndex('idx_ord_acc_tracking');
        });
    }
};
