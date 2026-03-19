<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lead_statuses', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable()->index();
            $table->string('code', 80);
            $table->string('name', 120);
            $table->string('color', 20)->nullable();
            $table->integer('sort_order')->default(0);
            $table->boolean('is_default')->default(false);
            $table->boolean('blocks_order_create')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['account_id', 'code']);
        });

        Schema::create('lead_staffs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable()->index();
            $table->unsignedBigInteger('user_id')->nullable()->index();
            $table->string('name', 120);
            $table->integer('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('lead_tag_rules', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable()->index();
            $table->string('tag', 120);
            $table->string('match_type', 40)->default('contains');
            $table->string('pattern', 255);
            $table->integer('priority')->default(0);
            $table->text('notes')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('lead_notes', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable()->index();
            $table->unsignedBigInteger('lead_id')->index();
            $table->unsignedBigInteger('user_id')->nullable()->index();
            $table->string('staff_name', 120)->nullable();
            $table->text('content');
            $table->timestamps();

            $table->foreign('lead_id')->references('id')->on('leads')->cascadeOnDelete();
        });

        Schema::create('lead_items', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable()->index();
            $table->unsignedBigInteger('lead_id')->index();
            $table->unsignedBigInteger('product_id')->nullable()->index();
            $table->string('product_name', 255)->nullable();
            $table->string('product_sku', 120)->nullable();
            $table->string('product_slug', 255)->nullable();
            $table->text('product_url')->nullable();
            $table->integer('quantity')->default(1);
            $table->decimal('unit_price', 12, 2)->default(0);
            $table->decimal('line_total', 12, 2)->default(0);
            $table->json('options')->nullable();
            $table->json('bundle_items')->nullable();
            $table->integer('sort_order')->default(0);
            $table->timestamps();

            $table->foreign('lead_id')->references('id')->on('leads')->cascadeOnDelete();
        });

        Schema::table('leads', function (Blueprint $table) {
            $table->string('lead_number', 60)->nullable()->after('id');
            $table->unsignedBigInteger('lead_status_id')->nullable()->after('account_id')->index();
            $table->text('address')->nullable()->after('email');
            $table->string('tag', 120)->nullable()->after('source');
            $table->text('link_url')->nullable()->after('tag');
            $table->text('product_summary')->nullable()->after('product_name');
            $table->string('product_summary_short', 255)->nullable()->after('product_summary');
            $table->timestamp('placed_at')->nullable()->after('status');
            $table->decimal('total_amount', 12, 2)->default(0)->after('placed_at');
            $table->decimal('discount_amount', 12, 2)->default(0)->after('total_amount');
            $table->unsignedBigInteger('order_id')->nullable()->after('discount_amount')->index();
            $table->timestamp('status_changed_at')->nullable()->after('order_id');
            $table->text('latest_note_excerpt')->nullable()->after('notes');
            $table->timestamp('last_noted_at')->nullable()->after('latest_note_excerpt');
            $table->json('payload_snapshot')->nullable()->after('user_agent');
            $table->json('conversion_data')->nullable()->after('payload_snapshot');

            $table->unique('lead_number');
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->unsignedBigInteger('lead_id')->nullable()->after('customer_id')->index();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('lead_id');
        });

        Schema::table('leads', function (Blueprint $table) {
            $table->dropUnique(['lead_number']);
            $table->dropColumn([
                'lead_number',
                'lead_status_id',
                'address',
                'tag',
                'link_url',
                'product_summary',
                'product_summary_short',
                'placed_at',
                'total_amount',
                'discount_amount',
                'order_id',
                'status_changed_at',
                'latest_note_excerpt',
                'last_noted_at',
                'payload_snapshot',
                'conversion_data',
            ]);
        });

        Schema::dropIfExists('lead_items');
        Schema::dropIfExists('lead_notes');
        Schema::dropIfExists('lead_tag_rules');
        Schema::dropIfExists('lead_staffs');
        Schema::dropIfExists('lead_statuses');
    }
};
