<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('finance_fixed_expenses', 'sort_order')) {
            Schema::table('finance_fixed_expenses', function (Blueprint $table) {
                $table->unsignedInteger('sort_order')->default(0)->after('amount');
            });
        }

        Schema::create('finance_fixed_expense_versions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->date('effective_date');
            $table->string('day_calculation_mode', 30)->default('actual_month');
            $table->decimal('total_monthly_amount', 18, 2)->default(0);
            $table->json('items_snapshot');
            $table->text('note')->nullable();
            $table->timestamps();

            $table->index(['account_id', 'effective_date'], 'finance_fixed_expense_versions_account_effective_index');
        });

        $rows = DB::table('finance_fixed_expenses')
            ->whereNull('deleted_at')
            ->orderBy('account_id')
            ->orderBy('id')
            ->get();

        foreach ($rows->groupBy('account_id') as $accountId => $accountRows) {
            $snapshot = [];
            $totalMonthlyAmount = 0;
            $effectiveDate = null;

            foreach ($accountRows->values() as $index => $row) {
                $sortOrder = $index + 1;
                DB::table('finance_fixed_expenses')
                    ->where('id', $row->id)
                    ->update(['sort_order' => $sortOrder]);

                $effectiveDate ??= $row->start_date ?: now()->toDateString();
                $totalMonthlyAmount += (float) $row->amount;

                $snapshot[] = [
                    'line_key' => (string) $row->id,
                    'fixed_expense_id' => (int) $row->id,
                    'content' => $row->name,
                    'monthly_amount' => round((float) $row->amount, 2),
                    'sort_order' => $sortOrder,
                ];
            }

            if ($snapshot === []) {
                continue;
            }

            DB::table('finance_fixed_expense_versions')->insert([
                'account_id' => (int) $accountId,
                'created_by' => $accountRows->first()->updated_by ?? $accountRows->first()->created_by,
                'effective_date' => $effectiveDate,
                'day_calculation_mode' => 'actual_month',
                'total_monthly_amount' => round($totalMonthlyAmount, 2),
                'items_snapshot' => json_encode($snapshot, JSON_UNESCAPED_UNICODE),
                'note' => 'Initial backfill snapshot',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('finance_fixed_expense_versions');

        if (Schema::hasColumn('finance_fixed_expenses', 'sort_order')) {
            Schema::table('finance_fixed_expenses', function (Blueprint $table) {
                $table->dropColumn('sort_order');
            });
        }
    }
};
