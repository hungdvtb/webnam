<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('finance_transactions', function (Blueprint $table) {
            $table->index(
                ['account_id', 'direction', 'transaction_type', 'deleted_at', 'transaction_date', 'id'],
                'finance_transactions_receipt_runtime_index'
            );
        });
    }

    public function down(): void
    {
        Schema::table('finance_transactions', function (Blueprint $table) {
            $table->dropIndex('finance_transactions_receipt_runtime_index');
        });
    }
};
