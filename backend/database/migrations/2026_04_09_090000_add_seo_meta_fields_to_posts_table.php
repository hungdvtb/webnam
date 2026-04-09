<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('posts', function (Blueprint $table) {
            if (!Schema::hasColumn('posts', 'meta_title')) {
                $table->string('meta_title')->nullable()->after('excerpt');
            }

            if (!Schema::hasColumn('posts', 'meta_description')) {
                $table->text('meta_description')->nullable()->after('meta_title');
            }

            if (!Schema::hasColumn('posts', 'meta_keywords')) {
                $table->text('meta_keywords')->nullable()->after('meta_description');
            }
        });
    }

    public function down(): void
    {
        Schema::table('posts', function (Blueprint $table) {
            foreach (['meta_keywords', 'meta_description', 'meta_title'] as $column) {
                if (Schema::hasColumn('posts', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
