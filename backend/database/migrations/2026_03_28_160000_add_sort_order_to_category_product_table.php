<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('category_product', function (Blueprint $table) {
            $table->unsignedInteger('sort_order')->default(0);
        });

        $existingRows = DB::table('category_product')
            ->orderBy('category_id')
            ->orderBy('created_at')
            ->orderBy('id')
            ->get(['id', 'category_id']);

        $nextSortOrderByCategory = [];

        foreach ($existingRows as $row) {
            $categoryId = (int) $row->category_id;
            $sortOrder = $nextSortOrderByCategory[$categoryId] ?? 0;

            DB::table('category_product')
                ->where('id', $row->id)
                ->update(['sort_order' => $sortOrder]);

            $nextSortOrderByCategory[$categoryId] = $sortOrder + 1;
        }

        $missingAssignments = DB::table('products')
            ->leftJoin('category_product', function ($join) {
                $join->on('products.id', '=', 'category_product.product_id')
                    ->on('products.category_id', '=', 'category_product.category_id');
            })
            ->whereNotNull('products.category_id')
            ->whereNull('category_product.id')
            ->orderBy('products.category_id')
            ->orderBy('products.created_at')
            ->orderBy('products.id')
            ->get([
                'products.id as product_id',
                'products.category_id',
                'products.created_at',
            ]);

        $insertRows = [];

        foreach ($missingAssignments as $row) {
            $categoryId = (int) $row->category_id;
            $sortOrder = $nextSortOrderByCategory[$categoryId] ?? 0;

            $insertRows[] = [
                'product_id' => (int) $row->product_id,
                'category_id' => $categoryId,
                'sort_order' => $sortOrder,
                'created_at' => $row->created_at ?? now(),
                'updated_at' => now(),
            ];

            $nextSortOrderByCategory[$categoryId] = $sortOrder + 1;
        }

        foreach (array_chunk($insertRows, 500) as $chunk) {
            DB::table('category_product')->insert($chunk);
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('category_product', function (Blueprint $table) {
            $table->dropColumn('sort_order');
        });
    }
};
