<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('carrier_status_mappings')) {
            return;
        }

        DB::table('carrier_status_mappings')
            ->where('internal_shipment_status', 'returned')
            ->where('mapped_order_status', 'pending_return')
            ->update([
                'internal_shipment_status' => 'returning',
                'updated_at' => now(),
            ]);
    }

    public function down(): void
    {
        if (!Schema::hasTable('carrier_status_mappings')) {
            return;
        }

        DB::table('carrier_status_mappings')
            ->where('internal_shipment_status', 'returning')
            ->where('mapped_order_status', 'pending_return')
            ->update([
                'internal_shipment_status' => 'returned',
                'updated_at' => now(),
            ]);
    }
};
