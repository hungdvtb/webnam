<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // 1. Tài khoản (Tiền mặt, ACB, VCB...)
        Schema::create('fin_accounts', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('type')->default('cash'); // 'cash' or 'bank'
            $table->decimal('balance', 15, 2)->default(0); // Số dư hiện tại, cached để query cho nhanh
            $table->text('description')->nullable();
            $table->timestamps();
        });

        // 2. Hạng mục (Nhập hàng, Lương, Hộp xốp...)
        Schema::create('fin_categories', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('type')->default('expense'); // 'income' or 'expense'
            $table->string('color')->nullable(); // Màu hiển thị (ví dụ cho frontend)
            $table->timestamps();
        });

        // 3. Giao dịch (Thu, Chi)
        Schema::create('fin_transactions', function (Blueprint $table) {
            $table->id();
            $table->dateTime('transaction_date');
            $table->string('description');

            $table->foreignId('fin_account_id')->constrained('fin_accounts')->onDelete('restrict');
            $table->foreignId('fin_category_id')->nullable()->constrained('fin_categories')->onDelete('set null');

            $table->string('type'); // 'income', 'expense'
            $table->decimal('amount', 15, 2);
            $table->decimal('balance_after', 15, 2); // Số dư của tài khoản account_id ngay sau gd này

            $table->text('notes')->nullable();

            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('fin_transactions');
        Schema::dropIfExists('fin_categories');
        Schema::dropIfExists('fin_accounts');
    }
};
