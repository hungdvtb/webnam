<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            if (!Schema::hasColumn('products', 'expected_cost')) {
                $table->decimal('expected_cost', 15, 2)->nullable()->after('cost_price');
            }
        });

        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'profit_total')) {
                $table->decimal('profit_total', 15, 2)->default(0)->after('cost_total');
            }
        });

        Schema::table('order_items', function (Blueprint $table) {
            if (!Schema::hasColumn('order_items', 'cost_total')) {
                $table->decimal('cost_total', 15, 2)->default(0)->after('cost_price');
            }
            if (!Schema::hasColumn('order_items', 'profit_total')) {
                $table->decimal('profit_total', 15, 2)->default(0)->after('cost_total');
            }
        });

        Schema::create('imports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->string('import_number')->unique();
            $table->string('supplier_name');
            $table->date('import_date');
            $table->string('status', 30)->default('completed');
            $table->unsignedInteger('total_quantity')->default(0);
            $table->decimal('total_amount', 15, 2)->default(0);
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['account_id', 'import_date']);
            $table->index(['account_id', 'status']);
        });

        Schema::create('import_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('import_id')->constrained('imports')->cascadeOnDelete();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('product_name_snapshot');
            $table->string('product_sku_snapshot')->nullable();
            $table->unsignedInteger('quantity');
            $table->decimal('unit_cost', 15, 2);
            $table->decimal('line_total', 15, 2);
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['account_id', 'product_id']);
            $table->index(['import_id', 'product_id']);
        });

        Schema::create('inventory_batches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignId('import_id')->nullable()->constrained('imports')->nullOnDelete();
            $table->foreignId('import_item_id')->nullable()->constrained('import_items')->nullOnDelete();
            $table->string('batch_number')->unique();
            $table->dateTime('received_at');
            $table->unsignedInteger('quantity');
            $table->unsignedInteger('remaining_quantity');
            $table->decimal('unit_cost', 15, 2);
            $table->string('status', 30)->default('open');
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->index(['account_id', 'product_id', 'status']);
            $table->index(['product_id', 'received_at', 'id']);
            $table->index(['product_id', 'remaining_quantity']);
        });

        Schema::create('inventory_batch_allocations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('inventory_batch_id')->constrained('inventory_batches')->cascadeOnDelete();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignId('order_id')->nullable()->constrained('orders')->cascadeOnDelete();
            $table->foreignId('order_item_id')->nullable()->constrained('order_items')->cascadeOnDelete();
            $table->unsignedInteger('quantity');
            $table->decimal('unit_cost', 15, 2);
            $table->decimal('total_cost', 15, 2);
            $table->dateTime('allocated_at');
            $table->timestamps();

            $table->index(['account_id', 'order_id']);
            $table->index(['order_item_id']);
            $table->index(['inventory_batch_id']);
            $table->index(['product_id', 'allocated_at']);
        });

        DB::table('products')
            ->whereNull('expected_cost')
            ->update(['expected_cost' => DB::raw('cost_price')]);
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_batch_allocations');
        Schema::dropIfExists('inventory_batches');
        Schema::dropIfExists('import_items');
        Schema::dropIfExists('imports');

        Schema::table('order_items', function (Blueprint $table) {
            if (Schema::hasColumn('order_items', 'profit_total')) {
                $table->dropColumn('profit_total');
            }
            if (Schema::hasColumn('order_items', 'cost_total')) {
                $table->dropColumn('cost_total');
            }
        });

        Schema::table('orders', function (Blueprint $table) {
            if (Schema::hasColumn('orders', 'profit_total')) {
                $table->dropColumn('profit_total');
            }
        });

        Schema::table('products', function (Blueprint $table) {
            if (Schema::hasColumn('products', 'expected_cost')) {
                $table->dropColumn('expected_cost');
            }
        });
    }
};
