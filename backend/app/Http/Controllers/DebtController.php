<?php

namespace App\Http\Controllers;

use App\Models\DebtSubject;
use App\Models\DebtTransaction;
use App\Models\FinCategory;
use App\Models\FinTransaction;
use App\Services\AccountDataScopeService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class DebtController extends Controller
{
    public function getSubjects(Request $request)
    {
        $accountId = $this->accountId($request);
        $subjects = DebtSubject::with([
            'transactions' => fn ($query) => $query->where('account_id', $accountId),
        ])
            ->where('account_id', $accountId)
            ->get();

        $data = $subjects->map(function ($subject) {
            $borrowSum = $subject->transactions->where('type', 'borrow')->sum('amount');
            $payPrincipalSum = $subject->transactions->where('type', 'pay_principal')->sum('amount');
            $remainingDebt = $subject->initial_debt + $borrowSum - $payPrincipalSum;
            $monthlyInterest = $remainingDebt * ($subject->interest_rate_percent / 100);
            $totalInterestPaid = $subject->transactions->where('type', 'pay_interest')->sum('amount');

            return [
                'id' => $subject->id,
                'name' => $subject->name,
                'interest_rate_percent' => (float) $subject->interest_rate_percent,
                'initial_debt' => (float) $subject->initial_debt,
                'remaining_debt' => $remainingDebt,
                'monthly_interest' => $monthlyInterest,
                'total_interest_paid' => $totalInterestPaid,
            ];
        });

        return response()->json([
            'status' => 'success',
            'data' => $data,
            'summary' => [
                'total_debt' => $data->sum('remaining_debt'),
                'total_monthly_interest' => $data->sum('monthly_interest'),
            ],
        ]);
    }

    public function saveSubject(Request $request)
    {
        $accountId = $this->accountId($request);
        $request->validate([
            'id' => 'nullable|integer',
            'name' => 'required|string',
            'interest_rate_percent' => 'numeric',
            'initial_debt' => 'numeric',
        ]);

        if ($request->id) {
            $subject = DebtSubject::query()
                ->where('account_id', $accountId)
                ->findOrFail($request->id);
            $subject->update($request->only(['name', 'interest_rate_percent', 'initial_debt']));
        } else {
            $subject = DebtSubject::create([
                ...$request->only(['name', 'interest_rate_percent', 'initial_debt']),
                'account_id' => $accountId,
            ]);
        }

        return response()->json(['status' => 'success', 'data' => $subject]);
    }

    public function deleteSubject(Request $request, int $id)
    {
        $accountId = $this->accountId($request);

        DebtSubject::query()
            ->where('account_id', $accountId)
            ->findOrFail($id)
            ->delete();

        return response()->json(['status' => 'success']);
    }

    public function getTransactions(Request $request, int $subjectId)
    {
        $accountId = $this->accountId($request);
        $subject = DebtSubject::query()
            ->where('account_id', $accountId)
            ->findOrFail($subjectId);

        $transactions = DebtTransaction::query()
            ->where('account_id', $accountId)
            ->where('debt_subject_id', $subject->id)
            ->orderBy('transaction_date', 'asc')
            ->orderBy('id', 'asc')
            ->get();

        $runningBalance = $subject->initial_debt;
        $data = $transactions->map(function ($transaction) use (&$runningBalance) {
            if ($transaction->type === 'borrow') {
                $runningBalance += $transaction->amount;
            } elseif ($transaction->type === 'pay_principal') {
                $runningBalance -= $transaction->amount;
            }

            return [
                'id' => $transaction->id,
                'debt_subject_id' => $transaction->debt_subject_id,
                'transaction_date' => $transaction->transaction_date,
                'type' => $transaction->type,
                'amount' => (float) $transaction->amount,
                'note' => $transaction->note,
                'fin_account_id' => $transaction->fin_account_id,
                'fin_transaction_id' => $transaction->fin_transaction_id,
                'running_balance' => $runningBalance,
            ];
        });

        return response()->json(['status' => 'success', 'data' => $data->reverse()->values()]);
    }

    public function saveTransaction(Request $request)
    {
        $accountId = $this->accountId($request);
        $request->validate([
            'id' => 'nullable|integer',
            'debt_subject_id' => [
                'required',
                'integer',
                Rule::exists('debt_subjects', 'id')->where(fn ($query) => $query->where('account_id', $accountId)),
            ],
            'transaction_date' => 'required|date',
            'type' => 'required|in:borrow,pay_principal,pay_interest',
            'amount' => 'required|numeric',
            'note' => 'nullable|string',
            'fin_account_id' => [
                'required',
                'integer',
                Rule::exists('fin_accounts', 'id')->where(fn ($query) => $query->where('account_id', $accountId)),
            ],
        ]);

        try {
            DB::beginTransaction();

            $data = [
                ...$request->only(['debt_subject_id', 'transaction_date', 'type', 'amount', 'note', 'fin_account_id']),
                'account_id' => $accountId,
            ];

            $typeStr = $request->type === 'borrow' ? 'income' : 'expense';
            $catName = 'Giao dịch Nợ';
            $catColor = '#607d8b';
            if ($request->type === 'pay_interest') {
                $catName = 'Trả Lãi Nợ';
                $catColor = '#ff9800';
            }
            if ($request->type === 'borrow') {
                $catName = 'Vay Nợ';
                $catColor = '#ff5722';
            }

            $category = FinCategory::firstOrCreate(
                ['account_id' => $accountId, 'name' => $catName, 'type' => $typeStr],
                [
                    'color' => $catColor,
                    'sort_order' => FinCategory::nextSortOrder($accountId),
                ]
            );

            $subject = DebtSubject::query()
                ->where('account_id', $accountId)
                ->findOrFail($request->debt_subject_id);

            $actionLabel = 'Giao dịch nợ';
            if ($request->type === 'borrow') {
                $actionLabel = 'Vay thêm';
            }
            if ($request->type === 'pay_principal') {
                $actionLabel = 'Trả nợ gốc';
            }
            if ($request->type === 'pay_interest') {
                $actionLabel = 'Trả lãi nợ';
            }

            $description = "{$actionLabel}: {$subject->name}" . ($request->note ? " ({$request->note})" : '') . ' [Sổ nợ]';
            $finTransactionData = [
                'account_id' => $accountId,
                'fin_account_id' => $request->fin_account_id,
                'fin_category_id' => $category->id,
                'transaction_date' => $request->transaction_date,
                'type' => $typeStr,
                'amount' => $request->amount,
                'description' => $description,
                'notes' => $request->note,
                'balance_after' => 0,
            ];

            $oldFundAccountId = null;
            if ($request->id) {
                $debtTransaction = DebtTransaction::query()
                    ->where('account_id', $accountId)
                    ->findOrFail($request->id);
                $oldFundAccountId = $debtTransaction->fin_account_id;

                if ($debtTransaction->fin_transaction_id) {
                    $finTransaction = FinTransaction::query()
                        ->where('account_id', $accountId)
                        ->find($debtTransaction->fin_transaction_id);

                    if ($finTransaction) {
                        $oldFundAccountId = $finTransaction->fin_account_id;
                        $finTransaction->update($finTransactionData);
                    } else {
                        $finTransaction = FinTransaction::create($finTransactionData);
                        $data['fin_transaction_id'] = $finTransaction->id;
                    }
                } else {
                    $finTransaction = FinTransaction::create($finTransactionData);
                    $data['fin_transaction_id'] = $finTransaction->id;
                }

                $debtTransaction->update($data);
            } else {
                $finTransaction = FinTransaction::create($finTransactionData);
                $data['fin_transaction_id'] = $finTransaction->id;
                $debtTransaction = DebtTransaction::create($data);
            }

            foreach (array_unique([$request->fin_account_id, $oldFundAccountId]) as $fundAccountId) {
                if ($fundAccountId) {
                    app(FundController::class)->recomputeAccountBalance((int) $fundAccountId, $accountId);
                }
            }

            DB::commit();

            return response()->json(['status' => 'success', 'data' => $debtTransaction]);
        } catch (\Exception $exception) {
            DB::rollBack();

            return response()->json(['status' => 'error', 'message' => $exception->getMessage()], 500);
        }
    }

    public function deleteTransaction(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $transaction = DebtTransaction::query()
            ->where('account_id', $accountId)
            ->findOrFail($id);

        if ($transaction->fin_transaction_id) {
            $finTransaction = FinTransaction::query()
                ->where('account_id', $accountId)
                ->find($transaction->fin_transaction_id);

            if ($finTransaction) {
                $fundAccountId = $finTransaction->fin_account_id;
                $finTransaction->delete();
                app(FundController::class)->recomputeAccountBalance((int) $fundAccountId, $accountId);
            }
        }

        $transaction->delete();

        return response()->json(['status' => 'success']);
    }

    private function accountId(Request $request): int
    {
        $scope = app(AccountDataScopeService::class);
        $accountId = $scope->resolveScopedAccountId(
            $scope->rawActiveAccountId($request),
            AccountDataScopeService::SCOPE_ACTIVE
        );

        if (!$accountId) {
            $accountId = $scope->accountIdForCurrentRequest(AccountDataScopeService::SCOPE_ACTIVE);
        }

        if (!$accountId) {
            abort(422, 'Can chon cua hang truoc khi thao tac so no.');
        }

        return (int) $accountId;
    }
}
