<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            // Foreign Key and Common Filters
            $table->index('category_id', 'idx_prod_category_id');
            $table->index('account_id', 'idx_prod_account_id'); // Very important for multi-tenancy

            // Performance Optimizations for Sorting
            $table->index('created_at', 'idx_prod_created_at');
            $table->index('price', 'idx_prod_price');
            
            // Boolean Filters
            $table->index(['account_id', 'is_featured', 'is_new'], 'idx_prod_flags');

            // Compound index for default listing (account + date)
            $table->index(['account_id', 'created_at', 'id'], 'idx_prod_acc_date');
        });

        Schema::table('product_images', function (Blueprint $table) {
            $table->index('product_id', 'idx_prod_img_product_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropIndex('idx_prod_category_id');
            $table->dropIndex('idx_prod_account_id');
            $table->dropIndex('idx_prod_created_at');
            $table->dropIndex('idx_prod_price');
            $table->dropIndex('idx_prod_flags');
            $table->dropIndex('idx_prod_acc_date');
        });

        Schema::table('product_images', function (Blueprint $table) {
            $table->dropIndex('idx_prod_img_product_id');
        });
    }

};
