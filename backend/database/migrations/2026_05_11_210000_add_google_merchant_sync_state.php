<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            if (!Schema::hasColumn('products', 'google_merchant_sync_status')) {
                $table->string('google_merchant_sync_status', 32)->default('not_synced')->index();
            }

            if (!Schema::hasColumn('products', 'google_merchant_last_synced_at')) {
                $table->timestamp('google_merchant_last_synced_at')->nullable()->index();
            }

            if (!Schema::hasColumn('products', 'google_merchant_last_attempted_at')) {
                $table->timestamp('google_merchant_last_attempted_at')->nullable();
            }

            if (!Schema::hasColumn('products', 'google_merchant_last_error')) {
                $table->text('google_merchant_last_error')->nullable();
            }

            if (!Schema::hasColumn('products', 'google_merchant_offer_id')) {
                $table->string('google_merchant_offer_id', 128)->nullable()->index();
            }

            if (!Schema::hasColumn('products', 'google_merchant_product_input_name')) {
                $table->string('google_merchant_product_input_name')->nullable();
            }

            if (!Schema::hasColumn('products', 'google_merchant_last_payload_hash')) {
                $table->string('google_merchant_last_payload_hash', 64)->nullable();
            }

            if (!Schema::hasColumn('products', 'google_merchant_last_action')) {
                $table->string('google_merchant_last_action', 32)->nullable();
            }
        });

        if (!Schema::hasTable('google_merchant_sync_logs')) {
            Schema::create('google_merchant_sync_logs', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('account_id')->nullable()->index();
                $table->unsignedBigInteger('product_id')->nullable()->index();
                $table->string('offer_id', 128)->nullable()->index();
                $table->string('action', 32)->index();
                $table->string('status', 32)->index();
                $table->string('request_method', 12)->nullable();
                $table->text('request_url')->nullable();
                $table->json('request_payload')->nullable();
                $table->unsignedSmallInteger('response_status')->nullable();
                $table->json('response_body')->nullable();
                $table->text('error_message')->nullable();
                $table->unsignedInteger('duration_ms')->nullable();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('google_merchant_sync_logs');

        Schema::table('products', function (Blueprint $table) {
            foreach ([
                'google_merchant_sync_status',
                'google_merchant_last_synced_at',
                'google_merchant_last_attempted_at',
                'google_merchant_last_error',
                'google_merchant_offer_id',
                'google_merchant_product_input_name',
                'google_merchant_last_payload_hash',
                'google_merchant_last_action',
            ] as $column) {
                if (Schema::hasColumn('products', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
