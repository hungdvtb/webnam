<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_suppliers', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable()->index();
            $table->unsignedBigInteger('product_id');
            $table->unsignedBigInteger('supplier_id');
            $table->timestamps();

            $table->unique(['product_id', 'supplier_id']);
            $table->foreign('product_id')->references('id')->on('products')->cascadeOnDelete();
            $table->foreign('supplier_id')->references('id')->on('suppliers')->cascadeOnDelete();
        });

        if (!Schema::hasTable('products') || !Schema::hasTable('supplier_product_prices')) {
            return;
        }

        DB::table('products')
            ->select(['id as product_id', 'supplier_id', 'account_id'])
            ->whereNotNull('supplier_id')
            ->orderBy('id')
            ->chunk(500, function ($rows) {
                $payload = collect($rows)
                    ->map(function ($row) {
                        $now = now();

                        return [
                            'product_id' => (int) $row->product_id,
                            'supplier_id' => (int) $row->supplier_id,
                            'account_id' => $row->account_id ? (int) $row->account_id : null,
                            'created_at' => $now,
                            'updated_at' => $now,
                        ];
                    })
                    ->all();

                if (!empty($payload)) {
                    DB::table('product_suppliers')->upsert(
                        $payload,
                        ['product_id', 'supplier_id'],
                        ['account_id', 'updated_at']
                    );
                }
            });

        DB::table('supplier_product_prices')
            ->leftJoin('products', 'products.id', '=', 'supplier_product_prices.product_id')
            ->select([
                'supplier_product_prices.product_id',
                'supplier_product_prices.supplier_id',
                DB::raw('COALESCE(supplier_product_prices.account_id, products.account_id) as account_id'),
            ])
            ->orderBy('supplier_product_prices.id')
            ->chunk(500, function ($rows) {
                $payload = collect($rows)
                    ->map(function ($row) {
                        $now = now();

                        return [
                            'product_id' => (int) $row->product_id,
                            'supplier_id' => (int) $row->supplier_id,
                            'account_id' => $row->account_id ? (int) $row->account_id : null,
                            'created_at' => $now,
                            'updated_at' => $now,
                        ];
                    })
                    ->all();

                if (!empty($payload)) {
                    DB::table('product_suppliers')->upsert(
                        $payload,
                        ['product_id', 'supplier_id'],
                        ['account_id', 'updated_at']
                    );
                }
            });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_suppliers');
    }
};
