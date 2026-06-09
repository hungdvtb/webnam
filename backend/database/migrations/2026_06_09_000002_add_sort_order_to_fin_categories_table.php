<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fin_categories', function (Blueprint $table) {
            $table->unsignedInteger('sort_order')->default(0)->after('color');
        });

        DB::table('fin_categories')
            ->orderBy('name')
            ->orderBy('id')
            ->pluck('id')
            ->each(function ($id, $index) {
                DB::table('fin_categories')
                    ->where('id', $id)
                    ->update(['sort_order' => $index + 1]);
            });
    }

    public function down(): void
    {
        Schema::table('fin_categories', function (Blueprint $table) {
            $table->dropColumn('sort_order');
        });
    }
};
