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
        Schema::table('products', function (Blueprint $column) {
            $column->unsignedBigInteger('site_domain_id')->nullable()->after('id');
            $column->foreign('site_domain_id')->references('id')->on('site_domains')->onDelete('set null');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('products', function (Blueprint $column) {
            $column->dropForeign(['site_domain_id']);
            $column->dropColumn('site_domain_id');
        });
    }
};
