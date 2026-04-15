<?php

use App\Models\Order;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'draft_created_at')) {
                $table->timestamp('draft_created_at')->nullable();
            }

            if (!Schema::hasColumn('orders', 'officialized_at')) {
                $table->timestamp('officialized_at')->nullable();
            }
        });

        if (Schema::hasColumn('orders', 'order_kind')) {
            DB::table('orders')
                ->where('order_kind', Order::KIND_DRAFT)
                ->whereNull('draft_created_at')
                ->update([
                    'draft_created_at' => DB::raw('created_at'),
                ]);

            DB::table('orders')
                ->where(function ($query) {
                    $query
                        ->where('order_kind', Order::KIND_OFFICIAL)
                        ->orWhereNull('order_kind')
                        ->orWhere('order_kind', '');
                })
                ->whereNull('officialized_at')
                ->update([
                    'officialized_at' => DB::raw('created_at'),
                ]);
        } else {
            DB::table('orders')
                ->whereNull('officialized_at')
                ->update([
                    'officialized_at' => DB::raw('created_at'),
                ]);
        }
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (Schema::hasColumn('orders', 'officialized_at')) {
                $table->dropColumn('officialized_at');
            }

            if (Schema::hasColumn('orders', 'draft_created_at')) {
                $table->dropColumn('draft_created_at');
            }
        });
    }
};
