<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('stores') || !Schema::hasTable('site_domains')) {
            return;
        }

        if (!Schema::hasColumn('stores', 'public_domain_id')) {
            Schema::table('stores', function (Blueprint $table) {
                $table->foreignId('public_domain_id')
                    ->nullable()
                    ->after('account_id')
                    ->constrained('site_domains')
                    ->nullOnDelete();

                $table->index(['account_id', 'public_domain_id'], 'stores_account_public_domain_idx');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('stores') || !Schema::hasColumn('stores', 'public_domain_id')) {
            return;
        }

        Schema::table('stores', function (Blueprint $table) {
            $table->dropIndex('stores_account_public_domain_idx');
            $table->dropForeign(['public_domain_id']);
            $table->dropColumn('public_domain_id');
        });
    }
};
