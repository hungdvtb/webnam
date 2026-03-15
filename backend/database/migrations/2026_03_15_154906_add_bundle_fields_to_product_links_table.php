<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('product_links', function (Blueprint $table) {
            if (!Schema::hasColumn('product_links', 'option_title')) {
                $table->string('option_title')->nullable()->after('is_required');
            }
            if (!Schema::hasColumn('product_links', 'is_default')) {
                $table->boolean('is_default')->default(false)->after('option_title');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('product_links', function (Blueprint $table) {
            $table->dropColumn(['option_title', 'is_default']);
        });
    }
};
