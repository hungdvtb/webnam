<?php

namespace App\Services\Finance;

use App\Models\FinanceCatalog;
use App\Models\FinanceTransaction;
use App\Models\FinanceTransfer;
use App\Models\FinanceWallet;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

class FinanceCashbookService
{
    public function __construct(
        private readonly FinanceService $financeService,
    ) {
    }

    public function cashbook(int $accountId, array $filters = []): array
    {
        $this->financeService->ensureDefaults($accountId);

        [$from, $to] = $this->resolveDateRange($accountId, $filters);
        $page = max((int) ($filters['page'] ?? 1), 1);
        $perPage = $this->financeService->resolvePerPage($filters, 20, 100);

        $wallets = FinanceWallet::query()
            ->where('account_id', $accountId)
            ->orderByRaw("CASE WHEN type = 'cash' THEN 0 ELSE 1 END")
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get();

        $walletPayloads = $wallets
            ->map(fn (FinanceWallet $wallet) => $this->walletPayload($wallet))
            ->values();

        $activeWallets = $walletPayloads->where('is_active', true)->values();
        $cashWallets = $activeWallets->where('type', 'cash')->values();
        $bankWallets = $activeWallets->where('type', 'bank')->values();

        $transactionQuery = FinanceTransaction::query()
            ->with([
                'wallet:id,name,type,bank_name,account_number,color,is_active,is_default',
                'category:id,name,color,group_key',
                'creator:id,name',
            ])
            ->where('account_id', $accountId)
            ->whereNotIn('transaction_type', ['transfer_in', 'transfer_out']);

        $this->applyTransactionFilters($transactionQuery, $filters, $from, $to);

        $transactions = $transactionQuery
            ->orderByDesc('transaction_date')
            ->orderByDesc('id')
            ->get()
            ->map(fn (FinanceTransaction $transaction) => $this->transactionRow($transaction))
            ->values();

        $transferQuery = FinanceTransfer::query()
            ->with([
                'fromWallet:id,name,type,bank_name,account_number,color,is_active,is_default',
                'toWallet:id,name,type,bank_name,account_number,color,is_active,is_default',
                'creator:id,name',
            ])
            ->where('account_id', $accountId);

        $this->applyTransferFilters($transferQuery, $filters, $from, $to);

        $transfers = $transferQuery
            ->orderByDesc('transfer_date')
            ->orderByDesc('id')
            ->get()
            ->map(fn (FinanceTransfer $transfer) => $this->transferRow($transfer))
            ->values();

        $rows = $transactions
            ->concat($transfers)
            ->sort(function (array $left, array $right) {
                $timeCompare = strcmp((string) ($right['entry_timestamp'] ?? ''), (string) ($left['entry_timestamp'] ?? ''));

                if ($timeCompare !== 0) {
                    return $timeCompare;
                }

                return strcmp((string) ($right['entry_key'] ?? ''), (string) ($left['entry_key'] ?? ''));
            })
            ->values();

        $total = $rows->count();
        $lastPage = max((int) ceil(max($total, 1) / $perPage), 1);
        $currentPage = min($page, $lastPage);
        $pagedRows = $rows->slice(($currentPage - 1) * $perPage, $perPage)->values();

        $categories = FinanceCatalog::query()
            ->where('account_id', $accountId)
            ->whereIn('group_key', ['income_type', 'expense_type'])
            ->where('is_active', true)
            ->orderBy('group_key')
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get()
            ->groupBy('group_key')
            ->map(fn (Collection $items) => $items
                ->map(fn (FinanceCatalog $catalog) => $this->financeService->catalogPayload($catalog))
                ->values()
            );

        $confirmedTransactions = $transactions->where('status', 'confirmed');
        $confirmedTransfers = $transfers->where('status', 'confirmed');

        return [
            'filters' => [
                'date_from' => $from->toDateString(),
                'date_to' => $to->toDateString(),
                'voucher_type' => $this->normalizeVoucherType($filters['voucher_type'] ?? null),
                'wallet_id' => !empty($filters['wallet_id']) ? (int) $filters['wallet_id'] : null,
                'keyword' => trim((string) ($filters['keyword'] ?? '')),
                'page' => $currentPage,
                'per_page' => $perPage,
            ],
            'overview' => [
                'total_current_money' => round((float) $activeWallets->sum('current_balance'), 2),
                'cash_total' => round((float) $cashWallets->sum('current_balance'), 2),
                'bank_total' => round((float) $bankWallets->sum('current_balance'), 2),
                'cash_accounts' => $cashWallets->values(),
                'bank_accounts' => $bankWallets->values(),
            ],
            'options' => [
                'voucher_types' => [
                    ['value' => 'income', 'label' => 'Thu'],
                    ['value' => 'expense', 'label' => 'Chi'],
                    ['value' => 'transfer', 'label' => 'Chuyen quy'],
                ],
                'statuses' => [
                    ['value' => 'confirmed', 'label' => 'Da xac nhan'],
                    ['value' => 'draft', 'label' => 'Nhap'],
                    ['value' => 'pending', 'label' => 'Cho xu ly'],
                    ['value' => 'cancelled', 'label' => 'Da huy'],
                ],
                'wallets' => $walletPayloads,
                'categories' => [
                    'income' => $categories->get('income_type', collect())->values(),
                    'expense' => $categories->get('expense_type', collect())->values(),
                ],
            ],
            'summary' => [
                'total_records' => $total,
                'income_total' => round((float) $confirmedTransactions->where('voucher_type', 'income')->sum('amount'), 2),
                'expense_total' => round((float) $confirmedTransactions->where('voucher_type', 'expense')->sum('amount'), 2),
                'transfer_total' => round((float) $confirmedTransfers->sum('amount'), 2),
            ],
            'pagination' => [
                'current_page' => $currentPage,
                'last_page' => $lastPage,
                'per_page' => $perPage,
                'total' => $total,
            ],
            'data' => $pagedRows,
        ];
    }

