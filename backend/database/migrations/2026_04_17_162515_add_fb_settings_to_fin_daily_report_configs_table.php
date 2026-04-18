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
            $table->text('fb_access_token')->nullable();
            $table->text('fb_ad_account_ids')->nullable(); // Comma-separated list of IDs like act_123, act_456
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('fin_daily_report_configs', function (Blueprint $table) {
            $table->dropColumn(['fb_access_token', 'fb_ad_account_ids']);
        });
    }
};
