<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->decimal('special_price', 15, 2)->nullable()->after('price');
            $table->timestamp('special_price_from')->nullable()->after('special_price');
            $table->timestamp('special_price_to')->nullable()->after('special_price_from');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn(['special_price', 'special_price_from', 'special_price_to']);
        });
    }
};
