<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('product_links') || !Schema::hasColumn('product_links', 'is_default')) {
            return;
        }

        DB::table('product_links')
            ->where('link_type', 'super_link')
            ->where('is_default', true)
            ->orderBy('product_id')
            ->orderBy('position')
            ->orderBy('id')
            ->get(['id', 'product_id'])
            ->groupBy('product_id')
            ->each(function ($rows) {
                $keepId = optional($rows->first())->id;
                $duplicateIds = $rows
                    ->pluck('id')
                    ->filter(fn ($id) => (int) $id !== (int) $keepId)
                    ->values();

                if ($duplicateIds->isNotEmpty()) {
                    DB::table('product_links')
                        ->whereIn('id', $duplicateIds->all())
                        ->update(['is_default' => false]);
                }
            });

        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS product_links_single_default_super_variant ON product_links (product_id) WHERE link_type = 'super_link' AND is_default = true");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS product_links_single_default_super_variant');
    }
};