    public function storeTransactionEntry(int $accountId, array $data, ?FinanceTransaction $transaction = null): FinanceTransaction
    {
        $wallet = FinanceWallet::query()
            ->where('account_id', $accountId)
            ->findOrFail((int) $data['wallet_id']);

        $transactionType = $transaction?->transaction_type ?: 'manual';
        $canChangeVoucherType = in_array($transactionType, ['manual', 'adjustment'], true) || !$transaction;
        $voucherType = $this->normalizeVoucherType($data['voucher_type'] ?? null) ?: ($transaction?->direction === 'out' ? 'expense' : 'income');
        $direction = $canChangeVoucherType
            ? ($voucherType === 'expense' ? 'out' : 'in')
            : ($transaction?->direction ?: 'in');

        return $this->financeService->storeTransaction(
            $accountId,
            [
                'wallet_id' => $wallet->id,
                'category_id' => $data['category_id'] ?? null,
                'direction' => $direction,
                'transaction_type' => $transactionType,
                'payment_method' => $data['payment_method']
                    ?? ($wallet->type === 'bank' ? 'bank_transfer' : 'cash'),
                'transaction_date' => $data['transaction_date'] ?? now(),
                'amount' => $data['amount'] ?? 0,
                'counterparty_type' => $transaction?->counterparty_type ?: 'party',
                'counterparty_name' => trim((string) ($data['counterparty_name'] ?? '')) ?: null,
                'content' => trim((string) ($data['content'] ?? '')) ?: trim((string) ($data['counterparty_name'] ?? '')) ?: 'Giao dich tien',
                'note' => trim((string) ($data['note'] ?? '')) ?: null,
                'status' => $data['status'] ?? ($transaction?->status ?: 'confirmed'),
                'affects_profit_loss' => array_key_exists('affects_profit_loss', $data)
                    ? (bool) $data['affects_profit_loss']
                    : ($transaction?->affects_profit_loss ?? $transactionType !== 'adjustment'),
                'source_name' => $transaction?->source_name,
                'reference_type' => $transaction?->reference_type,
                'reference_id' => $transaction?->reference_id,
                'reference_code' => $transaction?->reference_code,
                'reference_label' => $transaction?->reference_label,
                'metadata' => $transaction?->metadata,
                'user_id' => $data['user_id'] ?? auth()->id(),
            ],
            null,
            $transaction
        );
    }

