<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('order_statuses')) {
            return;
        }

        try {
            Schema::table('order_statuses', function (Blueprint $table) {
                $table->dropUnique('order_statuses_code_unique');
            });
        } catch (\Throwable $e) {
        }

        try {
            Schema::table('order_statuses', function (Blueprint $table) {
                $table->unique(['account_id', 'code'], 'order_statuses_account_code_unique');
            });
        } catch (\Throwable $e) {
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('order_statuses')) {
            return;
        }

        try {
            Schema::table('order_statuses', function (Blueprint $table) {
                $table->dropUnique('order_statuses_account_code_unique');
            });
        } catch (\Throwable $e) {
        }

        try {
            Schema::table('order_statuses', function (Blueprint $table) {
                $table->unique('code', 'order_statuses_code_unique');
            });
        } catch (\Throwable $e) {
        }
    }
};
