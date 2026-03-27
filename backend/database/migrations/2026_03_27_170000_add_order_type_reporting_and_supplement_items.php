<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'order_type')) {
                $table->string('order_type', 30)->default('standard')->after('order_kind');
            }

            if (!Schema::hasColumn('orders', 'settlement_delta')) {
                $table->decimal('settlement_delta', 15, 2)->default(0)->after('discount');
            }

            if (!Schema::hasColumn('orders', 'supplement_items_total_price')) {
                $table->decimal('supplement_items_total_price', 15, 2)->default(0)->after('settlement_delta');
            }

            if (!Schema::hasColumn('orders', 'supplement_items_cost_total')) {
                $table->decimal('supplement_items_cost_total', 15, 2)->default(0)->after('supplement_items_total_price');
            }

            if (!Schema::hasColumn('orders', 'report_revenue_total')) {
                $table->decimal('report_revenue_total', 15, 2)->default(0)->after('profit_total');
            }

            if (!Schema::hasColumn('orders', 'report_cost_total')) {
                $table->decimal('report_cost_total', 15, 2)->default(0)->after('report_revenue_total');
            }

            if (!Schema::hasColumn('orders', 'report_profit_total')) {
                $table->decimal('report_profit_total', 15, 2)->default(0)->after('report_cost_total');
            }

            $table->index(['account_id', 'order_type', 'deleted_at', 'created_at'], 'idx_orders_account_type_deleted_created');
        });

        Schema::create('order_supplement_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('product_name_snapshot')->nullable();
            $table->string('product_sku_snapshot')->nullable();
            $table->unsignedInteger('quantity')->default(1);
            $table->decimal('price', 15, 2)->default(0);
            $table->decimal('cost_price', 15, 2)->default(0);
            $table->decimal('total_price', 15, 2)->default(0);
            $table->decimal('total_cost', 15, 2)->default(0);
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['order_id', 'product_id'], 'idx_order_supplement_items_order_product');
            $table->index(['account_id', 'created_at'], 'idx_order_supplement_items_account_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_supplement_items');

        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex('idx_orders_account_type_deleted_created');

            if (Schema::hasColumn('orders', 'report_profit_total')) {
                $table->dropColumn('report_profit_total');
            }

            if (Schema::hasColumn('orders', 'report_cost_total')) {
                $table->dropColumn('report_cost_total');
            }

            if (Schema::hasColumn('orders', 'report_revenue_total')) {
                $table->dropColumn('report_revenue_total');
            }

            if (Schema::hasColumn('orders', 'supplement_items_cost_total')) {
                $table->dropColumn('supplement_items_cost_total');
            }

            if (Schema::hasColumn('orders', 'supplement_items_total_price')) {
                $table->dropColumn('supplement_items_total_price');
            }

            if (Schema::hasColumn('orders', 'settlement_delta')) {
                $table->dropColumn('settlement_delta');
            }

            if (Schema::hasColumn('orders', 'order_type')) {
                $table->dropColumn('order_type');
            }
        });
    }
};
