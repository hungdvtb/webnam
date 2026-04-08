<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('customers')) {
            return;
        }

        Schema::whenTableHasIndex('customers', 'customers_account_id_email_unique', function (Blueprint $table) {
            $table->dropUnique('customers_account_id_email_unique');
        }, 'unique');
    }

    public function down(): void
    {
        if (!Schema::hasTable('customers')) {
            return;
        }

        Schema::whenTableDoesntHaveIndex('customers', 'customers_account_id_email_unique', function (Blueprint $table) {
            $table->unique(['account_id', 'email'], 'customers_account_id_email_unique');
        }, 'unique');
    }
};
