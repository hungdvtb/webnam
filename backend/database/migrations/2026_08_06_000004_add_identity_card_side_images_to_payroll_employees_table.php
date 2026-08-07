<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_employees', function (Blueprint $table) {
            if (!Schema::hasColumn('payroll_employees', 'identity_card_front_image_url')) {
                $table->string('identity_card_front_image_url', 1000)->nullable()->after('identity_card_image_url');
            }

            if (!Schema::hasColumn('payroll_employees', 'identity_card_back_image_url')) {
                $table->string('identity_card_back_image_url', 1000)->nullable()->after('identity_card_front_image_url');
            }
        });
    }

    public function down(): void
    {
        Schema::table('payroll_employees', function (Blueprint $table) {
            if (Schema::hasColumn('payroll_employees', 'identity_card_back_image_url')) {
                $table->dropColumn('identity_card_back_image_url');
            }

            if (Schema::hasColumn('payroll_employees', 'identity_card_front_image_url')) {
                $table->dropColumn('identity_card_front_image_url');
            }
        });
    }
};
