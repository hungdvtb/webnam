<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('public_category_nodes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('site_domain_id')->constrained('site_domains')->cascadeOnDelete();
            $table->foreignId('parent_id')->nullable()->constrained('public_category_nodes')->nullOnDelete();
            $table->string('title');
            $table->string('slug');
            $table->boolean('status')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->unique(['site_domain_id', 'slug'], 'public_cat_nodes_domain_slug_unique');
            $table->index(['site_domain_id', 'parent_id', 'sort_order'], 'public_cat_nodes_tree_idx');
        });

        Schema::create('public_category_node_categories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('public_category_node_id')->constrained('public_category_nodes')->cascadeOnDelete();
            $table->foreignId('category_id')->constrained('categories')->cascadeOnDelete();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['public_category_node_id', 'category_id'], 'pub_cat_node_cat_unique');
            $table->index('category_id', 'pub_cat_node_cat_category_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('public_category_node_categories');
        Schema::dropIfExists('public_category_nodes');
    }
};
