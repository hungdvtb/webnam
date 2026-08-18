<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('products', 'warehouse_sequence')) {
            Schema::table('products', function (Blueprint $table) {
                $table->unsignedInteger('warehouse_sequence')->nullable()->after('sort_order');
            });
        }

        $counters = DB::table('products')
            ->select('account_id', DB::raw('COALESCE(MAX(warehouse_sequence), 0) as max_sequence'))
            ->whereNotNull('warehouse_sequence')
            ->groupBy('account_id')
            ->get()
            ->mapWithKeys(fn ($row) => [(string) ($row->account_id ?? 0) => (int) $row->max_sequence])
            ->all();

        DB::table('products')
            ->select(['id', 'account_id'])
            ->whereNull('warehouse_sequence')
            ->orderBy('id')
            ->chunkById(500, function ($products) use (&$counters) {
                foreach ($products as $product) {
                    $accountKey = (string) ($product->account_id ?? 0);
                    $counters[$accountKey] = ($counters[$accountKey] ?? 0) + 1;

                    DB::table('products')
                        ->where('id', $product->id)
                        ->update(['warehouse_sequence' => $counters[$accountKey]]);
                }
            });

        Schema::table('products', function (Blueprint $table) {
            $table->unique(['account_id', 'warehouse_sequence'], 'products_account_warehouse_sequence_unique');
        });
    }

    public function down(): void
    {
        if (!Schema::hasColumn('products', 'warehouse_sequence')) {
            return;
        }

        Schema::table('products', function (Blueprint $table) {
            $table->dropUnique('products_account_warehouse_sequence_unique');
            $table->dropColumn('warehouse_sequence');
        });
    }
};
