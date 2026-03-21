<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $products = DB::table('products')
            ->select('id', 'account_id', 'name', 'sku', 'stock_quantity', 'cost_price', 'expected_cost')
            ->where('stock_quantity', '>', 0)
            ->whereNull('deleted_at')
            ->orderBy('account_id')
            ->orderBy('id')
            ->get()
            ->groupBy('account_id');

        foreach ($products as $accountId => $rows) {
            $accountKey = $accountId ?: '0';
            $importNumber = sprintf('BOOT-%s-%s', $accountKey, now()->format('ymd'));

            $importId = DB::table('imports')->insertGetId([
                'account_id' => $accountId,
                'import_number' => $importNumber,
                'supplier_name' => 'Ton dau ky',
                'import_date' => now()->toDateString(),
                'status' => 'completed',
                'total_quantity' => (int) $rows->sum('stock_quantity'),
                'total_amount' => (float) $rows->sum(fn ($row) => ((float) ($row->cost_price ?? $row->expected_cost ?? 0)) * (int) $row->stock_quantity),
                'notes' => 'Tu dong chuyen ton cu thanh batch dau ky.',
                'created_by' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $line = 1;
            foreach ($rows as $row) {
                $exists = DB::table('inventory_batches')->where('product_id', $row->id)->exists();
                if ($exists) {
                    continue;
                }

                $unitCost = (float) ($row->cost_price ?? $row->expected_cost ?? 0);
                $quantity = (int) $row->stock_quantity;

                $importItemId = DB::table('import_items')->insertGetId([
                    'account_id' => $accountId,
                    'import_id' => $importId,
                    'product_id' => $row->id,
                    'product_name_snapshot' => $row->name,
                    'product_sku_snapshot' => $row->sku,
                    'quantity' => $quantity,
                    'unit_cost' => $unitCost,
                    'line_total' => $quantity * $unitCost,
                    'notes' => 'Backfill ton dau ky',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                DB::table('inventory_batches')->insert([
                    'account_id' => $accountId,
                    'product_id' => $row->id,
                    'import_id' => $importId,
                    'import_item_id' => $importItemId,
                    'batch_number' => sprintf('OPEN-%s-%04d', $accountKey, $line++),
                    'received_at' => now(),
                    'quantity' => $quantity,
                    'remaining_quantity' => $quantity,
                    'unit_cost' => $unitCost,
                    'status' => 'open',
                    'meta' => json_encode(['source' => 'opening_balance']),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        $importIds = DB::table('imports')
            ->where('supplier_name', 'Ton dau ky')
            ->pluck('id');

        if ($importIds->isEmpty()) {
            return;
        }

        DB::table('inventory_batches')->whereIn('import_id', $importIds)->delete();
        DB::table('import_items')->whereIn('import_id', $importIds)->delete();
        DB::table('imports')->whereIn('id', $importIds)->delete();
    }
};
