<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('categories') || Schema::hasColumn('categories', 'visibility')) {
            return;
        }

        Schema::table('categories', function (Blueprint $table) {
            $table->string('visibility', 30)->default('public')->after('status');
            $table->index(['status', 'visibility'], 'categories_status_visibility_index');
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('categories') || !Schema::hasColumn('categories', 'visibility')) {
            return;
        }

        Schema::table('categories', function (Blueprint $table) {
            $table->dropIndex('categories_status_visibility_index');
            $table->dropColumn('visibility');
        });
    }
};
