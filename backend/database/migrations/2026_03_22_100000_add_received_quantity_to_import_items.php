<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('import_items', function (Blueprint $table) {
            if (!Schema::hasColumn('import_items', 'received_quantity')) {
                $table->unsignedInteger('received_quantity')->default(0)->after('quantity');
            }
        });

        DB::table('import_items')
            ->whereNull('received_quantity')
            ->orWhere('received_quantity', 0)
            ->update([
                'received_quantity' => DB::raw('quantity'),
            ]);
    }

    public function down(): void
    {
        Schema::table('import_items', function (Blueprint $table) {
            if (Schema::hasColumn('import_items', 'received_quantity')) {
                $table->dropColumn('received_quantity');
            }
        });
    }
};
