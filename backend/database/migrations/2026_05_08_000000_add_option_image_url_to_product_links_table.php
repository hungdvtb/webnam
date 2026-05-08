<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_links', function (Blueprint $table) {
            if (!Schema::hasColumn('product_links', 'option_image_url')) {
                $table->string('option_image_url', 2048)->nullable()->after('option_post_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('product_links', function (Blueprint $table) {
            if (Schema::hasColumn('product_links', 'option_image_url')) {
                $table->dropColumn('option_image_url');
            }
        });
    }
};
