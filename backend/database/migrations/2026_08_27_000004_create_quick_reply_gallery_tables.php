<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quick_reply_image_folders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('name', 140);
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['account_id', 'sort_order']);
        });

        Schema::create('quick_reply_gallery_images', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('folder_id')->nullable()->constrained('quick_reply_image_folders')->nullOnDelete();
            $table->foreignId('media_asset_id')->nullable()->constrained('media_assets')->nullOnDelete();
            $table->string('name', 255);
            $table->mediumText('search_text')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->unsignedInteger('use_count')->default(0);
            $table->boolean('is_favorite')->default(false);
            $table->timestamp('last_used_at')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['account_id', 'folder_id', 'sort_order']);
            $table->index(['account_id', 'is_favorite']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quick_reply_gallery_images');
        Schema::dropIfExists('quick_reply_image_folders');
    }
};
