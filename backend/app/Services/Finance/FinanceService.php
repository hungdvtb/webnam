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
use App\Models\Shipment;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use InvalidArgumentException;

class FinanceService
{
    public function ensureDefaults(?int $accountId): void
    {
        if (!$accountId) {
            return;
        }

        foreach ($this->defaultCatalogs() as $item) {
            FinanceCatalog::withTrashed()->updateOrCreate(
                [
                    'account_id' => $accountId,
                    'group_key' => $item['group_key'],
                    'code' => $item['code'],
                ],
                [
                    'name' => $item['name'],
                    'color' => $item['color'],
                    'is_system' => true,
                    'is_active' => true,
                    'sort_order' => $item['sort_order'],
                    'deleted_at' => null,
                ]
            );
        }

        foreach ($this->defaultWallets() as $wallet) {
            FinanceWallet::withTrashed()->updateOrCreate(
                [
                    'account_id' => $accountId,
                    'code' => $wallet['code'],
                ],
                [
                    ...$wallet,
                    'deleted_at' => null,
                ]
            );
        }

        FinanceWallet::query()
            ->where('account_id', $accountId)
            ->get()
            ->each(fn (FinanceWallet $wallet) => $this->recalculateWalletBalance($wallet));
    }

    public function resolveDateRange(array $filters, int $defaultDays = 30): array
    {
        $to = !empty($filters['date_to'])
            ? Carbon::parse($filters['date_to'])->endOfDay()
            : now()->endOfDay();

        $from = !empty($filters['date_from'])
            ? Carbon::parse($filters['date_from'])->startOfDay()
            : $to->copy()->subDays($defaultDays)->startOfDay();

        if ($from->gt($to)) {
            [$from, $to] = [$to->copy()->startOfDay(), $from->copy()->endOfDay()];
        }

        return [$from, $to];
    }

    public function resolvePerPage(array $filters, int $default = 20, int $max = 100): int
    {
        return min(max((int) ($filters['per_page'] ?? $default), 1), $max);
    }

    public function resolveFixedExpenseCalculationMode(?string $value): string
    {
        return $value === 'fixed_30' ? 'fixed_30' : 'actual_month';
    }

    public function fixedExpenseCalculationModeLabel(string $mode): string
    {
        return $mode === 'fixed_30' ? 'Cố định 30 ngày' : 'Theo tháng thực tế';
    }

    public function resolveFixedExpenseDaysInMonth(Carbon|string $date, ?string $mode = null): int
    {
        $resolvedDate = $date instanceof Carbon ? $date->copy() : Carbon::parse($date);
        $resolvedMode = $this->resolveFixedExpenseCalculationMode($mode);

        return $resolvedMode === 'fixed_30' ? 30 : $resolvedDate->daysInMonth;
    }

    public function resolveDailyProfitShippingMode(?string $value): string
    {
        return $value === 'revenue_percent' ? 'revenue_percent' : 'fixed_per_order';
    }

    public function dailyProfitShippingModeLabel(string $mode): string
    {
        return $mode === 'revenue_percent'
            ? '% x doanh thu'
            : 'Số đơn x phí ship cố định';
    }

    public function nextDueDate(Carbon $baseDate, string $frequency, int $intervalValue, ?Carbon $currentDueDate = null): Carbon
    {
        $date = ($currentDueDate ?: $baseDate)->copy();
        $interval = max($intervalValue, 1);

        return match ($frequency) {
            'daily' => $date->addDays($interval),
            'weekly' => $date->addWeeks($interval),
            'quarterly' => $date->addMonths($interval * 3),
            'yearly' => $date->addYears($interval),
            default => $date->addMonths($interval),
        };
    }

    public function walletOpeningBalance(FinanceWallet $wallet, Carbon $from): float
    {
        $signedBefore = (float) FinanceTransaction::query()
            ->where('account_id', $wallet->account_id)
            ->where('wallet_id', $wallet->id)
            ->where('status', 'confirmed')
            ->where('transaction_date', '<', $from)
            ->selectRaw("COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE amount * -1 END), 0) AS total")
            ->value('total');

        return round((float) $wallet->opening_balance + $signedBefore, 2);
    }

    public function outstandingOrdersQuery(int $accountId): Builder
    {
        $outstandingExpression = 'GREATEST(orders.total_price - COALESCE(order_receipts.paid_amount, 0), 0)';

        $paidSubquery = FinanceTransaction::query()
            ->selectRaw('reference_id, COALESCE(SUM(amount), 0) AS paid_amount')
            ->where('account_id', $accountId)
            ->where('reference_type', 'order')
            ->where('direction', 'in')
            ->where('status', 'confirmed')
            ->groupBy('reference_id');

        return Order::query()
            ->select([
                'orders.id',
                'orders.order_number',
                'orders.customer_name',
                'orders.total_price',
                'orders.status',
                'orders.created_at',
            ])
            ->leftJoinSub($paidSubquery, 'order_receipts', function ($join) {
                $join->on('orders.id', '=', 'order_receipts.reference_id');
            })
            ->where('orders.account_id', $accountId)
            ->whereNull('orders.deleted_at')
            ->whereNotIn('orders.status', ['cancelled', 'returned'])
            ->selectRaw('COALESCE(order_receipts.paid_amount, 0) AS paid_amount')
            ->selectRaw("{$outstandingExpression} AS outstanding_amount")
            ->whereRaw("{$outstandingExpression} > 0");
    }

    public function recalculateWalletBalance(FinanceWallet $wallet): FinanceWallet
    {
        $signedTotal = (float) FinanceTransaction::query()
            ->where('account_id', $wallet->account_id)
            ->where('wallet_id', $wallet->id)
            ->where('status', 'confirmed')
            ->selectRaw("COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE amount * -1 END), 0) AS total")
            ->value('total');

        $wallet->current_balance = round((float) $wallet->opening_balance + $signedTotal, 2);
        $wallet->balance_updated_at = now();
        $wallet->saveQuietly();

        return $wallet->fresh();
    }

    public function recalculateLoan(FinanceLoan $loan): FinanceLoan
    {
        $principalPaid = (float) FinanceLoanPayment::query()
            ->where('account_id', $loan->account_id)
            ->where('loan_id', $loan->id)
            ->where('status', 'confirmed')
            ->sum('principal_amount');

        $interestPaid = (float) FinanceLoanPayment::query()
            ->where('account_id', $loan->account_id)
            ->where('loan_id', $loan->id)
            ->where('status', 'confirmed')
            ->sum('interest_amount');

        $status = $loan->status;
        $outstanding = round((float) $loan->principal_amount - $principalPaid, 2);

        if ($outstanding <= 0 && !in_array($loan->status, ['suspended'], true)) {
            $status = 'closed';
        } elseif ($loan->due_date && Carbon::parse($loan->due_date)->isPast() && $outstanding > 0 && !in_array($loan->status, ['suspended'], true)) {
            $status = 'overdue';
        } elseif ($outstanding > 0 && in_array($loan->status, ['closed', 'overdue'], true)) {
            $status = 'active';
        }

        $loan->principal_paid = round($principalPaid, 2);
        $loan->interest_paid = round($interestPaid, 2);
        $loan->status = $status;
        $loan->saveQuietly();

        return $loan->fresh();
    }

    public function storeTransaction(int $accountId, array $data, ?UploadedFile $attachment = null, ?FinanceTransaction $transaction = null): FinanceTransaction
    {
        $this->ensureDefaults($accountId);

        return DB::transaction(function () use ($accountId, $data, $attachment, $transaction) {
            $isNew = !$transaction;
            $transaction ??= new FinanceTransaction();

            $before = $transaction->exists ? $transaction->getOriginal() : null;
            $oldWalletId = $transaction->wallet_id;
            $oldAttachment = $transaction->attachment_path;

            $payload = [
                'account_id' => $accountId,
                'wallet_id' => $data['wallet_id'] ?? null,
                'category_id' => $data['category_id'] ?? null,
                'source_name' => $data['source_name'] ?? null,
                'related_transaction_id' => $data['related_transaction_id'] ?? null,
                'created_by' => $transaction->created_by ?: ($data['user_id'] ?? auth()->id()),
                'updated_by' => $data['user_id'] ?? auth()->id(),
                'code' => $transaction->code
                    ?: ($data['code'] ?? $this->nextCode(
                        FinanceTransaction::class,
                        strtoupper((string) ($data['code_prefix'] ?? 'FT')),
                        $accountId
                    )),
                'status' => $data['status'] ?? ($transaction->status ?: 'confirmed'),
                'direction' => $data['direction'],
                'transaction_type' => $data['transaction_type'] ?? 'manual',
                'payment_method' => $data['payment_method'] ?? null,
                'transaction_date' => $data['transaction_date'] ?? now(),
                'amount' => round((float) ($data['amount'] ?? 0), 2),
                'counterparty_type' => $data['counterparty_type'] ?? null,
                'counterparty_name' => $data['counterparty_name'] ?? null,
                'counterparty_phone' => $data['counterparty_phone'] ?? null,
                'reference_type' => $data['reference_type'] ?? null,
                'reference_id' => $data['reference_id'] ?? null,
                'reference_code' => $data['reference_code'] ?? null,
                'reference_label' => $data['reference_label'] ?? null,
                'content' => $data['content'] ?? null,
                'note' => $data['note'] ?? null,
                'affects_profit_loss' => array_key_exists('affects_profit_loss', $data)
                    ? (bool) $data['affects_profit_loss']
                    : ($transaction->exists ? $transaction->affects_profit_loss : true),
                'metadata' => $data['metadata'] ?? ($transaction->metadata ?? null),
            ];

            if ($attachment) {
                $payload['attachment_path'] = $attachment->store('uploads/finance/transactions', 'public');
            } elseif (!empty($data['remove_attachment']) && $transaction->attachment_path) {
                $payload['attachment_path'] = null;
            }

            $transaction->fill($payload);
            $transaction->save();

            if (!empty($data['remove_attachment']) && $oldAttachment) {
                Storage::disk('public')->delete($oldAttachment);
            }

            if ($attachment && $oldAttachment && $oldAttachment !== $transaction->attachment_path) {
                Storage::disk('public')->delete($oldAttachment);
            }

            collect([$oldWalletId, $transaction->wallet_id])
                ->filter()
                ->unique()
                ->each(function ($walletId) {
                    $wallet = FinanceWallet::query()->find($walletId);
                    if ($wallet) {
                        $this->recalculateWalletBalance($wallet);
                    }
                });

            $this->logChange(
                $accountId,
                $transaction,
                $isNew ? 'created' : 'updated',
                $before,
                $transaction->fresh()->getAttributes(),
                $data['user_id'] ?? auth()->id()
            );

            return $transaction->fresh(['wallet', 'category', 'creator', 'updater']);
        });
    }

