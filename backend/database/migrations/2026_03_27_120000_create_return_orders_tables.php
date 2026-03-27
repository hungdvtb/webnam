<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('return_orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->string('return_number')->unique();
            $table->foreignId('origin_order_id')->nullable()->constrained('orders')->nullOnDelete();
            $table->string('status', 30)->default('new');
            $table->date('exchange_date');
            $table->string('customer_name')->nullable();
            $table->string('customer_phone', 50)->nullable();
            $table->text('customer_address')->nullable();
            $table->unsignedInteger('returned_total_quantity')->default(0);
            $table->unsignedInteger('resent_total_quantity')->default(0);
            $table->decimal('returned_total_amount', 15, 2)->default(0);
            $table->decimal('resent_total_amount', 15, 2)->default(0);
            $table->decimal('profit_loss_amount', 15, 2)->default(0);
            $table->foreignId('return_document_id')->nullable()->constrained('inventory_documents')->nullOnDelete();
            $table->foreignId('export_document_id')->nullable()->constrained('inventory_documents')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('received_at')->nullable();
            $table->timestamp('shipped_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['account_id', 'status', 'exchange_date'], 'return_orders_account_status_date_idx');
            $table->index(['account_id', 'origin_order_id'], 'return_orders_account_origin_idx');
            $table->index(['account_id', 'created_at'], 'return_orders_account_created_idx');
        });

        Schema::create('return_order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('return_order_id')->constrained('return_orders')->cascadeOnDelete();
            $table->string('item_group', 20);
            $table->foreignId('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('product_name_snapshot');
            $table->string('product_sku_snapshot')->nullable();
            $table->unsignedInteger('quantity');
            $table->decimal('unit_price_snapshot', 15, 2)->default(0);
            $table->decimal('line_total_snapshot', 15, 2)->default(0);
            $table->decimal('unit_cost_snapshot', 15, 2)->default(0);
            $table->decimal('line_cost_snapshot', 15, 2)->default(0);
            $table->text('notes')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->index(['account_id', 'return_order_id', 'item_group'], 'return_order_items_account_group_idx');
            $table->index(['account_id', 'product_id'], 'return_order_items_account_product_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('return_order_items');
        Schema::dropIfExists('return_orders');
    }
};
