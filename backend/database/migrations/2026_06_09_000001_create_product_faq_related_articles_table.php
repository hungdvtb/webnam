<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_faq_related_articles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_faq_id')->constrained('product_faqs')->cascadeOnDelete();
            $table->foreignId('post_id')->nullable()->constrained('posts')->nullOnDelete();
            $table->string('source', 20);
            $table->text('url')->nullable();
            $table->string('title')->nullable();
            $table->text('excerpt')->nullable();
            $table->text('image_url')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->index(
                ['product_faq_id', 'sort_order'],
                'product_faq_related_articles_faq_sort_idx'
            );
            $table->index(
                ['account_id', 'post_id'],
                'product_faq_related_articles_account_post_idx'
            );
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_faq_related_articles');
    }
};
