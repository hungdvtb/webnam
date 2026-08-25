<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('imports', function (Blueprint $table) {
            if (!Schema::hasColumn('imports', 'has_purchase_invoice')) {
                $table->boolean('has_purchase_invoice')->default(false)->after('entry_mode');
            }
        });

        Schema::table('import_items', function (Blueprint $table) {
            if (!Schema::hasColumn('import_items', 'has_purchase_invoice')) {
                $table->boolean('has_purchase_invoice')->default(false)->after('sort_order');
            }
        });

        if (Schema::hasColumn('imports', 'has_purchase_invoice')) {
            DB::table('imports')
                ->whereExists(function ($query) {
                    $query->select(DB::raw(1))
                        ->from('inventory_import_attachments')
                        ->whereColumn('inventory_import_attachments.import_id', 'imports.id');
                })
                ->update(['has_purchase_invoice' => true]);
        }

        if (Schema::hasColumn('import_items', 'has_purchase_invoice')) {
            DB::table('imports')
                ->where('has_purchase_invoice', true)
                ->orderBy('id')
                ->chunkById(500, function ($imports) {
                    DB::table('import_items')
                        ->whereIn('import_id', $imports->pluck('id')->all())
                        ->update(['has_purchase_invoice' => true]);
                });
        }
    }

    public function down(): void
    {
        Schema::table('import_items', function (Blueprint $table) {
            if (Schema::hasColumn('import_items', 'has_purchase_invoice')) {
                $table->dropColumn('has_purchase_invoice');
            }
        });

        Schema::table('imports', function (Blueprint $table) {
            if (Schema::hasColumn('imports', 'has_purchase_invoice')) {
                $table->dropColumn('has_purchase_invoice');
            }
        });
    }
};
