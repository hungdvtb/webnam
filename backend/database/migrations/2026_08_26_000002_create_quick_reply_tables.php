<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quick_reply_topics', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('slug', 140);
            $table->string('color', 20)->default('#2563eb');
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['account_id', 'slug']);
            $table->index(['account_id', 'is_active', 'sort_order']);
        });

        Schema::create('quick_replies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('topic_id')->nullable()->constrained('quick_reply_topics')->nullOnDelete();
            $table->string('shortcut', 80);
            $table->string('title', 255)->nullable();
            $table->mediumText('body')->nullable();
            $table->json('tags')->nullable();
            $table->mediumText('search_text')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->unsignedInteger('use_count')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();

            $table->unique(['account_id', 'shortcut']);
            $table->index(['account_id', 'topic_id', 'is_active']);
            $table->index(['account_id', 'sort_order']);
        });

        Schema::create('quick_reply_images', function (Blueprint $table) {
            $table->id();
            $table->foreignId('quick_reply_id')->constrained('quick_replies')->cascadeOnDelete();
            $table->foreignId('media_asset_id')->nullable()->constrained('media_assets')->nullOnDelete();
            $table->text('url');
            $table->text('thumbnail_url')->nullable();
            $table->text('medium_url')->nullable();
            $table->text('large_url')->nullable();
            $table->text('original_url')->nullable();
            $table->unsignedInteger('width')->nullable();
            $table->unsignedInteger('height')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['quick_reply_id', 'sort_order']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quick_reply_images');
        Schema::dropIfExists('quick_replies');
        Schema::dropIfExists('quick_reply_topics');
    }
};
