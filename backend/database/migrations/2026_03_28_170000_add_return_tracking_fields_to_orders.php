<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'return_tracking_code')) {
                $table->string('return_tracking_code', 120)->nullable()->after('settlement_delta');
            }

            if (!Schema::hasColumn('orders', 'return_status')) {
                $table->string('return_status', 30)->default('not_returned')->after('return_tracking_code');
            }
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (Schema::hasColumn('orders', 'return_status')) {
                $table->dropColumn('return_status');
            }

            if (Schema::hasColumn('orders', 'return_tracking_code')) {
                $table->dropColumn('return_tracking_code');
            }
        });
    }
};
