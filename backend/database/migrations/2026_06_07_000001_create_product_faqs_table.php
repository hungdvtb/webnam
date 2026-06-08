<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_faqs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->text('question');
            $table->longText('answer');
            $table->json('images')->nullable();
            $table->string('youtube_url', 2048)->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->string('status', 20)->default('visible');
            $table->timestamps();

            $table->index(['account_id', 'product_id', 'status', 'sort_order'], 'product_faqs_account_product_status_sort_idx');
            $table->index(['product_id', 'status', 'sort_order'], 'product_faqs_product_status_sort_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_faqs');
    }
};
