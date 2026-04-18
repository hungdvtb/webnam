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
        Schema::table('fin_daily_report_configs', function (Blueprint $table) {
            $table->string('shipping_fee_type')->default('%');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('fin_daily_report_configs', function (Blueprint $table) {
            $table->dropColumn('shipping_fee_type');
        });
    }
};
