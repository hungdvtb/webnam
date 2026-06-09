<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\DebtSubject;
use App\Models\DebtTransaction;
use App\Models\FinAccount;
use App\Models\FinCategory;
use App\Models\FinTransaction;
use Illuminate\Support\Facades\DB;

class DebtController extends Controller
{
    // Lấy danh sách các chủ nợ (kèm tổng nợ và tiền lãi hàng tháng)
    public function getSubjects()
    {
        $subjects = DebtSubject::with('transactions')->get();

        $data = $subjects->map(function($sub) {
            $borrowSum = $sub->transactions->where('type', 'borrow')->sum('amount');
            $payPrincipalSum = $sub->transactions->where('type', 'pay_principal')->sum('amount');

            $remainingDebt = $sub->initial_debt + $borrowSum - $payPrincipalSum;
            $monthlyInterest = $remainingDebt * ($sub->interest_rate_percent / 100);

            // Lấy thêm các con số tổng khác để báo cáo (nếu cần)
            $totalInterestPaid = $sub->transactions->where('type', 'pay_interest')->sum('amount');

            return [
                'id' => $sub->id,
                'name' => $sub->name,
                'interest_rate_percent' => floatval($sub->interest_rate_percent),
                'initial_debt' => floatval($sub->initial_debt),
                'remaining_debt' => $remainingDebt,
                'monthly_interest' => $monthlyInterest,
                'total_interest_paid' => $totalInterestPaid
            ];
        });

        // Tính tổng tất cả nợ, tất cả lãi cần trả
        $totalDebtAll = $data->sum('remaining_debt');
        $totalMonthlyInterestAll = $data->sum('monthly_interest');

        return response()->json([
            'status' => 'success',
            'data' => $data,
            'summary' => [
                'total_debt' => $totalDebtAll,
                'total_monthly_interest' => $totalMonthlyInterestAll
            ]
        ]);
    }

    public function saveSubject(Request $request)
    {
        $request->validate([
            'name' => 'required|string',
            'interest_rate_percent' => 'numeric',
            'initial_debt' => 'numeric'
        ]);

        if ($request->id) {
            $sub = DebtSubject::findOrFail($request->id);
            $sub->update($request->only(['name', 'interest_rate_percent', 'initial_debt']));
        } else {
            $sub = DebtSubject::create($request->only(['name', 'interest_rate_percent', 'initial_debt']));
        }

        return response()->json(['status' => 'success', 'data' => $sub]);
    }

    public function deleteSubject($id)
    {
        DebtSubject::findOrFail($id)->delete();
        return response()->json(['status' => 'success']);
    }

    public function getTransactions($subjectId)
    {
        $transactions = DebtTransaction::where('debt_subject_id', $subjectId)
            ->orderBy('transaction_date', 'asc')
            ->orderBy('id', 'asc')
            ->get();

        $sub = DebtSubject::findOrFail($subjectId);
        $runningBalance = $sub->initial_debt;

        $data = $transactions->map(function($tx) use (&$runningBalance) {
            if ($tx->type === 'borrow') {
                $runningBalance += $tx->amount;
            } else if ($tx->type === 'pay_principal') {
                $runningBalance -= $tx->amount;
            }
            // pay_interest does not affect running balance

            return [
                'id' => $tx->id,
                'debt_subject_id' => $tx->debt_subject_id,
                'transaction_date' => $tx->transaction_date,
                'type' => $tx->type,
                'amount' => floatval($tx->amount),
                'note' => $tx->note,
                'fin_account_id' => $tx->fin_account_id,
                'fin_transaction_id' => $tx->fin_transaction_id,
                'running_balance' => $runningBalance
            ];
        });

        return response()->json(['status' => 'success', 'data' => $data->reverse()->values()]);
    }

    public function saveTransaction(Request $request)
    {
        $request->validate([
            'debt_subject_id' => 'required|exists:debt_subjects,id',
            'transaction_date' => 'required|date',
            'type' => 'required|in:borrow,pay_principal,pay_interest',
            'amount' => 'required|numeric',
            'fin_account_id' => 'required|exists:fin_accounts,id'
        ]);

        try {
            DB::beginTransaction();

            $data = $request->only(['debt_subject_id', 'transaction_date', 'type', 'amount', 'note', 'fin_account_id']);
            $debtTxId = $request->id;

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

            $cat = FinCategory::firstOrCreate(
                ['name' => $catName],
                [
                    'type' => $typeStr,
                    'color' => $catColor,
                    'sort_order' => FinCategory::nextSortOrder(),
                ]
            );

            $subject = DebtSubject::find($request->debt_subject_id);
            $subjectName = $subject ? $subject->name : 'N/A';

            $actionLabel = 'Giao dịch nợ';
            if ($request->type === 'borrow') $actionLabel = 'Vay thêm';
            if ($request->type === 'pay_principal') $actionLabel = 'Trả nợ gốc';
            if ($request->type === 'pay_interest') $actionLabel = 'Trả lãi nợ';

            $description = "{$actionLabel}: {$subjectName}" . ($request->note ? " ({$request->note})" : "") . " [Sổ nợ]";

            $finTxData = [
                'fin_account_id' => $request->fin_account_id,
                'fin_category_id' => $cat->id,
                'transaction_date' => $request->transaction_date,
                'type' => $typeStr,
                'amount' => $request->amount,
                'description' => $description,
                'notes' => $request->note,
                'balance_after' => 0,
            ];

            if ($debtTxId) {
                $debtTx = DebtTransaction::findOrFail($debtTxId);
                if ($debtTx->fin_transaction_id) {
                    $finTx = FinTransaction::find($debtTx->fin_transaction_id);
                    if ($finTx) {
                        $finTx->update($finTxData);
                    } else {
                        $finTx = FinTransaction::create($finTxData);
                        $data['fin_transaction_id'] = $finTx->id;
                    }
                } else {
                    $finTx = FinTransaction::create($finTxData);
                    $data['fin_transaction_id'] = $finTx->id;
                }
                $debtTx->update($data);
            } else {
                $finTx = FinTransaction::create($finTxData);
                $data['fin_transaction_id'] = $finTx->id;
                $debtTx = DebtTransaction::create($data);
            }

            // Recompute fin account
            app(FundController::class)->recomputeAccountBalance($request->fin_account_id);

            DB::commit();
            return response()->json(['status' => 'success', 'data' => $debtTx]);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json(['status' => 'error', 'message' => $e->getMessage()], 500);
        }
    }

    public function deleteTransaction($id)
    {
        $tx = DebtTransaction::findOrFail($id);

        if ($tx->fin_transaction_id) {
            $finTx = FinTransaction::find($tx->fin_transaction_id);
            if ($finTx) {
                $accId = $finTx->fin_account_id;
                $finTx->delete();
                app(FundController::class)->recomputeAccountBalance($accId);
            }
        }

        $tx->delete();
        return response()->json(['status' => 'success']);
    }
}
