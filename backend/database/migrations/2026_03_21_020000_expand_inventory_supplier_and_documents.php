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
            if (!Schema::hasColumn('products', 'damaged_quantity')) {
                $table->unsignedInteger('damaged_quantity')->default(0)->after('stock_quantity');
            }
        });

        Schema::create('suppliers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->string('code', 120)->nullable();
            $table->string('name');
            $table->string('phone', 50)->nullable();
            $table->string('email')->nullable();
            $table->string('address')->nullable();
            $table->text('notes')->nullable();
            $table->boolean('status')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['account_id', 'status']);
            $table->index(['account_id', 'name']);
        });

        Schema::create('supplier_product_prices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('supplier_id')->constrained('suppliers')->cascadeOnDelete();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->decimal('unit_cost', 15, 2);
            $table->text('notes')->nullable();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['supplier_id', 'product_id']);
            $table->index(['account_id', 'supplier_id']);
            $table->index(['account_id', 'product_id']);
            $table->index(['product_id', 'updated_at']);
        });

        Schema::table('imports', function (Blueprint $table) {
            if (!Schema::hasColumn('imports', 'supplier_id')) {
                $table->foreignId('supplier_id')->nullable()->after('account_id')->constrained('suppliers')->nullOnDelete();
            }
        });

        Schema::table('import_items', function (Blueprint $table) {
            if (!Schema::hasColumn('import_items', 'supplier_product_price_id')) {
                $table->foreignId('supplier_product_price_id')->nullable()->after('product_id')->constrained('supplier_product_prices')->nullOnDelete();
            }
            if (!Schema::hasColumn('import_items', 'supplier_price_snapshot')) {
                $table->decimal('supplier_price_snapshot', 15, 2)->nullable()->after('unit_cost');
            }
            if (!Schema::hasColumn('import_items', 'price_was_updated')) {
                $table->boolean('price_was_updated')->default(false)->after('supplier_price_snapshot');
            }
        });

        Schema::table('inventory_batches', function (Blueprint $table) {
            if (!Schema::hasColumn('inventory_batches', 'source_type')) {
                $table->string('source_type', 50)->nullable()->after('import_item_id');
            }
            if (!Schema::hasColumn('inventory_batches', 'source_id')) {
                $table->unsignedBigInteger('source_id')->nullable()->after('source_type');
            }
            $table->index(['source_type', 'source_id'], 'inventory_batches_source_lookup_idx');
        });

        Schema::create('inventory_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('supplier_id')->nullable()->constrained('suppliers')->nullOnDelete();
            $table->string('document_number')->unique();
            $table->string('type', 30);
            $table->date('document_date');
            $table->string('status', 30)->default('completed');
            $table->string('reference_type', 50)->nullable();
            $table->unsignedBigInteger('reference_id')->nullable();
            $table->unsignedInteger('total_quantity')->default(0);
            $table->decimal('total_amount', 15, 2)->default(0);
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['account_id', 'type', 'document_date']);
            $table->index(['account_id', 'status']);
            $table->index(['supplier_id', 'type']);
        });

        Schema::create('inventory_document_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('inventory_document_id')->constrained('inventory_documents')->cascadeOnDelete();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('product_name_snapshot');
            $table->string('product_sku_snapshot')->nullable();
            $table->unsignedInteger('quantity');
            $table->string('stock_bucket', 30)->default('sellable');
            $table->string('direction', 10)->default('in');
            $table->decimal('unit_cost', 15, 2)->default(0);
            $table->decimal('total_cost', 15, 2)->default(0);
            $table->decimal('unit_price', 15, 2)->nullable();
            $table->decimal('total_price', 15, 2)->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['account_id', 'product_id']);
            $table->index(['inventory_document_id', 'product_id']);
            $table->index(['stock_bucket', 'direction']);
        });

        Schema::create('inventory_document_allocations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('inventory_document_item_id')->constrained('inventory_document_items')->cascadeOnDelete();
            $table->foreignId('inventory_batch_id')->nullable()->constrained('inventory_batches')->nullOnDelete();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->unsignedInteger('quantity');
            $table->decimal('unit_cost', 15, 2);
            $table->decimal('total_cost', 15, 2);
            $table->dateTime('allocated_at');
            $table->timestamps();

            $table->index(['account_id', 'product_id']);
            $table->index(['inventory_document_item_id']);
            $table->index(['inventory_batch_id']);
        });

        DB::table('inventory_batches')
            ->whereNull('source_type')
            ->whereNotNull('import_id')
            ->update([
                'source_type' => 'import',
                'source_id' => DB::raw('import_id'),
            ]);

        $imports = DB::table('imports')
            ->select('id', 'account_id', 'supplier_name')
            ->whereNotNull('supplier_name')
            ->where('supplier_name', '<>', '')
            ->orderBy('id')
            ->get();

        $supplierMap = [];

        foreach ($imports as $import) {
            $key = ($import->account_id ?? 0) . '|' . mb_strtolower(trim((string) $import->supplier_name));

            if (!isset($supplierMap[$key])) {
                $existingId = DB::table('suppliers')
                    ->where('account_id', $import->account_id)
                    ->whereRaw('LOWER(name) = ?', [mb_strtolower(trim((string) $import->supplier_name))])
                    ->value('id');

                $supplierMap[$key] = $existingId ?: DB::table('suppliers')->insertGetId([
                    'account_id' => $import->account_id,
                    'name' => trim((string) $import->supplier_name),
                    'status' => true,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            DB::table('imports')
                ->where('id', $import->id)
                ->update(['supplier_id' => $supplierMap[$key]]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_document_allocations');
        Schema::dropIfExists('inventory_document_items');
        Schema::dropIfExists('inventory_documents');

        Schema::table('inventory_batches', function (Blueprint $table) {
            if (Schema::hasColumn('inventory_batches', 'source_id')) {
                $table->dropIndex('inventory_batches_source_lookup_idx');
                $table->dropColumn(['source_type', 'source_id']);
            }
        });

        Schema::table('import_items', function (Blueprint $table) {
            if (Schema::hasColumn('import_items', 'supplier_product_price_id')) {
                $table->dropConstrainedForeignId('supplier_product_price_id');
            }
            if (Schema::hasColumn('import_items', 'supplier_price_snapshot')) {
                $table->dropColumn(['supplier_price_snapshot', 'price_was_updated']);
            }
        });

        Schema::table('imports', function (Blueprint $table) {
            if (Schema::hasColumn('imports', 'supplier_id')) {
                $table->dropConstrainedForeignId('supplier_id');
            }
        });

        Schema::dropIfExists('supplier_product_prices');
        Schema::dropIfExists('suppliers');

        Schema::table('products', function (Blueprint $table) {
            if (Schema::hasColumn('products', 'damaged_quantity')) {
                $table->dropColumn('damaged_quantity');
            }
        });
    }
};
