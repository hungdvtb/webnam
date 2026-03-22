<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('supplier_product_prices', function (Blueprint $table) {
            if (!Schema::hasColumn('supplier_product_prices', 'supplier_product_code')) {
                $table->string('supplier_product_code')->nullable()->after('product_id');
                $table->index(['supplier_id', 'supplier_product_code'], 'supplier_price_supplier_code_idx');
            }
        });

        if (Schema::hasTable('products') && Schema::hasColumn('products', 'supplier_product_code')) {
            $products = DB::table('products')
                ->select([
                    'products.id',
                    'products.account_id',
                    'products.supplier_id',
                    'products.supplier_product_code',
                    'products.cost_price',
                    'products.expected_cost',
                ])
                ->whereNotNull('products.supplier_product_code')
                ->where('products.supplier_product_code', '<>', '')
                ->orderBy('products.id')
                ->get();

            foreach ($products as $product) {
                $supplierId = $product->supplier_id ? (int) $product->supplier_id : null;

                if (!$supplierId && Schema::hasTable('product_suppliers')) {
                    $supplierId = DB::table('product_suppliers')
                        ->where('product_id', $product->id)
                        ->orderBy('supplier_id')
                        ->value('supplier_id');
                }

                if (!$supplierId) {
                    $supplierId = DB::table('supplier_product_prices')
                        ->where('product_id', $product->id)
                        ->orderBy('supplier_id')
                        ->value('supplier_id');
                }

                if (!$supplierId) {
                    continue;
                }

                $existingPrice = DB::table('supplier_product_prices')
                    ->where('supplier_id', $supplierId)
                    ->where('product_id', $product->id)
                    ->first();

                $normalizedCode = trim((string) $product->supplier_product_code) ?: null;
                $unitCost = round((float) ($product->cost_price ?? $product->expected_cost ?? 0), 2);

                if ($existingPrice) {
                    if (empty($existingPrice->supplier_product_code) && $normalizedCode) {
                        DB::table('supplier_product_prices')
                            ->where('id', $existingPrice->id)
                            ->update([
                                'supplier_product_code' => $normalizedCode,
                                'updated_at' => now(),
                            ]);
                    }

                    continue;
                }

                DB::table('supplier_product_prices')->insert([
                    'account_id' => $product->account_id,
                    'supplier_id' => $supplierId,
                    'product_id' => $product->id,
                    'supplier_product_code' => $normalizedCode,
                    'unit_cost' => $unitCost,
                    'notes' => null,
                    'updated_by' => null,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            Schema::table('products', function (Blueprint $table) {
                if (Schema::hasColumn('products', 'supplier_product_code')) {
                    $table->dropColumn('supplier_product_code');
                }
            });
        }
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            if (!Schema::hasColumn('products', 'supplier_product_code')) {
                $table->string('supplier_product_code')->nullable()->after('supplier_id');
            }
        });

        DB::table('supplier_product_prices')
            ->whereNotNull('supplier_product_code')
            ->where('supplier_product_code', '<>', '')
            ->orderBy('id')
            ->get()
            ->each(function ($price) {
                DB::table('products')
                    ->where('id', $price->product_id)
                    ->whereNull('supplier_product_code')
                    ->update([
                        'supplier_product_code' => $price->supplier_product_code,
                    ]);
            });

        Schema::table('supplier_product_prices', function (Blueprint $table) {
            if (Schema::hasColumn('supplier_product_prices', 'supplier_product_code')) {
                $table->dropIndex('supplier_price_supplier_code_idx');
                $table->dropColumn('supplier_product_code');
            }
        });
    }
};
