<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('accounts', function (Blueprint $table) {
            if (!Schema::hasColumn('accounts', 'catalog_account_id')) {
                $table->foreignId('catalog_account_id')
                    ->nullable()
                    ->after('ai_api_key')
                    ->constrained('accounts')
                    ->nullOnDelete();
            }

            if (!Schema::hasColumn('accounts', 'inventory_account_id')) {
                $table->foreignId('inventory_account_id')
                    ->nullable()
                    ->after('catalog_account_id')
                    ->constrained('accounts')
                    ->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::table('accounts', function (Blueprint $table) {
            if (Schema::hasColumn('accounts', 'inventory_account_id')) {
                $table->dropConstrainedForeignId('inventory_account_id');
            }

            if (Schema::hasColumn('accounts', 'catalog_account_id')) {
                $table->dropConstrainedForeignId('catalog_account_id');
            }
        });
    }
};
