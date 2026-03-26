<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inventory_document_items', function (Blueprint $table) {
            if (!Schema::hasColumn('inventory_document_items', 'actual_product_id')) {
                $table->foreignId('actual_product_id')
                    ->nullable()
                    ->after('product_id')
                    ->constrained('products')
                    ->nullOnDelete();
            }

            if (!Schema::hasColumn('inventory_document_items', 'actual_product_name_snapshot')) {
                $table->string('actual_product_name_snapshot')->nullable()->after('product_sku_snapshot');
            }

            if (!Schema::hasColumn('inventory_document_items', 'actual_product_sku_snapshot')) {
                $table->string('actual_product_sku_snapshot')->nullable()->after('actual_product_name_snapshot');
            }

            if (!Schema::hasColumn('inventory_document_items', 'actual_quantity')) {
                $table->unsignedInteger('actual_quantity')->nullable()->after('quantity');
            }

            if (!Schema::hasColumn('inventory_document_items', 'actual_unit_cost')) {
                $table->decimal('actual_unit_cost', 15, 2)->nullable()->after('total_cost');
            }

            if (!Schema::hasColumn('inventory_document_items', 'actual_total_cost')) {
                $table->decimal('actual_total_cost', 15, 2)->nullable()->after('actual_unit_cost');
            }

            if (!Schema::hasColumn('inventory_document_items', 'actual_unit_price')) {
                $table->decimal('actual_unit_price', 15, 2)->nullable()->after('total_price');
            }

            if (!Schema::hasColumn('inventory_document_items', 'actual_total_price')) {
                $table->decimal('actual_total_price', 15, 2)->nullable()->after('actual_unit_price');
            }

            if (!Schema::hasColumn('inventory_document_items', 'actual_reason')) {
                $table->text('actual_reason')->nullable()->after('notes');
            }

            if (!Schema::hasColumn('inventory_document_items', 'variance_type')) {
                $table->string('variance_type', 50)->nullable()->after('actual_reason');
            }

            if (!Schema::hasColumn('inventory_document_items', 'planned_order_product_id')) {
                $table->unsignedBigInteger('planned_order_product_id')->nullable()->after('variance_type');
            }

            if (!Schema::hasColumn('inventory_document_items', 'planned_order_product_name_snapshot')) {
                $table->string('planned_order_product_name_snapshot')->nullable()->after('planned_order_product_id');
            }

            if (!Schema::hasColumn('inventory_document_items', 'planned_order_product_sku_snapshot')) {
                $table->string('planned_order_product_sku_snapshot')->nullable()->after('planned_order_product_name_snapshot');
            }

            if (!Schema::hasColumn('inventory_document_items', 'planned_order_quantity')) {
                $table->unsignedInteger('planned_order_quantity')->nullable()->after('planned_order_product_sku_snapshot');
            }
        });

        DB::table('inventory_document_items')
            ->whereNull('actual_product_id')
            ->update([
                'actual_product_id' => DB::raw('product_id'),
                'actual_product_name_snapshot' => DB::raw('product_name_snapshot'),
                'actual_product_sku_snapshot' => DB::raw('product_sku_snapshot'),
                'actual_quantity' => DB::raw('quantity'),
                'actual_unit_cost' => DB::raw('unit_cost'),
                'actual_total_cost' => DB::raw('total_cost'),
                'actual_unit_price' => DB::raw('unit_price'),
                'actual_total_price' => DB::raw('total_price'),
                'planned_order_product_id' => DB::raw('product_id'),
                'planned_order_product_name_snapshot' => DB::raw('product_name_snapshot'),
                'planned_order_product_sku_snapshot' => DB::raw('product_sku_snapshot'),
                'planned_order_quantity' => DB::raw('quantity'),
            ]);

        Schema::create('inventory_document_item_order_releases', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('inventory_document_item_id')->constrained('inventory_document_items')->cascadeOnDelete();
            $table->foreignId('inventory_batch_id')->nullable()->constrained('inventory_batches')->nullOnDelete();
            $table->unsignedBigInteger('order_id')->nullable();
            $table->unsignedBigInteger('order_item_id')->nullable();
            $table->unsignedBigInteger('product_id')->nullable();
            $table->unsignedInteger('quantity')->default(0);
            $table->decimal('unit_cost', 15, 2)->default(0);
            $table->decimal('total_cost', 15, 2)->default(0);
            $table->dateTime('released_at');
            $table->timestamps();

            $table->index(['inventory_document_item_id'], 'inv_doc_item_order_release_item_idx');
            $table->index(['order_id', 'order_item_id'], 'inv_doc_item_order_release_order_idx');
            $table->index(['inventory_batch_id'], 'inv_doc_item_order_release_batch_idx');
            $table->index(['product_id'], 'inv_doc_item_order_release_product_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_document_item_order_releases');

        Schema::table('inventory_document_items', function (Blueprint $table) {
            if (Schema::hasColumn('inventory_document_items', 'actual_product_id')) {
                $table->dropConstrainedForeignId('actual_product_id');
            }

            $columns = [
                'actual_product_name_snapshot',
                'actual_product_sku_snapshot',
                'actual_quantity',
                'actual_unit_cost',
                'actual_total_cost',
                'actual_unit_price',
                'actual_total_price',
                'actual_reason',
                'variance_type',
                'planned_order_product_id',
                'planned_order_product_name_snapshot',
                'planned_order_product_sku_snapshot',
                'planned_order_quantity',
            ];

            $existing = array_values(array_filter($columns, fn ($column) => Schema::hasColumn('inventory_document_items', $column)));
            if (!empty($existing)) {
                $table->dropColumn($existing);
            }
        });
    }
};