    public function deleteTransaction(FinanceTransaction $transaction, ?int $userId = null): void
    {
        DB::transaction(function () use ($transaction, $userId) {
            $before = $transaction->getAttributes();
            $walletId = $transaction->wallet_id;

            $transaction->delete();

            if ($walletId) {
                $wallet = FinanceWallet::query()->find($walletId);
                if ($wallet) {
                    $this->recalculateWalletBalance($wallet);
                }
            }

            $this->logChange(
                (int) $transaction->account_id,
                $transaction,
                'deleted',
                $before,
                null,
                $userId ?? auth()->id()
            );
        });
    }

    public function restoreTransaction(FinanceTransaction $transaction, ?int $userId = null): FinanceTransaction
    {
        $transaction->restore();

        if ($transaction->wallet_id) {
            $wallet = FinanceWallet::query()->find($transaction->wallet_id);
            if ($wallet) {
                $this->recalculateWalletBalance($wallet);
            }
        }

        $this->logChange(
            (int) $transaction->account_id,
            $transaction,
            'restored',
            null,
            $transaction->getAttributes(),
            $userId ?? auth()->id()
        );

        return $transaction->fresh(['wallet', 'category']);
    }

    public function storeWallet(int $accountId, array $data, ?FinanceWallet $wallet = null): FinanceWallet
    {
        $this->ensureDefaults($accountId);

        return DB::transaction(function () use ($accountId, $data, $wallet) {
            $isNew = !$wallet;
            $wallet ??= new FinanceWallet();
            $before = $wallet->exists ? $wallet->getOriginal() : null;

            if (($data['is_default'] ?? false) && !empty($data['type'])) {
                FinanceWallet::query()
                    ->where('account_id', $accountId)
                    ->where('type', $data['type'])
                    ->where('id', '!=', $wallet->id ?: 0)
                    ->update(['is_default' => false]);
            }

            $wallet->fill([
                'account_id' => $accountId,
                'code' => $wallet->code ?: $this->sanitizeCode($data['code'] ?? $data['name'] ?? 'VI'),
                'name' => $data['name'],
                'type' => $data['type'],
                'bank_name' => $data['bank_name'] ?? null,
                'account_number' => $data['account_number'] ?? null,
                'currency' => $data['currency'] ?? 'VND',
                'opening_balance' => round((float) ($data['opening_balance'] ?? ($wallet->opening_balance ?? 0)), 2),
                'color' => $data['color'] ?? null,
                'note' => $data['note'] ?? null,
                'is_default' => (bool) ($data['is_default'] ?? false),
                'is_active' => array_key_exists('is_active', $data) ? (bool) $data['is_active'] : true,
                'sort_order' => (int) ($data['sort_order'] ?? 0),
            ]);
            $wallet->save();

            $this->recalculateWalletBalance($wallet);

            $this->logChange(
                $accountId,
                $wallet,
                $isNew ? 'created' : 'updated',
                $before,
                $wallet->fresh()->getAttributes(),
                $data['user_id'] ?? auth()->id()
            );

            return $wallet->fresh();
        });
    }

    public function adjustWallet(FinanceWallet $wallet, array $data): FinanceTransaction
    {
        $direction = (float) $data['amount'] >= 0 ? 'in' : 'out';

        return $this->storeTransaction(
            (int) $wallet->account_id,
            [
                'wallet_id' => $wallet->id,
                'direction' => $direction,
                'transaction_type' => 'adjustment',
                'status' => 'confirmed',
                'payment_method' => $wallet->type === 'bank' ? 'bank_transfer' : 'cash',
                'transaction_date' => $data['transaction_date'] ?? now(),
                'amount' => abs((float) $data['amount']),
                'counterparty_type' => 'internal',
                'counterparty_name' => 'Điều chỉnh quỹ',
                'content' => $data['content'] ?? 'Điều chỉnh số dư',
                'note' => $data['note'] ?? null,
                'reference_type' => 'wallet_adjustment',
                'reference_id' => $wallet->id,
                'affects_profit_loss' => false,
                'metadata' => [
                    'reason' => $data['reason'] ?? null,
                ],
                'user_id' => $data['user_id'] ?? auth()->id(),
            ]
        );
    }

    public function storeTransfer(int $accountId, array $data): FinanceTransfer
    {
        $this->ensureDefaults($accountId);

        if ((int) $data['from_wallet_id'] === (int) $data['to_wallet_id']) {
            throw new InvalidArgumentException('Tài khoản chuyển và nhận không được trùng nhau.');
        }

        return DB::transaction(function () use ($accountId, $data) {
            $transfer = new FinanceTransfer();
            $transfer->fill([
                'account_id' => $accountId,
                'from_wallet_id' => $data['from_wallet_id'],
                'to_wallet_id' => $data['to_wallet_id'],
                'created_by' => $data['user_id'] ?? auth()->id(),
                'updated_by' => $data['user_id'] ?? auth()->id(),
                'code' => $this->nextCode(FinanceTransfer::class, 'TR', $accountId),
                'status' => $data['status'] ?? 'confirmed',
                'transfer_date' => $data['transfer_date'] ?? now(),
                'amount' => round((float) $data['amount'], 2),
                'content' => $data['content'] ?? 'Chuyển tiền nội bộ',
                'note' => $data['note'] ?? null,
            ]);
            $transfer->save();

            $outgoing = $this->storeTransaction($accountId, [
                'wallet_id' => $transfer->from_wallet_id,
                'direction' => 'out',
                'transaction_type' => 'transfer_out',
                'status' => $transfer->status,
                'payment_method' => 'internal_transfer',
                'transaction_date' => $transfer->transfer_date,
                'amount' => $transfer->amount,
                'counterparty_type' => 'wallet',
                'counterparty_name' => $transfer->toWallet?->name,
                'reference_type' => 'transfer',
                'reference_id' => $transfer->id,
                'content' => $transfer->content,
                'note' => $transfer->note,
                'affects_profit_loss' => false,
                'metadata' => [
                    'from_wallet_id' => $transfer->from_wallet_id,
                    'to_wallet_id' => $transfer->to_wallet_id,
                    'pair' => 'outgoing',
                ],
                'user_id' => $data['user_id'] ?? auth()->id(),
            ]);

            $incoming = $this->storeTransaction($accountId, [
                'wallet_id' => $transfer->to_wallet_id,
                'direction' => 'in',
                'transaction_type' => 'transfer_in',
                'status' => $transfer->status,
                'payment_method' => 'internal_transfer',
                'transaction_date' => $transfer->transfer_date,
                'amount' => $transfer->amount,
                'counterparty_type' => 'wallet',
                'counterparty_name' => $transfer->fromWallet?->name,
                'reference_type' => 'transfer',
                'reference_id' => $transfer->id,
                'content' => $transfer->content,
                'note' => $transfer->note,
                'affects_profit_loss' => false,
                'metadata' => [
                    'from_wallet_id' => $transfer->from_wallet_id,
                    'to_wallet_id' => $transfer->to_wallet_id,
                    'pair' => 'incoming',
                ],
                'user_id' => $data['user_id'] ?? auth()->id(),
            ]);

            $outgoing->related_transaction_id = $incoming->id;
            $outgoing->save();
            $incoming->related_transaction_id = $outgoing->id;
            $incoming->save();

            $transfer->outgoing_transaction_id = $outgoing->id;
            $transfer->incoming_transaction_id = $incoming->id;
            $transfer->save();

            $this->logChange(
                $accountId,
                $transfer,
                'created',
                null,
                $transfer->fresh()->getAttributes(),
                $data['user_id'] ?? auth()->id()
            );

            return $transfer->fresh(['fromWallet', 'toWallet', 'outgoingTransaction', 'incomingTransaction']);
        });
    }

    public function deleteTransfer(FinanceTransfer $transfer, ?int $userId = null): void
    {
        DB::transaction(function () use ($transfer, $userId) {
            $before = $transfer->getAttributes();

            if ($transfer->outgoingTransaction) {
                $this->deleteTransaction($transfer->outgoingTransaction, $userId);
            }
            if ($transfer->incomingTransaction) {
                $this->deleteTransaction($transfer->incomingTransaction, $userId);
            }

            $transfer->delete();

            $this->logChange(
                (int) $transfer->account_id,
                $transfer,
                'deleted',
                $before,
                null,
                $userId ?? auth()->id()
            );
        });
    }

