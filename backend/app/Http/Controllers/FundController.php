<?php

namespace App\Http\Controllers;

use App\Models\FinAccount;
use App\Models\FinCategory;
use App\Models\FinTransaction;
use App\Services\AccountDataScopeService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class FundController extends Controller
{
    private function ensureDefaults(int $accountId): void
    {
        if (FinAccount::query()->where('account_id', $accountId)->count() === 0) {
            FinAccount::create(['account_id' => $accountId, 'name' => 'Tiền mặt', 'type' => 'cash', 'balance' => 0, 'initial_balance' => 0]);
            FinAccount::create(['account_id' => $accountId, 'name' => 'Ngân hàng', 'type' => 'bank', 'balance' => 0, 'initial_balance' => 0]);
        }

        if (FinCategory::query()->where('account_id', $accountId)->count() === 0) {
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

            foreach ($categories as $index => $category) {
                FinCategory::create([...$category, 'account_id' => $accountId, 'sort_order' => $index + 1]);
            }
        }
    }

    public function summary(Request $request)
    {
        $accountId = $this->accountId($request);
        $this->ensureDefaults($accountId);

        $accounts = FinAccount::query()
            ->where('account_id', $accountId)
            ->orderBy('type')
            ->orderBy('id')
            ->get();

        $totalCash = $accounts->where('type', 'cash')->sum('balance');
        $totalBank = $accounts->where('type', 'bank')->sum('balance');
        $total = $totalCash + $totalBank;

        return response()->json([
            'status' => 'success',
            'data' => [
                'total' => $total,
                'cash' => $totalCash,
                'bank' => $totalBank,
                'accounts' => $accounts,
            ],
        ]);
    }

    public function accounts(Request $request)
    {
        $accountId = $this->accountId($request);
        $this->ensureDefaults($accountId);

        return response()->json([
            'status' => 'success',
            'data' => FinAccount::query()
                ->where('account_id', $accountId)
                ->orderBy('type')
                ->orderBy('id')
                ->get(),
        ]);
    }

    public function categories(Request $request)
    {
        $accountId = $this->accountId($request);
        $this->ensureDefaults($accountId);

        return response()->json([
            'status' => 'success',
            'data' => $this->orderedCategories($accountId),
        ]);
    }

    public function transactions(Request $request)
    {
        $accountId = $this->accountId($request);
        $query = FinTransaction::with(['account', 'category'])->where('account_id', $accountId);

        if ($request->has('type') && $request->type !== 'all') {
            $type = $request->type;
            $query->whereHas('account', function ($q) use ($accountId, $type) {
                $q->where('account_id', $accountId)->where('type', $type);
            });
        }

        if ($request->filled('account_id')) {
            $query->where('fin_account_id', $request->account_id);
        }

        if ($request->filled('category_id')) {
            $query->where('fin_category_id', $request->category_id);
        }

        if ($request->filled('tx_type')) {
            $query->where('type', $request->tx_type);
        }

        if ($request->filled('start_date')) {
            $query->where('transaction_date', '>=', $request->start_date . ' 00:00:00');
        }
        if ($request->filled('end_date')) {
            $query->where('transaction_date', '<=', $request->end_date . ' 23:59:59');
        }

        if ($request->has('search') && trim($request->search) !== '') {
            $search = trim($request->search);
            $query->where(function ($q) use ($search) {
                $q->where('description', 'like', "%{$search}%")
                    ->orWhere('notes', 'like', "%{$search}%");
            });
        }

        $transactions = $query->orderBy('transaction_date', 'desc')
            ->orderBy('id', 'desc')
            ->paginate(100);

        return response()->json([
            'status' => 'success',
            'data' => $transactions,
        ]);
    }

    public function saveTransaction(Request $request)
    {
        $accountId = $this->accountId($request);
        $request->validate([
            'id' => 'nullable|integer',
            'transaction_date' => 'required|date',
            'description' => 'required|string',
            'fin_account_id' => [
                'required',
                'integer',
                Rule::exists('fin_accounts', 'id')->where(fn ($query) => $query->where('account_id', $accountId)),
            ],
            'fin_category_id' => [
                'nullable',
                'integer',
                Rule::exists('fin_categories', 'id')->where(fn ($query) => $query->where('account_id', $accountId)),
            ],
            'type' => 'required|in:income,expense',
            'amount' => 'required|numeric|min:0',
            'notes' => 'nullable|string',
            'new_category_name' => 'nullable|string|max:255',
        ]);

        try {
            DB::beginTransaction();

            $categoryId = $request->fin_category_id;
            if (!$categoryId && $request->filled('new_category_name')) {
                $category = FinCategory::firstOrCreate([
                    'account_id' => $accountId,
                    'name' => $request->new_category_name,
                    'type' => $request->type,
                ], [
                    'sort_order' => FinCategory::nextSortOrder($accountId),
                ]);
                $categoryId = $category->id;
            }

            $oldAccountId = null;
            if ($request->id) {
                $transaction = FinTransaction::query()
                    ->where('account_id', $accountId)
                    ->findOrFail($request->id);
                $oldAccountId = $transaction->fin_account_id;
            } else {
                $transaction = new FinTransaction();
            }

            $transaction->account_id = $accountId;
            $transaction->transaction_date = $request->transaction_date;
            $transaction->description = $request->description;
            $transaction->fin_account_id = $request->fin_account_id;
            $transaction->fin_category_id = $categoryId;
            $transaction->type = $request->type;
            $transaction->amount = $request->amount;
            $transaction->notes = $request->notes;
            $transaction->balance_after = 0;
            $transaction->save();

            foreach (array_unique([$request->fin_account_id, $oldAccountId]) as $fundAccountId) {
                if ($fundAccountId) {
                    $this->recomputeAccountBalance((int) $fundAccountId, $accountId);
                }
            }

            DB::commit();

            return response()->json([
                'status' => 'success',
                'message' => 'Lưu giao dịch thành công',
                'data' => FinTransaction::with(['account', 'category'])
                    ->where('account_id', $accountId)
                    ->find($transaction->id),
            ]);
        } catch (\Exception $exception) {
            DB::rollBack();

            return response()->json([
                'status' => 'error',
                'message' => $exception->getMessage(),
            ], 500);
        }
    }

    public function deleteTransaction(Request $request, int $id)
    {
        $accountId = $this->accountId($request);

        try {
            DB::beginTransaction();

            $transaction = FinTransaction::query()
                ->where('account_id', $accountId)
                ->findOrFail($id);
            $fundAccountId = $transaction->fin_account_id;
            $transaction->delete();

            $this->recomputeAccountBalance((int) $fundAccountId, $accountId);

            DB::commit();

            return response()->json(['status' => 'success']);
        } catch (\Exception $exception) {
            DB::rollBack();

            return response()->json(['status' => 'error', 'message' => $exception->getMessage()], 500);
        }
    }

    public function transfer(Request $request)
    {
        $accountId = $this->accountId($request);
        $fundAccountRule = fn () => Rule::exists('fin_accounts', 'id')
            ->where(fn ($query) => $query->where('account_id', $accountId));

        $request->validate([
            'from_account_id' => ['required', 'integer', $fundAccountRule()],
            'to_account_id' => ['required', 'integer', $fundAccountRule()],
            'amount' => 'required|numeric|min:1',
            'transaction_date' => 'required|date',
            'notes' => 'nullable|string',
        ]);

        if ((int) $request->from_account_id === (int) $request->to_account_id) {
            return response()->json(['status' => 'error', 'message' => 'Tài khoản nguồn và đích phải khác nhau'], 400);
        }

        try {
            DB::beginTransaction();

            $fromAccount = FinAccount::query()
                ->where('account_id', $accountId)
                ->findOrFail($request->from_account_id);
            $toAccount = FinAccount::query()
                ->where('account_id', $accountId)
                ->findOrFail($request->to_account_id);

            $category = FinCategory::firstOrCreate(
                ['account_id' => $accountId, 'name' => 'Chuyển quỹ', 'type' => 'expense'],
                [
                    'color' => '#009688',
                    'sort_order' => FinCategory::nextSortOrder($accountId),
                ]
            );

            FinTransaction::create([
                'account_id' => $accountId,
                'transaction_date' => $request->transaction_date,
                'description' => "Chuyển tiền sang [{$toAccount->name}]",
                'fin_account_id' => $fromAccount->id,
                'fin_category_id' => $category->id,
                'type' => 'expense',
                'amount' => $request->amount,
                'notes' => $request->notes,
                'balance_after' => 0,
            ]);

            FinTransaction::create([
                'account_id' => $accountId,
                'transaction_date' => $request->transaction_date,
                'description' => "Nhận tiền từ [{$fromAccount->name}]",
                'fin_account_id' => $toAccount->id,
                'fin_category_id' => $category->id,
                'type' => 'income',
                'amount' => $request->amount,
                'notes' => $request->notes,
                'balance_after' => 0,
            ]);

            $this->recomputeAccountBalance((int) $fromAccount->id, $accountId);
            $this->recomputeAccountBalance((int) $toAccount->id, $accountId);

            DB::commit();

            return response()->json(['status' => 'success', 'message' => 'Chuyển quỹ thành công']);
        } catch (\Exception $exception) {
            DB::rollBack();

            return response()->json(['status' => 'error', 'message' => $exception->getMessage()], 500);
        }
    }

    public function recomputeAccountBalance($fundAccountId, ?int $accountId = null): void
    {
        $accountQuery = FinAccount::query();
        if ($accountId !== null) {
            $accountQuery->where('account_id', $accountId);
        }

        $account = $accountQuery->find($fundAccountId);
        if (!$account) {
            return;
        }

        $transactions = FinTransaction::query()
            ->where('account_id', $account->account_id)
            ->where('fin_account_id', $account->id)
            ->orderBy('transaction_date', 'asc')
            ->orderBy('id', 'asc')
            ->get();

        $runningBalance = $account->initial_balance;
        foreach ($transactions as $transaction) {
            if ($transaction->type === 'income') {
                $runningBalance += $transaction->amount;
            } else {
                $runningBalance -= $transaction->amount;
            }

            if ((float) $transaction->balance_after !== (float) $runningBalance) {
                $transaction->balance_after = $runningBalance;
                $transaction->save();
            }
        }

        $account->balance = $runningBalance;
        $account->save();
    }

    public function updateAccountInitialBalance(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $request->validate(['initial_balance' => 'required|numeric']);

        $account = FinAccount::query()
            ->where('account_id', $accountId)
            ->findOrFail($id);
        $account->initial_balance = $request->initial_balance;
        $account->save();

        $this->recomputeAccountBalance($id, $accountId);

        return response()->json(['status' => 'success', 'data' => $account]);
    }

    public function saveAccount(Request $request)
    {
        $accountId = $this->accountId($request);
        $request->validate([
            'id' => 'nullable|integer',
            'name' => 'required|string',
            'type' => 'required|in:cash,bank',
        ]);

        if ($request->id) {
            $account = FinAccount::query()
                ->where('account_id', $accountId)
                ->findOrFail($request->id);
            $account->update($request->only(['name', 'type']));
        } else {
            $account = FinAccount::create([
                ...$request->only(['name', 'type']),
                'account_id' => $accountId,
                'balance' => 0,
                'initial_balance' => 0,
            ]);
        }

        return response()->json(['status' => 'success', 'data' => $account]);
    }

    public function deleteAccount(Request $request, int $id)
    {
        $accountId = $this->accountId($request);

        try {
            FinAccount::query()
                ->where('account_id', $accountId)
                ->findOrFail($id)
                ->delete();

            return response()->json(['status' => 'success']);
        } catch (\Exception) {
            return response()->json(['status' => 'error', 'message' => 'Không thể xóa tài khoản đã có giao dịch.'], 400);
        }
    }

    public function saveCategory(Request $request)
    {
        $accountId = $this->accountId($request);
        $request->validate([
            'id' => 'nullable|integer',
            'name' => 'required|string',
            'type' => 'required|in:income,expense',
            'color' => 'nullable|string',
        ]);

        if ($request->id) {
            $category = FinCategory::query()
                ->where('account_id', $accountId)
                ->findOrFail($request->id);
            $category->update($request->only(['name', 'type', 'color']));
        } else {
            $category = FinCategory::create([
                ...$request->only(['name', 'type', 'color']),
                'account_id' => $accountId,
                'sort_order' => FinCategory::nextSortOrder($accountId),
            ]);
        }

        return response()->json(['status' => 'success', 'data' => $category]);
    }

    public function reorderCategories(Request $request)
    {
        $accountId = $this->accountId($request);
        $validated = $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'required|integer|distinct',
        ]);

        $ids = array_map('intval', $validated['ids']);
        $categoryCount = FinCategory::query()->where('account_id', $accountId)->count();
        $validIdCount = FinCategory::query()
            ->where('account_id', $accountId)
            ->whereIn('id', $ids)
            ->count();

        if ($validIdCount !== count($ids) || count($ids) !== $categoryCount) {
            return response()->json([
                'message' => 'Danh sách hạng mục đã thay đổi. Vui lòng tải lại và thử lại.',
                'errors' => [
                    'ids' => ['Danh sách sắp xếp phải chứa đầy đủ các hạng mục hiện tại.'],
                ],
            ], 422);
        }

        DB::transaction(function () use ($ids, $accountId) {
            foreach ($ids as $index => $id) {
                FinCategory::query()
                    ->where('account_id', $accountId)
                    ->whereKey($id)
                    ->update(['sort_order' => $index + 1]);
            }
        });

        return response()->json([
            'status' => 'success',
            'data' => $this->orderedCategories($accountId),
        ]);
    }

    public function deleteCategory(Request $request, int $id)
    {
        $accountId = $this->accountId($request);

        FinCategory::query()
            ->where('account_id', $accountId)
            ->findOrFail($id)
            ->delete();

        return response()->json(['status' => 'success']);
    }

    private function orderedCategories(int $accountId)
    {
        return FinCategory::query()
            ->where('account_id', $accountId)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();
    }

    public function report(Request $request)
    {
        $accountId = $this->accountId($request);
        $startDate = $request->start_date ? $request->start_date . ' 00:00:00' : date('Y-m-01 00:00:00');
        $endDate = $request->end_date ? $request->end_date . ' 23:59:59' : date('Y-m-t 23:59:59');

        $query = FinTransaction::with('category')
            ->where('account_id', $accountId)
            ->whereBetween('transaction_date', [$startDate, $endDate]);

        if ($request->has('fin_account_ids') && is_array($request->fin_account_ids) && count($request->fin_account_ids) > 0) {
            $query->whereIn('fin_account_id', $request->fin_account_ids);
        } elseif ($request->has('fin_account_id') && $request->fin_account_id !== 'all') {
            $query->where('fin_account_id', $request->fin_account_id);
        }

        $grouped = $query->get()->groupBy('fin_category_id');

        $report = [];
        $totalIncome = 0;
        $totalExpense = 0;

        foreach ($grouped as $categoryId => $transactions) {
            $category = $categoryId
                ? FinCategory::query()->where('account_id', $accountId)->find($categoryId)
                : null;
            $categoryName = $category ? $category->name : 'Chưa phân loại';
            $incomeSum = $transactions->where('type', 'income')->sum('amount');
            $expenseSum = $transactions->where('type', 'expense')->sum('amount');

            $totalIncome += $incomeSum;
            $totalExpense += $expenseSum;

            if ($incomeSum > 0) {
                $report[] = [
                    'id' => $categoryId,
                    'name' => $categoryName,
                    'type' => 'income',
                    'amount' => $incomeSum,
                    'color' => $category ? $category->color : '#9e9e9e',
                ];
            }
            if ($expenseSum > 0) {
                $report[] = [
                    'id' => $categoryId,
                    'name' => $categoryName,
                    'type' => 'expense',
                    'amount' => $expenseSum,
                    'color' => $category ? $category->color : '#9e9e9e',
                ];
            }
        }

        usort($report, fn ($a, $b) => $b['amount'] <=> $a['amount']);

        return response()->json([
            'status' => 'success',
            'data' => [
                'report' => $report,
                'total_income' => $totalIncome,
                'total_expense' => $totalExpense,
            ],
        ]);
    }

    private function accountId(Request $request): int
    {
        $accountId = app(AccountDataScopeService::class)
            ->resolveScopedAccountId(
                app(AccountDataScopeService::class)->rawActiveAccountId($request),
                AccountDataScopeService::SCOPE_ACTIVE
            );

        if (!$accountId) {
            $accountId = app(AccountDataScopeService::class)->accountIdForCurrentRequest(AccountDataScopeService::SCOPE_ACTIVE);
        }

        if (!$accountId) {
            abort(422, 'Can chon cua hang truoc khi thao tac so cai.');
        }

        return (int) $accountId;
    }
}
