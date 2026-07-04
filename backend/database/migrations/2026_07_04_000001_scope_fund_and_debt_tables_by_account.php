<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $this->addAccountColumn('fin_accounts');
        $this->addAccountColumn('fin_categories');
        $this->addAccountColumn('fin_transactions');
        $this->addAccountColumn('debt_subjects');
        $this->addAccountColumn('debt_transactions');

        $primaryAccountId = $this->primaryAccountId();
        if ($primaryAccountId === null) {
            return;
        }

        DB::table('fin_accounts')->whereNull('account_id')->update(['account_id' => $primaryAccountId]);
        DB::table('fin_categories')->whereNull('account_id')->update(['account_id' => $primaryAccountId]);
        DB::table('debt_subjects')->whereNull('account_id')->update(['account_id' => $primaryAccountId]);

        $this->backfillFinTransactions($primaryAccountId);
        $this->backfillDebtTransactions($primaryAccountId);
    }

    public function down(): void
    {
        $this->dropAccountColumn('debt_transactions');
        $this->dropAccountColumn('debt_subjects');
        $this->dropAccountColumn('fin_transactions');
        $this->dropAccountColumn('fin_categories');
        $this->dropAccountColumn('fin_accounts');
    }

    private function addAccountColumn(string $tableName): void
    {
        if (!Schema::hasTable($tableName) || Schema::hasColumn($tableName, 'account_id')) {
            return;
        }

        Schema::table($tableName, function (Blueprint $table) {
            $table->unsignedBigInteger('account_id')->nullable()->after('id')->index();
        });
    }

    private function dropAccountColumn(string $tableName): void
    {
        if (!Schema::hasTable($tableName) || !Schema::hasColumn($tableName, 'account_id')) {
            return;
        }

        Schema::table($tableName, function (Blueprint $table) {
            $table->dropIndex($table->getTable() . '_account_id_index');
            $table->dropColumn('account_id');
        });
    }

    private function primaryAccountId(): ?int
    {
        if (!Schema::hasTable('accounts')) {
            return null;
        }

        $accountId = DB::table('accounts')->orderBy('id')->value('id');

        return $accountId ? (int) $accountId : null;
    }

    private function backfillFinTransactions(int $primaryAccountId): void
    {
        if (!Schema::hasTable('fin_transactions')) {
            return;
        }

        DB::table('fin_transactions')
            ->whereNull('account_id')
            ->orderBy('id')
            ->select(['id', 'fin_account_id'])
            ->chunkById(500, function ($transactions) use ($primaryAccountId) {
                $fundAccountIds = $transactions
                    ->pluck('fin_account_id')
                    ->filter()
                    ->unique()
                    ->values();

                $accountIdsByFundAccount = DB::table('fin_accounts')
                    ->whereIn('id', $fundAccountIds)
                    ->pluck('account_id', 'id');

                foreach ($transactions as $transaction) {
                    DB::table('fin_transactions')
                        ->where('id', $transaction->id)
                        ->update([
                            'account_id' => $accountIdsByFundAccount[$transaction->fin_account_id] ?? $primaryAccountId,
                        ]);
                }
            });
    }

    private function backfillDebtTransactions(int $primaryAccountId): void
    {
        if (!Schema::hasTable('debt_transactions')) {
            return;
        }

        DB::table('debt_transactions')
            ->whereNull('account_id')
            ->orderBy('id')
            ->select(['id', 'debt_subject_id'])
            ->chunkById(500, function ($transactions) use ($primaryAccountId) {
                $subjectIds = $transactions
                    ->pluck('debt_subject_id')
                    ->filter()
                    ->unique()
                    ->values();

                $accountIdsBySubject = DB::table('debt_subjects')
                    ->whereIn('id', $subjectIds)
                    ->pluck('account_id', 'id');

                foreach ($transactions as $transaction) {
                    DB::table('debt_transactions')
                        ->where('id', $transaction->id)
                        ->update([
                            'account_id' => $accountIdsBySubject[$transaction->debt_subject_id] ?? $primaryAccountId,
                        ]);
                }
            });
    }
};
