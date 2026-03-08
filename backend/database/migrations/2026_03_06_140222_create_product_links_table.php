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
        Schema::create('product_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->onDelete('cascade'); // Parent
            $table->foreignId('linked_product_id')->constrained('products')->onDelete('cascade'); // Child
            $table->string('link_type'); // super_link (configurable), grouped, relation, up_sell, cross_sell
            $table->integer('position')->default(0);
            $table->timestamps();
            
            $table->unique(['product_id', 'linked_product_id', 'link_type']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('product_links');
    }
};
