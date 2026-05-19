<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_employees', function (Blueprint $table) {
            $table->string('phone', 50)->nullable()->after('full_name');
            $table->text('address')->nullable()->after('phone');
            $table->string('identity_card_image_url', 1000)->nullable()->after('address');
        });
    }

    public function down(): void
    {
        Schema::table('payroll_employees', function (Blueprint $table) {
            $table->dropColumn([
                'phone',
                'address',
                'identity_card_image_url',
            ]);
        });
    }
};
