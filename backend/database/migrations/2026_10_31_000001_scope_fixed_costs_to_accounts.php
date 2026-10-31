<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('fixed_costs')
            || !Schema::hasTable('fixed_cost_daily_snapshots')
            || !Schema::hasTable('fixed_cost_categories')) {
            return;
        }

        Schema::table('fixed_costs', function (Blueprint $table) {
            if (!Schema::hasColumn('fixed_costs', 'account_id')) {
                $table->foreignId('account_id')->nullable()->after('id')->constrained('accounts')->cascadeOnDelete();
            }
        });

        Schema::table('fixed_cost_daily_snapshots', function (Blueprint $table) {
            if (!Schema::hasColumn('fixed_cost_daily_snapshots', 'account_id')) {
                $table->foreignId('account_id')->nullable()->after('id')->constrained('accounts')->cascadeOnDelete();
            }
            $table->dropUnique('fixed_cost_daily_snapshots_date_unique');
            $table->unique(['account_id', 'date'], 'fixed_cost_snapshots_account_date_unique');
        });

        Schema::table('fixed_cost_categories', function (Blueprint $table) {
            if (!Schema::hasColumn('fixed_cost_categories', 'account_id')) {
                $table->foreignId('account_id')->nullable()->after('id')->constrained('accounts')->cascadeOnDelete();
            }
            $table->dropUnique('fixed_cost_categories_name_unique');
            $table->unique(['account_id', 'name'], 'fixed_cost_categories_account_name_unique');
        });

        $accountIds = DB::table('accounts')->orderBy('id')->pluck('id');
        if ($accountIds->isEmpty()) {
            return;
        }

        $legacyCosts = DB::table('fixed_costs')
            ->whereNull('account_id')
            ->get(['category', 'name', 'amount', 'notes', 'applied_from', 'created_at', 'updated_at']);
        $legacySnapshots = DB::table('fixed_cost_daily_snapshots')
            ->whereNull('account_id')
            ->get(['date', 'amount', 'created_at', 'updated_at']);
        $legacyCategories = DB::table('fixed_cost_categories')
            ->whereNull('account_id')
            ->get(['name', 'sort_order', 'created_at', 'updated_at']);

        foreach ($accountIds as $accountId) {
            if ($legacyCosts->isNotEmpty()) {
                DB::table('fixed_costs')->insert(
                    $legacyCosts->map(fn ($row) => [
                        'account_id' => (int) $accountId,
                        'category' => $row->category,
                        'name' => $row->name,
                        'amount' => $row->amount,
                        'notes' => $row->notes,
                        'applied_from' => $row->applied_from,
                        'created_at' => $row->created_at,
                        'updated_at' => $row->updated_at,
                    ])->all()
                );
            }

            if ($legacySnapshots->isNotEmpty()) {
                DB::table('fixed_cost_daily_snapshots')->insert(
                    $legacySnapshots->map(fn ($row) => [
                        'account_id' => (int) $accountId,
                        'date' => $row->date,
                        'amount' => $row->amount,
                        'created_at' => $row->created_at,
                        'updated_at' => $row->updated_at,
                    ])->all()
                );
            }

            if ($legacyCategories->isNotEmpty()) {
                DB::table('fixed_cost_categories')->insert(
                    $legacyCategories->map(fn ($row) => [
                        'account_id' => (int) $accountId,
                        'name' => $row->name,
                        'sort_order' => $row->sort_order,
                        'created_at' => $row->created_at,
                        'updated_at' => $row->updated_at,
                    ])->all()
                );
            }
        }
    }

    public function down(): void
    {
        if (!Schema::hasColumn('fixed_costs', 'account_id')
            || !Schema::hasColumn('fixed_cost_daily_snapshots', 'account_id')
            || !Schema::hasColumn('fixed_cost_categories', 'account_id')) {
            return;
        }

        DB::table('fixed_costs')->whereNotNull('account_id')->delete();
        DB::table('fixed_cost_daily_snapshots')->whereNotNull('account_id')->delete();
        DB::table('fixed_cost_categories')->whereNotNull('account_id')->delete();

        Schema::table('fixed_cost_categories', function (Blueprint $table) {
            $table->dropUnique('fixed_cost_categories_account_name_unique');
            $table->unique('name', 'fixed_cost_categories_name_unique');
        });

        Schema::table('fixed_cost_daily_snapshots', function (Blueprint $table) {
            $table->dropUnique('fixed_cost_snapshots_account_date_unique');
            $table->unique('date', 'fixed_cost_daily_snapshots_date_unique');
        });

        Schema::table('fixed_costs', function (Blueprint $table) {
            $table->dropConstrainedForeignId('account_id');
        });

        Schema::table('fixed_cost_daily_snapshots', function (Blueprint $table) {
            $table->dropConstrainedForeignId('account_id');
        });

        Schema::table('fixed_cost_categories', function (Blueprint $table) {
            $table->dropConstrainedForeignId('account_id');
        });
    }
};
