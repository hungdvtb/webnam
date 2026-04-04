<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('category_product', function (Blueprint $table) {
            $table->string('item_type', 40)->default('product')->after('category_id');
            $table->string('bundle_option_key', 190)->default('')->after('item_type');
            $table->foreignId('bundle_option_post_id')->nullable()->after('bundle_option_key')->constrained('posts')->nullOnDelete();
            $table->string('bundle_option_title')->nullable()->after('bundle_option_post_id');
        });

        DB::table('category_product')
            ->whereNull('bundle_option_key')
            ->update(['bundle_option_key' => '']);

        Schema::table('category_product', function (Blueprint $table) {
            $table->dropUnique('category_product_product_id_category_id_unique');
            $table->unique(
                ['category_id', 'item_type', 'product_id', 'bundle_option_key'],
                'category_product_unique_category_assignment'
            );
            $table->index(
                ['category_id', 'item_type', 'sort_order'],
                'category_product_category_item_sort_index'
            );
        });
    }

    public function down(): void
    {
        DB::table('category_product')
            ->where('item_type', 'bundle_option')
            ->delete();

        Schema::table('category_product', function (Blueprint $table) {
            $table->dropUnique('category_product_unique_category_assignment');
            $table->dropIndex('category_product_category_item_sort_index');
            $table->dropConstrainedForeignId('bundle_option_post_id');
            $table->dropColumn(['item_type', 'bundle_option_key', 'bundle_option_title']);
            $table->unique(['product_id', 'category_id']);
        });
    }
};
