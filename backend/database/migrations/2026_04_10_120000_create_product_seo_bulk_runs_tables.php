<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_seo_bulk_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('status', 40)->default('queued');
            $table->unsignedInteger('total_items')->default(0);
            $table->unsignedInteger('queued_items')->default(0);
            $table->unsignedInteger('processing_items')->default(0);
            $table->unsignedInteger('completed_items')->default(0);
            $table->unsignedInteger('retrying_items')->default(0);
            $table->unsignedInteger('failed_items')->default(0);
            $table->unsignedSmallInteger('max_attempts')->default(5);
            $table->string('ai_model', 120)->nullable();
            $table->text('custom_instruction')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->json('summary')->nullable();
            $table->json('errors')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['account_id', 'status']);
            $table->index(['account_id', 'created_at']);
        });

        Schema::create('product_seo_bulk_run_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_seo_bulk_run_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('position')->default(0);
            $table->string('product_name', 255);
            $table->string('product_sku', 255)->nullable();
            $table->string('status', 40)->default('queued');
            $table->unsignedSmallInteger('attempt_count')->default(0);
            $table->unsignedSmallInteger('max_attempts')->default(5);
            $table->string('error_code', 80)->nullable();
            $table->text('last_error')->nullable();
            $table->boolean('retryable')->default(false);
            $table->timestamp('next_retry_at')->nullable();
            $table->string('last_model', 120)->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->unique(['product_seo_bulk_run_id', 'product_id'], 'product_seo_bulk_run_items_run_product_unique');
            $table->index(['product_seo_bulk_run_id', 'status', 'position'], 'product_seo_bulk_run_items_run_status_position_index');
            $table->index(['product_seo_bulk_run_id', 'updated_at'], 'product_seo_bulk_run_items_run_updated_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_seo_bulk_run_items');
        Schema::dropIfExists('product_seo_bulk_runs');
    }
};
