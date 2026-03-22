<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('finance_catalogs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('group_key', 80);
            $table->string('code', 120);
            $table->string('name', 180);
            $table->string('color', 20)->nullable();
            $table->boolean('is_system')->default(false);
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->json('meta')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['account_id', 'group_key', 'code'], 'finance_catalogs_account_group_code_unique');
            $table->index(['account_id', 'group_key', 'is_active'], 'finance_catalogs_account_group_active_index');
        });

        Schema::create('finance_wallets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('code', 120);
            $table->string('name', 180);
            $table->string('type', 30)->default('cash');
            $table->string('bank_name', 180)->nullable();
            $table->string('account_number', 80)->nullable();
            $table->string('currency', 10)->default('VND');
            $table->decimal('opening_balance', 18, 2)->default(0);
            $table->decimal('current_balance', 18, 2)->default(0);
            $table->string('color', 20)->nullable();
            $table->text('note')->nullable();
            $table->boolean('is_default')->default(false);
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamp('balance_updated_at')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['account_id', 'code'], 'finance_wallets_account_code_unique');
            $table->index(['account_id', 'type', 'is_active'], 'finance_wallets_account_type_active_index');
        });

        Schema::create('finance_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('wallet_id')->nullable()->constrained('finance_wallets')->nullOnDelete();
            $table->foreignId('category_id')->nullable()->constrained('finance_catalogs')->nullOnDelete();
            $table->foreignId('related_transaction_id')->nullable()->constrained('finance_transactions')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('code', 120);
            $table->string('status', 50)->default('confirmed');
            $table->string('direction', 10);
            $table->string('transaction_type', 60)->default('manual');
            $table->string('payment_method', 60)->nullable();
            $table->dateTime('transaction_date');
            $table->decimal('amount', 18, 2);
            $table->string('counterparty_type', 80)->nullable();
            $table->string('counterparty_name', 180)->nullable();
            $table->string('reference_type', 80)->nullable();
            $table->unsignedBigInteger('reference_id')->nullable();
            $table->string('content', 255)->nullable();
            $table->text('note')->nullable();
            $table->string('attachment_path')->nullable();
            $table->boolean('affects_profit_loss')->default(true);
            $table->json('metadata')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['account_id', 'code'], 'finance_transactions_account_code_unique');
            $table->index(['account_id', 'transaction_date'], 'finance_transactions_account_date_index');
            $table->index(['account_id', 'status', 'direction'], 'finance_transactions_account_status_direction_index');
            $table->index(['account_id', 'reference_type', 'reference_id'], 'finance_transactions_reference_index');
        });

        Schema::create('finance_transfers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('from_wallet_id')->constrained('finance_wallets')->cascadeOnDelete();
            $table->foreignId('to_wallet_id')->constrained('finance_wallets')->cascadeOnDelete();
            $table->foreignId('outgoing_transaction_id')->nullable()->constrained('finance_transactions')->nullOnDelete();
            $table->foreignId('incoming_transaction_id')->nullable()->constrained('finance_transactions')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('code', 120);
            $table->string('status', 50)->default('confirmed');
            $table->dateTime('transfer_date');
            $table->decimal('amount', 18, 2);
            $table->string('content', 255)->nullable();
            $table->text('note')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['account_id', 'code'], 'finance_transfers_account_code_unique');
            $table->index(['account_id', 'transfer_date'], 'finance_transfers_account_date_index');
        });

        Schema::create('finance_loans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('disbursed_wallet_id')->nullable()->constrained('finance_wallets')->nullOnDelete();
            $table->foreignId('disbursement_transaction_id')->nullable()->constrained('finance_transactions')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('code', 120);
            $table->string('type', 30)->default('borrowed');
            $table->string('status', 50)->default('active');
            $table->string('counterparty_name', 180);
            $table->string('counterparty_contact', 180)->nullable();
            $table->decimal('principal_amount', 18, 2);
            $table->decimal('principal_paid', 18, 2)->default(0);
            $table->decimal('interest_paid', 18, 2)->default(0);
            $table->decimal('interest_rate', 10, 4)->nullable();
            $table->string('interest_type', 30)->default('percent');
            $table->date('start_date');
            $table->date('due_date')->nullable();
            $table->text('note')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['account_id', 'code'], 'finance_loans_account_code_unique');
            $table->index(['account_id', 'status', 'type'], 'finance_loans_account_status_type_index');
            $table->index(['account_id', 'due_date'], 'finance_loans_account_due_date_index');
        });

        Schema::create('finance_loan_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('loan_id')->constrained('finance_loans')->cascadeOnDelete();
            $table->foreignId('wallet_id')->nullable()->constrained('finance_wallets')->nullOnDelete();
            $table->foreignId('finance_transaction_id')->nullable()->constrained('finance_transactions')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('code', 120);
            $table->string('status', 50)->default('confirmed');
            $table->dateTime('payment_date');
            $table->decimal('principal_amount', 18, 2)->default(0);
            $table->decimal('interest_amount', 18, 2)->default(0);
            $table->decimal('total_amount', 18, 2);
            $table->text('note')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['account_id', 'code'], 'finance_loan_payments_account_code_unique');
            $table->index(['account_id', 'payment_date'], 'finance_loan_payments_account_date_index');
        });

        Schema::create('finance_fixed_expenses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('category_id')->nullable()->constrained('finance_catalogs')->nullOnDelete();
            $table->foreignId('default_wallet_id')->nullable()->constrained('finance_wallets')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('code', 120);
            $table->string('name', 180);
            $table->decimal('amount', 18, 2);
            $table->string('frequency', 30)->default('monthly');
            $table->unsignedInteger('interval_value')->default(1);
            $table->unsignedInteger('reminder_days')->default(3);
            $table->string('status', 50)->default('active');
            $table->date('start_date');
            $table->date('next_due_date');
            $table->date('last_paid_date')->nullable();
            $table->text('note')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['account_id', 'code'], 'finance_fixed_expenses_account_code_unique');
            $table->index(['account_id', 'status', 'next_due_date'], 'finance_fixed_expenses_account_status_due_index');
        });

        Schema::create('finance_change_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('changed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('subject_type', 120);
            $table->unsignedBigInteger('subject_id');
            $table->string('action', 60);
            $table->json('before_data')->nullable();
            $table->json('after_data')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index(['account_id', 'subject_type', 'subject_id'], 'finance_change_logs_subject_index');
            $table->index(['account_id', 'action'], 'finance_change_logs_action_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('finance_change_logs');
        Schema::dropIfExists('finance_fixed_expenses');
        Schema::dropIfExists('finance_loan_payments');
        Schema::dropIfExists('finance_loans');
        Schema::dropIfExists('finance_transfers');
        Schema::dropIfExists('finance_transactions');
        Schema::dropIfExists('finance_wallets');
        Schema::dropIfExists('finance_catalogs');
    }
};
