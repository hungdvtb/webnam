<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('leads', function (Blueprint $table) {
            $table->boolean('is_draft')->default(false)->after('status')->index();
            $table->string('draft_token', 120)->nullable()->after('order_id');
            $table->timestamp('draft_captured_at')->nullable()->after('placed_at');
            $table->timestamp('converted_at')->nullable()->after('draft_captured_at');

            $table->unique(['account_id', 'draft_token']);
        });
    }

    public function down(): void
    {
        Schema::table('leads', function (Blueprint $table) {
            $table->dropUnique(['account_id', 'draft_token']);
            $table->dropColumn([
                'is_draft',
                'draft_token',
                'draft_captured_at',
                'converted_at',
            ]);
        });
    }
};
