<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('accounts') || !Schema::hasTable('site_domains')) {
            return;
        }

        if (!Schema::hasColumn('accounts', 'public_domain_id')) {
            Schema::table('accounts', function (Blueprint $table) {
                $table->foreignId('public_domain_id')
                    ->nullable()
                    ->after('inventory_account_id')
                    ->constrained('site_domains')
                    ->nullOnDelete();

                $table->index(['public_domain_id', 'status'], 'accounts_public_domain_status_idx');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('accounts') || !Schema::hasColumn('accounts', 'public_domain_id')) {
            return;
        }

        Schema::table('accounts', function (Blueprint $table) {
            $table->dropIndex('accounts_public_domain_status_idx');
            $table->dropForeign(['public_domain_id']);
            $table->dropColumn('public_domain_id');
        });
    }
};
