<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('daily_ads_spends', function (Blueprint $table) {
            $table->string('platform', 32)->default('facebook')->after('id')->index();
        });

        DB::table('daily_ads_spends')
            ->whereNull('platform')
            ->update(['platform' => 'facebook']);

        Schema::table('daily_ads_spends', function (Blueprint $table) {
            $table->dropUnique('daily_ads_spends_date_account_id_unique');
            $table->unique(['platform', 'date', 'account_id'], 'daily_ads_spends_platform_date_account_unique');
        });
    }

    public function down(): void
    {
        Schema::table('daily_ads_spends', function (Blueprint $table) {
            $table->dropUnique('daily_ads_spends_platform_date_account_unique');
            $table->unique(['date', 'account_id']);
            $table->dropColumn('platform');
        });
    }
};
