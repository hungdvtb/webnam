<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('accounts') && Schema::hasTable('site_settings')) {
            $now = now();

            DB::table('accounts')
                ->orderBy('id')
                ->pluck('id')
                ->each(function ($accountId) use ($now) {
                    DB::table('site_settings')->updateOrInsert(
                        [
                            'account_id' => (int) $accountId,
                            'key' => 'order_product_quick_mode_default_enabled',
                        ],
                        [
                            'value' => '1',
                            'created_at' => $now,
                            'updated_at' => $now,
                        ]
                    );
                });
        }

        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('CREATE EXTENSION IF NOT EXISTS unaccent');
        DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        DB::statement("CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$ SELECT public.unaccent('public.unaccent', $1) $$ LANGUAGE sql IMMUTABLE");

        DB::statement("CREATE INDEX IF NOT EXISTS idx_products_compact_sku_trgm ON products USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(sku, '')), '[^a-zA-Z0-9]', '', 'g')) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_products_compact_name_trgm ON products USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(name, '')), '[^a-zA-Z0-9]', '', 'g')) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_products_words_name_trgm ON products USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(name, '')), '[^a-zA-Z0-9]+', ' ', 'g')) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_product_attribute_values_value_trgm ON product_attribute_values USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(value, '')), '[^a-zA-Z0-9]+', ' ', 'g')) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_product_attribute_values_compact_value_trgm ON product_attribute_values USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(value, '')), '[^a-zA-Z0-9]', '', 'g')) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_product_links_option_title_trgm ON product_links USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(option_title, '')), '[^a-zA-Z0-9]+', ' ', 'g')) gin_trgm_ops)");
        DB::statement("CREATE INDEX IF NOT EXISTS idx_product_links_compact_option_title_trgm ON product_links USING GIN (LOWER(REGEXP_REPLACE(immutable_unaccent(COALESCE(option_title, '')), '[^a-zA-Z0-9]', '', 'g')) gin_trgm_ops)");
    }

    public function down(): void
    {
        if (Schema::hasTable('site_settings')) {
            DB::table('site_settings')
                ->where('key', 'order_product_quick_mode_default_enabled')
                ->delete();
        }

        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('DROP INDEX IF EXISTS idx_product_links_compact_option_title_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_product_links_option_title_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_product_attribute_values_compact_value_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_product_attribute_values_value_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_products_words_name_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_products_compact_name_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_products_compact_sku_trgm');
    }
};
