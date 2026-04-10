<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'external_delivery_meta')) {
                $table->json('external_delivery_meta')->nullable()->after('shipping_issue_detected_at');
            }
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (Schema::hasColumn('orders', 'external_delivery_meta')) {
                $table->dropColumn('external_delivery_meta');
            }
        });
    }
};