    public function storeLoan(int $accountId, array $data, ?FinanceLoan $loan = null): FinanceLoan
    {
        $this->ensureDefaults($accountId);

        return DB::transaction(function () use ($accountId, $data, $loan) {
            $isNew = !$loan;
            $loan ??= new FinanceLoan();
            $before = $loan->exists ? $loan->getOriginal() : null;

            $loan->fill([
                'account_id' => $accountId,
                'disbursed_wallet_id' => $data['disbursed_wallet_id'] ?? null,
                'created_by' => $loan->created_by ?: ($data['user_id'] ?? auth()->id()),
                'updated_by' => $data['user_id'] ?? auth()->id(),
                'code' => $loan->code ?: $this->nextCode(FinanceLoan::class, 'LO', $accountId),
                'type' => $data['type'],
                'status' => $data['status'] ?? 'active',
                'counterparty_name' => $data['counterparty_name'],
                'counterparty_contact' => $data['counterparty_contact'] ?? null,
                'principal_amount' => round((float) $data['principal_amount'], 2),
                'interest_rate' => array_key_exists('interest_rate', $data) ? (float) $data['interest_rate'] : null,
                'interest_type' => $data['interest_type'] ?? 'percent',
                'start_date' => $data['start_date'],
                'due_date' => $data['due_date'] ?? null,
                'note' => $data['note'] ?? null,
            ]);
            $loan->save();

            if (!empty($data['create_disbursement']) || ($isNew && $loan->disbursed_wallet_id)) {
                $direction = $loan->type === 'borrowed' ? 'in' : 'out';
                $transactionData = [
                    'wallet_id' => $loan->disbursed_wallet_id,
                    'direction' => $direction,
                    'transaction_type' => 'loan_disbursement',
                    'status' => $loan->status === 'draft' ? 'draft' : 'confirmed',
                    'payment_method' => $loan->disbursed_wallet_id ? 'bank_transfer' : 'other',
                    'transaction_date' => $loan->start_date,
                    'amount' => $loan->principal_amount,
                    'counterparty_type' => 'loan_counterparty',
                    'counterparty_name' => $loan->counterparty_name,
                    'reference_type' => 'loan',
                    'reference_id' => $loan->id,
                    'content' => $loan->type === 'borrowed' ? 'Nhận khoản vay' : 'Giải ngân cho vay',
                    'note' => $loan->note,
                    'affects_profit_loss' => false,
                    'user_id' => $data['user_id'] ?? auth()->id(),
                ];

                if ($loan->disbursementTransaction) {
                    $linked = $this->storeTransaction($accountId, $transactionData, null, $loan->disbursementTransaction);
                } else {
                    $linked = $this->storeTransaction($accountId, $transactionData);
                    $loan->disbursement_transaction_id = $linked->id;
                    $loan->save();
                }
            } elseif ($loan->disbursementTransaction) {
                $this->deleteTransaction($loan->disbursementTransaction, $data['user_id'] ?? auth()->id());
                $loan->disbursement_transaction_id = null;
                $loan->save();
            }

            $this->recalculateLoan($loan);

            $this->logChange(
                $accountId,
                $loan,
                $isNew ? 'created' : 'updated',
                $before,
                $loan->fresh()->getAttributes(),
                $data['user_id'] ?? auth()->id()
            );

            return $loan->fresh(['wallet', 'disbursementTransaction', 'payments.wallet']);
        });
    }

    public function deleteLoan(FinanceLoan $loan, ?int $userId = null): void
    {
        DB::transaction(function () use ($loan, $userId) {
            $before = $loan->getAttributes();

            foreach ($loan->payments as $payment) {
                $this->deleteLoanPayment($payment, $userId);
            }

            if ($loan->disbursementTransaction) {
                $this->deleteTransaction($loan->disbursementTransaction, $userId);
            }

            $loan->delete();

            $this->logChange(
                (int) $loan->account_id,
                $loan,
                'deleted',
                $before,
                null,
                $userId ?? auth()->id()
            );
        });
    }

    public function storeLoanPayment(FinanceLoan $loan, array $data): FinanceLoanPayment
    {
        return DB::transaction(function () use ($loan, $data) {
            $accountId = (int) $loan->account_id;
            $principalAmount = round((float) ($data['principal_amount'] ?? 0), 2);
            $interestAmount = round((float) ($data['interest_amount'] ?? 0), 2);
            $totalAmount = round((float) ($data['total_amount'] ?? ($principalAmount + $interestAmount)), 2);
            $direction = $loan->type === 'borrowed' ? 'out' : 'in';

            $transaction = $this->storeTransaction($accountId, [
                'wallet_id' => $data['wallet_id'] ?? null,
                'direction' => $direction,
                'transaction_type' => 'loan_payment',
                'status' => $data['status'] ?? 'confirmed',
                'payment_method' => $data['payment_method'] ?? (($data['wallet_id'] ?? null) ? 'bank_transfer' : 'other'),
                'transaction_date' => $data['payment_date'] ?? now(),
                'amount' => $totalAmount,
                'counterparty_type' => 'loan_counterparty',
                'counterparty_name' => $loan->counterparty_name,
                'reference_type' => 'loan_payment',
                'reference_id' => $loan->id,
                'content' => $loan->type === 'borrowed' ? 'Thanh toán khoản vay' : 'Thu hồi khoản cho vay',
                'note' => $data['note'] ?? null,
                'affects_profit_loss' => false,
                'metadata' => [
                    'principal_amount' => $principalAmount,
                    'interest_amount' => $interestAmount,
                    'loan_type' => $loan->type,
                ],
                'user_id' => $data['user_id'] ?? auth()->id(),
            ]);

            $payment = new FinanceLoanPayment();
            $payment->fill([
                'account_id' => $accountId,
                'loan_id' => $loan->id,
                'wallet_id' => $data['wallet_id'] ?? null,
                'finance_transaction_id' => $transaction->id,
                'created_by' => $data['user_id'] ?? auth()->id(),
                'updated_by' => $data['user_id'] ?? auth()->id(),
                'code' => $this->nextCode(FinanceLoanPayment::class, 'LP', $accountId),
                'status' => $data['status'] ?? 'confirmed',
                'payment_date' => $data['payment_date'] ?? now(),
                'principal_amount' => $principalAmount,
                'interest_amount' => $interestAmount,
                'total_amount' => $totalAmount,
                'note' => $data['note'] ?? null,
            ]);
            $payment->save();

            $this->recalculateLoan($loan);

            $this->logChange(
                $accountId,
                $payment,
                'created',
                null,
                $payment->getAttributes(),
                $data['user_id'] ?? auth()->id()
            );

            return $payment->fresh(['wallet', 'transaction']);
        });
    }

    public function deleteLoanPayment(FinanceLoanPayment $payment, ?int $userId = null): void
    {
        DB::transaction(function () use ($payment, $userId) {
            $before = $payment->getAttributes();
            $loan = $payment->loan;

            if ($payment->transaction) {
                $this->deleteTransaction($payment->transaction, $userId);
            }

            $payment->delete();

            if ($loan) {
                $this->recalculateLoan($loan);
            }

            $this->logChange(
                (int) $payment->account_id,
                $payment,
                'deleted',
                $before,
                null,
                $userId ?? auth()->id()
            );
        });
    }

    public function currentFixedExpenseRows(int $accountId): Collection
    {
        return FinanceFixedExpense::query()
            ->where('account_id', $accountId)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();
    }

    public function storeFixedExpense(int $accountId, array $data, ?FinanceFixedExpense $expense = null): FinanceFixedExpense
    {
        return DB::transaction(function () use ($accountId, $data, $expense) {
            $currentMaxSortOrder = (int) FinanceFixedExpense::query()
                ->where('account_id', $accountId)
                ->max('sort_order');

            $savedExpense = $this->persistFixedExpenseRow($accountId, [
                'content' => $data['content'] ?? $data['name'] ?? '',
                'monthly_amount' => $data['monthly_amount'] ?? $data['amount'] ?? 0,
                'category_id' => $data['category_id'] ?? null,
                'default_wallet_id' => $data['default_wallet_id'] ?? null,
                'effective_date' => $data['effective_date'] ?? $data['start_date'] ?? now()->toDateString(),
                'sort_order' => $data['sort_order'] ?? ($expense?->sort_order ?: ($currentMaxSortOrder + 1)),
                'status' => $data['status'] ?? 'active',
                'note' => $data['note'] ?? null,
                'user_id' => $data['user_id'] ?? auth()->id(),
            ], $expense);

            $this->createFixedExpenseVersionSnapshot(
                $accountId,
                $this->currentFixedExpenseRows($accountId),
                [
                    'effective_date' => $data['effective_date'] ?? $data['start_date'] ?? now()->toDateString(),
                    'day_calculation_mode' => $data['day_calculation_mode'] ?? null,
                    'note' => $data['version_note'] ?? null,
                    'user_id' => $data['user_id'] ?? auth()->id(),
                ]
            );

            return $savedExpense;
        });
    }

