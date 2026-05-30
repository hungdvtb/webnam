<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('product_reviews', 'rating')) {
            return;
        }

        $driver = DB::getDriverName();

        if ($driver === 'mysql') {
            DB::statement('ALTER TABLE product_reviews MODIFY rating DECIMAL(2,1) NOT NULL DEFAULT 5.0');
            return;
        }

        Schema::table('product_reviews', function (Blueprint $table) {
            $table->decimal('rating', 2, 1)->default(5.0)->change();
        });
    }

    public function down(): void
    {
        if (!Schema::hasColumn('product_reviews', 'rating')) {
            return;
        }

        $driver = DB::getDriverName();

        DB::table('product_reviews')->update(['rating' => DB::raw('ROUND(rating)')]);

        if ($driver === 'mysql') {
            DB::statement('ALTER TABLE product_reviews MODIFY rating INT NOT NULL DEFAULT 5');
            return;
        }

        Schema::table('product_reviews', function (Blueprint $table) {
            $table->integer('rating')->default(5)->change();
        });
    }
};
