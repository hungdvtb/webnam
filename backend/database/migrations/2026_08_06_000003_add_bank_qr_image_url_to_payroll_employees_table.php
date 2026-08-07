<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_employees', function (Blueprint $table) {
            if (!Schema::hasColumn('payroll_employees', 'bank_qr_image_url')) {
                $table->string('bank_qr_image_url', 1000)->nullable()->after('bank_account_note');
            }
        });
    }

    public function down(): void
    {
        Schema::table('payroll_employees', function (Blueprint $table) {
            if (Schema::hasColumn('payroll_employees', 'bank_qr_image_url')) {
                $table->dropColumn('bank_qr_image_url');
            }
        });
    }
};