    public function syncFixedExpenseSheet(int $accountId, array $data): array
    {
        $rows = $this->normalizeFixedExpenseSheetRows($data['rows'] ?? []);
        $effectiveDate = Carbon::parse($data['effective_date'] ?? now())->toDateString();
        $dayCalculationMode = $this->resolveFixedExpenseCalculationMode($data['day_calculation_mode'] ?? null);
        $userId = $data['user_id'] ?? auth()->id();

        return DB::transaction(function () use ($accountId, $rows, $effectiveDate, $dayCalculationMode, $data, $userId) {
            $existingRows = FinanceFixedExpense::withTrashed()
                ->where('account_id', $accountId)
                ->get()
                ->keyBy('id');

            $keptIds = [];

            foreach ($rows as $row) {
                $expense = null;

                if (!empty($row['id'])) {
                    $expense = $existingRows->get((int) $row['id']);

                    if (!$expense) {
                        throw new InvalidArgumentException('Không tìm thấy dòng chi phí cố định để cập nhật.');
                    }
                }

                $savedExpense = $this->persistFixedExpenseRow($accountId, [
                    ...$row,
                    'effective_date' => $effectiveDate,
                    'user_id' => $userId,
                ], $expense);

                $keptIds[] = $savedExpense->id;
            }

            $rowsToDelete = FinanceFixedExpense::query()
                ->where('account_id', $accountId)
                ->when($keptIds !== [], fn (Builder $query) => $query->whereNotIn('id', $keptIds))
                ->get();

            foreach ($rowsToDelete as $rowToDelete) {
                $this->softDeleteFixedExpenseRow($rowToDelete, $userId);
            }

            $currentRows = $this->currentFixedExpenseRows($accountId);
            $version = $this->createFixedExpenseVersionSnapshot($accountId, $currentRows, [
                'effective_date' => $effectiveDate,
                'day_calculation_mode' => $dayCalculationMode,
                'note' => $data['note'] ?? null,
                'user_id' => $userId,
            ]);
            $versionPayload = $this->fixedExpenseVersionPayload($version, Carbon::parse($effectiveDate));

            return [
                'rows' => collect($versionPayload['items'] ?? [])->values(),
                'version' => $versionPayload,
                'history' => FinanceFixedExpenseVersion::query()
                    ->with('creator:id,name')
                    ->where('account_id', $accountId)
                    ->orderByDesc('effective_date')
                    ->orderByDesc('id')
                    ->limit(20)
                    ->get()
                    ->map(fn (FinanceFixedExpenseVersion $historyVersion) => $this->fixedExpenseVersionPayload($historyVersion))
                    ->values(),
            ];
        });
    }

    public function deleteFixedExpense(
        FinanceFixedExpense $expense,
        ?int $userId = null,
        ?string $effectiveDate = null,
        ?string $dayCalculationMode = null
    ): void {
        DB::transaction(function () use ($expense, $userId, $effectiveDate, $dayCalculationMode) {
            $accountId = (int) $expense->account_id;
            $this->softDeleteFixedExpenseRow($expense, $userId);

            $this->createFixedExpenseVersionSnapshot($accountId, $this->currentFixedExpenseRows($accountId), [
                'effective_date' => $effectiveDate ?? now()->toDateString(),
                'day_calculation_mode' => $dayCalculationMode,
                'note' => 'Deleted fixed expense row',
                'user_id' => $userId ?? auth()->id(),
            ]);
        });
    }

    public function fixedExpenseByDate(int $accountId, Carbon|string $date): array
    {
        $resolvedDate = $date instanceof Carbon ? $date->copy() : Carbon::parse($date);

        $version = FinanceFixedExpenseVersion::query()
            ->with('creator:id,name')
            ->where('account_id', $accountId)
            ->whereDate('effective_date', '<=', $resolvedDate->toDateString())
            ->orderByDesc('effective_date')
            ->orderByDesc('id')
            ->first();

        if ($version) {
            return $this->fixedExpenseVersionPayload($version, $resolvedDate);
        }

        $currentRows = $this->currentFixedExpenseRows($accountId);
        $totalMonthlyAmount = round((float) $currentRows->sum('amount'), 2);
        $mode = $this->resolveFixedExpenseCalculationMode(null);
        $daysInMonth = $this->resolveFixedExpenseDaysInMonth($resolvedDate, $mode);

        return [
            'id' => null,
            'effective_date' => null,
            'day_calculation_mode' => $mode,
            'day_calculation_label' => $this->fixedExpenseCalculationModeLabel($mode),
            'total_monthly_amount' => $totalMonthlyAmount,
            'days_in_month' => $daysInMonth,
            'daily_amount' => $daysInMonth > 0 ? round($totalMonthlyAmount / $daysInMonth, 2) : 0,
            'items' => $currentRows->map(fn (FinanceFixedExpense $expense) => [
                'line_key' => (string) $expense->id,
                'id' => $expense->id,
                'fixed_expense_id' => $expense->id,
                'content' => $expense->name,
                'monthly_amount' => round((float) $expense->amount, 2),
                'sort_order' => (int) $expense->sort_order,
            ])->values(),
            'note' => null,
            'created_at' => null,
            'created_by' => null,
            'created_by_name' => null,
            'applies_to_date' => $resolvedDate->toDateString(),
        ];
    }

    public function fixedExpenseDailySeries(int $accountId, Carbon $from, Carbon $to): Collection
    {
        $versions = FinanceFixedExpenseVersion::query()
            ->where('account_id', $accountId)
            ->whereDate('effective_date', '<=', $to->toDateString())
            ->orderBy('effective_date')
            ->orderBy('id')
            ->get();

        $series = collect();
        $versionIndex = 0;
        $activeVersion = null;
        $cursor = $from->copy()->startOfDay();

        while ($cursor <= $to) {
            while (isset($versions[$versionIndex]) && Carbon::parse($versions[$versionIndex]->effective_date)->startOfDay()->lte($cursor)) {
                $activeVersion = $versions[$versionIndex];
                $versionIndex += 1;
            }

            $resolved = $activeVersion
                ? $this->fixedExpenseVersionPayload($activeVersion, $cursor)
                : $this->fixedExpenseByDate($accountId, $cursor);

            $series->push([
                'date' => $cursor->toDateString(),
                'version_id' => $resolved['id'],
                'effective_date' => $resolved['effective_date'],
                'day_calculation_mode' => $resolved['day_calculation_mode'],
                'days_in_month' => $resolved['days_in_month'],
                'total_monthly_amount' => $resolved['total_monthly_amount'],
                'daily_amount' => $resolved['daily_amount'],
            ]);

            $cursor->addDay();
        }

        return $series;
    }

    public function storeDailyProfitConfigVersion(int $accountId, array $data): FinanceDailyProfitConfigVersion
    {
        return DB::transaction(function () use ($accountId, $data) {
            $version = FinanceDailyProfitConfigVersion::query()->create([
                'account_id' => $accountId,
                'created_by' => $data['user_id'] ?? auth()->id(),
                'effective_date' => Carbon::parse($data['effective_date'] ?? now())->toDateString(),
                'return_rate' => round((float) ($data['return_rate'] ?? 0), 4),
                'packaging_cost_per_order' => round((float) ($data['packaging_cost_per_order'] ?? 0), 2),
                'shipping_calculation_mode' => $this->resolveDailyProfitShippingMode($data['shipping_calculation_mode'] ?? null),
                'shipping_cost_per_order' => round((float) ($data['shipping_cost_per_order'] ?? 0), 2),
                'shipping_cost_rate' => round((float) ($data['shipping_cost_rate'] ?? 0), 4),
                'tax_rate' => round((float) ($data['tax_rate'] ?? 1.5), 4),
                'note' => $data['note'] ?? null,
            ]);

            $this->logChange(
                $accountId,
                $version,
                'created',
                null,
                $version->fresh()->getAttributes(),
                $data['user_id'] ?? auth()->id()
            );

            return $version->fresh('creator');
        });
    }

    public function dailyProfitConfigByDate(int $accountId, Carbon|string $date): array
    {
        $resolvedDate = $date instanceof Carbon ? $date->copy() : Carbon::parse($date);

        $version = FinanceDailyProfitConfigVersion::query()
            ->with('creator:id,name')
            ->where('account_id', $accountId)
            ->whereDate('effective_date', '<=', $resolvedDate->toDateString())
            ->orderByDesc('effective_date')
            ->orderByDesc('id')
            ->first();

        return $this->dailyProfitConfigPayload($version, $resolvedDate);
    }

    public function dailyProfitConfigSeries(int $accountId, Carbon $from, Carbon $to): Collection
    {
        $versions = FinanceDailyProfitConfigVersion::query()
            ->where('account_id', $accountId)
            ->whereDate('effective_date', '<=', $to->toDateString())
            ->orderBy('effective_date')
            ->orderBy('id')
            ->get();

        $series = collect();
        $versionIndex = 0;
        $activeVersion = null;
        $cursor = $from->copy()->startOfDay();

        while ($cursor <= $to) {
            while (isset($versions[$versionIndex]) && Carbon::parse($versions[$versionIndex]->effective_date)->startOfDay()->lte($cursor)) {
                $activeVersion = $versions[$versionIndex];
                $versionIndex += 1;
            }

            $resolved = $this->dailyProfitConfigPayload($activeVersion, $cursor);
            $series->push([
                'date' => $cursor->toDateString(),
                ...$resolved,
            ]);

            $cursor->addDay();
        }

        return $series;
    }

