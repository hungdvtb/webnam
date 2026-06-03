<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('blog_ai_url_import_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('blog_ai_bulk_job_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('position')->default(0);
            $table->string('source_url', 1000);
            $table->string('source_hash', 64);
            $table->string('source_title', 500)->nullable();
            $table->string('status', 40)->default('pending');
            $table->foreignId('post_id')->nullable()->constrained('posts')->nullOnDelete();
            $table->string('generated_title', 500)->nullable();
            $table->string('last_model', 120)->nullable();
            $table->text('source_brief')->nullable();
            $table->text('last_error')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->unique(['blog_ai_bulk_job_id', 'source_hash'], 'blog_ai_url_items_job_hash_unique');
            $table->index(['blog_ai_bulk_job_id', 'status', 'position'], 'blog_ai_url_items_status_position_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('blog_ai_url_import_items');
    }
};