    public function statusLabel(?string $status): string
    {
        return match ((string) $status) {
            'draft' => 'Nhap',
            'pending' => 'Cho xu ly',
            'cancelled' => 'Da huy',
            default => 'Da xac nhan',
        };
    }

    public function transactionEntryPayload(FinanceTransaction $transaction): array
    {
        $transaction->loadMissing([
            'wallet:id,name,type,bank_name,account_number,color,is_active,is_default',
            'category:id,name,color,group_key',
            'creator:id,name',
        ]);

        return $this->transactionRow($transaction);
    }

    public function transferEntryPayload(FinanceTransfer $transfer): array
    {
        $transfer->loadMissing([
            'fromWallet:id,name,type,bank_name,account_number,color,is_active,is_default',
            'toWallet:id,name,type,bank_name,account_number,color,is_active,is_default',
            'creator:id,name',
        ]);

        return $this->transferRow($transfer);
    }

    private function resolveDateRange(int $accountId, array $filters): array
    {
        if (($filters['range'] ?? null) === 'all') {
            $minTransactionDate = FinanceTransaction::query()
                ->where('account_id', $accountId)
                ->whereNotNull('transaction_date')
                ->orderBy('transaction_date')
                ->value('transaction_date');
            $minTransferDate = FinanceTransfer::query()
                ->where('account_id', $accountId)
                ->whereNotNull('transfer_date')
                ->orderBy('transfer_date')
                ->value('transfer_date');

            $dates = collect([$minTransactionDate, $minTransferDate])->filter();
            $from = $dates->isNotEmpty()
                ? Carbon::parse($dates->min())->startOfDay()
                : now()->startOfMonth();

            return [$from, now()->endOfDay()];
        }

        return $this->financeService->resolveDateRange($filters, 45);
    }

    private function normalizeVoucherType(?string $value): ?string
    {
        $normalized = strtolower(trim((string) $value));

        return in_array($normalized, ['income', 'expense', 'transfer'], true)
            ? $normalized
            : null;
    }

    private function walletPayload(FinanceWallet $wallet): array
    {
        $base = $this->financeService->walletPayload($wallet);
        $digits = preg_replace('/\D+/', '', (string) ($wallet->account_number ?? ''));
        $masked = $digits ? '•••• ' . substr($digits, -4) : null;

        return [
            ...$base,
            'subtitle' => $wallet->type === 'cash'
                ? 'Tien mat'
                : trim(implode(' • ', array_filter([$wallet->bank_name, $masked]))),
        ];
    }

    private function transactionRow(FinanceTransaction $transaction): array
    {
        $base = $this->financeService->transactionPayload($transaction);
        $voucherType = $transaction->direction === 'out' ? 'expense' : 'income';
        $transactionType = (string) $transaction->transaction_type;
        $lockedTypes = ['loan_disbursement', 'loan_payment', 'fixed_expense'];
        $canEdit = !in_array($transactionType, $lockedTypes, true);

        return [
            ...$base,
            'entry_kind' => 'transaction',
            'entry_id' => (int) $transaction->id,
            'entry_key' => 'transaction:' . $transaction->id,
            'entry_timestamp' => optional($transaction->transaction_date)->toIso8601String(),
            'voucher_type' => $voucherType,
            'voucher_type_label' => $voucherType === 'expense' ? 'Chi' : 'Thu',
            'wallet_ids' => array_values(array_filter([(int) ($transaction->wallet_id ?? 0)])),
            'source_wallet_id' => $voucherType === 'expense' ? $transaction->wallet_id : null,
            'source_wallet_name' => $voucherType === 'expense' ? $transaction->wallet?->name : null,
            'destination_wallet_id' => $voucherType === 'income' ? $transaction->wallet_id : null,
            'destination_wallet_name' => $voucherType === 'income' ? $transaction->wallet?->name : null,
            'status_label' => $this->statusLabel($transaction->status),
            'entry_source' => $transactionType,
            'related_party' => $transaction->counterparty_name,
            'can_edit' => $canEdit,
            'can_delete' => $canEdit,
            'can_change_voucher_type' => in_array($transactionType, ['manual', 'adjustment'], true),
        ];
    }