    private function normalizeFixedExpenseSheetRows(array $rows): array
    {
        $normalizedRows = [];

        foreach ($rows as $index => $row) {
            $content = trim((string) ($row['content'] ?? $row['name'] ?? ''));
            $amountValue = $row['monthly_amount'] ?? $row['amount'] ?? '';
            $hasAmount = $amountValue !== null && $amountValue !== '';

            if ($content === '' && !$hasAmount) {
                continue;
            }

            if ($content === '') {
                throw new InvalidArgumentException('Dòng chi phí #' . ($index + 1) . ' chưa có nội dung.');
            }

            if ($amountValue !== '' && !is_numeric($amountValue)) {
                throw new InvalidArgumentException('Dòng chi phí "' . $content . '" có số tiền không hợp lệ.');
            }

            $monthlyAmount = round((float) ($amountValue === '' ? 0 : $amountValue), 2);

            if ($monthlyAmount < 0) {
                throw new InvalidArgumentException('Dòng chi phí "' . $content . '" không được nhỏ hơn 0.');
            }

            $normalizedRows[] = [
                'id' => !empty($row['id']) ? (int) $row['id'] : null,
                'content' => $content,
                'monthly_amount' => $monthlyAmount,
                'sort_order' => count($normalizedRows) + 1,
            ];
        }

        return $normalizedRows;
    }

    private function persistFixedExpenseRow(int $accountId, array $data, ?FinanceFixedExpense $expense = null): FinanceFixedExpense
    {
        $isNew = !$expense;
        $expense ??= new FinanceFixedExpense();
        $before = $expense->exists ? $expense->getOriginal() : null;
        $effectiveDate = Carbon::parse($data['effective_date'] ?? $data['start_date'] ?? now());

        if (method_exists($expense, 'trashed') && $expense->exists && $expense->trashed()) {
            $expense->restore();
        }

        $expense->fill([
            'account_id' => $accountId,
            'category_id' => $data['category_id'] ?? null,
            'default_wallet_id' => $data['default_wallet_id'] ?? null,
            'created_by' => $expense->created_by ?: ($data['user_id'] ?? auth()->id()),
            'updated_by' => $data['user_id'] ?? auth()->id(),
            'code' => $expense->code ?: $this->nextCode(FinanceFixedExpense::class, 'FX', $accountId),
            'name' => trim((string) ($data['content'] ?? $data['name'] ?? '')),
            'amount' => round((float) ($data['monthly_amount'] ?? $data['amount'] ?? 0), 2),
            'sort_order' => (int) ($data['sort_order'] ?? ($expense->sort_order ?: 0)),
            'frequency' => 'monthly',
            'interval_value' => 1,
            'reminder_days' => 0,
            'status' => $data['status'] ?? 'active',
            'start_date' => $effectiveDate->toDateString(),
            'next_due_date' => $effectiveDate->toDateString(),
            'last_paid_date' => $data['last_paid_date'] ?? $expense->last_paid_date,
            'note' => $data['note'] ?? null,
        ]);
        $expense->save();

        $this->logChange(
            $accountId,
            $expense,
            $isNew ? 'created' : 'updated',
            $before,
            $expense->fresh()->getAttributes(),
            $data['user_id'] ?? auth()->id()
        );

        return $expense->fresh(['category', 'wallet']);
    }

    private function softDeleteFixedExpenseRow(FinanceFixedExpense $expense, ?int $userId = null): void
    {
        $before = $expense->getAttributes();
        $expense->delete();

        $this->logChange(
            (int) $expense->account_id,
            $expense,
            'deleted',
            $before,
            null,
            $userId ?? auth()->id()
        );
    }

    private function createFixedExpenseVersionSnapshot(int $accountId, Collection $rows, array $data): FinanceFixedExpenseVersion
    {
        $itemsSnapshot = $rows
            ->sortBy('sort_order')
            ->values()
            ->map(function (FinanceFixedExpense $expense) {
                return [
                    'line_key' => (string) $expense->id,
                    'fixed_expense_id' => $expense->id,
                    'content' => $expense->name,
                    'monthly_amount' => round((float) $expense->amount, 2),
                    'sort_order' => (int) $expense->sort_order,
                ];
            })
            ->values()
            ->all();

        $version = FinanceFixedExpenseVersion::query()->create([
            'account_id' => $accountId,
            'created_by' => $data['user_id'] ?? auth()->id(),
            'effective_date' => Carbon::parse($data['effective_date'] ?? now())->toDateString(),
            'day_calculation_mode' => $this->resolveFixedExpenseCalculationMode($data['day_calculation_mode'] ?? null),
            'total_monthly_amount' => round((float) $rows->sum('amount'), 2),
            'items_snapshot' => $itemsSnapshot,
            'note' => $data['note'] ?? null,
        ]);

        $this->logChange(
            $accountId,
            $version,
            'created',
            null,
            $version->fresh()->getAttributes(),
            $data['user_id'] ?? auth()->id()
        );

        return $version->fresh('creator');
    }

    public function markFixedExpensePaid(FinanceFixedExpense $expense, array $data): FinanceTransaction
    {
        return DB::transaction(function () use ($expense, $data) {
            $amount = round((float) ($data['amount'] ?? $expense->amount), 2);
            $paidDate = Carbon::parse($data['payment_date'] ?? now());

            $transaction = $this->storeTransaction((int) $expense->account_id, [
                'wallet_id' => $data['wallet_id'] ?? $expense->default_wallet_id,
                'category_id' => $data['category_id'] ?? $expense->category_id,
                'direction' => 'out',
                'transaction_type' => 'fixed_expense',
                'status' => $data['status'] ?? 'confirmed',
                'payment_method' => $data['payment_method'] ?? 'bank_transfer',
                'transaction_date' => $paidDate,
                'amount' => $amount,
                'counterparty_type' => 'supplier',
                'counterparty_name' => $data['counterparty_name'] ?? $expense->name,
                'reference_type' => 'fixed_expense',
                'reference_id' => $expense->id,
                'content' => $data['content'] ?? $expense->name,
                'note' => $data['note'] ?? $expense->note,
                'affects_profit_loss' => true,
                'user_id' => $data['user_id'] ?? auth()->id(),
            ], $data['attachment'] ?? null);

            $expense->last_paid_date = $paidDate->toDateString();
            $expense->next_due_date = $this->nextDueDate(
                $paidDate,
                $expense->frequency,
                (int) $expense->interval_value,
                Carbon::parse($expense->next_due_date)
            )->toDateString();
            $expense->save();

            $this->logChange(
                (int) $expense->account_id,
                $expense,
                'paid',
                null,
                $expense->fresh()->getAttributes(),
                $data['user_id'] ?? auth()->id()
            );

            return $transaction;
        });
    }

    public function storeCatalog(int $accountId, array $data, ?FinanceCatalog $catalog = null): FinanceCatalog
    {
        $this->ensureDefaults($accountId);

        return DB::transaction(function () use ($accountId, $data, $catalog) {
            $isNew = !$catalog;
            $catalog ??= new FinanceCatalog();
            $before = $catalog->exists ? $catalog->getOriginal() : null;

            $catalog->fill([
                'account_id' => $accountId,
                'group_key' => $data['group_key'],
                'code' => $catalog->code ?: $this->sanitizeCode($data['code'] ?? $data['name']),
                'name' => $data['name'],
                'color' => $data['color'] ?? null,
                'is_system' => $catalog->is_system ?? false,
                'is_active' => array_key_exists('is_active', $data) ? (bool) $data['is_active'] : true,
                'sort_order' => (int) ($data['sort_order'] ?? 0),
                'meta' => $data['meta'] ?? null,
            ]);
            $catalog->save();

            $this->logChange(
                $accountId,
                $catalog,
                $isNew ? 'created' : 'updated',
                $before,
                $catalog->fresh()->getAttributes(),
                $data['user_id'] ?? auth()->id()
            );

            return $catalog->fresh();
        });
    }

    public function deleteCatalog(FinanceCatalog $catalog, ?int $userId = null): void
    {
        $before = $catalog->getAttributes();
        $catalog->delete();

        $this->logChange(
            (int) $catalog->account_id,
            $catalog,
            'deleted',
            $before,
            null,
            $userId ?? auth()->id()
        );
    }

    public function catalogGroupLabels(): array
    {
        return [
            'income_type' => 'Loại thu',
            'expense_type' => 'Loại chi',
            'transaction_status' => 'Trạng thái phiếu',
            'loan_status' => 'Trạng thái vay nợ',
            'fixed_expense_type' => 'Loại chi phí cố định',
        ];
    }

    public function catalogPayload(FinanceCatalog $catalog): array
    {
        return [
            'id' => $catalog->id,
            'group_key' => $catalog->group_key,
            'group_label' => $this->catalogGroupLabels()[$catalog->group_key] ?? $catalog->group_key,
            'code' => $catalog->code,
            'name' => $catalog->name,
            'color' => $catalog->color,
            'is_system' => (bool) $catalog->is_system,
            'is_active' => (bool) $catalog->is_active,
            'sort_order' => (int) $catalog->sort_order,
            'meta' => $catalog->meta,
        ];
    }

    public function receiptVoucherStatusOptions(): array
    {
        return [
            ['value' => 'draft', 'label' => 'Nháp', 'color' => '#2563eb'],
            ['value' => 'confirmed', 'label' => 'Đã xác nhận', 'color' => '#16a34a'],
            ['value' => 'cancelled', 'label' => 'Đã hủy', 'color' => '#6b7280'],
        ];
    }

    public function receiptVoucherPaymentMethodOptions(): array
    {
        return [
            ['value' => 'cash', 'label' => 'Tiền mặt'],
            ['value' => 'bank_transfer', 'label' => 'Chuyển khoản'],
            ['value' => 'cod', 'label' => 'COD'],
            ['value' => 'card', 'label' => 'Thẻ'],
            ['value' => 'ewallet', 'label' => 'Ví điện tử'],
            ['value' => 'other', 'label' => 'Khác'],
        ];
    }

