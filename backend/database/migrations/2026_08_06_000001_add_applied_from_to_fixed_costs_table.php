<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fixed_costs', function (Blueprint $table) {
            if (!Schema::hasColumn('fixed_costs', 'applied_from')) {
                $table->date('applied_from')->nullable()->after('notes')->index();
            }
        });

        $firstSnapshotDate = DB::table('fixed_cost_daily_snapshots')
            ->orderBy('date')
            ->value('date');

        if ($firstSnapshotDate && Schema::hasColumn('fixed_costs', 'applied_from')) {
            DB::table('fixed_costs')
                ->whereNull('applied_from')
                ->update(['applied_from' => $firstSnapshotDate]);
        }
    }

    public function down(): void
    {
        Schema::table('fixed_costs', function (Blueprint $table) {
            if (Schema::hasColumn('fixed_costs', 'applied_from')) {
                $table->dropColumn('applied_from');
            }
        });
    }
};
