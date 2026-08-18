<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_replacement_groups', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('name')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['account_id', 'created_at']);
        });

        Schema::create('product_replacement_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('group_id')->constrained('product_replacement_groups')->cascadeOnDelete();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('product_sku_snapshot')->nullable();
            $table->string('product_name_snapshot')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['account_id', 'product_id'], 'product_replacement_items_account_product_unique');
            $table->unique(['group_id', 'product_id'], 'product_replacement_items_group_product_unique');
            $table->index(['account_id', 'product_sku_snapshot'], 'product_replacement_items_account_sku_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_replacement_items');
        Schema::dropIfExists('product_replacement_groups');
    }
};
