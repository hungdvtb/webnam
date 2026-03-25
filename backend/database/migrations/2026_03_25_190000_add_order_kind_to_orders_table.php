<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'order_kind')) {
                $table->string('order_kind', 20)->default('official')->after('order_number');
            }

            if (!Schema::hasColumn('orders', 'converted_from_order_id')) {
                $table->unsignedBigInteger('converted_from_order_id')->nullable()->after('order_kind');
                $table->index('converted_from_order_id', 'idx_orders_converted_from_order_id');
            }

            if (!Schema::hasColumn('orders', 'converted_from_kind')) {
                $table->string('converted_from_kind', 20)->nullable()->after('converted_from_order_id');
            }

            $table->index(['account_id', 'order_kind', 'deleted_at', 'created_at'], 'idx_orders_account_kind_deleted_created');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex('idx_orders_account_kind_deleted_created');
            $table->dropIndex('idx_orders_converted_from_order_id');

            if (Schema::hasColumn('orders', 'converted_from_kind')) {
                $table->dropColumn('converted_from_kind');
            }

            if (Schema::hasColumn('orders', 'converted_from_order_id')) {
                $table->dropColumn('converted_from_order_id');
            }

            if (Schema::hasColumn('orders', 'order_kind')) {
                $table->dropColumn('order_kind');
            }
        });
    }
};
