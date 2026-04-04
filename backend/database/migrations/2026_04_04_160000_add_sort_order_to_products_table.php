<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('products') || Schema::hasColumn('products', 'sort_order')) {
            return;
        }

        Schema::table('products', function (Blueprint $table) {
            $table->unsignedInteger('sort_order')->default(0)->after('site_domain_id');
            $table->index(['account_id', 'sort_order'], 'products_account_id_sort_order_index');
        });

        $rows = DB::table('products')
            ->select(['id', 'account_id'])
            ->orderByRaw('CASE WHEN account_id IS NULL THEN 1 ELSE 0 END')
            ->orderBy('account_id')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get();

        $counters = [];

        foreach ($rows as $row) {
            $accountKey = $row->account_id === null ? 'global' : (string) $row->account_id;
            $nextSortOrder = ($counters[$accountKey] ?? 0) + 1;
            $counters[$accountKey] = $nextSortOrder;

            DB::table('products')
                ->where('id', $row->id)
                ->update(['sort_order' => $nextSortOrder]);
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('products') || !Schema::hasColumn('products', 'sort_order')) {
            return;
        }

        Schema::table('products', function (Blueprint $table) {
            $table->dropIndex('products_account_id_sort_order_index');
            $table->dropColumn('sort_order');
        });
    }
};
