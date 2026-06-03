<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if ($this->hasColumns(['product_id', 'status', 'source_type', 'created_at'])) {
            DB::statement('
                CREATE INDEX IF NOT EXISTS product_reviews_product_status_source_created_idx
                ON product_reviews (product_id, status, source_type, created_at DESC)
            ');
        }

        if ($this->hasColumns(['account_id', 'product_id', 'status', 'created_at'])) {
            DB::statement('
                CREATE INDEX IF NOT EXISTS product_reviews_account_product_status_created_idx
                ON product_reviews (account_id, product_id, status, created_at DESC)
            ');
        }

        if ($this->hasColumns(['product_id', 'parent_id', 'status', 'created_at'])) {
            DB::statement('
                CREATE INDEX IF NOT EXISTS product_reviews_product_parent_status_created_idx
                ON product_reviews (product_id, parent_id, status, created_at DESC)
            ');
        }
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS product_reviews_product_parent_status_created_idx');
        DB::statement('DROP INDEX IF EXISTS product_reviews_account_product_status_created_idx');
        DB::statement('DROP INDEX IF EXISTS product_reviews_product_status_source_created_idx');
    }

    private function hasColumns(array $columns): bool
    {
        if (!Schema::hasTable('product_reviews')) {
            return false;
        }

        foreach ($columns as $column) {
            if (!Schema::hasColumn('product_reviews', $column)) {
                return false;
            }
        }

        return true;
    }
};
