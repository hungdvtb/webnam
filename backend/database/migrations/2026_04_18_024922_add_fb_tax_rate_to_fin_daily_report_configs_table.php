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
            $table->decimal('fb_tax_rate', 5, 2)->default(0)->after('fb_ad_account_ids');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('fin_daily_report_configs', function (Blueprint $table) {
            $table->dropColumn('fb_tax_rate');
        });
    }
};
