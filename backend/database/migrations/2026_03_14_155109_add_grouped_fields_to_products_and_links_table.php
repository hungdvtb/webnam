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
        Schema::table('products', function (Blueprint $table) {
            if (!Schema::hasColumn('products', 'price_type')) {
                $table->string('price_type')->default('fixed')->after('price'); // fixed, sum
            }
        });

        Schema::table('product_links', function (Blueprint $table) {
            if (!Schema::hasColumn('product_links', 'quantity')) {
                $table->integer('quantity')->default(1)->after('link_type');
            }
            if (!Schema::hasColumn('product_links', 'is_required')) {
                $table->boolean('is_required')->default(true)->after('quantity');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('price_type');
        });

        Schema::table('product_links', function (Blueprint $table) {
            $table->dropColumn(['quantity', 'is_required']);
        });
    }
};