    public function receiptVoucherReferenceTypeOptions(): array
    {
        return [
            ['value' => 'order', 'label' => 'Đơn hàng'],
            ['value' => 'shipment', 'label' => 'Vận đơn'],
            ['value' => 'debt', 'label' => 'Công nợ'],
            ['value' => 'return_slip', 'label' => 'Phiếu hoàn'],
            ['value' => 'other', 'label' => 'Liên kết khác'],
        ];
    }

    public function receiptVoucherStatusLabel(?string $value): string
    {
        return collect($this->receiptVoucherStatusOptions())
            ->firstWhere('value', (string) $value)['label'] ?? 'Nháp';
    }

    public function receiptVoucherPaymentMethodLabel(?string $value): string
    {
        return collect($this->receiptVoucherPaymentMethodOptions())
            ->firstWhere('value', (string) $value)['label'] ?? 'Khác';
    }

    public function receiptVoucherReferenceTypeLabel(?string $value): string
    {
        return collect($this->receiptVoucherReferenceTypeOptions())
            ->firstWhere('value', (string) $value)['label'] ?? 'Không liên kết';
    }

    public function storeReceiptVoucher(int $accountId, array $data, ?FinanceTransaction $transaction = null): FinanceTransaction
    {
        $categoryId = $this->resolveReceiptVoucherCategoryId($accountId, $data['category_id'] ?? null);
        $reference = $this->resolveReceiptVoucherReference($accountId, $data);
        $walletId = !empty($data['wallet_id'])
            ? (int) $data['wallet_id']
            : $this->resolveReceiptVoucherWalletId($accountId, $data['payment_method'] ?? null);
        $status = in_array(($data['status'] ?? null), ['draft', 'confirmed', 'cancelled'], true)
            ? $data['status']
            : 'draft';
        $content = trim((string) ($data['content'] ?? ''));
        $existingMetadata = is_array($transaction?->metadata) ? $transaction->metadata : [];
        $metadata = array_merge($existingMetadata, [
            'receipt_reference_type' => $reference['reference_type'],
            'receipt_reference_code' => $reference['reference_code'],
            'receipt_reference_label' => $reference['reference_label'],
            'receipt_reference_summary' => $reference['summary'],
        ]);

        if ($content === '') {
            $content = trim((string) (
                $data['source_name']
                ?? $reference['reference_label']
                ?? $data['counterparty_name']
                ?? 'Phiếu thu'
            ));
        }

        return $this->storeTransaction(
            $accountId,
            [
                'wallet_id' => $walletId,
                'category_id' => $categoryId,
                'source_name' => trim((string) ($data['source_name'] ?? '')) ?: null,
                'direction' => 'in',
                'transaction_type' => FinanceTransaction::TYPE_RECEIPT_VOUCHER,
                'payment_method' => trim((string) ($data['payment_method'] ?? '')) ?: 'other',
                'transaction_date' => $data['transaction_date'] ?? now(),
                'amount' => $data['amount'] ?? 0,
                'counterparty_type' => trim((string) ($data['counterparty_type'] ?? 'customer')) ?: 'customer',
                'counterparty_name' => trim((string) ($data['counterparty_name'] ?? '')) ?: null,
                'counterparty_phone' => trim((string) ($data['counterparty_phone'] ?? '')) ?: null,
                'reference_type' => $reference['reference_type'],
                'reference_id' => $reference['reference_id'],
                'reference_code' => $reference['reference_code'],
                'reference_label' => $reference['reference_label'],
                'content' => Str::limit($content, 255, ''),
                'note' => trim((string) ($data['note'] ?? '')) ?: null,
                'status' => $status,
                'affects_profit_loss' => array_key_exists('affects_profit_loss', $data)
                    ? (bool) $data['affects_profit_loss']
                    : true,
                'metadata' => $metadata,
                'user_id' => $data['user_id'] ?? auth()->id(),
                'code_prefix' => 'PT',
            ],
            $data['attachment'] ?? null,
            $transaction
        );
    }

    public function transactionPayload(FinanceTransaction $transaction): array
    {
        return [
            'id' => $transaction->id,
            'code' => $transaction->code,
            'transaction_date' => optional($transaction->transaction_date)->toIso8601String(),
            'direction' => $transaction->direction,
            'transaction_type' => $transaction->transaction_type,
            'amount' => round((float) $transaction->amount, 2),
            'signed_amount' => round((float) $transaction->signed_amount, 2),
            'payment_method' => $transaction->payment_method,
            'status' => $transaction->status,
            'wallet_id' => $transaction->wallet_id,
            'wallet_name' => $transaction->wallet?->name,
            'wallet_type' => $transaction->wallet?->type,
            'category_id' => $transaction->category_id,
            'category_name' => $transaction->category?->name,
            'category_color' => $transaction->category?->color,
            'source_name' => $transaction->source_name,
            'counterparty_type' => $transaction->counterparty_type,
            'counterparty_name' => $transaction->counterparty_name,
            'counterparty_phone' => $transaction->counterparty_phone,
            'reference_type' => $transaction->reference_type,
            'reference_id' => $transaction->reference_id,
            'reference_code' => $transaction->reference_code,
            'reference_label' => $transaction->reference_label,
            'content' => $transaction->content,
            'note' => $transaction->note,
            'attachment_path' => $transaction->attachment_path,
            'attachment_url' => $transaction->attachment_url,
            'affects_profit_loss' => (bool) $transaction->affects_profit_loss,
            'metadata' => $transaction->metadata,
            'created_by' => $transaction->created_by,
            'created_by_name' => $transaction->creator?->name,
            'updated_by' => $transaction->updated_by,
            'deleted_at' => optional($transaction->deleted_at)->toIso8601String(),
        ];
    }

    public function receiptVoucherPayload(FinanceTransaction $transaction): array
    {
        $base = $this->transactionPayload($transaction);
        $reference = $this->resolveReceiptVoucherReferenceForTransaction($transaction);

        return [
            ...$base,
            'receipt_date' => $base['transaction_date'],
            'receipt_type_id' => $transaction->category_id,
            'receipt_type_name' => $transaction->category?->name,
            'payer_name' => $transaction->counterparty_name,
            'payer_phone' => $transaction->counterparty_phone,
            'payment_method_label' => $this->receiptVoucherPaymentMethodLabel($transaction->payment_method),
            'status_label' => $this->receiptVoucherStatusLabel($transaction->status),
            'reference' => $reference,
        ];
    }

    public function walletPayload(FinanceWallet $wallet, ?Carbon $from = null, ?Carbon $to = null): array
    {
        $summary = null;

        if ($from && $to) {
            $transactions = FinanceTransaction::query()
                ->where('account_id', $wallet->account_id)
                ->where('wallet_id', $wallet->id)
                ->where('status', 'confirmed')
                ->whereBetween('transaction_date', [$from, $to])
                ->get();

            $summary = [
                'opening_balance' => round($this->walletOpeningBalance($wallet, $from), 2),
                'period_inflow' => round((float) $transactions->where('direction', 'in')->sum('amount'), 2),
                'period_outflow' => round((float) $transactions->where('direction', 'out')->sum('amount'), 2),
            ];
            $summary['closing_balance'] = round($summary['opening_balance'] + $summary['period_inflow'] - $summary['period_outflow'], 2);
        }

        return [
            'id' => $wallet->id,
            'code' => $wallet->code,
            'name' => $wallet->name,
            'type' => $wallet->type,
            'bank_name' => $wallet->bank_name,
            'account_number' => $wallet->account_number,
            'currency' => $wallet->currency,
            'opening_balance' => round((float) $wallet->opening_balance, 2),
            'current_balance' => round((float) $wallet->current_balance, 2),
            'color' => $wallet->color,
            'note' => $wallet->note,
            'is_default' => (bool) $wallet->is_default,
            'is_active' => (bool) $wallet->is_active,
            'sort_order' => (int) $wallet->sort_order,
            'balance_updated_at' => optional($wallet->balance_updated_at)->toIso8601String(),
            'period_summary' => $summary,
        ];
    }

    public function transferPayload(FinanceTransfer $transfer): array
    {
        return [
            'id' => $transfer->id,
            'code' => $transfer->code,
            'status' => $transfer->status,
            'transfer_date' => optional($transfer->transfer_date)->toIso8601String(),
            'amount' => round((float) $transfer->amount, 2),
            'content' => $transfer->content,
            'note' => $transfer->note,
            'from_wallet_id' => $transfer->from_wallet_id,
            'from_wallet_name' => $transfer->fromWallet?->name,
            'to_wallet_id' => $transfer->to_wallet_id,
            'to_wallet_name' => $transfer->toWallet?->name,
            'outgoing_transaction_id' => $transfer->outgoing_transaction_id,
            'incoming_transaction_id' => $transfer->incoming_transaction_id,
        ];
    }

