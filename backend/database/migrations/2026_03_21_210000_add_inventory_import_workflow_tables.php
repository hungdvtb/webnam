<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_units', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name', 60);
            $table->string('normalized_name', 60);
            $table->string('code', 40)->nullable();
            $table->boolean('is_default')->default(false);
            $table->boolean('is_system')->default(false);
            $table->unsignedInteger('sort_order')->default(0);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['account_id', 'sort_order']);
            $table->index(['account_id', 'is_default']);
            $table->unique(['account_id', 'normalized_name'], 'inventory_units_account_normalized_unique');
        });

        Schema::create('inventory_import_statuses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->string('code', 60);
            $table->string('name', 120);
            $table->string('color', 20)->default('#10B981');
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_default')->default(false);
            $table->boolean('is_system')->default(false);
            $table->boolean('is_active')->default(true);
            $table->boolean('affects_inventory')->default(false);
            $table->timestamps();

            $table->index(['account_id', 'sort_order']);
            $table->index(['account_id', 'is_active']);
            $table->unique(['account_id', 'code'], 'inventory_import_statuses_account_code_unique');
        });

        Schema::create('inventory_invoice_analysis_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('supplier_id')->nullable()->constrained('suppliers')->nullOnDelete();
            $table->foreignId('import_id')->nullable()->constrained('imports')->nullOnDelete();
            $table->string('source_name');
            $table->string('disk', 40)->default('public');
            $table->string('file_path');
            $table->string('mime_type', 120)->nullable();
            $table->unsignedBigInteger('file_size')->default(0);
            $table->string('status', 30)->default('pending');
            $table->string('provider', 60)->nullable();
            $table->longText('extracted_text')->nullable();
            $table->json('analysis_result')->nullable();
            $table->text('error_message')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['account_id', 'created_at']);
            $table->index(['import_id', 'created_at']);
            $table->index(['status', 'created_at']);
        });

        Schema::table('products', function (Blueprint $table) {
            if (!Schema::hasColumn('products', 'inventory_unit_id')) {
                $table->foreignId('inventory_unit_id')
                    ->nullable()
                    ->after('weight')
                    ->constrained('inventory_units')
                    ->nullOnDelete();
            }
        });

        Schema::table('imports', function (Blueprint $table) {
            if (!Schema::hasColumn('imports', 'inventory_import_status_id')) {
                $table->foreignId('inventory_import_status_id')
                    ->nullable()
                    ->after('supplier_id')
                    ->constrained('inventory_import_statuses')
                    ->nullOnDelete();
            }
            if (!Schema::hasColumn('imports', 'entry_mode')) {
                $table->string('entry_mode', 30)->default('manual')->after('status');
            }
            if (!Schema::hasColumn('imports', 'subtotal_amount')) {
                $table->decimal('subtotal_amount', 15, 2)->default(0)->after('total_quantity');
            }
            if (!Schema::hasColumn('imports', 'extra_charge_percent')) {
                $table->decimal('extra_charge_percent', 8, 2)->default(0)->after('subtotal_amount');
            }
            if (!Schema::hasColumn('imports', 'inventory_applied_at')) {
                $table->timestamp('inventory_applied_at')->nullable()->after('updated_at');
            }
        });

        Schema::table('import_items', function (Blueprint $table) {
            if (!Schema::hasColumn('import_items', 'supplier_product_code_snapshot')) {
                $table->string('supplier_product_code_snapshot')->nullable()->after('product_sku_snapshot');
            }
            if (!Schema::hasColumn('import_items', 'unit_name_snapshot')) {
                $table->string('unit_name_snapshot', 60)->nullable()->after('product_name_snapshot');
            }
            if (!Schema::hasColumn('import_items', 'sort_order')) {
                $table->unsignedInteger('sort_order')->default(0)->after('notes');
            }
        });

        Schema::create('inventory_import_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('import_id')->constrained('imports')->cascadeOnDelete();
            $table->foreignId('invoice_analysis_log_id')->nullable()->constrained('inventory_invoice_analysis_logs')->nullOnDelete();
            $table->string('source_type', 30)->default('manual');
            $table->string('disk', 40)->default('public');
            $table->string('file_path');
            $table->string('original_name');
            $table->string('mime_type', 120)->nullable();
            $table->unsignedBigInteger('file_size')->default(0);
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['account_id', 'import_id']);
            $table->index(['invoice_analysis_log_id']);
        });

        $defaultUnits = [
            ['name' => 'Cái', 'normalized_name' => 'cai', 'code' => 'cai', 'sort_order' => 1, 'is_default' => true],
            ['name' => 'Bộ', 'normalized_name' => 'bo', 'code' => 'bo', 'sort_order' => 2, 'is_default' => false],
            ['name' => 'Đôi', 'normalized_name' => 'doi', 'code' => 'doi', 'sort_order' => 3, 'is_default' => false],
            ['name' => 'Chiếc', 'normalized_name' => 'chiec', 'code' => 'chiec', 'sort_order' => 4, 'is_default' => false],
        ];

        $unitIds = [];
        foreach ($defaultUnits as $unit) {
            $unitIds[$unit['normalized_name']] = DB::table('inventory_units')->insertGetId([
                'account_id' => null,
                'name' => $unit['name'],
                'normalized_name' => $unit['normalized_name'],
                'code' => $unit['code'],
                'is_default' => $unit['is_default'],
                'is_system' => true,
                'sort_order' => $unit['sort_order'],
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $defaultStatuses = [
            ['code' => 'moi', 'name' => 'Mới', 'color' => '#94A3B8', 'sort_order' => 1, 'is_default' => true, 'affects_inventory' => false],
            ['code' => 'da_xac_nhan', 'name' => 'Đã xác nhận', 'color' => '#3B82F6', 'sort_order' => 2, 'is_default' => false, 'affects_inventory' => false],
            ['code' => 'hoan_thanh_1_phan', 'name' => 'Hoàn thành 1 phần', 'color' => '#F59E0B', 'sort_order' => 3, 'is_default' => false, 'affects_inventory' => true],
            ['code' => 'hoan_thanh', 'name' => 'Hoàn thành', 'color' => '#10B981', 'sort_order' => 4, 'is_default' => false, 'affects_inventory' => true],
        ];

        $statusIds = [];
        foreach ($defaultStatuses as $status) {
            $statusIds[$status['code']] = DB::table('inventory_import_statuses')->insertGetId([
                'account_id' => null,
                'code' => $status['code'],
                'name' => $status['name'],
                'color' => $status['color'],
                'sort_order' => $status['sort_order'],
                'is_default' => $status['is_default'],
                'is_system' => true,
                'is_active' => true,
                'affects_inventory' => $status['affects_inventory'],
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        if (isset($unitIds['cai'])) {
            DB::table('products')
                ->whereNull('inventory_unit_id')
                ->update(['inventory_unit_id' => $unitIds['cai']]);
        }

        $completedStatusId = $statusIds['hoan_thanh'] ?? null;
        if ($completedStatusId) {
            DB::table('imports')
                ->whereNull('inventory_import_status_id')
                ->update([
                    'inventory_import_status_id' => $completedStatusId,
                    'status' => 'hoan_thanh',
                    'entry_mode' => 'manual',
                    'subtotal_amount' => DB::raw('COALESCE(total_amount, 0)'),
                    'extra_charge_percent' => 0,
                    'inventory_applied_at' => DB::raw('COALESCE(updated_at, created_at, NOW())'),
                ]);
        }

        foreach (
            DB::table('import_items')
                ->select([
                    'import_items.id',
                    'products.supplier_product_code',
                    'inventory_units.name as unit_name',
                ])
                ->join('products', 'products.id', '=', 'import_items.product_id')
                ->leftJoin('inventory_units', 'inventory_units.id', '=', 'products.inventory_unit_id')
                ->orderBy('import_items.id')
                ->cursor() as $row
        ) {
            DB::table('import_items')
                ->where('id', $row->id)
                ->update([
                    'supplier_product_code_snapshot' => $row->supplier_product_code,
                    'unit_name_snapshot' => $row->unit_name,
                ]);
        }

        $sortMap = [];
        $currentImportId = null;
        $position = 0;
        foreach (DB::table('import_items')->select('id', 'import_id')->orderBy('import_id')->orderBy('id')->cursor() as $row) {
            if ($currentImportId !== $row->import_id) {
                $currentImportId = $row->import_id;
                $position = 1;
            } else {
                $position++;
            }
            $sortMap[$row->id] = $position;
        }
        foreach ($sortMap as $itemId => $sortOrder) {
            DB::table('import_items')->where('id', $itemId)->update(['sort_order' => $sortOrder]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_import_attachments');

        Schema::table('import_items', function (Blueprint $table) {
            if (Schema::hasColumn('import_items', 'sort_order')) {
                $table->dropColumn(['supplier_product_code_snapshot', 'unit_name_snapshot', 'sort_order']);
            }
        });

        Schema::table('imports', function (Blueprint $table) {
            if (Schema::hasColumn('imports', 'inventory_import_status_id')) {
                $table->dropConstrainedForeignId('inventory_import_status_id');
            }
            foreach (['entry_mode', 'subtotal_amount', 'extra_charge_percent', 'inventory_applied_at'] as $column) {
                if (Schema::hasColumn('imports', $column)) {
                    $table->dropColumn($column);
                }
            }
        });

        Schema::table('products', function (Blueprint $table) {
            if (Schema::hasColumn('products', 'inventory_unit_id')) {
                $table->dropConstrainedForeignId('inventory_unit_id');
            }
        });

        Schema::dropIfExists('inventory_invoice_analysis_logs');
        Schema::dropIfExists('inventory_import_statuses');
        Schema::dropIfExists('inventory_units');
    }
};
