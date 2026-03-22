<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('imports', function (Blueprint $table) {
            if (!Schema::hasColumn('imports', 'extra_charge_mode')) {
                $table->string('extra_charge_mode', 20)->default('percent')->after('extra_charge_percent');
            }
            if (!Schema::hasColumn('imports', 'extra_charge_value')) {
                $table->decimal('extra_charge_value', 15, 2)->default(0)->after('extra_charge_mode');
            }
            if (!Schema::hasColumn('imports', 'extra_charge_amount')) {
                $table->decimal('extra_charge_amount', 15, 2)->default(0)->after('extra_charge_value');
            }
        });

        DB::table('imports')->update([
            'extra_charge_mode' => DB::raw("COALESCE(extra_charge_mode, 'percent')"),
            'extra_charge_value' => DB::raw('COALESCE(extra_charge_value, extra_charge_percent, 0)'),
            'extra_charge_amount' => DB::raw('ROUND(COALESCE(subtotal_amount, 0) * COALESCE(extra_charge_percent, 0) / 100, 2)'),
        ]);
    }

    public function down(): void
    {
        Schema::table('imports', function (Blueprint $table) {
            foreach (['extra_charge_amount', 'extra_charge_value', 'extra_charge_mode'] as $column) {
                if (Schema::hasColumn('imports', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
