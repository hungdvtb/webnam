<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('storefront_themes')) {
            Schema::create('storefront_themes', function (Blueprint $table) {
                $table->id();
                $table->foreignId('account_id')->nullable()->constrained()->cascadeOnDelete();
                $table->string('name');
                $table->string('code', 120)->unique();
                $table->string('folder', 160);
                $table->string('preview_image')->nullable();
                $table->text('description')->nullable();
                $table->foreignId('cloned_from_id')->nullable()->constrained('storefront_themes')->nullOnDelete();
                $table->boolean('status')->default(true);
                $table->boolean('is_default')->default(false);
                $table->unsignedInteger('sort_order')->default(0);
                $table->timestamps();

                $table->index(['account_id', 'status', 'sort_order'], 'storefront_themes_account_status_sort_idx');
            });
        }

        if (Schema::hasTable('stores') && !Schema::hasColumn('stores', 'storefront_theme_id')) {
            Schema::table('stores', function (Blueprint $table) {
                $table->foreignId('storefront_theme_id')
                    ->nullable()
                    ->after('public_domain_id')
                    ->constrained('storefront_themes')
                    ->nullOnDelete();

                $table->index(['account_id', 'storefront_theme_id'], 'stores_account_theme_idx');
            });
        }

        $now = now();
        DB::table('storefront_themes')->updateOrInsert(
            ['code' => 'do-tho'],
            [
                'account_id' => null,
                'name' => 'Giao diện số 1',
                'folder' => 'do-tho',
                'description' => 'Bộ giao diện sản phẩm hiện tại đã được lưu làm giao diện số 1.',
                'status' => true,
                'is_default' => true,
                'sort_order' => 1,
                'updated_at' => $now,
                'created_at' => $now,
            ]
        );

    }

    public function down(): void
    {
        if (Schema::hasTable('stores') && Schema::hasColumn('stores', 'storefront_theme_id')) {
            Schema::table('stores', function (Blueprint $table) {
                $table->dropIndex('stores_account_theme_idx');
                $table->dropForeign(['storefront_theme_id']);
                $table->dropColumn('storefront_theme_id');
            });
        }

        Schema::dropIfExists('storefront_themes');
    }
};
