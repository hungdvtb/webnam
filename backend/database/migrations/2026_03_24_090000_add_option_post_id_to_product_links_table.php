<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_links', function (Blueprint $table) {
            if (!Schema::hasColumn('product_links', 'option_post_id')) {
                $table->unsignedBigInteger('option_post_id')->nullable()->after('option_title');
            }
        });
    }

    public function down(): void
    {
        Schema::table('product_links', function (Blueprint $table) {
            if (Schema::hasColumn('product_links', 'option_post_id')) {
                $table->dropColumn('option_post_id');
            }
        });
    }
};
