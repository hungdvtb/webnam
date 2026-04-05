<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_ai_training_datasets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('rule_key', 160);
            $table->string('altar_size_label', 120);
            $table->json('altar_size_aliases')->nullable();
            $table->json('context_aliases')->nullable();
            $table->string('input_type', 20);
            $table->string('source_name', 255)->nullable();
            $table->text('training_note')->nullable();
            $table->longText('input_text')->nullable();
            $table->string('input_image_path', 1000)->nullable();
            $table->string('input_image_mime', 120)->nullable();
            $table->json('parsed_result')->nullable();
            $table->longText('parsed_raw_text')->nullable();
            $table->string('parsed_provider', 120)->nullable();
            $table->timestamp('trained_at')->nullable();
            $table->softDeletes();
            $table->timestamps();

            $table->unique(['account_id', 'rule_key'], 'order_ai_training_datasets_account_rule_unique');
            $table->index(['account_id', 'altar_size_label'], 'order_ai_training_datasets_account_size_index');
            $table->index(['account_id', 'input_type'], 'order_ai_training_datasets_account_type_index');
        });

        Schema::create('order_ai_training_dataset_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('dataset_id')
                ->constrained('order_ai_training_datasets')
                ->cascadeOnDelete();
            $table->json('aliases')->nullable();
            $table->unsignedInteger('default_quantity')->default(1);
            $table->unsignedBigInteger('target_product_id');
            $table->unsignedBigInteger('parent_product_id')->nullable();
            $table->string('entry_kind', 20)->default('product');
            $table->string('display_name', 255)->nullable();
            $table->string('display_sku', 120)->nullable();
            $table->string('option_label', 255)->nullable();
            $table->string('main_image', 1000)->nullable();
            $table->decimal('price', 12, 2)->default(0);
            $table->decimal('cost_price', 12, 2)->default(0);
            $table->unsignedInteger('sort_order')->default(1);
            $table->timestamps();

            $table->index(['dataset_id', 'sort_order'], 'order_ai_training_items_dataset_sort_index');
            $table->index(['target_product_id'], 'order_ai_training_items_target_product_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_ai_training_dataset_items');
        Schema::dropIfExists('order_ai_training_datasets');
    }
};
