<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('attributes', function (Blueprint $table) {
            $table->string('swatch_type')->nullable()->after('frontend_type'); // color, image, none
            $table->boolean('is_variant')->default(false)->after('is_filterable');
        });

        Schema::table('attribute_options', function (Blueprint $table) {
            $table->string('swatch_value')->nullable()->after('value'); // hex code or image URL
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('attributes', function (Blueprint $table) {
            $table->dropColumn(['swatch_type', 'is_variant']);
        });

        Schema::table('attribute_options', function (Blueprint $table) {
            $table->dropColumn('swatch_value');
        });
    }
};
