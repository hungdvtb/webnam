<?php

use App\Services\CategoryDemoLogoService;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    public function up(): void
    {
        app(CategoryDemoLogoService::class)->backfillMissingLogoPaths();
    }

    public function down(): void
    {
        // Keep generated demo logo paths in place on rollback to avoid removing live category logos.
    }
};
