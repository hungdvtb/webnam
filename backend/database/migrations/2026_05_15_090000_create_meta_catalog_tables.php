<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('meta_catalog_configs')) {
            Schema::create('meta_catalog_configs', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('account_id')->nullable()->unique();
                $table->boolean('enabled')->default(false);
                $table->string('app_id', 64)->nullable();
                $table->string('catalog_id', 64)->nullable();
                $table->longText('access_token')->nullable();
                $table->string('graph_api_version', 16)->default('v25.0');
                $table->string('brand', 120)->default('Gốm Đại Thành');
                $table->string('currency', 3)->default('VND');
                $table->string('fallback_image_url', 2048)->nullable();
                $table->boolean('delete_stale')->default(true);
                $table->string('sync_frequency', 32)->default('hourly');
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('meta_catalog_sync_logs')) {
            Schema::create('meta_catalog_sync_logs', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('account_id')->nullable()->index();
                $table->unsignedBigInteger('user_id')->nullable()->index();
                $table->string('operation', 32)->index();
                $table->string('status', 32)->index();
                $table->unsignedInteger('total_products')->default(0);
                $table->unsignedInteger('valid_products')->default(0);
                $table->unsignedInteger('invalid_products')->default(0);
                $table->unsignedInteger('success_count')->default(0);
                $table->unsignedInteger('error_count')->default(0);
                $table->unsignedInteger('create_count')->default(0);
                $table->unsignedInteger('update_count')->default(0);
                $table->unsignedInteger('delete_count')->default(0);
                $table->unsignedInteger('fallback_count')->default(0);
                $table->unsignedInteger('duration_ms')->nullable();
                $table->text('summary')->nullable();
                $table->text('error_message')->nullable();
                $table->json('details')->nullable();
                $table->timestamp('started_at')->nullable()->index();
                $table->timestamp('finished_at')->nullable()->index();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('meta_catalog_sync_logs');
        Schema::dropIfExists('meta_catalog_configs');
    }
};
