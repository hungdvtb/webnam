<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_ai_training_datasets', function (Blueprint $table) {
            $table->longText('definition_text')->nullable()->after('training_note');
        });
    }

    public function down(): void
    {
        Schema::table('order_ai_training_datasets', function (Blueprint $table) {
            $table->dropColumn('definition_text');
        });
    }
};