    public function loanPayload(FinanceLoan $loan): array
    {
        return [
            'id' => $loan->id,
            'code' => $loan->code,
            'type' => $loan->type,
            'status' => $loan->status,
            'counterparty_name' => $loan->counterparty_name,
            'counterparty_contact' => $loan->counterparty_contact,
            'principal_amount' => round((float) $loan->principal_amount, 2),
            'principal_paid' => round((float) $loan->principal_paid, 2),
            'interest_paid' => round((float) $loan->interest_paid, 2),
            'interest_rate' => $loan->interest_rate !== null ? round((float) $loan->interest_rate, 4) : null,
            'interest_type' => $loan->interest_type,
            'outstanding_principal' => round((float) $loan->outstanding_principal, 2),
            'start_date' => optional($loan->start_date)->toDateString(),
            'due_date' => optional($loan->due_date)->toDateString(),
            'note' => $loan->note,
            'disbursed_wallet_id' => $loan->disbursed_wallet_id,
            'disbursed_wallet_name' => $loan->wallet?->name,
            'payments' => $loan->relationLoaded('payments')
                ? $loan->payments->map(function (FinanceLoanPayment $payment) {
                    return [
                        'id' => $payment->id,
                        'code' => $payment->code,
                        'status' => $payment->status,
                        'payment_date' => optional($payment->payment_date)->toIso8601String(),
                        'principal_amount' => round((float) $payment->principal_amount, 2),
                        'interest_amount' => round((float) $payment->interest_amount, 2),
                        'total_amount' => round((float) $payment->total_amount, 2),
                        'wallet_id' => $payment->wallet_id,
                        'wallet_name' => $payment->wallet?->name,
                        'note' => $payment->note,
                    ];
                })->values()
                : [],
        ];
    }

    public function fixedExpensePayload(FinanceFixedExpense $expense): array
    {
        $daysUntilDue = $expense->next_due_date
            ? Carbon::now()->startOfDay()->diffInDays(Carbon::parse($expense->next_due_date), false)
            : null;

        return [
            'id' => $expense->id,
            'code' => $expense->code,
            'name' => $expense->name,
            'content' => $expense->name,
            'amount' => round((float) $expense->amount, 2),
            'monthly_amount' => round((float) $expense->amount, 2),
            'sort_order' => (int) $expense->sort_order,
            'frequency' => $expense->frequency,
            'interval_value' => (int) $expense->interval_value,
            'reminder_days' => (int) $expense->reminder_days,
            'status' => $expense->status,
            'start_date' => optional($expense->start_date)->toDateString(),
            'effective_date' => optional($expense->start_date)->toDateString(),
            'next_due_date' => optional($expense->next_due_date)->toDateString(),
            'last_paid_date' => optional($expense->last_paid_date)->toDateString(),
            'days_until_due' => $daysUntilDue,
            'category_id' => $expense->category_id,
            'category_name' => $expense->category?->name,
            'category_color' => $expense->category?->color,
            'default_wallet_id' => $expense->default_wallet_id,
            'default_wallet_name' => $expense->wallet?->name,
            'note' => $expense->note,
        ];
    }

    public function fixedExpenseVersionPayload(FinanceFixedExpenseVersion $version, ?Carbon $forDate = null): array
    {
        $appliesToDate = ($forDate ?: ($version->effective_date instanceof Carbon ? $version->effective_date->copy() : Carbon::parse($version->effective_date)))->copy();
        $mode = $this->resolveFixedExpenseCalculationMode($version->day_calculation_mode);
        $daysInMonth = $this->resolveFixedExpenseDaysInMonth($appliesToDate, $mode);
        $items = collect($version->items_snapshot ?? [])
            ->map(function (array $item) {
                return [
                    'line_key' => (string) ($item['line_key'] ?? $item['fixed_expense_id'] ?? Str::uuid()),
                    'id' => !empty($item['fixed_expense_id']) ? (int) $item['fixed_expense_id'] : null,
                    'fixed_expense_id' => !empty($item['fixed_expense_id']) ? (int) $item['fixed_expense_id'] : null,
                    'content' => $item['content'] ?? '',
                    'monthly_amount' => round((float) ($item['monthly_amount'] ?? 0), 2),
                    'sort_order' => (int) ($item['sort_order'] ?? 0),
                ];
            })
            ->sortBy('sort_order')
            ->values();

        $totalMonthlyAmount = round((float) ($version->total_monthly_amount ?: $items->sum('monthly_amount')), 2);

        return [
            'id' => $version->id,
            'effective_date' => optional($version->effective_date)->toDateString(),
            'day_calculation_mode' => $mode,
            'day_calculation_label' => $this->fixedExpenseCalculationModeLabel($mode),
            'total_monthly_amount' => $totalMonthlyAmount,
            'days_in_month' => $daysInMonth,
            'daily_amount' => $daysInMonth > 0 ? round($totalMonthlyAmount / $daysInMonth, 2) : 0,
            'items' => $items,
            'note' => $version->note,
            'created_at' => optional($version->created_at)->toIso8601String(),
            'created_by' => $version->created_by,
            'created_by_name' => $version->creator?->name,
            'applies_to_date' => $appliesToDate->toDateString(),
        ];
    }

    public function dailyProfitConfigPayload(?FinanceDailyProfitConfigVersion $version, ?Carbon $forDate = null): array
    {
        $appliesToDate = ($forDate ?: ($version?->effective_date instanceof Carbon ? $version->effective_date->copy() : now()))->copy();
        $shippingMode = $this->resolveDailyProfitShippingMode($version?->shipping_calculation_mode);
        $returnRate = round((float) ($version?->return_rate ?? 0), 4);

        return [
            'id' => $version?->id,
            'effective_date' => optional($version?->effective_date)->toDateString(),
            'return_rate' => $returnRate,
            'return_rate_ratio' => round($returnRate / 100, 6),
            'packaging_cost_per_order' => round((float) ($version?->packaging_cost_per_order ?? 0), 2),
            'shipping_calculation_mode' => $shippingMode,
            'shipping_calculation_label' => $this->dailyProfitShippingModeLabel($shippingMode),
            'shipping_cost_per_order' => round((float) ($version?->shipping_cost_per_order ?? 0), 2),
            'shipping_cost_rate' => round((float) ($version?->shipping_cost_rate ?? 0), 4),
            'tax_rate' => round((float) ($version?->tax_rate ?? 1.5), 4),
            'salary_daily_amount' => 0,
            'facebook_ads_daily_amount' => 0,
            'note' => $version?->note,
            'created_at' => optional($version?->created_at)->toIso8601String(),
            'created_by' => $version?->created_by,
            'created_by_name' => $version?->creator?->name,
            'applies_to_date' => $appliesToDate->toDateString(),
        ];
    }

    public function logChange(int $accountId, Model $subject, string $action, $before, $after, ?int $userId = null): void
    {
        FinanceChangeLog::query()->create([
            'account_id' => $accountId,
            'changed_by' => $userId,
            'subject_type' => class_basename($subject),
            'subject_id' => $subject->getKey(),
            'action' => $action,
            'before_data' => $before,
            'after_data' => $after,
            'created_at' => now(),
        ]);
    }

    public function nextCode(string $modelClass, string $prefix, int $accountId): string
    {
        $query = $modelClass::query()->where('account_id', $accountId);

        if (in_array('Illuminate\\Database\\Eloquent\\SoftDeletes', class_uses_recursive($modelClass), true)) {
            $query = $query->withTrashed();
        }

        $lastCode = (string) $query
            ->where('code', 'like', $prefix . '%')
            ->orderByDesc('id')
            ->value('code');

        $number = 1;
        if ($lastCode && preg_match('/(\d+)$/', $lastCode, $matches) === 1) {
            $number = (int) $matches[1] + 1;
        }

        return sprintf('%s%05d', $prefix, $number);
    }

    public function sanitizeCode(string $value): string
    {
        $sanitized = Str::upper(Str::slug($value, '_'));

        return $sanitized !== '' ? $sanitized : Str::upper(Str::random(6));
    }

    private function resolveReceiptVoucherCategoryId(int $accountId, $categoryId): ?int
    {
        if (!$categoryId) {
            return null;
        }

        $category = FinanceCatalog::query()
            ->where('account_id', $accountId)
            ->where('group_key', 'income_type')
            ->find((int) $categoryId);

        if (!$category) {
            throw new InvalidArgumentException('Loại thu không hợp lệ.');
        }

        return (int) $category->id;
    }

    private function resolveReceiptVoucherWalletId(int $accountId, ?string $paymentMethod): ?int
    {
        $resolvedMethod = trim((string) $paymentMethod);

        if ($resolvedMethod === 'cash') {
            return FinanceWallet::query()
                ->where('account_id', $accountId)
                ->where('type', 'cash')
                ->where('is_active', true)
                ->orderByDesc('is_default')
                ->orderBy('sort_order')
                ->value('id');
        }

        if (in_array($resolvedMethod, ['bank_transfer', 'cod', 'card', 'ewallet'], true)) {
            return FinanceWallet::query()
                ->where('account_id', $accountId)
                ->where('type', 'bank')
                ->where('is_active', true)
                ->orderByDesc('is_default')
                ->orderBy('sort_order')
                ->value('id');
        }

        return null;
    }

