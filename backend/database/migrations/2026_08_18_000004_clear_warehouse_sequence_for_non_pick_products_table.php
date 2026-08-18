<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('products', 'warehouse_sequence')) {
            return;
        }

        DB::table('products')
            ->whereIn('type', ['configurable', 'bundle'])
            ->whereNotNull('warehouse_sequence')
            ->update(['warehouse_sequence' => null]);
    }

    public function down(): void
    {
        // Intentionally left blank: old parent/bundle STT values cannot be restored safely.
    }
};
