<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fin_transactions', function (Blueprint $table) {
            $table->dateTime('transaction_date')->change();
        });

        Schema::table('fin_accounts', function (Blueprint $table) {
            if (!Schema::hasColumn('fin_accounts', 'initial_balance')) {
                $table->decimal('initial_balance', 15, 2)->default(0)->after('type');
            }
        });
    }

    public function down(): void
    {
        Schema::table('fin_transactions', function (Blueprint $table) {
            $table->date('transaction_date')->change();
        });

        Schema::table('fin_accounts', function (Blueprint $table) {
            $table->dropColumn('initial_balance');
        });
    }
};
