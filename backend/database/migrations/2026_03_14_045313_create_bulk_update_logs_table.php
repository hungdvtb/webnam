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
        Schema::create('bulk_update_logs', function (Blueprint $table) {
            $table->id();
            $table->string('batch_name')->nullable();
            $table->json('original_data'); // Store previous state of products
            $table->integer('product_count');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('bulk_update_logs');
    }
};
