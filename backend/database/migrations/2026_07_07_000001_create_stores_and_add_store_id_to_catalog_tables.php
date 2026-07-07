<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('stores')) {
            Schema::create('stores', function (Blueprint $table) {
                $table->id();
                $table->foreignId('account_id')->nullable()->constrained()->cascadeOnDelete();
                $table->string('name');
                $table->string('slug')->nullable();
                $table->string('code', 120)->nullable();
                $table->string('phone', 50)->nullable();
                $table->string('address')->nullable();
                $table->boolean('status')->default(true);
                $table->unsignedInteger('sort_order')->default(0);
                $table->timestamps();

                $table->unique(['account_id', 'slug'], 'stores_account_slug_unique');
                $table->index(['account_id', 'status', 'sort_order'], 'stores_account_status_sort_idx');
            });
        }

        if (Schema::hasTable('categories') && !Schema::hasColumn('categories', 'store_id')) {
            Schema::table('categories', function (Blueprint $table) {
                $table->foreignId('store_id')->nullable()->after('site_domain_id')->constrained('stores')->nullOnDelete();
                $table->index(['account_id', 'store_id'], 'categories_account_store_idx');
            });
        }

        if (Schema::hasTable('products') && !Schema::hasColumn('products', 'store_id')) {
            Schema::table('products', function (Blueprint $table) {
                $table->foreignId('store_id')->nullable()->after('site_domain_id')->constrained('stores')->nullOnDelete();
                $table->index(['account_id', 'store_id'], 'products_account_store_idx');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('products') && Schema::hasColumn('products', 'store_id')) {
            Schema::table('products', function (Blueprint $table) {
                $table->dropIndex('products_account_store_idx');
                $table->dropForeign(['store_id']);
                $table->dropColumn('store_id');
            });
        }

        if (Schema::hasTable('categories') && Schema::hasColumn('categories', 'store_id')) {
            Schema::table('categories', function (Blueprint $table) {
                $table->dropIndex('categories_account_store_idx');
                $table->dropForeign(['store_id']);
                $table->dropColumn('store_id');
            });
        }

        Schema::dropIfExists('stores');
    }
};
