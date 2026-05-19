<?php

use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    public function up(): void
    {
        // Kept intentionally empty. Do not hard-delete or clone product images
        // between SKUs; storefront filtering now only prevents stale variant
        // images from overriding the child product's own primary image.
    }

    public function down(): void
    {
        // No-op.
    }
};
