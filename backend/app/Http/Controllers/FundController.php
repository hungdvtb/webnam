<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\FinAccount;
use App\Models\FinCategory;
use App\Models\FinTransaction;
use Illuminate\Support\Facades\DB;

class FundController extends Controller
{
    private function ensureDefaults()
    {
        if (FinAccount::count() === 0) {
            FinAccount::create(['name' => 'Tiền mặt', 'type' => 'cash', 'balance' => 0]);
            FinAccount::create(['name' => 'Ngân hàng', 'type' => 'bank', 'balance' => 0]);
        }
        if (FinCategory::count() === 0) {
            $categories = [
                ['name' => 'Bán hàng', 'type' => 'income', 'color' => '#4caf50'],
                ['name' => 'Khách nợ', 'type' => 'income', 'color' => '#81c784'],
                ['name' => 'Nhập hàng', 'type' => 'expense', 'color' => '#f44336'],
                ['name' => 'Vật tư đóng gói', 'type' => 'expense', 'color' => '#e57373'],
                ['name' => 'Vận chuyển', 'type' => 'expense', 'color' => '#ff9800'],
                ['name' => 'Lương/Thưởng', 'type' => 'expense', 'color' => '#ffb74d'],
                ['name' => 'Chi phí cố định', 'type' => 'expense', 'color' => '#9c27b0'],
                ['name' => 'Chuyển quỹ', 'type' => 'expense', 'color' => '#009688'],
                ['name' => 'Khác', 'type' => 'expense', 'color' => '#9e9e9e'],
            ];
            foreach ($categories as $index => $cat) {
                FinCategory::create(array_merge($cat, ['sort_order' => $index + 1]));
            }
        }
    }

    public function summary()
    {
        $this->ensureDefaults();

        $accounts = FinAccount::all();
        $totalCash = $accounts->where('type', 'cash')->sum('balance');
        $totalBank = $accounts->where('type', 'bank')->sum('balance');
        $total = $totalCash + $totalBank;

        return response()->json([
            'status' => 'success',
            'data' => [
                'total' => $total,
                'cash' => $totalCash,
                'bank' => $totalBank,
                'accounts' => $accounts
            ]
        ]);
    }

    public function accounts()
    {
        return response()->json([
            'status' => 'success',
            'data' => FinAccount::all()
        ]);
    }

    public function categories()
    {
        $this->ensureDefaults();
        return response()->json([
            'status' => 'success',
            'data' => $this->orderedCategories()
        ]);
    }

    public function transactions(Request $request)
    {
        $query = FinTransaction::with(['account', 'category']);

        // Account type filter (cash/bank/all)
        if ($request->has('type') && $request->type !== 'all') {
            $type = $request->type;
            $query->whereHas('account', function($q) use ($type) {
                $q->where('type', $type);
            });
        }

        // Specific Account ID filter
        if ($request->filled('account_id')) {
            $query->where('fin_account_id', $request->account_id);
        }

        // Category filter
        if ($request->filled('category_id')) {
            $query->where('fin_category_id', $request->category_id);
        }

        // Transaction type filter (income/expense)
        if ($request->filled('tx_type')) {
            $query->where('type', $request->tx_type);
        }

        // Date range filter
        if ($request->filled('start_date')) {
            $query->where('transaction_date', '>=', $request->start_date . ' 00:00:00');
        }
        if ($request->filled('end_date')) {
            $query->where('transaction_date', '<=', $request->end_date . ' 23:59:59');
        }

        // Quick Search (Search by description or notes)
        if ($request->has('search') && trim($request->search) !== '') {
            $search = trim($request->search);
            $query->where(function($q) use ($search) {
                $q->where('description', 'like', "%{$search}%")
                  ->orWhere('notes', 'like', "%{$search}%");
            });
        }

        $transactions = $query->orderBy('transaction_date', 'desc')
                              ->orderBy('id', 'desc')
                              ->paginate(100);

        return response()->json([
            'status' => 'success',
            'data' => $transactions
        ]);
    }

