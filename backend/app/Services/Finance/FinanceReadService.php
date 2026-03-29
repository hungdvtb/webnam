<?php

namespace App\Services\Finance;

use App\Models\FinanceCatalog;
use App\Models\FinanceChangeLog;
use App\Models\FinanceDailyProfitConfigVersion;
use App\Models\FinanceFixedExpense;
use App\Models\FinanceFixedExpenseVersion;
use App\Models\FinanceLoan;
use App\Models\FinanceLoanPayment;
use App\Models\FinanceTransaction;
use App\Models\FinanceTransfer;
use App\Models\FinanceWallet;
use App\Models\InventoryDocument;
use App\Models\Order;
use App\Models\Product;
use App\Models\Shipment;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

class FinanceReadService
{
    public function __construct(
        private readonly FinanceService $financeService,
    ) {
    }

    public function dashboard(int $accountId, array $filters = []): array
    {
        $this->financeService->ensureDefaults($accountId);
        [$from, $to] = $this->financeService->resolveDateRange($filters, 30);

        $confirmedTransactions = FinanceTransaction::query()
            ->where('account_id', $accountId)
            ->where('status', 'confirmed')
            ->whereBetween('transaction_date', [$from, $to]);

        $totalIncome = (float) (clone $confirmedTransactions)
            ->where('direction', 'in')
            ->whereNotIn('transaction_type', ['transfer_in'])
            ->sum('amount');

        $totalExpense = (float) (clone $confirmedTransactions)
            ->where('direction', 'out')
            ->whereNotIn('transaction_type', ['transfer_out'])
            ->sum('amount');

        $profitLossBase = (float) (clone $confirmedTransactions)
            ->where('affects_profit_loss', true)
            ->where(function (Builder $builder) {
                $builder
                    ->whereNull('transaction_type')
                    ->orWhere('transaction_type', '!=', 'fixed_expense');
            })
            ->selectRaw("COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE amount * -1 END), 0) AS total")
            ->value('total');

        $loanInterestIncome = (float) FinanceLoanPayment::query()
            ->where('account_id', $accountId)
            ->where('status', 'confirmed')
            ->whereBetween('payment_date', [$from, $to])
            ->whereHas('loan', fn (Builder $builder) => $builder->where('type', 'lent'))
            ->sum('interest_amount');

        $loanInterestExpense = (float) FinanceLoanPayment::query()
            ->where('account_id', $accountId)
            ->where('status', 'confirmed')
            ->whereBetween('payment_date', [$from, $to])
            ->whereHas('loan', fn (Builder $builder) => $builder->where('type', 'borrowed'))
            ->sum('interest_amount');

        $cashBalance = (float) FinanceWallet::query()
            ->where('account_id', $accountId)
            ->where('type', 'cash')
            ->where('is_active', true)
            ->sum('current_balance');

        $bankBalance = (float) FinanceWallet::query()
            ->where('account_id', $accountId)
            ->where('type', 'bank')
            ->where('is_active', true)
            ->sum('current_balance');

        $inventoryValue = (float) Product::query()
            ->where('account_id', $accountId)
            ->selectRaw('COALESCE(SUM(stock_quantity * COALESCE(cost_price, expected_cost, 0)), 0) AS total_value')
            ->value('total_value');

        $outstandingOrders = $this->financeService->outstandingOrdersQuery($accountId)
            ->get()
            ->sum(fn ($order) => (float) $order->outstanding_amount);

        $pendingIncome = (float) FinanceTransaction::query()
            ->where('account_id', $accountId)
            ->where('status', 'pending')
            ->where('direction', 'in')
            ->whereNotIn('transaction_type', ['transfer_in'])
            ->sum('amount');

        $pendingExpense = (float) FinanceTransaction::query()
            ->where('account_id', $accountId)
            ->where('status', 'pending')
            ->where('direction', 'out')
            ->whereNotIn('transaction_type', ['transfer_out'])
            ->sum('amount');

        $loanLiability = (float) FinanceLoan::query()
            ->where('account_id', $accountId)
            ->where('type', 'borrowed')
            ->whereIn('status', ['active', 'overdue'])
            ->get()
            ->sum(fn (FinanceLoan $loan) => $loan->outstanding_principal);

        $loanReceivable = (float) FinanceLoan::query()
            ->where('account_id', $accountId)
            ->where('type', 'lent')
            ->whereIn('status', ['active', 'overdue'])
            ->get()
            ->sum(fn (FinanceLoan $loan) => $loan->outstanding_principal);

        $fixedExpenseSeries = $this->financeService->fixedExpenseDailySeries($accountId, $from, $to);
        $allocatedFixedExpense = (float) $fixedExpenseSeries->sum('daily_amount');
        $currentFixedExpense = $this->financeService->fixedExpenseByDate($accountId, $to);

        return [
            'filters' => [
                'date_from' => $from->toDateString(),
                'date_to' => $to->toDateString(),
            ],
            'summary' => [
                'total_income' => round($totalIncome, 2),
                'total_expense' => round($totalExpense, 2),
                'cash_balance' => round($cashBalance, 2),
                'bank_balance' => round($bankBalance, 2),
                'inventory_value' => round($inventoryValue, 2),
                'money_coming_soon' => round($outstandingOrders + $pendingIncome, 2),
                'total_assets' => round($cashBalance + $bankBalance + $inventoryValue + $outstandingOrders + $pendingIncome, 2),
                'receivables' => round($outstandingOrders + $pendingIncome, 2),
                'payables' => round($pendingExpense, 2),
                'net_debt' => round($outstandingOrders + $pendingIncome - $pendingExpense, 2),
                'loan_liability' => round($loanLiability, 2),
                'loan_receivable' => round($loanReceivable, 2),
                'fixed_expense_allocated' => round($allocatedFixedExpense, 2),
                'fixed_expense_daily' => round((float) ($currentFixedExpense['daily_amount'] ?? 0), 2),
                'profit_loss' => round($profitLossBase + $loanInterestIncome - $loanInterestExpense - $allocatedFixedExpense, 2),
            ],
            'wallets' => FinanceWallet::query()
                ->where('account_id', $accountId)
                ->where('is_active', true)
                ->orderByRaw("CASE WHEN type = 'cash' THEN 0 ELSE 1 END")
                ->orderBy('sort_order')
                ->orderBy('name')
                ->get()
                ->map(fn (FinanceWallet $wallet) => $this->financeService->walletPayload($wallet, $from, $to))
                ->values(),
            'due_fixed_expenses' => $this->financeService->currentFixedExpenseRows($accountId)
                ->take(8)
                ->map(fn (FinanceFixedExpense $expense) => $this->financeService->fixedExpensePayload($expense))
                ->values(),
            'fixed_expense_version' => $currentFixedExpense,
            'recent_transactions' => FinanceTransaction::query()
                ->with(['wallet', 'category', 'creator'])
                ->where('account_id', $accountId)
                ->orderByDesc('transaction_date')
                ->limit(10)
                ->get()
                ->map(fn (FinanceTransaction $transaction) => $this->financeService->transactionPayload($transaction))
                ->values(),
            'activity_logs' => FinanceChangeLog::query()
                ->with('user:id,name')
                ->where('account_id', $accountId)
                ->orderByDesc('created_at')
                ->limit(10)
                ->get()
                ->map(function (FinanceChangeLog $log) {
                    return [
                        'id' => $log->id,
                        'action' => $log->action,
                        'subject_type' => $log->subject_type,
                        'subject_id' => $log->subject_id,
                        'created_at' => optional($log->created_at)->toIso8601String(),
                        'user_name' => $log->user?->name,
                        'after_data' => $log->after_data,
                    ];
                })
                ->values(),
            'outstanding_orders' => $this->financeService->outstandingOrdersQuery($accountId)
                ->orderByDesc('orders.created_at')
                ->limit(8)
                ->get()
                ->map(function ($order) {
                    return [
                        'id' => (int) $order->id,
                        'order_number' => $order->order_number,
                        'customer_name' => $order->customer_name,
                        'status' => $order->status,
                        'total_price' => round((float) $order->total_price, 2),
                        'paid_amount' => round((float) $order->paid_amount, 2),
                        'outstanding_amount' => round((float) $order->outstanding_amount, 2),
                        'created_at' => optional($order->created_at)->toIso8601String(),
                    ];
                })
                ->values(),
        ];
    }

