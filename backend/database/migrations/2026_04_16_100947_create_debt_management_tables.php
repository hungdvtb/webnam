<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::create('debt_subjects', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->decimal('interest_rate_percent', 5, 2)->default(0); // Lãi suất %/tháng
            $table->decimal('initial_debt', 15, 2)->default(0);
            $table->timestamps();
        });

        Schema::create('debt_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('debt_subject_id')->constrained()->onDelete('cascade');
            $table->dateTime('transaction_date');
            $table->enum('type', ['borrow', 'pay_principal', 'pay_interest']);
            $table->decimal('amount', 15, 2);
            $table->string('note')->nullable();

            // To optionally link with Fund Accounts (if they choose to sync)
            $table->unsignedBigInteger('fin_account_id')->nullable();
            $table->unsignedBigInteger('fin_transaction_id')->nullable();

            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::dropIfExists('debt_transactions');
        Schema::dropIfExists('debt_subjects');
    }
};
