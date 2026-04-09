<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('blog_ai_bulk_jobs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('status', 40)->default('pending');
            $table->string('source_filename', 255);
            $table->string('source_disk', 50)->default('local');
            $table->string('source_path', 500);
            $table->unsignedInteger('total_keywords')->default(0);
            $table->unsignedInteger('unique_keywords')->default(0);
            $table->unsignedInteger('cluster_count')->default(0);
            $table->unsignedInteger('processed_clusters')->default(0);
            $table->unsignedInteger('categories_created')->default(0);
            $table->unsignedInteger('posts_created')->default(0);
            $table->unsignedInteger('posts_failed')->default(0);
            $table->string('ai_model', 120)->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->json('summary')->nullable();
            $table->json('errors')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['account_id', 'status']);
            $table->index(['account_id', 'created_at']);
        });

        Schema::create('blog_ai_bulk_job_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('blog_ai_bulk_job_id')->constrained()->cascadeOnDelete();
            $table->string('level', 20)->default('info');
            $table->string('step', 80)->nullable();
            $table->text('message');
            $table->json('context')->nullable();
            $table->timestamps();

            $table->index(['blog_ai_bulk_job_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('blog_ai_bulk_job_logs');
        Schema::dropIfExists('blog_ai_bulk_jobs');
    }
};
