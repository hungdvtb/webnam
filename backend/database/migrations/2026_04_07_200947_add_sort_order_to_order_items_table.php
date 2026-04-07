<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('order_items', 'sort_order')) {
            Schema::table('order_items', function (Blueprint $table) {
                $table->unsignedInteger('sort_order')->default(0)->after('product_group_id');
            });
        }

        Schema::table('order_items', function (Blueprint $table) {
            $table->index(['order_id', 'sort_order', 'id'], 'idx_order_items_order_sort');
        });

        $rows = DB::table('order_items')
            ->select(['id', 'order_id'])
            ->orderBy('order_id')
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        $currentOrderId = null;
        $currentSortOrder = 0;

        foreach ($rows as $row) {
            $orderId = (int) $row->order_id;

            if ($orderId !== $currentOrderId) {
                $currentOrderId = $orderId;
                $currentSortOrder = 1;
            } else {
                $currentSortOrder++;
            }

            DB::table('order_items')
                ->where('id', $row->id)
                ->update(['sort_order' => $currentSortOrder]);
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('order_items')) {
            return;
        }

        Schema::table('order_items', function (Blueprint $table) {
            $table->dropIndex('idx_order_items_order_sort');
        });

        if (Schema::hasColumn('order_items', 'sort_order')) {
            Schema::table('order_items', function (Blueprint $table) {
                $table->dropColumn('sort_order');
            });
        }
    }
};
