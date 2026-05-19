<?php

use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    public function up(): void
    {
        // Kept intentionally empty. Bundle/cart image precedence is handled at
        // runtime so product gallery rows set in admin are not deleted.
    }

    public function down(): void
    {
        // No-op.
    }
};
