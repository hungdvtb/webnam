<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('site_analytics_events', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable()->index();
            $table->string('event_name', 50);
            $table->date('event_date')->index();
            $table->timestamp('occurred_at')->index();
            $table->unsignedBigInteger('product_id')->nullable()->index();
            $table->unsignedBigInteger('lead_id')->nullable()->index();
            $table->unsignedBigInteger('order_id')->nullable()->index();
            $table->string('visitor_id', 100)->nullable();
            $table->string('session_id', 100)->nullable();
            $table->string('ip_hash', 64)->nullable();
            $table->integer('quantity')->default(0);
            $table->decimal('value', 15, 2)->nullable();
            $table->text('path')->nullable();
            $table->text('url')->nullable();
            $table->text('referrer')->nullable();
            $table->text('user_agent')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['account_id', 'event_date', 'event_name'], 'site_analytics_account_date_event_index');
            $table->index(['account_id', 'product_id', 'event_date'], 'site_analytics_account_product_date_index');
            $table->index(['account_id', 'session_id'], 'site_analytics_account_session_index');
            $table->index(['account_id', 'visitor_id'], 'site_analytics_account_visitor_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('site_analytics_events');
    }
};