    public function options(int $accountId): array
    {
        $this->financeService->ensureDefaults($accountId);

        return [
            'catalogs' => FinanceCatalog::query()
                ->where('account_id', $accountId)
                ->orderBy('group_key')
                ->orderBy('sort_order')
                ->orderBy('name')
                ->get()
                ->groupBy('group_key')
                ->map(fn (Collection $items) => $items->map(fn (FinanceCatalog $catalog) => $this->financeService->catalogPayload($catalog))->values()),
            'wallets' => FinanceWallet::query()
                ->where('account_id', $accountId)
                ->orderByRaw("CASE WHEN type = 'cash' THEN 0 ELSE 1 END")
                ->orderBy('sort_order')
                ->orderBy('name')
                ->get()
                ->map(fn (FinanceWallet $wallet) => $this->financeService->walletPayload($wallet))
                ->values(),
            'recent_orders' => Order::query()
                ->where('account_id', $accountId)
                ->whereNull('deleted_at')
                ->orderByDesc('created_at')
                ->limit(50)
                ->get(['id', 'order_number', 'customer_name', 'status', 'total_price', 'created_at'])
                ->map(function (Order $order) {
                    return [
                        'id' => $order->id,
                        'order_number' => $order->order_number,
                        'customer_name' => $order->customer_name,
                        'status' => $order->status,
                        'total_price' => round((float) $order->total_price, 2),
                        'created_at' => optional($order->created_at)->toIso8601String(),
                    ];
                })
                ->values(),
            'recent_loans' => FinanceLoan::query()
                ->where('account_id', $accountId)
                ->orderByDesc('created_at')
                ->limit(50)
                ->get()
                ->map(fn (FinanceLoan $loan) => $this->financeService->loanPayload($loan))
                ->values(),
        ];
    }

