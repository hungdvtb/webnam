<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            if (!Schema::hasColumn('order_items', 'product_source_account_id')) {
                $table->foreignId('product_source_account_id')
                    ->nullable()
                    ->after('actual_product_id')
                    ->constrained('accounts')
                    ->nullOnDelete();
            }

            if (!Schema::hasColumn('order_items', 'inventory_source_account_id')) {
                $table->foreignId('inventory_source_account_id')
                    ->nullable()
                    ->after('product_source_account_id')
                    ->constrained('accounts')
                    ->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            if (Schema::hasColumn('order_items', 'inventory_source_account_id')) {
                $table->dropConstrainedForeignId('inventory_source_account_id');
            }

            if (Schema::hasColumn('order_items', 'product_source_account_id')) {
                $table->dropConstrainedForeignId('product_source_account_id');
            }
        });
    }
};
