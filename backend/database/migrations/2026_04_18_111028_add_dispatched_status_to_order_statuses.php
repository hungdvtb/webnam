<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     * Inserts "Đã tạo đơn" (dispatched) after "Đã in" (printed, sort_order=9).
     */
    public function up(): void
    {
        // Shift all statuses with sort_order >= 10 down by 1 to make room
        DB::table('order_statuses')
            ->where('sort_order', '>=', 10)
            ->increment('sort_order');

        // Get account_id from existing system statuses
        $accountId = DB::table('order_statuses')->where('is_system', true)->value('account_id');

        // Insert the new status
        DB::table('order_statuses')->insert([
            'code'       => 'dispatched',
            'name'       => 'Đã tạo đơn',
            'color'      => '#7c3aed',
            'sort_order' => 10,
            'is_system'  => true,
            'account_id' => $accountId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::table('order_statuses')->where('code', 'dispatched')->delete();

        // Shift back down
        DB::table('order_statuses')
            ->where('sort_order', '>', 10)
            ->decrement('sort_order');
    }
};
