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
            $table->boolean('is_filterable_frontend')->default(false)->after('is_filterable');
            $table->boolean('is_filterable_backend')->default(false)->after('is_filterable_frontend');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('attributes', function (Blueprint $table) {
            $table->dropColumn(['is_filterable_frontend', 'is_filterable_backend']);
        });
    }
};
