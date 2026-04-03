<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('media_assets', function (Blueprint $table) {
            $table->id();
            $table->string('public_id', 26)->unique();
            $table->string('disk', 40)->default('r2');
            $table->string('collection', 80)->nullable()->index();
            $table->string('original_name')->nullable();
            $table->string('original_extension', 20)->nullable();
            $table->string('mime_type', 120)->nullable();
            $table->unsignedInteger('width')->nullable();
            $table->unsignedInteger('height')->nullable();
            $table->unsignedBigInteger('size_bytes')->nullable();
            $table->json('variants')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();
        });

        Schema::table('product_images', function (Blueprint $table) {
            $table->foreignId('media_asset_id')
                ->nullable()
                ->after('product_id')
                ->constrained('media_assets')
                ->nullOnDelete();
        });

        Schema::table('categories', function (Blueprint $table) {
            $table->foreignId('banner_media_asset_id')
                ->nullable()
                ->after('banner_path')
                ->constrained('media_assets')
                ->nullOnDelete();

            $table->foreignId('logo_media_asset_id')
                ->nullable()
                ->after('logo_path')
                ->constrained('media_assets')
                ->nullOnDelete();
        });

        Schema::table('posts', function (Blueprint $table) {
            $table->foreignId('featured_media_asset_id')
                ->nullable()
                ->after('featured_image')
                ->constrained('media_assets')
                ->nullOnDelete();
        });

        Schema::table('banners', function (Blueprint $table) {
            $table->foreignId('media_asset_id')
                ->nullable()
                ->after('image_url')
                ->constrained('media_assets')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('banners', function (Blueprint $table) {
            $table->dropConstrainedForeignId('media_asset_id');
        });

        Schema::table('posts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('featured_media_asset_id');
        });

        Schema::table('categories', function (Blueprint $table) {
            $table->dropConstrainedForeignId('banner_media_asset_id');
            $table->dropConstrainedForeignId('logo_media_asset_id');
        });

        Schema::table('product_images', function (Blueprint $table) {
            $table->dropConstrainedForeignId('media_asset_id');
        });

        Schema::dropIfExists('media_assets');
    }
};