    private function resolveReceiptVoucherReference(int $accountId, array $data): array
    {
        $referenceType = trim((string) ($data['reference_type'] ?? ''));
        $referenceId = !empty($data['reference_id']) ? (int) $data['reference_id'] : null;
        $referenceCode = trim((string) ($data['reference_code'] ?? '')) ?: null;
        $referenceLabel = trim((string) ($data['reference_label'] ?? '')) ?: null;

        if ($referenceType === '') {
            return [
                'reference_type' => null,
                'reference_id' => null,
                'reference_code' => null,
                'reference_label' => null,
                'summary' => null,
            ];
        }

        if ($referenceType === 'order') {
            if (!$referenceId) {
                throw new InvalidArgumentException('Phiếu thu liên kết đơn hàng cần chọn đơn hàng.');
            }

            $order = Order::query()
                ->withTrashed()
                ->where('account_id', $accountId)
                ->find($referenceId);

            if (!$order) {
                throw new InvalidArgumentException('Không tìm thấy đơn hàng liên kết.');
            }

            return [
                'reference_type' => 'order',
                'reference_id' => (int) $order->id,
                'reference_code' => $order->order_number ?: $referenceCode,
                'reference_label' => $order->customer_name ?: $referenceLabel ?: 'Đơn hàng',
                'summary' => sprintf('Đơn %s', $order->order_number ?: ('#' . $order->id)),
            ];
        }

        if ($referenceType === 'shipment') {
            if (!$referenceId) {
                throw new InvalidArgumentException('Phiếu thu liên kết vận đơn cần chọn vận đơn.');
            }

            $shipment = Shipment::query()
                ->withTrashed()
                ->where('account_id', $accountId)
                ->find($referenceId);

            if (!$shipment) {
                throw new InvalidArgumentException('Không tìm thấy vận đơn liên kết.');
            }

            $shipmentCode = $shipment->carrier_tracking_code ?: $shipment->tracking_number ?: $shipment->shipment_number;

            return [
                'reference_type' => 'shipment',
                'reference_id' => (int) $shipment->id,
                'reference_code' => $shipmentCode ?: $referenceCode,
                'reference_label' => $shipment->customer_name ?: $referenceLabel ?: 'Vận đơn',
                'summary' => sprintf('Vận đơn %s', $shipmentCode ?: ('#' . $shipment->id)),
            ];
        }

        if ($referenceType === 'return_slip') {
            if (!$referenceId) {
                throw new InvalidArgumentException('Phiếu thu liên kết phiếu hoàn cần chọn phiếu hoàn.');
            }

            $document = InventoryDocument::query()
                ->withTrashed()
                ->where('account_id', $accountId)
                ->where('type', 'return')
                ->find($referenceId);

            if (!$document) {
                throw new InvalidArgumentException('Không tìm thấy phiếu hoàn liên kết.');
            }

            return [
                'reference_type' => 'return_slip',
                'reference_id' => (int) $document->id,
                'reference_code' => $document->document_number ?: $referenceCode,
                'reference_label' => $referenceLabel ?: 'Phiếu hoàn',
                'summary' => sprintf('Phiếu hoàn %s', $document->document_number ?: ('#' . $document->id)),
            ];
        }

        if (in_array($referenceType, ['debt', 'other'], true)) {
            if (!$referenceCode && !$referenceLabel) {
                throw new InvalidArgumentException('Liên kết công nợ hoặc liên kết khác cần có mã hoặc nhãn tham chiếu.');
            }

            return [
                'reference_type' => $referenceType,
                'reference_id' => null,
                'reference_code' => $referenceCode,
                'reference_label' => $referenceLabel,
                'summary' => trim(implode(' - ', array_filter([$referenceCode, $referenceLabel]))),
            ];
        }

        throw new InvalidArgumentException('Loại liên kết phiếu thu không hợp lệ.');
    }

    private function resolveReceiptVoucherReferenceForTransaction(FinanceTransaction $transaction): array
    {
        $type = $transaction->reference_type;
        $id = $transaction->reference_id ? (int) $transaction->reference_id : null;
        $code = $transaction->reference_code;
        $label = $transaction->reference_label;
        $route = null;
        $status = null;

        if ($type === 'order' && $id) {
            $order = Order::query()
                ->withTrashed()
                ->where('account_id', $transaction->account_id)
                ->find($id);

            if ($order) {
                $code = $order->order_number ?: $code;
                $label = $order->customer_name ?: $label;
                $route = '/admin/orders/' . $order->id;
                $status = $order->status;
            }
        } elseif ($type === 'shipment' && $id) {
            $shipment = Shipment::query()
                ->withTrashed()
                ->where('account_id', $transaction->account_id)
                ->find($id);

            if ($shipment) {
                $code = $shipment->carrier_tracking_code ?: $shipment->tracking_number ?: $shipment->shipment_number ?: $code;
                $label = $shipment->customer_name ?: $label;
                $route = '/admin/shipments';
                $status = $shipment->shipment_status ?: $shipment->status;
            }
        } elseif ($type === 'return_slip' && $id) {
            $document = InventoryDocument::query()
                ->withTrashed()
                ->where('account_id', $transaction->account_id)
                ->find($id);

            if ($document) {
                $code = $document->document_number ?: $code;
                $label = $label ?: 'Phiếu hoàn';
                $route = '/admin/inventory';
                $status = $document->status;
            }
        }

        $summary = trim(implode(' - ', array_filter([$code, $label])));

        return [
            'type' => $type,
            'type_label' => $this->receiptVoucherReferenceTypeLabel($type),
            'id' => $id,
            'code' => $code,
            'label' => $label,
            'summary' => $summary !== '' ? $summary : null,
            'route' => $route,
            'status' => $status,
        ];
    }

    private function defaultCatalogs(): array
    {
        return [
            ['group_key' => 'income_type', 'code' => 'ban_hang', 'name' => 'Bán hàng', 'color' => '#0f766e', 'sort_order' => 1],
            ['group_key' => 'income_type', 'code' => 'thu_cong_no', 'name' => 'Thu công nợ', 'color' => '#0ea5e9', 'sort_order' => 2],
            ['group_key' => 'income_type', 'code' => 'thu_khac', 'name' => 'Thu khác', 'color' => '#22c55e', 'sort_order' => 3],
            ['group_key' => 'income_type', 'code' => 'thu_lai_vay', 'name' => 'Thu lãi vay', 'color' => '#8b5cf6', 'sort_order' => 4],

            ['group_key' => 'expense_type', 'code' => 'nhap_hang', 'name' => 'Nhập hàng', 'color' => '#f97316', 'sort_order' => 1],
            ['group_key' => 'expense_type', 'code' => 'chi_van_hanh', 'name' => 'Chi vận hành', 'color' => '#ef4444', 'sort_order' => 2],
            ['group_key' => 'expense_type', 'code' => 'chi_luong', 'name' => 'Chi lương', 'color' => '#b91c1c', 'sort_order' => 3],
            ['group_key' => 'expense_type', 'code' => 'chi_marketing', 'name' => 'Chi marketing', 'color' => '#f59e0b', 'sort_order' => 4],
            ['group_key' => 'expense_type', 'code' => 'chi_khac', 'name' => 'Chi khác', 'color' => '#6b7280', 'sort_order' => 5],

            ['group_key' => 'transaction_status', 'code' => 'confirmed', 'name' => 'Đã xác nhận', 'color' => '#16a34a', 'sort_order' => 1],
            ['group_key' => 'transaction_status', 'code' => 'pending', 'name' => 'Chờ xác nhận', 'color' => '#f59e0b', 'sort_order' => 2],
            ['group_key' => 'transaction_status', 'code' => 'draft', 'name' => 'Nháp', 'color' => '#2563eb', 'sort_order' => 3],
            ['group_key' => 'transaction_status', 'code' => 'cancelled', 'name' => 'Đã hủy', 'color' => '#6b7280', 'sort_order' => 4],

            ['group_key' => 'loan_status', 'code' => 'active', 'name' => 'Đang theo dõi', 'color' => '#0ea5e9', 'sort_order' => 1],
            ['group_key' => 'loan_status', 'code' => 'closed', 'name' => 'Đã tất toán', 'color' => '#16a34a', 'sort_order' => 2],
            ['group_key' => 'loan_status', 'code' => 'overdue', 'name' => 'Quá hạn', 'color' => '#dc2626', 'sort_order' => 3],
            ['group_key' => 'loan_status', 'code' => 'suspended', 'name' => 'Tạm dừng', 'color' => '#6b7280', 'sort_order' => 4],

            ['group_key' => 'fixed_expense_type', 'code' => 'thue_mat_bang', 'name' => 'Thuê mặt bằng', 'color' => '#92400e', 'sort_order' => 1],
            ['group_key' => 'fixed_expense_type', 'code' => 'dien_nuoc', 'name' => 'Điện nước', 'color' => '#0284c7', 'sort_order' => 2],
            ['group_key' => 'fixed_expense_type', 'code' => 'internet', 'name' => 'Internet', 'color' => '#7c3aed', 'sort_order' => 3],
            ['group_key' => 'fixed_expense_type', 'code' => 'luong', 'name' => 'Lương', 'color' => '#dc2626', 'sort_order' => 4],
            ['group_key' => 'fixed_expense_type', 'code' => 'phan_mem', 'name' => 'Phần mềm', 'color' => '#16a34a', 'sort_order' => 5],
        ];
    }

    private function defaultWallets(): array
    {
        return [
            [
                'code' => 'CASH_MAIN',
                'name' => 'Quỹ tiền mặt',
                'type' => 'cash',
                'opening_balance' => 0,
                'current_balance' => 0,
                'currency' => 'VND',
                'color' => '#f97316',
                'note' => 'Quỹ mặc định của hệ thống',
                'is_default' => true,
                'is_active' => true,
                'sort_order' => 1,
            ],
            [
                'code' => 'BANK_MAIN',
                'name' => 'Tài khoản ngân hàng chính',
                'type' => 'bank',
                'bank_name' => 'Ngân hàng chính',
                'opening_balance' => 0,
                'current_balance' => 0,
                'currency' => 'VND',
                'color' => '#2563eb',
                'note' => 'Tài khoản mặc định của hệ thống',
                'is_default' => true,
                'is_active' => true,
                'sort_order' => 2,
            ],
        ];
    }
}
