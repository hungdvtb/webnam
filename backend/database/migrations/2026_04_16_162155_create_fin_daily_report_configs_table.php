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
        Schema::create('fin_daily_report_configs', function (Blueprint $table) {
            $table->id();
            $table->decimal('return_rate', 5, 2)->default(2.00); // 2%
            $table->decimal('packaging_fee', 15, 2)->default(2000.00); // 2000đ/order
            $table->decimal('shipping_estimate_rate', 5, 2)->default(10.00); // 10%
            $table->decimal('tax_rate', 5, 2)->default(1.50); // 1.5%
            $table->string('fb_ad_account_id')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('fin_daily_report_configs');
    }
};
