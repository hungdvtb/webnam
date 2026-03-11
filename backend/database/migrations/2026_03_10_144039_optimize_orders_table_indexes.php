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
            // Drop old unique if it was just order_number
            // $table->dropUnique(['order_number']); 
            
            // Re-add indices for high performance lookup (Composite indexes)
            $table->index(['account_id', 'status', 'created_at'], 'idx_ord_acc_status_date');
            $table->index(['account_id', 'customer_phone'], 'idx_ord_acc_phone');
            $table->index(['account_id', 'customer_name'], 'idx_ord_acc_name');
            $table->index(['account_id', 'order_number'], 'idx_ord_acc_number');
            $table->index(['account_id', 'created_at'], 'idx_ord_acc_date');
            
            // Fulltext index for global search across major fields (if MySQL version supports it)
            // $table->fullText(['order_number', 'customer_name', 'customer_phone', 'customer_email', 'shipping_address']);
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->index(['order_id'], 'idx_ord_items_order_id');
            $table->index(['product_id'], 'idx_ord_items_product_id');
        });

        Schema::table('order_attribute_values', function (Blueprint $table) {
            $table->index(['order_id', 'attribute_id'], 'idx_ord_attr_val_lookup');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex('idx_ord_acc_status_date');
            $table->dropIndex('idx_ord_acc_phone');
            $table->dropIndex('idx_ord_acc_name');
            $table->dropIndex('idx_ord_acc_number');
            $table->dropIndex('idx_ord_acc_date');
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->dropIndex('idx_ord_items_order_id');
            $table->dropIndex('idx_ord_items_product_id');
        });

        Schema::table('order_attribute_values', function (Blueprint $table) {
            $table->dropIndex('idx_ord_attr_val_lookup');
        });
    }
};
