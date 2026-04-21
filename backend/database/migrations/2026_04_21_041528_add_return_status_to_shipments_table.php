<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shipments', function (Blueprint $table) {
            // Trạng thái hoàn/đổi của vận đơn
            // Giá trị: null | 'not_returned' | 'exchanged' | 'partial_returned' | 'returned'
            $table->string('return_status', 30)->nullable()->after('reconciliation_status');

            // Index để filter nhanh
            $table->index('return_status');
        });
    }

    public function down(): void
    {
        Schema::table('shipments', function (Blueprint $table) {
            $table->dropIndex(['return_status']);
            $table->dropColumn('return_status');
        });
    }
};
