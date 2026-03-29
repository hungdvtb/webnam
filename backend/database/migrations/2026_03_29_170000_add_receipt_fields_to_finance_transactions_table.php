<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('finance_transactions', function (Blueprint $table) {
            $table->string('source_name', 180)->nullable()->after('category_id');
            $table->string('counterparty_phone', 30)->nullable()->after('counterparty_name');
            $table->string('reference_code', 120)->nullable()->after('reference_id');
            $table->string('reference_label', 180)->nullable()->after('reference_code');

            $table->index(
                ['account_id', 'transaction_type', 'status', 'transaction_date'],
                'finance_transactions_receipt_lookup_index'
            );
            $table->index(
                ['account_id', 'counterparty_phone'],
                'finance_transactions_phone_index'
            );
        });
    }

    public function down(): void
    {
        Schema::table('finance_transactions', function (Blueprint $table) {
            $table->dropIndex('finance_transactions_receipt_lookup_index');
            $table->dropIndex('finance_transactions_phone_index');

            $table->dropColumn([
                'source_name',
                'counterparty_phone',
                'reference_code',
                'reference_label',
            ]);
        });
    }
};
