<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const QUANTITY_COLUMNS = [
        'products' => ['stock_quantity', 'damaged_quantity', 'imported_quantity_total'],
        'order_items' => ['quantity'],
        'order_supplement_items' => ['quantity'],
        'imports' => ['total_quantity'],
        'import_items' => ['quantity', 'received_quantity'],
        'inventory_batches' => ['quantity', 'remaining_quantity'],
        'inventory_batch_allocations' => ['quantity'],
        'shipment_items' => ['qty'],
        'inventory_documents' => ['total_quantity'],
        'inventory_document_items' => ['quantity'],
        'inventory_document_allocations' => ['quantity'],
        'inventory_document_item_order_links' => [
            'exported_quantity',
            'actual_quantity',
            'export_adjustment_quantity',
        ],
    ];

    public function up(): void
    {
        $this->changeQuantityColumnsToDecimal();
    }

    public function down(): void
    {
        $this->changeQuantityColumnsToInteger();
    }

    private function changeQuantityColumnsToDecimal(): void
    {
        foreach (self::QUANTITY_COLUMNS as $table => $columns) {
            if (!Schema::hasTable($table)) {
                continue;
            }

            foreach ($columns as $column) {
                if (!Schema::hasColumn($table, $column)) {
                    continue;
                }

                $this->alterColumn($table, $column, 'DECIMAL(15,3)', 'NUMERIC(15,3)');
            }
        }
    }

    private function changeQuantityColumnsToInteger(): void
    {
        foreach (self::QUANTITY_COLUMNS as $table => $columns) {
            if (!Schema::hasTable($table)) {
                continue;
            }

            foreach ($columns as $column) {
                if (!Schema::hasColumn($table, $column)) {
                    continue;
                }

                $this->alterColumn($table, $column, 'INTEGER', 'INTEGER');
            }
        }
    }

    private function alterColumn(string $table, string $column, string $mysqlType, string $pgsqlType): void
    {
        $driver = DB::connection()->getDriverName();

        if ($driver === 'pgsql') {
            $quotedTable = '"' . str_replace('"', '""', $table) . '"';
            $quotedColumn = '"' . str_replace('"', '""', $column) . '"';
            DB::statement("ALTER TABLE {$quotedTable} ALTER COLUMN {$quotedColumn} TYPE {$pgsqlType} USING {$quotedColumn}::{$pgsqlType}");
            DB::statement("ALTER TABLE {$quotedTable} ALTER COLUMN {$quotedColumn} SET DEFAULT 0");
            DB::statement("ALTER TABLE {$quotedTable} ALTER COLUMN {$quotedColumn} SET NOT NULL");
            return;
        }

        if (in_array($driver, ['mysql', 'mariadb'], true)) {
            $quotedTable = '`' . str_replace('`', '``', $table) . '`';
            $quotedColumn = '`' . str_replace('`', '``', $column) . '`';
            DB::statement("ALTER TABLE {$quotedTable} MODIFY {$quotedColumn} {$mysqlType} NOT NULL DEFAULT 0");
            return;
        }

        if ($driver === 'sqlsrv') {
            $quotedTable = '[' . str_replace(']', ']]', $table) . ']';
            $quotedColumn = '[' . str_replace(']', ']]', $column) . ']';
            DB::statement("ALTER TABLE {$quotedTable} ALTER COLUMN {$quotedColumn} {$mysqlType} NOT NULL");
        }
    }
};