    private function transferRow(FinanceTransfer $transfer): array
    {
        $base = $this->financeService->transferPayload($transfer);

        return [
            ...$base,
            'entry_kind' => 'transfer',
            'entry_id' => (int) $transfer->id,
            'entry_key' => 'transfer:' . $transfer->id,
            'entry_timestamp' => optional($transfer->transfer_date)->toIso8601String(),
            'transaction_date' => optional($transfer->transfer_date)->toIso8601String(),
            'voucher_type' => 'transfer',
            'voucher_type_label' => 'Chuyen quy',
            'wallet_ids' => array_values(array_filter([
                (int) ($transfer->from_wallet_id ?? 0),
                (int) ($transfer->to_wallet_id ?? 0),
            ])),
            'source_wallet_id' => $transfer->from_wallet_id,
            'source_wallet_name' => $transfer->fromWallet?->name,
            'destination_wallet_id' => $transfer->to_wallet_id,
            'destination_wallet_name' => $transfer->toWallet?->name,
            'wallet_id' => null,
            'wallet_name' => null,
            'category_id' => null,
            'category_name' => null,
            'category_color' => null,
            'direction' => null,
            'signed_amount' => 0,
            'status_label' => $this->statusLabel($transfer->status),
            'entry_source' => 'transfer',
            'related_party' => null,
            'counterparty_name' => null,
            'can_edit' => true,
            'can_delete' => true,
            'can_change_voucher_type' => false,
        ];
    }

    private function applyTransactionFilters(Builder $query, array $filters, Carbon $from, Carbon $to): void
    {
        $query->whereBetween('transaction_date', [$from, $to]);

        $voucherType = $this->normalizeVoucherType($filters['voucher_type'] ?? null);
        if ($voucherType === 'income') {
            $query->where('direction', 'in');
        } elseif ($voucherType === 'expense') {
            $query->where('direction', 'out');
        } elseif ($voucherType === 'transfer') {
            $query->whereRaw('1 = 0');
        }

        if (!empty($filters['wallet_id'])) {
            $query->where('wallet_id', (int) $filters['wallet_id']);
        }

        $keyword = trim((string) ($filters['keyword'] ?? ''));
        if ($keyword !== '') {
            $query->where(function (Builder $builder) use ($keyword) {
                $builder
                    ->where('code', 'like', '%' . $keyword . '%')
                    ->orWhere('content', 'like', '%' . $keyword . '%')
                    ->orWhere('note', 'like', '%' . $keyword . '%')
                    ->orWhere('counterparty_name', 'like', '%' . $keyword . '%')
                    ->orWhere('source_name', 'like', '%' . $keyword . '%')
                    ->orWhere('reference_code', 'like', '%' . $keyword . '%')
                    ->orWhere('reference_label', 'like', '%' . $keyword . '%');
            });
        }
    }

    private function applyTransferFilters(Builder $query, array $filters, Carbon $from, Carbon $to): void
    {
        $query->whereBetween('transfer_date', [$from, $to]);

        $voucherType = $this->normalizeVoucherType($filters['voucher_type'] ?? null);
        if ($voucherType && $voucherType !== 'transfer') {
            $query->whereRaw('1 = 0');
        }

        if (!empty($filters['wallet_id'])) {
            $walletId = (int) $filters['wallet_id'];
            $query->where(function (Builder $builder) use ($walletId) {
                $builder
                    ->where('from_wallet_id', $walletId)
                    ->orWhere('to_wallet_id', $walletId);
            });
        }

        $keyword = trim((string) ($filters['keyword'] ?? ''));
        if ($keyword !== '') {
            $query->where(function (Builder $builder) use ($keyword) {
                $builder
                    ->where('code', 'like', '%' . $keyword . '%')
                    ->orWhere('content', 'like', '%' . $keyword . '%')
                    ->orWhere('note', 'like', '%' . $keyword . '%');
            });
        }
    }
}
