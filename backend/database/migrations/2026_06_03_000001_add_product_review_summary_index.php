<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!$this->hasReviewSummaryColumns()) {
            return;
        }

        DB::statement("
            CREATE INDEX IF NOT EXISTS product_reviews_visible_summary_idx
            ON product_reviews (account_id, product_id, rating)
            WHERE is_approved = true
              AND parent_id IS NULL
              AND (status = 'visible' OR status IS NULL)
              AND rating >= 1
              AND rating <= 5
        ");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS product_reviews_visible_summary_idx');
    }

    private function hasReviewSummaryColumns(): bool
    {
        if (!Schema::hasTable('product_reviews')) {
            return false;
        }

        foreach (['account_id', 'product_id', 'rating', 'is_approved', 'parent_id', 'status'] as $column) {
            if (!Schema::hasColumn('product_reviews', $column)) {
                return false;
            }
        }

        return true;
    }
};
