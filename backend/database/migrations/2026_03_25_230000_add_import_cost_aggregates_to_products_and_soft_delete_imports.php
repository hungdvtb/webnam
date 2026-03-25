<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            if (!Schema::hasColumn('products', 'imported_quantity_total')) {
                $table->unsignedBigInteger('imported_quantity_total')->default(0)->after('expected_cost');
            }

            if (!Schema::hasColumn('products', 'imported_value_total')) {
                $table->decimal('imported_value_total', 18, 2)->default(0)->after('imported_quantity_total');
            }
        });

        Schema::table('imports', function (Blueprint $table) {
            if (!Schema::hasColumn('imports', 'deleted_at')) {
                $table->softDeletes();
            }
        });

        if (!Schema::hasTable('products')) {
            return;
        }

        DB::table('products')->update([
            'imported_quantity_total' => 0,
            'imported_value_total' => 0,
        ]);

        if (Schema::hasTable('imports') && Schema::hasTable('import_items') && Schema::hasTable('inventory_import_statuses')) {
            $aggregateMap = [];

            foreach (
                DB::table('imports')
                    ->leftJoin('inventory_import_statuses', 'inventory_import_statuses.id', '=', 'imports.inventory_import_status_id')
                    ->select([
                        'imports.id',
                        DB::raw('COALESCE(imports.extra_charge_amount, 0) as extra_charge_amount'),
                        DB::raw('COALESCE(inventory_import_statuses.affects_inventory, FALSE) as affects_inventory'),
                    ])
                    ->orderBy('imports.id')
                    ->cursor() as $import
            ) {
                if (!(bool) $import->affects_inventory) {
                    continue;
                }

                $items = DB::table('import_items')
                    ->where('import_id', $import->id)
                    ->orderBy('id')
                    ->get([
                        'product_id',
                        'quantity',
                        'received_quantity',
                        'unit_cost',
                    ]);

                foreach ($this->buildImportContributionMap($items, (float) $import->extra_charge_amount) as $productId => $row) {
                    if (!isset($aggregateMap[$productId])) {
                        $aggregateMap[$productId] = [
                            'quantity' => 0,
                            'value' => 0.0,
                        ];
                    }

                    $aggregateMap[$productId]['quantity'] += (int) $row['quantity'];
                    $aggregateMap[$productId]['value'] = round(
                        (float) $aggregateMap[$productId]['value'] + (float) $row['value'],
                        2
                    );
                }
            }

            foreach ($aggregateMap as $productId => $row) {
                DB::table('products')
                    ->where('id', (int) $productId)
                    ->update([
                        'imported_quantity_total' => (int) $row['quantity'],
                        'imported_value_total' => round((float) $row['value'], 2),
                    ]);
            }
        }

        DB::table('products')->update([
            'cost_price' => DB::raw("
                CASE
                    WHEN COALESCE(imported_quantity_total, 0) > 0
                        THEN ROUND(COALESCE(imported_value_total, 0) / NULLIF(imported_quantity_total, 0), 2)
                    ELSE NULL
                END
            "),
        ]);

        if (Schema::hasTable('supplier_product_prices')) {
            foreach (
                DB::table('products')
                    ->select(['id', 'account_id', 'supplier_id', 'expected_cost'])
                    ->orderBy('id')
                    ->cursor() as $product
            ) {
                $expectedCost = $product->expected_cost !== null ? round((float) $product->expected_cost, 2) : null;
                $supplierId = $product->supplier_id ? (int) $product->supplier_id : null;

                if ($expectedCost !== null && $supplierId) {
                    DB::table('supplier_product_prices')->upsert(
                        [[
                            'supplier_id' => $supplierId,
                            'product_id' => (int) $product->id,
                            'account_id' => $product->account_id ? (int) $product->account_id : null,
                            'unit_cost' => $expectedCost,
                            'created_at' => now(),
                            'updated_at' => now(),
                        ]],
                        ['supplier_id', 'product_id'],
                        ['account_id', 'unit_cost', 'updated_at']
                    );
                    continue;
                }

                if ($expectedCost !== null) {
                    continue;
                }

                $sourcePrice = DB::table('supplier_product_prices')
                    ->where('product_id', (int) $product->id)
                    ->when($supplierId, function ($query) use ($supplierId) {
                        $query->orderByRaw('CASE WHEN supplier_id = ? THEN 0 ELSE 1 END', [$supplierId]);
                    })
                    ->orderByDesc('updated_at')
                    ->orderByDesc('id')
                    ->first(['supplier_id', 'unit_cost']);

                if (!$sourcePrice || $sourcePrice->unit_cost === null) {
                    continue;
                }

                DB::table('products')
                    ->where('id', (int) $product->id)
                    ->update([
                        'expected_cost' => round((float) $sourcePrice->unit_cost, 2),
                        'supplier_id' => $supplierId ?: (int) $sourcePrice->supplier_id,
                    ]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('imports', function (Blueprint $table) {
            if (Schema::hasColumn('imports', 'deleted_at')) {
                $table->dropSoftDeletes();
            }
        });

        Schema::table('products', function (Blueprint $table) {
            foreach (['imported_quantity_total', 'imported_value_total'] as $column) {
                if (Schema::hasColumn('products', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }

    private function buildImportContributionMap($items, float $extraChargeAmount): array
    {
        $normalizedItems = collect($items)
            ->map(function ($item) {
                $receivedQuantity = max(0, (int) ($item->received_quantity ?? $item->quantity ?? 0));
                $unitCost = round((float) ($item->unit_cost ?? 0), 2);

                return [
                    'product_id' => (int) ($item->product_id ?? 0),
                    'received_quantity' => $receivedQuantity,
                    'base_value' => round($receivedQuantity * $unitCost, 2),
                ];
            })
            ->filter(fn ($item) => $item['product_id'] > 0 && $item['received_quantity'] > 0)
            ->values();

        if ($normalizedItems->isEmpty()) {
            return [];
        }

        $receivedSubtotal = round((float) $normalizedItems->sum('base_value'), 2);
        $remainingExtraCharge = round($extraChargeAmount, 2);
        $lastIndex = $normalizedItems->count() - 1;
        $result = [];

        foreach ($normalizedItems as $index => $item) {
            if ($index === $lastIndex) {
                $allocatedExtraCharge = $remainingExtraCharge;
            } elseif ($receivedSubtotal > 0) {
                $allocatedExtraCharge = round(
                    ($item['base_value'] / $receivedSubtotal) * $extraChargeAmount,
                    2
                );
                $remainingExtraCharge = round($remainingExtraCharge - $allocatedExtraCharge, 2);
            } else {
                $allocatedExtraCharge = 0.0;
            }

            $productId = $item['product_id'];
            if (!isset($result[$productId])) {
                $result[$productId] = [
                    'quantity' => 0,
                    'value' => 0.0,
                ];
            }

            $result[$productId]['quantity'] += (int) $item['received_quantity'];
            $result[$productId]['value'] = round(
                (float) $result[$productId]['value'] + (float) $item['base_value'] + (float) $allocatedExtraCharge,
                2
            );
        }

        return $result;
    }
};
