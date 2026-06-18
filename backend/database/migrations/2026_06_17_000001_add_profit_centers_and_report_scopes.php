<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('profit_centers')) {
            Schema::create('profit_centers', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('account_id')->nullable()->index();
                $table->string('name', 160);
                $table->string('code', 80)->index();
                $table->string('channel', 32)->default('online')->index();
                $table->unsignedBigInteger('manager_user_id')->nullable()->index();
                $table->text('description')->nullable();
                $table->boolean('is_active')->default(true)->index();
                $table->unsignedInteger('sort_order')->default(0);
                $table->json('metadata')->nullable();
                $table->timestamps();
                $table->softDeletes();

                $table->unique(['account_id', 'code'], 'profit_centers_account_code_unique');
                $table->foreign('account_id')->references('id')->on('accounts')->nullOnDelete();
                $table->foreign('manager_user_id')->references('id')->on('users')->nullOnDelete();
            });
        }

        if (!Schema::hasTable('ad_account_profit_centers')) {
            Schema::create('ad_account_profit_centers', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('account_id')->nullable()->index();
                $table->string('platform', 32)->index();
                $table->string('external_account_id', 100)->index();
                $table->string('external_account_name', 180)->nullable();
                $table->unsignedBigInteger('profit_center_id')->nullable()->index();
                $table->decimal('allocation_percent', 7, 4)->default(100);
                $table->boolean('is_active')->default(true)->index();
                $table->json('metadata')->nullable();
                $table->timestamps();

                $table->unique(['account_id', 'platform', 'external_account_id'], 'ad_pc_account_platform_external_unique');
                $table->foreign('account_id')->references('id')->on('accounts')->nullOnDelete();
                $table->foreign('profit_center_id')->references('id')->on('profit_centers')->nullOnDelete();
            });
        }

        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'sales_channel')) {
                $table->string('sales_channel', 32)->default('online')->after('order_type')->index();
            }

            if (!Schema::hasColumn('orders', 'profit_center_id')) {
                $table->unsignedBigInteger('profit_center_id')->nullable()->after('sales_channel')->index();
            }

            if (!Schema::hasColumn('orders', 'offline_store_name')) {
                $table->string('offline_store_name', 160)->nullable()->after('profit_center_id');
            }

            if (!Schema::hasColumn('orders', 'offline_seller_name')) {
                $table->string('offline_seller_name', 160)->nullable()->after('offline_store_name');
            }

            if (!Schema::hasColumn('orders', 'offline_payment_method')) {
                $table->string('offline_payment_method', 80)->nullable()->after('offline_seller_name');
            }
        });

        if (Schema::hasColumn('orders', 'profit_center_id')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->foreign('profit_center_id', 'orders_profit_center_id_foreign')
                    ->references('id')
                    ->on('profit_centers')
                    ->nullOnDelete();
            });
        }

        Schema::table('daily_ads_spends', function (Blueprint $table) {
            if (!Schema::hasColumn('daily_ads_spends', 'profit_center_id')) {
                $table->unsignedBigInteger('profit_center_id')->nullable()->after('account_id')->index();
            }
        });

        if (Schema::hasColumn('daily_ads_spends', 'profit_center_id')) {
            Schema::table('daily_ads_spends', function (Blueprint $table) {
                $table->foreign('profit_center_id', 'daily_ads_spends_profit_center_id_foreign')
                    ->references('id')
                    ->on('profit_centers')
                    ->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('daily_ads_spends', 'profit_center_id')) {
            Schema::table('daily_ads_spends', function (Blueprint $table) {
                $table->dropForeign('daily_ads_spends_profit_center_id_foreign');
                $table->dropColumn('profit_center_id');
            });
        }

        if (Schema::hasColumn('orders', 'profit_center_id')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->dropForeign('orders_profit_center_id_foreign');
            });
        }

        Schema::table('orders', function (Blueprint $table) {
            foreach (['offline_payment_method', 'offline_seller_name', 'offline_store_name', 'profit_center_id', 'sales_channel'] as $column) {
                if (Schema::hasColumn('orders', $column)) {
                    $table->dropColumn($column);
                }
            }
        });

        Schema::dropIfExists('ad_account_profit_centers');
        Schema::dropIfExists('profit_centers');
    }
};
