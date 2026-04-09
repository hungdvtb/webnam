<?php

use App\Support\OrderStatusCatalog;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'print_count')) {
                $table->unsignedInteger('print_count')->default(0);
            }

            if (!Schema::hasColumn('orders', 'last_printed_at')) {
                $table->timestamp('last_printed_at')->nullable();
            }
        });

        DB::table('orders')
            ->where('status', OrderStatusCatalog::PRINTED_CODE)
            ->where(function ($query) {
                $query
                    ->whereNull('print_count')
                    ->orWhere('print_count', '<', 1);
            })
            ->update([
                'print_count' => 1,
            ]);
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (Schema::hasColumn('orders', 'last_printed_at')) {
                $table->dropColumn('last_printed_at');
            }

            if (Schema::hasColumn('orders', 'print_count')) {
                $table->dropColumn('print_count');
            }
        });
    }
};
