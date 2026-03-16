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
            $table->unsignedBigInteger('variant_id')->nullable()->after('linked_product_id');
            $table->foreign('variant_id')->references('id')->on('products')->onDelete('set null');
            
            // Note: We might need to drop the unique constraint if it becomes a problem
            // for bundles with multiple variants of the same parent product.
            // But for now, we'll keep it and see.
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('product_links', function (Blueprint $table) {
            $table->dropForeign(['variant_id']);
            $table->dropColumn('variant_id');
        });
    }
};
