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

        DB::statement("CREATE INDEX IF NOT EXISTS idx_orders_cust_name_words_trgm ON orders USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(customer_name, '')), '[^a-zA-Z0-9]+', ' ', 'g')) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_orders_cust_name_compact_trgm ON orders USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(customer_name, '')), '[^a-zA-Z0-9]', '', 'g')) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_orders_cust_phone_trgm ON orders USING GIN (customer_phone gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_orders_cust_phone_compact_trgm ON orders USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(customer_phone, '')), '[^a-zA-Z0-9]', '', 'g')) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_orders_acc_phone_pattern ON orders (account_id, customer_phone varchar_pattern_ops)");

        DB::statement("CREATE INDEX IF NOT EXISTS idx_ship_cust_name_words_trgm ON shipments USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(customer_name, '')), '[^a-zA-Z0-9]+', ' ', 'g')) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_ship_cust_name_compact_trgm ON shipments USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(customer_name, '')), '[^a-zA-Z0-9]', '', 'g')) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_ship_cust_phone_trgm ON shipments USING GIN (customer_phone gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_ship_cust_phone_compact_trgm ON shipments USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(customer_phone, '')), '[^a-zA-Z0-9]', '', 'g')) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_ship_cust_phone_pattern ON shipments (customer_phone varchar_pattern_ops, order_id)");

        DB::statement("CREATE INDEX IF NOT EXISTS idx_order_attr_value_words_trgm ON order_attribute_values USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(value, '')), '[^a-zA-Z0-9]+', ' ', 'g')) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_order_attr_value_compact_trgm ON order_attribute_values USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(value, '')), '[^a-zA-Z0-9]', '', 'g')) gin_trgm_ops)");
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('DROP INDEX IF EXISTS idx_order_attr_value_compact_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_order_attr_value_words_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_ship_cust_phone_pattern');
        DB::statement('DROP INDEX IF EXISTS idx_ship_cust_phone_compact_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_ship_cust_phone_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_ship_cust_name_compact_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_ship_cust_name_words_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_orders_acc_phone_pattern');
        DB::statement('DROP INDEX IF EXISTS idx_orders_cust_phone_compact_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_orders_cust_phone_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_orders_cust_name_compact_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_orders_cust_name_words_trgm');
    }
};
