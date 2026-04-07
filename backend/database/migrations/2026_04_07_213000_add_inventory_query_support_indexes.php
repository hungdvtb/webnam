<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('shipment_items')) {
            DB::statement('CREATE INDEX IF NOT EXISTS shipment_items_shipment_id_idx ON shipment_items (shipment_id)');
            DB::statement('CREATE INDEX IF NOT EXISTS shipment_items_order_item_id_idx ON shipment_items (order_item_id)');
        }

        if (Schema::hasTable('product_links')) {
            DB::statement("CREATE INDEX IF NOT EXISTS product_links_link_type_product_id_idx ON product_links (link_type, product_id)");
        }
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS shipment_items_shipment_id_idx');
        DB::statement('DROP INDEX IF EXISTS shipment_items_order_item_id_idx');
        DB::statement('DROP INDEX IF EXISTS product_links_link_type_product_id_idx');
    }
};
