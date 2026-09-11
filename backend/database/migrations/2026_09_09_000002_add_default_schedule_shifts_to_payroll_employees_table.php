<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('payroll_employees') || Schema::hasColumn('payroll_employees', 'default_schedule_shift_ids')) {
            return;
        }

        Schema::table('payroll_employees', function (Blueprint $table) {
            $table->json('default_schedule_shift_ids')->nullable();
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('payroll_employees') || !Schema::hasColumn('payroll_employees', 'default_schedule_shift_ids')) {
            return;
        }

        Schema::table('payroll_employees', function (Blueprint $table) {
            $table->dropColumn('default_schedule_shift_ids');
        });
    }
};