    public function saveTransaction(Request $request)
    {
        $request->validate([
            'transaction_date' => 'required|date',
            'description' => 'required|string',
            'fin_account_id' => 'required|exists:fin_accounts,id',
            'type' => 'required|in:income,expense',
            'amount' => 'required|numeric|min:0',
        ]);

        try {
            DB::beginTransaction();

            $category_id = $request->fin_category_id;

            // If user typed a new category name (client sends new category as string in 'new_category_name')
            if (!$category_id && $request->new_category_name) {
                $type = $request->type;
                $cat = FinCategory::firstOrCreate([
                    'name' => $request->new_category_name,
                    'type' => $type
                ], [
                    'sort_order' => FinCategory::nextSortOrder()
                ]);
                $category_id = $cat->id;
            }

            $tx = null;
            $oldAmount = 0;
            $oldType = 'income';
            $oldAccountId = null;

            if ($request->id) {
                $tx = FinTransaction::findOrFail($request->id);
                $oldAmount = $tx->amount;
                $oldType = $tx->type;
                $oldAccountId = $tx->fin_account_id;
            } else {
                $tx = new FinTransaction();
            }

            $tx->transaction_date = $request->transaction_date;
            $tx->description = $request->description;
            $tx->fin_account_id = $request->fin_account_id;
            $tx->fin_category_id = $category_id;
            $tx->type = $request->type;
            $tx->amount = $request->amount;
            $tx->notes = $request->notes;

            // Just save the transaction without calculating balance_after instantly to fix whole chain.
            // But we must compute the balance for THIS transaction and RE-CALCULATE future ones for THIS account.
            $tx->balance_after = 0; // Temp
            $tx->save();

            // Recompute balances for affected accounts
            $accountsToRecalc = array_unique([$request->fin_account_id, $oldAccountId]);
            foreach ($accountsToRecalc as $accId) {
                if ($accId) {
                    $this->recomputeAccountBalance($accId);
                }
            }

            DB::commit();

            return response()->json([
                'status' => 'success',
                'message' => 'Lưu giao dịch thành công',
                'data' => FinTransaction::with(['account', 'category'])->find($tx->id)
            ]);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage()
            ], 500);
        }
    }

    public function deleteTransaction($id)
    {
        try {
            DB::beginTransaction();
            $tx = FinTransaction::findOrFail($id);
            $accId = $tx->fin_account_id;
            $tx->delete();

            $this->recomputeAccountBalance($accId);

            DB::commit();
            return response()->json(['status' => 'success']);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json(['status' => 'error', 'message' => $e->getMessage()], 500);
        }
    }

    public function transfer(Request $request)
    {
        $request->validate([
            'from_account_id' => 'required|exists:fin_accounts,id',
            'to_account_id' => 'required|exists:fin_accounts,id',
            'amount' => 'required|numeric|min:1',
            'transaction_date' => 'required|date',
            'notes' => 'nullable|string'
        ]);

        if ($request->from_account_id == $request->to_account_id) {
            return response()->json(['status' => 'error', 'message' => 'Tài khoản nguồn và đích phải khác nhau'], 400);
        }

        try {
            DB::beginTransaction();

            $fromAcc = FinAccount::findOrFail($request->from_account_id);
            $toAcc = FinAccount::findOrFail($request->to_account_id);

            // Find or create 'Chuyển quỹ' category
            $category = FinCategory::firstOrCreate(
                ['name' => 'Chuyển quỹ'],
                [
                    'type' => 'expense',
                    'color' => '#009688',
                    'sort_order' => FinCategory::nextSortOrder(),
                ]
            );

            // Create Expense (Withdraw) from source
            $outTx = FinTransaction::create([
                'transaction_date' => $request->transaction_date,
                'description' => "Chuyển tiền sang [{$toAcc->name}]",
                'fin_account_id' => $fromAcc->id,
                'fin_category_id' => $category->id,
                'type' => 'expense',
                'amount' => $request->amount,
                'notes' => $request->notes,
                'balance_after' => 0
            ]);

            // Create Income (Deposit) to target
            $inTx = FinTransaction::create([
                'transaction_date' => $request->transaction_date,
                'description' => "Nhận tiền từ [{$fromAcc->name}]",
                'fin_account_id' => $toAcc->id,
                'fin_category_id' => $category->id,
                'type' => 'income',
                'amount' => $request->amount,
                'notes' => $request->notes,
                'balance_after' => 0
            ]);

            // Recompute balances
            $this->recomputeAccountBalance($fromAcc->id);
            $this->recomputeAccountBalance($toAcc->id);

            DB::commit();
            return response()->json(['status' => 'success', 'message' => 'Chuyển quỹ thành công']);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json(['status' => 'error', 'message' => $e->getMessage()], 500);
        }
    }

    public function recomputeAccountBalance($accountId)
    {
        // Fetch all transactions for this account ordered by date ASC, then ID ASC
        $transactions = FinTransaction::where('fin_account_id', $accountId)
            ->orderBy('transaction_date', 'asc')
            ->orderBy('id', 'asc')
            ->get();

        $account = FinAccount::find($accountId);
        if (!$account) return;

        $runningBalance = $account->initial_balance;
        foreach ($transactions as $tx) {
            if ($tx->type === 'income') {
                $runningBalance += $tx->amount;
            } else {
                $runningBalance -= $tx->amount;
            }

            if ($tx->balance_after != $runningBalance) {
                $tx->balance_after = $runningBalance;
                $tx->save();
            }
        }

        // Update the account total
        $account->balance = $runningBalance;
        $account->save();
    }

    public function updateAccountInitialBalance(Request $request, $id)
    {
        $request->validate(['initial_balance' => 'required|numeric']);
        $account = FinAccount::findOrFail($id);
        $account->initial_balance = $request->initial_balance;
        $account->save();

        $this->recomputeAccountBalance($id);

        return response()->json(['status' => 'success', 'data' => $account]);
    }

    public function saveAccount(Request $request)
    {
        $request->validate([
            'name' => 'required|string',
            'type' => 'required|in:cash,bank',
        ]);

        if ($request->id) {
            $acc = FinAccount::findOrFail($request->id);
            $acc->update($request->only(['name', 'type']));
        } else {
            $acc = FinAccount::create(array_merge($request->only(['name', 'type']), ['balance' => 0, 'initial_balance' => 0]));
        }

        return response()->json(['status' => 'success', 'data' => $acc]);
    }

    public function deleteAccount($id)
    {
        try {
            FinAccount::findOrFail($id)->delete();
            return response()->json(['status' => 'success']);
        } catch (\Exception $e) {
            return response()->json(['status' => 'error', 'message' => 'Không thể xóa tài khoản đã có giao dịch.'], 400);
        }
    }

    public function saveCategory(Request $request)
    {
        $request->validate([
            'name' => 'required|string',
            'type' => 'required|in:income,expense'
        ]);

        if ($request->id) {
            $cat = FinCategory::findOrFail($request->id);
            $cat->update($request->only(['name', 'type', 'color']));
        } else {
            $cat = FinCategory::create(array_merge(
                $request->only(['name', 'type', 'color']),
                ['sort_order' => FinCategory::nextSortOrder()]
            ));
        }

        return response()->json(['status' => 'success', 'data' => $cat]);
    }

    public function reorderCategories(Request $request)
    {
        $validated = $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'required|integer|distinct|exists:fin_categories,id',
        ]);

        $ids = array_map('intval', $validated['ids']);
        if (count($ids) !== FinCategory::count()) {
            return response()->json([
                'message' => 'Danh sách hạng mục đã thay đổi. Vui lòng tải lại và thử lại.',
                'errors' => [
                    'ids' => ['Danh sách sắp xếp phải chứa đầy đủ các hạng mục hiện tại.'],
                ],
            ], 422);
        }

        DB::transaction(function () use ($ids) {
            foreach ($ids as $index => $id) {
                FinCategory::whereKey($id)->update(['sort_order' => $index + 1]);
            }
        });

        return response()->json([
            'status' => 'success',
            'data' => $this->orderedCategories(),
        ]);
    }

    public function deleteCategory($id)
    {
        FinCategory::findOrFail($id)->delete();
        return response()->json(['status' => 'success']);
    }

    private function orderedCategories()
    {
        return FinCategory::query()
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();
    }

    public function report(Request $request)
    {
        $startDate = $request->start_date ? $request->start_date . ' 00:00:00' : date('Y-m-01 00:00:00');
        $endDate = $request->end_date ? $request->end_date . ' 23:59:59' : date('Y-m-t 23:59:59');

        $query = FinTransaction::with('category')->whereBetween('transaction_date', [$startDate, $endDate]);

        if ($request->has('fin_account_ids') && is_array($request->fin_account_ids) && count($request->fin_account_ids) > 0) {
            $query->whereIn('fin_account_id', $request->fin_account_ids);
        } else if ($request->has('fin_account_id') && $request->fin_account_id !== 'all') {
            $query->where('fin_account_id', $request->fin_account_id);
        }

        $grouped = $query->get()->groupBy('fin_category_id');

        $report = [];
        $totalIncome = 0;
        $totalExpense = 0;

        foreach ($grouped as $categoryId => $txs) {
            $cat = $categoryId ? FinCategory::find($categoryId) : null;
            $catName = $cat ? $cat->name : 'Chưa phân loại';
            $type = $txs->first()->type;

            // To ensure all txs in this group have same type? Let's just sum based on tx type
            $incomeSum = $txs->where('type', 'income')->sum('amount');
            $expenseSum = $txs->where('type', 'expense')->sum('amount');

            $mainType = $incomeSum > 0 ? 'income' : 'expense';
            $amount = $incomeSum > 0 ? $incomeSum : $expenseSum;

            $totalIncome += $incomeSum;
            $totalExpense += $expenseSum;

            if ($incomeSum > 0) {
                $report[] = [
                    'id' => $categoryId,
                    'name' => $catName,
                    'type' => 'income',
                    'amount' => $incomeSum,
                    'color' => $cat ? $cat->color : '#9e9e9e'
                ];
            }
            if ($expenseSum > 0) {
                $report[] = [
                    'id' => $categoryId,
                    'name' => $catName,
                    'type' => 'expense',
                    'amount' => $expenseSum,
                    'color' => $cat ? $cat->color : '#9e9e9e'
                ];
            }
        }

        // Sort descending by amount
        usort($report, function($a, $b) {
            return $b['amount'] <=> $a['amount'];
        });

        return response()->json([
            'status' => 'success',
            'data' => [
                'report' => $report,
                'total_income' => $totalIncome,
                'total_expense' => $totalExpense,
            ]
        ]);
    }
}
