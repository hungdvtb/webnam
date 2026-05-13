<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('shipment_items') || !Schema::hasColumn('shipment_items', 'qty')) {
            return;
        }

        $this->alterQtyColumn('DECIMAL(15,3)', 'NUMERIC(15,3)');
    }

    public function down(): void
    {
        if (!Schema::hasTable('shipment_items') || !Schema::hasColumn('shipment_items', 'qty')) {
            return;
        }

        $this->alterQtyColumn('INTEGER', 'INTEGER');
    }

    private function alterQtyColumn(string $mysqlType, string $pgsqlType): void
    {
        $driver = DB::connection()->getDriverName();

        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE "shipment_items" ALTER COLUMN "qty" TYPE ' . $pgsqlType . ' USING "qty"::' . $pgsqlType);
            DB::statement('ALTER TABLE "shipment_items" ALTER COLUMN "qty" SET DEFAULT 0');
            DB::statement('ALTER TABLE "shipment_items" ALTER COLUMN "qty" SET NOT NULL');
            return;
        }

        if (in_array($driver, ['mysql', 'mariadb'], true)) {
            DB::statement('ALTER TABLE `shipment_items` MODIFY `qty` ' . $mysqlType . ' NOT NULL DEFAULT 0');
            return;
        }

        if ($driver === 'sqlsrv') {
            DB::statement('ALTER TABLE [shipment_items] ALTER COLUMN [qty] ' . $mysqlType . ' NOT NULL');
        }
    }
};
