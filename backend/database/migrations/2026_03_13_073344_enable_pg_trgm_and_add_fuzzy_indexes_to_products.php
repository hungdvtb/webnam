<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;


return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // 1. Enable pg_trgm extension if not exists
        DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');

        // 2. Create IMMUTABLE unaccent wrapper (necessary for indexing in Postgres)
        DB::statement("CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$ SELECT public.unaccent('public.unaccent', $1) $$ LANGUAGE sql IMMUTABLE");

        // 3. Add GIN indexes for fuzzy search (name and SKU)
        DB::statement('CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING GIN (immutable_unaccent(name) gin_trgm_ops)');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_products_sku_trgm ON products USING GIN (immutable_unaccent(sku) gin_trgm_ops)');
    }


    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS idx_products_name_trgm');
        DB::statement('DROP INDEX IF EXISTS idx_products_sku_trgm');
        // We usually don't drop the extension in down() as it might be used elsewhere
    }

};
