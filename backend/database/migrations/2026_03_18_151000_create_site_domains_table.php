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
        Schema::create('site_domains', function (Blueprint $blueprint) {
            $blueprint->id();
            $blueprint->unsignedBigInteger('account_id');
            $blueprint->string('domain')->unique();
            $blueprint->boolean('is_active')->default(true);
            $blueprint->boolean('is_default')->default(false);
            $blueprint->timestamps();

            $blueprint->foreign('account_id')->references('id')->on('accounts')->onDelete('cascade');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('site_domains');
    }
};
