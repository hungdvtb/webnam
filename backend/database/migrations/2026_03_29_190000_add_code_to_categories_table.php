<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            $table->string('code')->nullable()->after('name');
        });

        DB::table('categories')
            ->select('id', 'slug')
            ->orderBy('id')
            ->get()
            ->each(function ($category) {
                $baseCode = trim((string) ($category->slug ?? '')) !== ''
                    ? trim((string) $category->slug)
                    : ('danh-muc-' . $category->id);

                DB::table('categories')
                    ->where('id', $category->id)
                    ->update(['code' => $baseCode]);
            });

        Schema::table('categories', function (Blueprint $table) {
            $table->unique(['account_id', 'code'], 'categories_account_id_code_unique');
        });
    }

    public function down(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            $table->dropUnique('categories_account_id_code_unique');
            $table->dropColumn('code');
        });
    }
};
