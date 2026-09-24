<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('CREATE EXTENSION IF NOT EXISTS unaccent');
        DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        DB::statement("CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$ SELECT public.unaccent('public.unaccent', \$1) $$ LANGUAGE sql IMMUTABLE");

        DB::statement("CREATE INDEX IF NOT EXISTS idx_orders_order_number_trgm ON orders USING GIN (LOWER(immutable_unaccent(COALESCE(order_number, ''))) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_orders_shipping_tracking_trgm ON orders USING GIN (LOWER(immutable_unaccent(COALESCE(shipping_tracking_code, ''))) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_orders_return_tracking_trgm ON orders USING GIN (LOWER(immutable_unaccent(COALESCE(return_tracking_code, ''))) gin_trgm_ops)");

        DB::statement("CREATE INDEX IF NOT EXISTS idx_order_items_sku_snapshot_trgm ON order_items USING GIN (LOWER(immutable_unaccent(COALESCE(product_sku_snapshot, ''))) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_order_items_name_snapshot_trgm ON order_items USING GIN (LOWER(immutable_unaccent(COALESCE(product_name_snapshot, ''))) gin_trgm_ops)");

        DB::statement("CREATE INDEX IF NOT EXISTS idx_products_lower_sku_trgm ON products USING GIN (LOWER(immutable_unaccent(COALESCE(sku, ''))) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_products_lower_name_trgm ON products USING GIN (LOWER(immutable_unaccent(COALESCE(name, ''))) gin_trgm_ops)");

        DB::statement("CREATE INDEX IF NOT EXISTS idx_ship_shipment_number_trgm ON shipments USING GIN (LOWER(immutable_unaccent(COALESCE(shipment_number, ''))) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_ship_tracking_number_trgm ON shipments USING GIN (LOWER(immutable_unaccent(COALESCE(tracking_number, ''))) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_ship_carrier_tracking_trgm ON shipments USING GIN (LOWER(immutable_unaccent(COALESCE(carrier_tracking_code, ''))) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_ship_external_order_number_trgm ON shipments USING GIN (LOWER(immutable_unaccent(COALESCE(external_order_number, ''))) gin_trgm_ops)");
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('DROP INDEX IF EXISTS idx_ship_external_order_number_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_ship_carrier_tracking_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_ship_tracking_number_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_ship_shipment_number_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_products_lower_name_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_products_lower_sku_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_order_items_name_snapshot_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_order_items_sku_snapshot_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_orders_return_tracking_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_orders_shipping_tracking_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_orders_order_number_trgm');
    }
};
