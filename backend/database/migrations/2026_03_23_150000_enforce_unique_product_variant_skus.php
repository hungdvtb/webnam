<?php

use App\Services\ProductSkuService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        app(ProductSkuService::class)->repairLegacyIntegrity();

        $driver = DB::getDriverName();

        if (in_array($driver, ['pgsql', 'sqlite'], true)) {
            DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique ON products (sku) WHERE sku IS NOT NULL");
            DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS product_links_unique_super_link_variant ON product_links (linked_product_id) WHERE link_type = 'super_link'");
        }
    }

    public function down(): void
    {
        $driver = DB::getDriverName();

        if (in_array($driver, ['pgsql', 'sqlite'], true)) {
            DB::statement('DROP INDEX IF EXISTS product_links_unique_super_link_variant');
            DB::statement('DROP INDEX IF EXISTS products_sku_unique');
        }
    }
};
