<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_reviews', function (Blueprint $table) {
            if (!Schema::hasColumn('product_reviews', 'parent_id')) {
                $table->foreignId('parent_id')
                    ->nullable()
                    ->after('id')
                    ->constrained('product_reviews')
                    ->cascadeOnDelete();
            }

            if (!Schema::hasColumn('product_reviews', 'author_type')) {
                $table->string('author_type', 20)->default('guest')->after('user_id')->index();
            }

            if (!Schema::hasColumn('product_reviews', 'is_anonymous')) {
                $table->boolean('is_anonymous')->default(false)->after('customer_name');
            }

            if (!Schema::hasColumn('product_reviews', 'status')) {
                $table->string('status', 20)->default('pending')->after('is_approved')->index();
            }

            if (!Schema::hasColumn('product_reviews', 'helpful_count')) {
                $table->unsignedInteger('helpful_count')->default(0)->after('status');
            }

            if (!Schema::hasColumn('product_reviews', 'customer_ip_hash')) {
                $table->string('customer_ip_hash', 64)->nullable()->after('helpful_count')->index();
            }

            if (!Schema::hasColumn('product_reviews', 'customer_user_agent')) {
                $table->string('customer_user_agent', 255)->nullable()->after('customer_ip_hash');
            }
        });

        if (Schema::hasColumn('product_reviews', 'status')) {
            DB::table('product_reviews')
                ->where('is_approved', true)
                ->update(['status' => 'visible']);

            DB::table('product_reviews')
                ->where('is_approved', false)
                ->update(['status' => 'pending']);
        }

        if (!Schema::hasTable('product_review_likes')) {
            Schema::create('product_review_likes', function (Blueprint $table) {
                $table->id();
                $table->foreignId('product_review_id')->constrained('product_reviews')->cascadeOnDelete();
                $table->foreignId('account_id')->nullable()->constrained()->cascadeOnDelete();
                $table->string('customer_ip_hash', 64);
                $table->string('customer_user_agent_hash', 64)->nullable();
                $table->timestamps();

                $table->unique(['product_review_id', 'customer_ip_hash'], 'product_review_likes_review_ip_unique');
                $table->index(['account_id', 'created_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('product_review_likes');

        Schema::table('product_reviews', function (Blueprint $table) {
            if (Schema::hasColumn('product_reviews', 'parent_id')) {
                $table->dropConstrainedForeignId('parent_id');
            }

            foreach ([
                'author_type',
                'is_anonymous',
                'status',
                'helpful_count',
                'customer_ip_hash',
                'customer_user_agent',
            ] as $column) {
                if (Schema::hasColumn('product_reviews', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
