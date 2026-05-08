<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            if (!Schema::hasColumn('products', 'video_urls')) {
                $table->json('video_urls')->nullable()->after('video_url');
            }
        });

        Schema::table('product_links', function (Blueprint $table) {
            if (!Schema::hasColumn('product_links', 'option_video_url')) {
                $table->string('option_video_url', 2048)->nullable()->after('option_image_url');
            }

            if (!Schema::hasColumn('product_links', 'option_video_source')) {
                $table->string('option_video_source', 32)->nullable()->after('option_video_url');
            }
        });
    }

    public function down(): void
    {
        Schema::table('product_links', function (Blueprint $table) {
            if (Schema::hasColumn('product_links', 'option_video_source')) {
                $table->dropColumn('option_video_source');
            }

            if (Schema::hasColumn('product_links', 'option_video_url')) {
                $table->dropColumn('option_video_url');
            }
        });

        Schema::table('products', function (Blueprint $table) {
            if (Schema::hasColumn('products', 'video_urls')) {
                $table->dropColumn('video_urls');
            }
        });
    }
};
