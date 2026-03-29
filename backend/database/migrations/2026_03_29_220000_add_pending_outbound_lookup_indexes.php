<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('orders') && Schema::hasColumn('orders', 'deleted_at')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->index(
                    ['account_id', 'order_kind', 'deleted_at', 'created_at'],
                    'idx_orders_pending_outbound_lookup'
                );
            });
        }

        if (Schema::hasTable('order_items')) {
            Schema::table('order_items', function (Blueprint $table) {
                $table->index(
                    ['order_id', 'product_id'],
                    'idx_order_items_order_product_pending_outbound'
                );
            });
        }

        if (Schema::hasTable('inventory_documents') && Schema::hasColumn('inventory_documents', 'deleted_at')) {
            Schema::table('inventory_documents', function (Blueprint $table) {
                $table->index(
                    ['reference_type', 'reference_id', 'type', 'status', 'deleted_at'],
                    'idx_inventory_documents_order_export_lookup'
                );
            });
        }

        if (Schema::hasTable('shipments') && Schema::hasColumn('shipments', 'deleted_at')) {
            Schema::table('shipments', function (Blueprint $table) {
                $table->index(
                    ['order_id', 'deleted_at', 'shipment_status'],
                    'idx_shipments_order_active_lookup'
                );
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('shipments') && Schema::hasColumn('shipments', 'deleted_at')) {
            Schema::table('shipments', function (Blueprint $table) {
                $table->dropIndex('idx_shipments_order_active_lookup');
            });
        }

        if (Schema::hasTable('inventory_documents') && Schema::hasColumn('inventory_documents', 'deleted_at')) {
            Schema::table('inventory_documents', function (Blueprint $table) {
                $table->dropIndex('idx_inventory_documents_order_export_lookup');
            });
        }

        if (Schema::hasTable('order_items')) {
            Schema::table('order_items', function (Blueprint $table) {
                $table->dropIndex('idx_order_items_order_product_pending_outbound');
            });
        }

        if (Schema::hasTable('orders') && Schema::hasColumn('orders', 'deleted_at')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->dropIndex('idx_orders_pending_outbound_lookup');
            });
        }
    }
};
