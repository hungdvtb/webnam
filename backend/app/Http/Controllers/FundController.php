<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Api\InventoryController;
use App\Models\FinAccount;
use App\Models\FinCategory;
use App\Models\FinTransaction;
use App\Models\FinDailyReportConfig;
use App\Models\DebtSubject;
use App\Models\Order;
use App\Models\Shipment;
use App\Models\SiteSetting;
use App\Services\AccountDataScopeService;
use App\Services\Finance\FinanceService;
use App\Support\OrderStatusCatalog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;

class FundController extends Controller
{
    private const ASSET_SUMMARY_SETTING_KEY = 'fund_asset_summary_settings';

    private const ASSET_SUMMARY_SETTING_DEFAULTS = [
        'delivered_unpaid_amount' => 0,
        'other_deductions_amount' => 0,
        'note' => '',
    ];

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

    public function assetSummary(Request $request)
    {
        $accountId = $this->accountId($request);
        $this->ensureDefaults($accountId);

        return response()->json([
            'status' => 'success',
            'data' => $this->buildAssetSummary($accountId, $request),
        ]);
    }

    public function saveAssetSummarySettings(Request $request)
    {
        $accountId = $this->accountId($request);

        $validated = $request->validate([
            'delivered_unpaid_amount' => 'nullable|numeric|min:0',
            'other_deductions_amount' => 'nullable|numeric|min:0',
            'note' => 'nullable|string|max:2000',
        ]);

        $settings = [
            'delivered_unpaid_amount' => round((float) ($validated['delivered_unpaid_amount'] ?? 0), 2),
            'other_deductions_amount' => round((float) ($validated['other_deductions_amount'] ?? 0), 2),
            'note' => trim((string) ($validated['note'] ?? '')),
        ];

        if (!Schema::hasTable('site_settings')) {
            return response()->json([
                'status' => 'error',
                'message' => 'Bang cau hinh site_settings chua san sang.',
            ], 422);
        }

        SiteSetting::setValue(
            self::ASSET_SUMMARY_SETTING_KEY,
            json_encode($settings, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            $accountId
        );

        return response()->json([
            'status' => 'success',
            'data' => $this->buildAssetSummary($accountId, $request),
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

    private function buildAssetSummary(int $accountId, ?Request $request = null): array
    {
        $fundTotals = $this->fundAssetTotals($accountId);
        $inventoryTotals = $this->inventoryAssetTotals($accountId, $request);
        $settings = $this->assetSummarySettings($accountId);
        $pendingOrderTotals = $this->pendingOrderAssetTotals($accountId);
        $debtTotals = $this->debtAssetTotals($accountId);

        $rows = [
            [
                'key' => 'fund_balance',
                'type' => 'plus',
                'source' => 'auto',
                'label' => 'Tien trong so',
                'amount' => $fundTotals['total'],
                'note' => 'Tong so du tien mat va ngan hang trong so cai.',
                'meta' => $fundTotals,
            ],
            [
                'key' => 'inventory_value',
                'type' => 'plus',
                'source' => 'auto',
                'label' => 'Ton kho',
                'amount' => $inventoryTotals['value'],
                'note' => 'Tinh theo co the ban * gia von/gia du kien, cung cong thuc trang Ton kho.',
                'meta' => $inventoryTotals,
            ],
            [
                'key' => 'delivered_unpaid',
                'type' => 'plus',
                'source' => 'manual',
                'label' => 'VTP da giao chua tra',
                'amount' => $settings['delivered_unpaid_amount'],
                'note' => 'Khoan da giao thanh cong nhung ViettelPost chua doi soat/tra tien.',
                'meta' => [],
            ],
            [
                'key' => 'pending_orders',
                'type' => 'plus',
                'source' => 'auto',
                'label' => 'Don moi/dang giao du kien',
                'amount' => $pendingOrderTotals['net_amount'],
                'note' => 'Da tru ty le hoan, phi ship, dong goi va thue theo cau hinh lai ngay.',
                'meta' => $pendingOrderTotals,
            ],
            [
                'key' => 'other_deductions',
                'type' => 'minus',
                'source' => 'manual',
                'label' => 'Chi khac',
                'amount' => $settings['other_deductions_amount'],
                'note' => 'Khoan chi/du phong nhap tay can tru khoi tong tai san.',
                'meta' => [],
            ],
            [
                'key' => 'debt_payable',
                'type' => 'minus',
                'source' => 'auto',
                'label' => 'No phai tra',
                'amount' => $debtTotals['payable'],
                'note' => 'Lay tu so no: no dau ky + vay/ghi no - tra goc.',
                'meta' => $debtTotals,
            ],
        ];

        $grossAssets = round(
            $fundTotals['total']
            + $inventoryTotals['value']
            + $settings['delivered_unpaid_amount']
            + $pendingOrderTotals['net_amount'],
            2
        );
        $deductions = round($settings['other_deductions_amount'] + $debtTotals['payable'], 2);
        $netAssets = round($grossAssets - $deductions, 2);

        return [
            'summary' => [
                'net_assets' => $netAssets,
                'gross_assets' => $grossAssets,
                'deductions' => $deductions,
                'fund_balance' => $fundTotals['total'],
                'inventory_value' => $inventoryTotals['value'],
                'delivered_unpaid_amount' => $settings['delivered_unpaid_amount'],
                'pending_orders_net_amount' => $pendingOrderTotals['net_amount'],
                'other_deductions_amount' => $settings['other_deductions_amount'],
                'debt_payable' => $debtTotals['payable'],
            ],
            'settings' => $settings,
            'rows' => $rows,
            'pending_orders' => $pendingOrderTotals,
            'formula' => 'Tien trong so + Ton kho + VTP da giao chua tra + Don moi/dang giao du kien - Chi khac - No phai tra',
        ];
    }

    private function assetSummarySettings(int $accountId): array
    {
        if (!Schema::hasTable('site_settings')) {
            return self::ASSET_SUMMARY_SETTING_DEFAULTS;
        }

        $raw = SiteSetting::getValue(self::ASSET_SUMMARY_SETTING_KEY, $accountId, null);
        $decoded = is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
        if (!is_array($decoded)) {
            $decoded = [];
        }

        return [
            'delivered_unpaid_amount' => round((float) ($decoded['delivered_unpaid_amount'] ?? 0), 2),
            'other_deductions_amount' => round((float) ($decoded['other_deductions_amount'] ?? 0), 2),
            'note' => trim((string) ($decoded['note'] ?? '')),
        ];
    }

    private function fundAssetTotals(int $accountId): array
    {
        if (!Schema::hasTable('fin_accounts')) {
            return ['total' => 0, 'cash' => 0, 'bank' => 0, 'account_count' => 0];
        }

        $accounts = FinAccount::query()
            ->where('account_id', $accountId)
            ->get(['id', 'type', 'balance']);

        return [
            'total' => round((float) $accounts->sum('balance'), 2),
            'cash' => round((float) $accounts->where('type', 'cash')->sum('balance'), 2),
            'bank' => round((float) $accounts->where('type', 'bank')->sum('balance'), 2),
            'account_count' => $accounts->count(),
        ];
    }

    private function inventoryAssetTotals(int $accountId, ?Request $sourceRequest = null): array
    {
        if (!Schema::hasTable('products')) {
            return [
                'value' => 0,
                'stock_quantity' => 0,
                'sellable_stock_quantity' => 0,
                'pending_export_quantity' => 0,
                'pending_return_quantity' => 0,
                'product_count' => 0,
            ];
        }

        $sourceRequest ??= request();
        $inventoryRequest = Request::create('/api/inventory/products', 'GET', ['per_page' => 20]);
        $inventoryRequest->headers->set('X-Account-Id', (string) $accountId);
        $inventoryRequest->setUserResolver($sourceRequest->getUserResolver());
        $inventoryRequest->setRouteResolver($sourceRequest->getRouteResolver());

        $previousRequest = app('request');

        try {
            app()->instance('request', $inventoryRequest);
            $summary = app(InventoryController::class)->productSummaryForRequest($inventoryRequest);
        } finally {
            app()->instance('request', $previousRequest);
        }

        return [
            'value' => round((float) ($summary['total_inventory_value'] ?? 0), 2),
            'stock_quantity' => round((float) ($summary['total_stock'] ?? 0), 2),
            'sellable_stock_quantity' => round((float) ($summary['total_actual_stock'] ?? $summary['total_sellable_stock'] ?? 0), 2),
            'pending_export_quantity' => round((float) ($summary['total_pending_export'] ?? 0), 2),
            'pending_return_quantity' => round((float) ($summary['total_pending_return'] ?? 0), 2),
            'product_count' => (int) ($summary['total_products'] ?? 0),
            'source' => 'inventory_products_summary',
        ];
    }

    private function pendingOrderAssetTotals(int $accountId): array
    {
        if (!Schema::hasTable('orders')) {
            return $this->emptyPendingOrderAssetTotals();
        }

        $orders = $this->pendingOrderAssetQuery($accountId)->get([
            'id',
            'order_number',
            'order_type',
            'total_price',
            'shipping_fee',
            'internal_shipping_fee',
            'shipping_dispatched_at',
            'status',
        ]);
        $orderCount = $orders->count();
        $orderIds = $orders
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();
        $grossCod = round((float) $orders->sum(fn (Order $order) => $this->orderCodAmount($order)), 2);
        $shippingRows = $orders->map(function (Order $order) {
            return [
                'cod_amount' => $this->orderCodAmount($order),
                'recorded_shipping_cost' => $this->recordedOrderShippingCost($order),
            ];
        });
        $recordedShippingCost = round((float) $shippingRows->sum('recorded_shipping_cost'), 2);
        $missingShippingOrderCount = $shippingRows
            ->filter(fn (array $row) => (float) $row['recorded_shipping_cost'] <= 0)
            ->count();
        $missingShippingGrossCod = round((float) $shippingRows
            ->filter(fn (array $row) => (float) $row['recorded_shipping_cost'] <= 0)
            ->sum('cod_amount'), 2);

        $config = $this->dailyPnlExperienceConfig($accountId);
        $returnRate = max(0, (float) ($config['return_rate'] ?? 0));
        $returnFactor = max(0, 1 - ($returnRate / 100));
        $afterReturn = round($grossCod * $returnFactor, 2);

        $estimatedShippingCost = ($config['shipping_calculation_mode'] ?? 'fixed_per_order') === 'revenue_percent'
            ? round($missingShippingGrossCod * ((float) ($config['shipping_cost_rate'] ?? 0) / 100), 2)
            : round($missingShippingOrderCount * (float) ($config['shipping_cost_per_order'] ?? 0), 2);
        $shippingCost = round($recordedShippingCost + $estimatedShippingCost, 2);
        $packagingOrders = $orders->filter(fn (Order $order) => $this->shouldReservePackagingCost($order));
        $packagingOrderCount = $packagingOrders->count();
        $packagingCostPerOrder = (float) ($config['packaging_cost_per_order'] ?? 0);
        $packagingCost = round($packagingOrderCount * $packagingCostPerOrder, 2);
        $taxCost = round(max(0, $afterReturn - $shippingCost) * ((float) ($config['tax_rate'] ?? 1.5) / 100), 2);
        $netAmount = round($afterReturn - $shippingCost - $packagingCost - $taxCost, 2);

        return [
            'gross_cod_amount' => $grossCod,
            'order_count' => $orderCount,
            'order_ids' => $orderIds,
            'return_rate' => round($returnRate, 4),
            'after_return_amount' => $afterReturn,
            'shipping_cost' => round($shippingCost, 2),
            'recorded_shipping_cost' => $recordedShippingCost,
            'estimated_shipping_cost' => $estimatedShippingCost,
            'packaging_cost' => $packagingCost,
            'packaging_order_count' => $packagingOrderCount,
            'tax_cost' => $taxCost,
            'net_amount' => $netAmount,
            'config' => [
                'effective_date' => $config['effective_date'] ?? null,
                'source' => $config['source'] ?? 'daily_pnl_config',
                'shipping_calculation_mode' => $config['shipping_calculation_mode'] ?? 'fixed_per_order',
                'shipping_calculation_label' => $config['shipping_calculation_label'] ?? app(FinanceService::class)->dailyProfitShippingModeLabel('fixed_per_order'),
                'shipping_cost_per_order' => round((float) ($config['shipping_cost_per_order'] ?? 0), 2),
                'shipping_cost_rate' => round((float) ($config['shipping_cost_rate'] ?? 0), 4),
                'packaging_cost_per_order' => round($packagingCostPerOrder, 2),
                'tax_rate' => round((float) ($config['tax_rate'] ?? 1.5), 4),
            ],
        ];
    }

    private function dailyPnlExperienceConfig(int $accountId): array
    {
        $defaults = [
            'effective_date' => null,
            'return_rate' => 2.0,
            'packaging_cost_per_order' => 2000.0,
            'shipping_calculation_mode' => 'revenue_percent',
            'shipping_calculation_label' => 'Ước tính % theo COD',
            'shipping_cost_per_order' => 0.0,
            'shipping_cost_rate' => 5.0,
            'tax_rate' => 1.5,
            'source' => 'daily_pnl_config_default',
        ];

        if (!Schema::hasTable('fin_daily_report_configs')) {
            return $defaults;
        }

        $query = FinDailyReportConfig::query();

        if (Schema::hasColumn('fin_daily_report_configs', 'account_id')) {
            $config = (clone $query)->where('account_id', $accountId)->first()
                ?: (clone $query)->whereNull('account_id')->orderBy('id')->first()
                ?: (clone $query)->orderBy('id')->first();
        } else {
            $config = $query->orderBy('id')->first();
        }

        if (!$config) {
            return $defaults;
        }

        $shippingFeeType = trim((string) ($config->shipping_fee_type ?? '%'));
        $shippingEstimateRate = (float) ($config->shipping_estimate_rate ?? $defaults['shipping_cost_rate']);
        $isPercentShipping = $shippingFeeType === '%' || str_contains(strtolower($shippingFeeType), 'percent');

        return [
            'effective_date' => null,
            'return_rate' => (float) ($config->return_rate ?? $defaults['return_rate']),
            'packaging_cost_per_order' => (float) ($config->packaging_fee ?? $defaults['packaging_cost_per_order']),
            'shipping_calculation_mode' => $isPercentShipping ? 'revenue_percent' : 'fixed_per_order',
            'shipping_calculation_label' => $isPercentShipping ? 'Theo % COD thiếu phí ship' : 'Cố định theo đơn thiếu phí ship',
            'shipping_cost_per_order' => $isPercentShipping ? 0.0 : $shippingEstimateRate,
            'shipping_cost_rate' => $isPercentShipping ? $shippingEstimateRate : 0.0,
            'tax_rate' => (float) ($config->tax_rate ?? $defaults['tax_rate']),
            'source' => 'daily_pnl_config',
        ];
    }

    private function shouldReservePackagingCost(Order $order): bool
    {
        if ($order->shipping_dispatched_at) {
            return false;
        }

        return !($order->activeShipment instanceof Shipment);
    }

    private function emptyPendingOrderAssetTotals(): array
    {
        return [
            'gross_cod_amount' => 0,
            'order_count' => 0,
            'order_ids' => [],
            'return_rate' => 0,
            'after_return_amount' => 0,
            'shipping_cost' => 0,
            'recorded_shipping_cost' => 0,
            'estimated_shipping_cost' => 0,
            'packaging_cost' => 0,
            'packaging_order_count' => 0,
            'tax_cost' => 0,
            'net_amount' => 0,
            'config' => [],
        ];
    }

    private function pendingOrderAssetQuery(int $accountId)
    {
        $excludedOrderStatuses = array_filter(array_unique([
            OrderStatusCatalog::COMPLETED_CODE,
            OrderStatusCatalog::PENDING_RETURN_CODE,
            OrderStatusCatalog::RETURNED_CODE,
            OrderStatusCatalog::EXCHANGE_COMPLETED_CODE,
            OrderStatusCatalog::PARTIAL_DELIVERY_CODE,
            'cancelled',
            'canceled',
        ]));
        $excludedShipmentStatuses = [
            'delivered',
            'delivery_success',
            'returning',
            'returned',
            'canceled',
            'cancelled',
        ];

        $query = Order::query()
            ->where('account_id', $accountId)
            ->where('total_price', '>', 0)
            ->whereNotIn(DB::raw('LOWER(status)'), $excludedOrderStatuses);
        if (Schema::hasColumn('orders', 'order_kind')) {
            $query->where(function ($kindQuery) {
                $kindQuery
                    ->where('order_kind', Order::KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            });
        }

        if (Schema::hasTable('shipments')) {
            $query->with(['activeShipment:id,order_id,shipment_status,shipping_cost,service_fee,insurance_fee,other_fee,return_fee'])
                ->whereDoesntHave('shipments', function ($shipmentQuery) use ($excludedShipmentStatuses) {
                    $shipmentQuery->whereIn(DB::raw('LOWER(shipment_status)'), $excludedShipmentStatuses);
                });
        }

        return $query;
    }

    private function orderCodAmount(Order $order): float
    {
        return $order->shouldCollectCashOnDelivery()
            ? max(0, round((float) ($order->total_price ?? 0), 2))
            : 0.0;
    }

    private function recordedOrderShippingCost(Order $order): float
    {
        $shipment = $order->activeShipment;
        if ($shipment instanceof Shipment) {
            return round(
                (float) ($shipment->shipping_cost ?? 0)
                + (float) ($shipment->service_fee ?? 0)
                + (float) ($shipment->insurance_fee ?? 0)
                + (float) ($shipment->other_fee ?? 0)
                + (float) ($shipment->return_fee ?? 0),
                2
            );
        }

        return round(
            (float) ($order->internal_shipping_fee ?? 0)
            + (float) ($order->shipping_fee ?? 0),
            2
        );
    }

    private function debtAssetTotals(int $accountId): array
    {
        if (!Schema::hasTable('debt_subjects')) {
            return ['payable' => 0, 'subject_count' => 0];
        }

        $subjects = DebtSubject::query()
            ->where('account_id', $accountId)
            ->with(['transactions:id,debt_subject_id,type,amount'])
            ->get(['id', 'initial_debt']);

        $payable = $subjects->sum(function (DebtSubject $subject) {
            $borrowSum = $subject->transactions->where('type', 'borrow')->sum('amount');
            $payPrincipalSum = $subject->transactions->where('type', 'pay_principal')->sum('amount');

            return (float) ($subject->initial_debt ?? 0) + (float) $borrowSum - (float) $payPrincipalSum;
        });

        return [
            'payable' => round(max(0, (float) $payable), 2),
            'subject_count' => $subjects->count(),
        ];
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