    public function receiptVoucherBootstrap(int $accountId): array
    {
        $this->financeService->ensureDefaults($accountId);

        return [
            'statuses' => $this->financeService->receiptVoucherStatusOptions(),
            'payment_methods' => $this->financeService->receiptVoucherPaymentMethodOptions(),
            'reference_types' => $this->financeService->receiptVoucherReferenceTypeOptions(),
            'receipt_types' => FinanceCatalog::query()
                ->where('account_id', $accountId)
                ->where('group_key', 'income_type')
                ->where('is_active', true)
                ->orderBy('sort_order')
                ->orderBy('name')
                ->get()
                ->map(fn (FinanceCatalog $catalog) => $this->financeService->catalogPayload($catalog))
                ->values(),
            'wallets' => FinanceWallet::query()
                ->where('account_id', $accountId)
                ->where('is_active', true)
                ->orderByRaw("CASE WHEN type = 'cash' THEN 0 ELSE 1 END")
                ->orderBy('sort_order')
                ->orderBy('name')
                ->get()
                ->map(fn (FinanceWallet $wallet) => $this->financeService->walletPayload($wallet))
                ->values(),
            'recent_orders' => Order::query()
                ->where('account_id', $accountId)
                ->whereNull('deleted_at')
                ->orderByDesc('created_at')
                ->limit(80)
                ->get(['id', 'order_number', 'customer_name', 'customer_phone', 'status', 'total_price', 'created_at'])
                ->map(function (Order $order) {
                    return [
                        'id' => (int) $order->id,
                        'code' => $order->order_number,
                        'customer_name' => $order->customer_name,
                        'customer_phone' => $order->customer_phone,
                        'status' => $order->status,
                        'amount' => round((float) $order->total_price, 2),
                        'created_at' => optional($order->created_at)->toIso8601String(),
                    ];
                })
                ->values(),
            'recent_shipments' => Shipment::query()
                ->where('account_id', $accountId)
                ->whereNull('deleted_at')
                ->orderByDesc('created_at')
                ->limit(80)
                ->get([
                    'id',
                    'shipment_number',
                    'tracking_number',
                    'carrier_tracking_code',
                    'customer_name',
                    'customer_phone',
                    'shipment_status',
                    'cod_amount',
                    'created_at',
                ])
                ->map(function (Shipment $shipment) {
                    return [
                        'id' => (int) $shipment->id,
                        'code' => $shipment->carrier_tracking_code ?: $shipment->tracking_number ?: $shipment->shipment_number,
                        'customer_name' => $shipment->customer_name,
                        'customer_phone' => $shipment->customer_phone,
                        'status' => $shipment->shipment_status,
                        'amount' => round((float) $shipment->cod_amount, 2),
                        'created_at' => optional($shipment->created_at)->toIso8601String(),
                    ];
                })
                ->values(),
            'recent_return_documents' => InventoryDocument::query()
                ->where('account_id', $accountId)
                ->where('type', 'return')
                ->orderByDesc('document_date')
                ->orderByDesc('id')
                ->limit(60)
                ->get(['id', 'document_number', 'status', 'document_date', 'reference_type', 'reference_id', 'notes'])
                ->map(function (InventoryDocument $document) {
                    return [
                        'id' => (int) $document->id,
                        'code' => $document->document_number,
                        'status' => $document->status,
                        'document_date' => optional($document->document_date)->toDateString(),
                        'reference_type' => $document->reference_type,
                        'reference_id' => $document->reference_id,
                        'notes' => $document->notes,
                    ];
                })
                ->values(),
        ];
    }

    public function paginatedTransactions(int $accountId, array $filters = []): array
    {
        $this->financeService->ensureDefaults($accountId);

        $query = FinanceTransaction::query()
            ->with(['wallet:id,name,type,bank_name', 'category:id,name,color,group_key', 'creator:id,name'])
            ->where('account_id', $accountId);

        $this->applyTransactionFilters($query, $filters, $accountId);

        $page = $query
            ->orderByDesc('transaction_date')
            ->orderByDesc('id')
            ->paginate($this->financeService->resolvePerPage($filters, 20, 100));

        $summaryQuery = FinanceTransaction::query()->where('account_id', $accountId);
        $this->applyTransactionFilters($summaryQuery, $filters, $accountId);

        return [
            ...$page->toArray(),
            'data' => collect($page->items())->map(fn (FinanceTransaction $transaction) => $this->financeService->transactionPayload($transaction))->values(),
            'summary' => [
                'total_records' => (int) (clone $summaryQuery)->count(),
                'total_in' => round((float) (clone $summaryQuery)->where('direction', 'in')->sum('amount'), 2),
                'total_out' => round((float) (clone $summaryQuery)->where('direction', 'out')->sum('amount'), 2),
                'confirmed_net' => round((float) (clone $summaryQuery)
                    ->where('status', 'confirmed')
                    ->selectRaw("COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE amount * -1 END), 0) AS total")
                    ->value('total'), 2),
            ],
        ];
    }

    public function paginatedReceiptVouchers(int $accountId, array $filters = []): array
    {
        $this->financeService->ensureDefaults($accountId);

        $query = FinanceTransaction::query()
            ->with(['wallet:id,name,type,bank_name', 'category:id,name,color,group_key', 'creator:id,name'])
            ->where('account_id', $accountId)
            ->receiptVouchers();

        $this->applyReceiptVoucherFilters($query, $filters);

        $page = $query
            ->orderByDesc('transaction_date')
            ->orderByDesc('id')
            ->paginate($this->financeService->resolvePerPage($filters, 20, 100));

        $summaryQuery = FinanceTransaction::query()
            ->where('account_id', $accountId)
            ->receiptVouchers();

        $this->applyReceiptVoucherFilters($summaryQuery, $filters);

        $confirmedSummaryQuery = (clone $summaryQuery)->where('status', 'confirmed');
        $groupRows = (clone $confirmedSummaryQuery)
            ->selectRaw('category_id, COUNT(*) AS total_count, COALESCE(SUM(amount), 0) AS total_amount')
            ->groupBy('category_id')
            ->get();
        $groupCategories = FinanceCatalog::query()
            ->whereIn('id', $groupRows->pluck('category_id')->filter()->values())
            ->get()
            ->keyBy('id');

        return [
            ...$page->toArray(),
            'data' => collect($page->items())
                ->map(fn (FinanceTransaction $transaction) => $this->financeService->receiptVoucherPayload($transaction))
                ->values(),
            'summary' => [
                'total_records' => (int) (clone $summaryQuery)->count(),
                'confirmed_count' => (int) (clone $summaryQuery)->where('status', 'confirmed')->count(),
                'draft_count' => (int) (clone $summaryQuery)->where('status', 'draft')->count(),
                'cancelled_count' => (int) (clone $summaryQuery)->where('status', 'cancelled')->count(),
                'trash_count' => (int) FinanceTransaction::query()
                    ->where('account_id', $accountId)
                    ->receiptVouchers()
                    ->onlyTrashed()
                    ->count(),
                'total_amount' => round((float) (clone $confirmedSummaryQuery)->sum('amount'), 2),
                'cash_amount' => round((float) (clone $confirmedSummaryQuery)->where('payment_method', 'cash')->sum('amount'), 2),
                'bank_transfer_amount' => round((float) (clone $confirmedSummaryQuery)->where('payment_method', 'bank_transfer')->sum('amount'), 2),
                'cod_amount' => round((float) (clone $confirmedSummaryQuery)->where('payment_method', 'cod')->sum('amount'), 2),
                'main_groups' => $groupRows
                    ->map(function ($row) use ($groupCategories) {
                        $category = $row->category_id ? $groupCategories->get((int) $row->category_id) : null;

                        return [
                            'category_id' => $row->category_id ? (int) $row->category_id : null,
                            'category_name' => $category?->name ?? 'Chua phan loai',
                            'category_color' => $category?->color,
                            'total_count' => (int) $row->total_count,
                            'total_amount' => round((float) $row->total_amount, 2),
                        ];
                    })
                    ->sortByDesc('total_amount')
                    ->values(),
            ],
        ];
    }

