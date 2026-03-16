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
        Schema::table('product_links', function (Blueprint $table) {
            $table->dropUnique(['product_id', 'linked_product_id', 'link_type']);
            
            // New constraint to ensure we don't have exact duplicates, 
            // but allowing same product in different options or with different variants.
            $table->unique(['product_id', 'linked_product_id', 'link_type', 'option_title', 'variant_id'], 'product_links_unique_bundle_item');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('product_links', function (Blueprint $table) {
            $table->dropUnique('product_links_unique_bundle_item');
            $table->unique(['product_id', 'linked_product_id', 'link_type']);
        });
    }
};
