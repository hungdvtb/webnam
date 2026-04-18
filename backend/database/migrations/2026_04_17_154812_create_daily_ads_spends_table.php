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
        Schema::create('daily_ads_spends', function (Blueprint $table) {
            $table->id();
            $table->date('date')->index();
            $table->decimal('amount', 20, 2)->default(0);
            $table->unsignedBigInteger('account_id')->nullable()->index();
            $table->timestamps();

            $table->unique(['date', 'account_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('daily_ads_spends');
    }
};
