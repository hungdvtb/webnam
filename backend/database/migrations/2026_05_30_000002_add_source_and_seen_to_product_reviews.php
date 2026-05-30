<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_reviews', function (Blueprint $table) {
            if (!Schema::hasColumn('product_reviews', 'source_type')) {
                $table->string('source_type', 30)->default('customer_web')->after('author_type')->index();
            }

            if (!Schema::hasColumn('product_reviews', 'admin_seen_at')) {
                $table->timestamp('admin_seen_at')->nullable()->after('customer_user_agent')->index();
            }
        });

        if (Schema::hasColumn('product_reviews', 'source_type')) {
            DB::table('product_reviews')
                ->whereNull('customer_ip_hash')
                ->update(['source_type' => 'admin_manual']);

            DB::table('product_reviews')
                ->whereNotNull('customer_ip_hash')
                ->update(['source_type' => 'customer_web']);
        }

        if (Schema::hasColumn('product_reviews', 'admin_seen_at')) {
            DB::table('product_reviews')
                ->whereNull('admin_seen_at')
                ->update(['admin_seen_at' => now()]);
        }
    }

    public function down(): void
    {
        Schema::table('product_reviews', function (Blueprint $table) {
            if (Schema::hasColumn('product_reviews', 'admin_seen_at')) {
                $table->dropColumn('admin_seen_at');
            }

            if (Schema::hasColumn('product_reviews', 'source_type')) {
                $table->dropColumn('source_type');
            }
        });
    }
};
