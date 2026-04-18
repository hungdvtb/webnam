<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('orders', 'internal_shipping_fee')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->decimal('internal_shipping_fee', 15, 2)->default(0)->after('shipping_fee');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('orders', 'internal_shipping_fee')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->dropColumn('internal_shipping_fee');
            });
        }
    }
};