    public function wallets(int $accountId, array $filters = []): array
    {
        $this->financeService->ensureDefaults($accountId);
        [$from, $to] = $this->financeService->resolveDateRange($filters, 30);

        $wallets = FinanceWallet::query()
            ->where('account_id', $accountId)
            ->when(!($filters['include_inactive'] ?? false), fn (Builder $query) => $query->where('is_active', true))
            ->orderByRaw("CASE WHEN type = 'cash' THEN 0 ELSE 1 END")
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get()
            ->map(fn (FinanceWallet $wallet) => $this->financeService->walletPayload($wallet, $from, $to))
            ->values();

        return [
            'summary' => [
                'cash_total' => round((float) $wallets->where('type', 'cash')->sum('current_balance'), 2),
                'bank_total' => round((float) $wallets->where('type', 'bank')->sum('current_balance'), 2),
                'wallet_count' => $wallets->count(),
            ],
            'data' => $wallets,
        ];
    }

    public function walletLedger(FinanceWallet $wallet, array $filters = []): array
    {
        [$from, $to] = $this->financeService->resolveDateRange($filters, 30);

        $transactions = FinanceTransaction::query()
            ->with(['category:id,name,color', 'creator:id,name'])
            ->where('account_id', $wallet->account_id)
            ->where('wallet_id', $wallet->id)
            ->whereBetween('transaction_date', [$from, $to])
            ->when(!empty($filters['status']), fn (Builder $query) => $query->where('status', $filters['status']))
            ->orderBy('transaction_date')
            ->orderBy('id')
            ->get();

        $opening = round($this->financeService->walletOpeningBalance($wallet, $from), 2);
        $running = $opening;

        return [
            'wallet' => $this->financeService->walletPayload($wallet, $from, $to),
            'summary' => [
                'opening_balance' => $opening,
                'period_inflow' => round((float) $transactions->where('status', 'confirmed')->where('direction', 'in')->sum('amount'), 2),
                'period_outflow' => round((float) $transactions->where('status', 'confirmed')->where('direction', 'out')->sum('amount'), 2),
                'closing_balance' => round(
                    $opening
                    + (float) $transactions->where('status', 'confirmed')->where('direction', 'in')->sum('amount')
                    - (float) $transactions->where('status', 'confirmed')->where('direction', 'out')->sum('amount'),
                    2
                ),
            ],
            'data' => $transactions->map(function (FinanceTransaction $transaction) use (&$running) {
                if ($transaction->status === 'confirmed') {
                    $running += $transaction->signed_amount;
                }

                return [
                    ...$this->financeService->transactionPayload($transaction),
                    'running_balance' => round($running, 2),
                ];
            })->values(),
        ];
    }

