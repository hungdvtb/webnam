<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('fin_daily_report_configs')) {
            return;
        }

        if (!Schema::hasColumn('fin_daily_report_configs', 'account_id')) {
            Schema::table('fin_daily_report_configs', function (Blueprint $table) {
                $table->foreignId('account_id')
                    ->nullable()
                    ->after('id')
                    ->constrained('accounts')
                    ->nullOnDelete();
            });
        }

        try {
            Schema::table('fin_daily_report_configs', function (Blueprint $table) {
                $table->unique('account_id', 'fin_daily_report_configs_account_id_unique');
            });
        } catch (\Throwable) {
        }

        $template = DB::table('fin_daily_report_configs')
            ->whereNull('account_id')
            ->orderBy('id')
            ->first();

        if (!$template || !Schema::hasTable('accounts')) {
            return;
        }

        $columns = Schema::getColumnListing('fin_daily_report_configs');
        $copyColumns = array_values(array_diff($columns, ['id', 'account_id', 'created_at', 'updated_at']));
        $now = now();

        DB::table('accounts')
            ->orderBy('id')
            ->pluck('id')
            ->each(function ($accountId) use ($template, $copyColumns, $now) {
                $exists = DB::table('fin_daily_report_configs')
                    ->where('account_id', (int) $accountId)
                    ->exists();

                if ($exists) {
                    return;
                }

                $payload = [
                    'account_id' => (int) $accountId,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];

                foreach ($copyColumns as $column) {
                    $payload[$column] = $template->{$column} ?? null;
                }

                DB::table('fin_daily_report_configs')->insert($payload);
            });
    }

    public function down(): void
    {
        if (!Schema::hasTable('fin_daily_report_configs') || !Schema::hasColumn('fin_daily_report_configs', 'account_id')) {
            return;
        }

        try {
            Schema::table('fin_daily_report_configs', function (Blueprint $table) {
                $table->dropUnique('fin_daily_report_configs_account_id_unique');
            });
        } catch (\Throwable) {
        }

        try {
            Schema::table('fin_daily_report_configs', function (Blueprint $table) {
                $table->dropForeign(['account_id']);
            });
        } catch (\Throwable) {
        }

        Schema::table('fin_daily_report_configs', function (Blueprint $table) {
            $table->dropColumn('account_id');
        });
    }
};
