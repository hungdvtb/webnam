<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('ad_account_profit_centers')) {
            return;
        }

        Schema::table('ad_account_profit_centers', function (Blueprint $table) {
            if (!Schema::hasColumn('ad_account_profit_centers', 'effective_from')) {
                $table->date('effective_from')->default('1900-01-01')->after('profit_center_id')->index();
            }

            if (!Schema::hasColumn('ad_account_profit_centers', 'effective_to')) {
                $table->date('effective_to')->nullable()->after('effective_from')->index();
            }
        });

        DB::table('ad_account_profit_centers')
            ->whereNull('effective_from')
            ->update(['effective_from' => '1900-01-01']);

        Schema::table('ad_account_profit_centers', function (Blueprint $table) {
            $table->dropUnique('ad_pc_account_platform_external_unique');
        });

        Schema::table('ad_account_profit_centers', function (Blueprint $table) {
            $table->unique(
                ['account_id', 'platform', 'external_account_id', 'effective_from'],
                'ad_pc_account_platform_external_start_unique'
            );
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('ad_account_profit_centers')) {
            return;
        }

        Schema::table('ad_account_profit_centers', function (Blueprint $table) {
            $table->dropUnique('ad_pc_account_platform_external_start_unique');
        });

        Schema::table('ad_account_profit_centers', function (Blueprint $table) {
            if (Schema::hasColumn('ad_account_profit_centers', 'effective_to')) {
                $table->dropColumn('effective_to');
            }

            if (Schema::hasColumn('ad_account_profit_centers', 'effective_from')) {
                $table->dropColumn('effective_from');
            }
        });

        Schema::table('ad_account_profit_centers', function (Blueprint $table) {
            $table->unique(
                ['account_id', 'platform', 'external_account_id'],
                'ad_pc_account_platform_external_unique'
            );
        });
    }
};