    public function paginatedTransfers(int $accountId, array $filters = []): array
    {
        $query = FinanceTransfer::query()
            ->with(['fromWallet:id,name,type,bank_name', 'toWallet:id,name,type,bank_name'])
            ->where('account_id', $accountId);

        if (!empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (!empty($filters['wallet_id'])) {
            $walletId = (int) $filters['wallet_id'];
            $query->where(fn (Builder $builder) => $builder->where('from_wallet_id', $walletId)->orWhere('to_wallet_id', $walletId));
        }
        if (!empty($filters['date_from'])) {
            $query->whereDate('transfer_date', '>=', $filters['date_from']);
        }
        if (!empty($filters['date_to'])) {
            $query->whereDate('transfer_date', '<=', $filters['date_to']);
        }

        $page = $query->orderByDesc('transfer_date')->paginate($this->financeService->resolvePerPage($filters, 20, 100));

        return [
            ...$page->toArray(),
            'data' => collect($page->items())->map(fn (FinanceTransfer $transfer) => $this->financeService->transferPayload($transfer))->values(),
        ];
    }

    public function paginatedLoans(int $accountId, array $filters = []): array
    {
        $query = FinanceLoan::query()
            ->with([
                'wallet:id,name,type,bank_name',
                'payments' => fn ($builder) => $builder->with(['wallet:id,name,type,bank_name'])->limit(10),
            ])
            ->where('account_id', $accountId);

        if (!empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (!empty($filters['type'])) {
            $query->where('type', $filters['type']);
        }
        if (!empty($filters['search'])) {
            $search = trim((string) $filters['search']);
            $query->where(function (Builder $builder) use ($search) {
                $builder
                    ->where('code', 'like', '%' . $search . '%')
                    ->orWhere('counterparty_name', 'like', '%' . $search . '%')
                    ->orWhere('counterparty_contact', 'like', '%' . $search . '%');
            });
        }

        $page = $query->orderByDesc('start_date')->orderByDesc('id')->paginate($this->financeService->resolvePerPage($filters, 20, 100));
        $summaryRows = FinanceLoan::query()->where('account_id', $accountId)->get();

        return [
            ...$page->toArray(),
            'data' => collect($page->items())->map(fn (FinanceLoan $loan) => $this->financeService->loanPayload($loan))->values(),
            'summary' => [
                'borrowed_outstanding' => round((float) $summaryRows->where('type', 'borrowed')->sum('outstanding_principal'), 2),
                'lent_outstanding' => round((float) $summaryRows->where('type', 'lent')->sum('outstanding_principal'), 2),
                'active_count' => $summaryRows->whereIn('status', ['active', 'overdue'])->count(),
            ],
        ];
    }

    public function fixedExpenses(int $accountId, array $filters = []): array
    {
        $requestedDate = !empty($filters['date'])
            ? Carbon::parse($filters['date'])
            : now();

        $currentVersion = $this->financeService->fixedExpenseByDate($accountId, $requestedDate);
        $rows = collect($currentVersion['items'] ?? [])
            ->filter(function (array $item) use ($filters) {
                if (empty($filters['search'])) {
                    return true;
                }

                $search = mb_strtolower(trim((string) $filters['search']));
                $content = mb_strtolower((string) ($item['content'] ?? ''));

                return $search === '' || str_contains($content, $search);
            })
            ->values();
        $history = FinanceFixedExpenseVersion::query()
            ->with('creator:id,name')
            ->where('account_id', $accountId)
            ->orderByDesc('effective_date')
            ->orderByDesc('id')
            ->limit(20)
            ->get();

        return [
            'date' => $requestedDate->toDateString(),
            'rows' => $rows,
            'current_version' => $currentVersion,
            'history' => $history->map(fn (FinanceFixedExpenseVersion $version) => $this->financeService->fixedExpenseVersionPayload($version))->values(),
            'summary' => [
                'row_count' => $rows->count(),
                'total_monthly_amount' => round((float) ($currentVersion['total_monthly_amount'] ?? 0), 2),
                'daily_amount' => round((float) ($currentVersion['daily_amount'] ?? 0), 2),
                'days_in_month' => (int) ($currentVersion['days_in_month'] ?? $requestedDate->daysInMonth),
                'day_calculation_mode' => $currentVersion['day_calculation_mode'] ?? $this->financeService->resolveFixedExpenseCalculationMode(null),
                'day_calculation_label' => $currentVersion['day_calculation_label'] ?? $this->financeService->fixedExpenseCalculationModeLabel(
                    $this->financeService->resolveFixedExpenseCalculationMode(null)
                ),
            ],
        ];
    }

    public function catalogs(int $accountId, array $filters = []): array
    {
        $this->financeService->ensureDefaults($accountId);

        $query = FinanceCatalog::query()->where('account_id', $accountId);

        if (!empty($filters['group_key'])) {
            $query->where('group_key', $filters['group_key']);
        }
        if (array_key_exists('is_active', $filters) && $filters['is_active'] !== '') {
            $query->where('is_active', (bool) $filters['is_active']);
        }

        return [
            'data' => $query
                ->orderBy('group_key')
                ->orderBy('sort_order')
                ->orderBy('name')
                ->get()
                ->map(fn (FinanceCatalog $catalog) => $this->financeService->catalogPayload($catalog))
                ->values(),
            'groups' => collect($this->financeService->catalogGroupLabels()),
        ];
    }

    public function dailyProfitTable(int $accountId, array $filters = []): array
    {
        [$from, $to] = $this->financeService->resolveDateRange($filters, 30);

        $orders = Order::query()
            ->where('account_id', $accountId)
            ->whereBetween('created_at', [$from, $to])
            ->orderBy('created_at')
            ->get([
                'id',
                'order_type',
                'total_price',
                'cost_total',
                'status',
                'created_at',
                'report_revenue_total',
                'report_cost_total',
            ]);

        $ordersByDate = $orders
            ->filter(fn (Order $order) => !in_array(mb_strtolower((string) $order->status), ['cancelled', 'canceled'], true))
            ->groupBy(fn (Order $order) => optional($order->created_at)->toDateString());

        $fixedExpenseByDate = $this->financeService
            ->fixedExpenseDailySeries($accountId, $from, $to)
            ->keyBy('date');

        $configByDate = $this->financeService
            ->dailyProfitConfigSeries($accountId, $from, $to)
            ->keyBy('date');

        $rows = collect();
        $cursor = $from->copy()->startOfDay();

        while ($cursor <= $to) {
            $dateKey = $cursor->toDateString();
            $dayOrders = $ordersByDate->get($dateKey, collect());
            $config = $configByDate->get($dateKey, $this->financeService->dailyProfitConfigByDate($accountId, $cursor));
            $fixedExpenseRow = $fixedExpenseByDate->get($dateKey, [
                'daily_amount' => 0,
                'effective_date' => null,
            ]);

            $revenue = round((float) $dayOrders->sum(
                fn (Order $order) => (float) (
                    $order->getNormalizedOrderType() === Order::TYPE_STANDARD
                        ? ($order->total_price ?? 0)
                        : ($order->report_revenue_total ?? 0)
                )
            ), 2);
            $orderCount = (int) $dayOrders->count();
            $costGoods = round((float) $dayOrders->sum(
                fn (Order $order) => (float) (
                    $order->getNormalizedOrderType() === Order::TYPE_STANDARD
                        ? ($order->cost_total ?? 0)
                        : ($order->report_cost_total ?? 0)
                )
            ), 2);
            $returnFactor = max(0, 1 - ((float) ($config['return_rate'] ?? 0) / 100));
            $revenueActual = round($revenue * $returnFactor, 2);
            $costGoodsActual = round($costGoods * $returnFactor, 2);
            $shippingCost = ($config['shipping_calculation_mode'] ?? 'fixed_per_order') === 'revenue_percent'
                ? round($revenue * ((float) ($config['shipping_cost_rate'] ?? 0) / 100), 2)
                : round($orderCount * (float) ($config['shipping_cost_per_order'] ?? 0), 2);
            $packagingCost = round($orderCount * (float) ($config['packaging_cost_per_order'] ?? 0), 2);
            $salaryCost = 0.0;
            $facebookAdsCost = 0.0;
            $taxCost = round(($revenueActual - $shippingCost) * ((float) ($config['tax_rate'] ?? 1.5) / 100), 2);
            $fixedExpenseCost = round((float) ($fixedExpenseRow['daily_amount'] ?? 0), 2);
            $profit = round(
                $revenueActual
                - $costGoodsActual
                - $shippingCost
                - $packagingCost
                - $salaryCost
                - $facebookAdsCost
                - $taxCost
                - $fixedExpenseCost,
                2
            );

            $rows->push([
                'date' => $dateKey,
                'label' => $cursor->locale('vi')->translatedFormat('d/m/Y'),
                'revenue' => $revenue,
                'revenue_actual' => $revenueActual,
                'order_count' => $orderCount,
                'cost_goods' => $costGoods,
                'cost_goods_actual' => $costGoodsActual,
                'shipping_cost' => $shippingCost,
                'packaging_cost' => $packagingCost,
                'salary_cost' => $salaryCost,
                'facebook_ads_cost' => $facebookAdsCost,
                'tax_cost' => $taxCost,
                'fixed_expense_cost' => $fixedExpenseCost,
                'profit' => $profit,
                'profit_per_order' => $orderCount > 0 ? round($profit / $orderCount, 2) : 0,
                'cost_goods_ratio' => $revenueActual > 0 ? round($costGoodsActual / $revenueActual, 6) : 0,
                'ads_ratio' => $revenueActual > 0 ? round($facebookAdsCost / $revenueActual, 6) : 0,
                'shipping_ratio' => $revenueActual > 0 ? round($shippingCost / $revenueActual, 6) : 0,
                'config_effective_date' => $config['effective_date'],
                'fixed_expense_effective_date' => $fixedExpenseRow['effective_date'] ?? null,
                'return_rate' => round((float) ($config['return_rate'] ?? 0), 4),
                'packaging_cost_per_order' => round((float) ($config['packaging_cost_per_order'] ?? 0), 2),
                'shipping_calculation_mode' => $config['shipping_calculation_mode'] ?? 'fixed_per_order',
                'shipping_calculation_label' => $config['shipping_calculation_label'] ?? $this->financeService->dailyProfitShippingModeLabel('fixed_per_order'),
                'shipping_cost_per_order' => round((float) ($config['shipping_cost_per_order'] ?? 0), 2),
                'shipping_cost_rate' => round((float) ($config['shipping_cost_rate'] ?? 0), 4),
                'tax_rate' => round((float) ($config['tax_rate'] ?? 1.5), 4),
            ]);

            $cursor->addDay();
        }

        $totals = [
            'label' => 'Tổng',
            'revenue' => round((float) $rows->sum('revenue'), 2),
            'revenue_actual' => round((float) $rows->sum('revenue_actual'), 2),
            'order_count' => (int) $rows->sum('order_count'),
            'cost_goods' => round((float) $rows->sum('cost_goods'), 2),
            'cost_goods_actual' => round((float) $rows->sum('cost_goods_actual'), 2),
            'shipping_cost' => round((float) $rows->sum('shipping_cost'), 2),
            'packaging_cost' => round((float) $rows->sum('packaging_cost'), 2),
            'salary_cost' => round((float) $rows->sum('salary_cost'), 2),
            'facebook_ads_cost' => round((float) $rows->sum('facebook_ads_cost'), 2),
            'tax_cost' => round((float) $rows->sum('tax_cost'), 2),
            'fixed_expense_cost' => round((float) $rows->sum('fixed_expense_cost'), 2),
            'profit' => round((float) $rows->sum('profit'), 2),
        ];
        $totals['profit_per_order'] = $totals['order_count'] > 0 ? round($totals['profit'] / $totals['order_count'], 2) : 0;
        $totals['cost_goods_ratio'] = $totals['revenue_actual'] > 0 ? round($totals['cost_goods_actual'] / $totals['revenue_actual'], 6) : 0;
        $totals['ads_ratio'] = $totals['revenue_actual'] > 0 ? round($totals['facebook_ads_cost'] / $totals['revenue_actual'], 6) : 0;
        $totals['shipping_ratio'] = $totals['revenue_actual'] > 0 ? round($totals['shipping_cost'] / $totals['revenue_actual'], 6) : 0;

        $history = FinanceDailyProfitConfigVersion::query()
            ->with('creator:id,name')
            ->where('account_id', $accountId)
            ->orderByDesc('effective_date')
            ->orderByDesc('id')
            ->limit(20)
            ->get();

        return [
            'filters' => [
                'date_from' => $from->toDateString(),
                'date_to' => $to->toDateString(),
            ],
            'current_config' => $this->financeService->dailyProfitConfigByDate($accountId, $to),
            'config_history' => $history->map(fn (FinanceDailyProfitConfigVersion $version) => $this->financeService->dailyProfitConfigPayload($version))->values(),
            'rows' => $rows->values(),
            'totals' => $totals,
        ];
    }

    public function reports(int $accountId, array $filters = []): array
    {
        [$from, $to] = $this->financeService->resolveDateRange($filters, 90);
        $dashboard = $this->dashboard($accountId, $filters);

        $transactions = FinanceTransaction::query()
            ->with(['category:id,name,color,group_key', 'wallet:id,name,type,bank_name'])
            ->where('account_id', $accountId)
            ->where('status', 'confirmed')
            ->whereBetween('transaction_date', [$from, $to])
            ->orderBy('transaction_date')
            ->get();

        $loanPayments = FinanceLoanPayment::query()
            ->with('loan:id,type')
            ->where('account_id', $accountId)
            ->where('status', 'confirmed')
            ->whereBetween('payment_date', [$from, $to])
            ->get();

        $fixedExpenseSeries = $this->financeService->fixedExpenseDailySeries($accountId, $from, $to);
        $fixedExpenseByDate = $fixedExpenseSeries->keyBy('date');
        $loanPaymentsByDate = $loanPayments->groupBy(fn (FinanceLoanPayment $payment) => optional($payment->payment_date)->toDateString());

        $monthlyCashFlow = collect();
        $monthCursor = $from->copy()->startOfMonth();
        $monthEnd = $to->copy()->startOfMonth();

        while ($monthCursor <= $monthEnd) {
            $monthKey = $monthCursor->format('Y-m');
            $monthRows = $transactions->filter(fn (FinanceTransaction $transaction) => $transaction->transaction_date?->format('Y-m') === $monthKey);
            $monthLoanPayments = $loanPayments->filter(fn (FinanceLoanPayment $payment) => $payment->payment_date?->format('Y-m') === $monthKey);
            $monthFixedExpense = (float) $fixedExpenseSeries
                ->filter(fn (array $row) => str_starts_with($row['date'], $monthKey))
                ->sum('daily_amount');
            $income = (float) $monthRows->where('direction', 'in')->whereNotIn('transaction_type', ['transfer_in'])->sum('amount');
            $expense = (float) $monthRows->where('direction', 'out')->whereNotIn('transaction_type', ['transfer_out'])->sum('amount');
            $profitBase = (float) $monthRows
                ->where('affects_profit_loss', true)
                ->filter(fn (FinanceTransaction $transaction) => $transaction->transaction_type !== 'fixed_expense')
                ->sum('signed_amount');
            $loanInterestIncome = (float) $monthLoanPayments
                ->filter(fn (FinanceLoanPayment $payment) => $payment->loan?->type === 'lent')
                ->sum('interest_amount');
            $loanInterestExpense = (float) $monthLoanPayments
                ->filter(fn (FinanceLoanPayment $payment) => $payment->loan?->type === 'borrowed')
                ->sum('interest_amount');

            $monthlyCashFlow->push([
                'month' => $monthKey,
                'label' => $monthCursor->locale('vi')->translatedFormat('m/Y'),
                'income' => round($income, 2),
                'expense' => round($expense, 2),
                'net' => round($income - $expense, 2),
                'fixed_expense_allocated' => round($monthFixedExpense, 2),
                'profit_after_fixed' => round($profitBase + $loanInterestIncome - $loanInterestExpense - $monthFixedExpense, 2),
            ]);

            $monthCursor->addMonth();
        }

        $dailyProfitLoss = collect();
        $dayCursor = $from->copy()->startOfDay();

        while ($dayCursor <= $to) {
            $dateKey = $dayCursor->toDateString();
            $dayRows = $transactions->filter(fn (FinanceTransaction $transaction) => $transaction->transaction_date?->toDateString() === $dateKey);
            $dayLoanPayments = $loanPaymentsByDate->get($dateKey, collect());
            $fixedExpenseRow = $fixedExpenseByDate->get($dateKey, [
                'daily_amount' => 0,
                'total_monthly_amount' => 0,
                'effective_date' => null,
                'version_id' => null,
            ]);

            $income = (float) $dayRows->where('direction', 'in')->whereNotIn('transaction_type', ['transfer_in'])->sum('amount');
            $expense = (float) $dayRows->where('direction', 'out')->whereNotIn('transaction_type', ['transfer_out'])->sum('amount');
            $profitBase = (float) $dayRows
                ->where('affects_profit_loss', true)
                ->filter(fn (FinanceTransaction $transaction) => $transaction->transaction_type !== 'fixed_expense')
                ->sum('signed_amount');
            $loanInterestIncome = (float) $dayLoanPayments
                ->filter(fn (FinanceLoanPayment $payment) => $payment->loan?->type === 'lent')
                ->sum('interest_amount');
            $loanInterestExpense = (float) $dayLoanPayments
                ->filter(fn (FinanceLoanPayment $payment) => $payment->loan?->type === 'borrowed')
                ->sum('interest_amount');
            $profitBeforeFixed = $profitBase + $loanInterestIncome - $loanInterestExpense;

            $dailyProfitLoss->push([
                'date' => $dateKey,
                'label' => $dayCursor->locale('vi')->translatedFormat('d/m'),
                'income' => round($income, 2),
                'expense' => round($expense, 2),
                'fixed_expense_daily' => round((float) $fixedExpenseRow['daily_amount'], 2),
                'fixed_expense_monthly' => round((float) $fixedExpenseRow['total_monthly_amount'], 2),
                'fixed_expense_effective_date' => $fixedExpenseRow['effective_date'],
                'profit_before_fixed' => round($profitBeforeFixed, 2),
                'profit_after_fixed' => round($profitBeforeFixed - (float) $fixedExpenseRow['daily_amount'], 2),
            ]);

            $dayCursor->addDay();
        }

        return [
            'filters' => [
                'date_from' => $from->toDateString(),
                'date_to' => $to->toDateString(),
            ],
            'summary' => $dashboard['summary'],
            'monthly_cash_flow' => $monthlyCashFlow,
            'daily_profit_loss' => $dailyProfitLoss,
            'fixed_expense_report' => [
                'current' => $this->financeService->fixedExpenseByDate($accountId, $to),
                'allocated_total' => round((float) $fixedExpenseSeries->sum('daily_amount'), 2),
                'daily_series' => $fixedExpenseSeries->values(),
            ],
            'income_by_category' => $this->groupTransactionsByCategory($transactions->where('direction', 'in')->whereNotIn('transaction_type', ['transfer_in'])),
            'expense_by_category' => $this->groupTransactionsByCategory($transactions->where('direction', 'out')->whereNotIn('transaction_type', ['transfer_out'])),
            'wallet_report' => FinanceWallet::query()
                ->where('account_id', $accountId)
                ->where('is_active', true)
                ->orderByRaw("CASE WHEN type = 'cash' THEN 0 ELSE 1 END")
                ->orderBy('sort_order')
                ->orderBy('name')
                ->get()
                ->map(fn (FinanceWallet $wallet) => $this->financeService->walletPayload($wallet, $from, $to))
                ->values(),
            'loan_report' => FinanceLoan::query()
                ->with('payments')
                ->where('account_id', $accountId)
                ->orderByDesc('start_date')
                ->get()
                ->map(fn (FinanceLoan $loan) => $this->financeService->loanPayload($loan))
                ->values(),
            'asset_report' => [
                'inventory_value' => round((float) Product::query()
                    ->where('account_id', $accountId)
                    ->selectRaw('COALESCE(SUM(stock_quantity * COALESCE(cost_price, expected_cost, 0)), 0) AS total')
                    ->value('total'), 2),
                'outstanding_orders' => round((float) $this->financeService->outstandingOrdersQuery($accountId)->get()->sum('outstanding_amount'), 2),
            ],
        ];
    }

    private function applyReceiptVoucherFilters(Builder $query, array $filters): void
    {
        $view = strtolower(trim((string) ($filters['view'] ?? 'active')));

        if ($view === 'trash') {
            $query->onlyTrashed();
        } elseif (!empty($filters['include_deleted'])) {
            $query->withTrashed();
        }

        if (!empty($filters['search'])) {
            $search = trim((string) $filters['search']);
            $query->where(function (Builder $builder) use ($search) {
                $builder
                    ->where('code', 'like', '%' . $search . '%')
                    ->orWhere('counterparty_name', 'like', '%' . $search . '%')
                    ->orWhere('counterparty_phone', 'like', '%' . $search . '%')
                    ->orWhere('source_name', 'like', '%' . $search . '%')
                    ->orWhere('reference_code', 'like', '%' . $search . '%')
                    ->orWhere('reference_label', 'like', '%' . $search . '%')
                    ->orWhere('note', 'like', '%' . $search . '%');
            });
        }

        if (!empty($filters['counterparty_name'])) {
            $query->where('counterparty_name', 'like', '%' . trim((string) $filters['counterparty_name']) . '%');
        }

        if (!empty($filters['counterparty_phone'])) {
            $query->where('counterparty_phone', 'like', '%' . trim((string) $filters['counterparty_phone']) . '%');
        }

        if (!empty($filters['source_name'])) {
            $query->where('source_name', 'like', '%' . trim((string) $filters['source_name']) . '%');
        }

        foreach (['payment_method', 'status', 'reference_type'] as $field) {
            if (!empty($filters[$field])) {
                $query->where($field, $filters[$field]);
            }
        }

        if (!empty($filters['category_id'])) {
            $query->where('category_id', (int) $filters['category_id']);
        }

        if (!empty($filters['date_from'])) {
            $query->whereDate('transaction_date', '>=', $filters['date_from']);
        }

        if (!empty($filters['date_to'])) {
            $query->whereDate('transaction_date', '<=', $filters['date_to']);
        }
    }

    private function applyTransactionFilters(Builder $query, array $filters, int $accountId): void
    {
        if (!empty($filters['include_deleted'])) {
            $query->withTrashed();
        }

        if (!empty($filters['search'])) {
            $search = trim((string) $filters['search']);
            $query->where(function (Builder $builder) use ($search) {
                $builder
                    ->where('code', 'like', '%' . $search . '%')
                    ->orWhere('content', 'like', '%' . $search . '%')
                    ->orWhere('note', 'like', '%' . $search . '%')
                    ->orWhere('counterparty_name', 'like', '%' . $search . '%');
            });
        }

        foreach (['direction', 'status', 'reference_type', 'transaction_type'] as $field) {
            if (!empty($filters[$field])) {
                $query->where($field, $filters[$field]);
            }
        }

        if (!empty($filters['wallet_id'])) {
            $query->where('wallet_id', (int) $filters['wallet_id']);
        }
        if (!empty($filters['category_id'])) {
            $query->where('category_id', (int) $filters['category_id']);
        }
        if (!empty($filters['date_from'])) {
            $query->whereDate('transaction_date', '>=', $filters['date_from']);
        }
        if (!empty($filters['date_to'])) {
            $query->whereDate('transaction_date', '<=', $filters['date_to']);
        }
        if (!empty($filters['pending_orders_only'])) {
            $orderIds = $this->financeService->outstandingOrdersQuery($accountId)->pluck('orders.id');
            $query->where('reference_type', 'order')->whereIn('reference_id', $orderIds);
        }
    }

    private function groupTransactionsByCategory(Collection $transactions): Collection
    {
        return $transactions
            ->groupBy(fn (FinanceTransaction $transaction) => $transaction->category?->name ?? 'Chưa phân loại')
            ->map(function (Collection $items, string $label) {
                $category = $items->first()?->category;

                return [
                    'label' => $label,
                    'color' => $category?->color,
                    'amount' => round((float) $items->sum('amount'), 2),
                ];
            })
            ->values()
            ->sortByDesc('amount')
            ->values();
    }
}
