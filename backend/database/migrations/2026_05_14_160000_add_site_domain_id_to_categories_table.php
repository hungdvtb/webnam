<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('categories') || !Schema::hasTable('site_domains')) {
            return;
        }

        Schema::table('categories', function (Blueprint $table) {
            if (!Schema::hasColumn('categories', 'site_domain_id')) {
                $table->unsignedBigInteger('site_domain_id')->nullable()->after('id');
                $table->foreign('site_domain_id')
                    ->references('id')
                    ->on('site_domains')
                    ->onDelete('set null');
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('categories') || !Schema::hasColumn('categories', 'site_domain_id')) {
            return;
        }

        Schema::table('categories', function (Blueprint $table) {
            $table->dropForeign(['site_domain_id']);
            $table->dropColumn('site_domain_id');
        });
    }
};
