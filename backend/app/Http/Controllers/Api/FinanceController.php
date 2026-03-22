<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\FinanceCatalog;
use App\Models\FinanceFixedExpense;
use App\Models\FinanceLoan;
use App\Models\FinanceLoanPayment;
use App\Models\FinanceTransaction;
use App\Models\FinanceTransfer;
use App\Models\FinanceWallet;
use App\Services\Finance\FinanceReadService;
use App\Services\Finance\FinanceService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class FinanceController extends Controller
{
    public function __construct(
        private readonly FinanceService $financeService,
        private readonly FinanceReadService $financeReadService,
    ) {
    }

    public function dashboard(Request $request)
    {
        return response()->json($this->financeReadService->dashboard($this->accountId($request), $request->all()));
    }

    public function options(Request $request)
    {
        return response()->json($this->financeReadService->options($this->accountId($request)));
    }

    public function transactions(Request $request)
    {
        return response()->json($this->financeReadService->paginatedTransactions($this->accountId($request), $request->all()));
    }

    public function storeTransaction(Request $request)
    {
        $validated = $request->validate([
            'wallet_id' => 'nullable|integer|exists:finance_wallets,id',
            'category_id' => 'nullable|integer|exists:finance_catalogs,id',
            'direction' => ['required', Rule::in(['in', 'out'])],
            'transaction_type' => 'nullable|string|max:60',
            'payment_method' => 'nullable|string|max:60',
            'transaction_date' => 'required|date',
            'amount' => 'required|numeric|min:0.01',
            'counterparty_type' => 'nullable|string|max:80',
            'counterparty_name' => 'nullable|string|max:180',
            'reference_type' => 'nullable|string|max:80',
            'reference_id' => 'nullable|integer',
            'content' => 'nullable|string|max:255',
            'note' => 'nullable|string|max:5000',
            'status' => ['nullable', Rule::in(['confirmed', 'pending', 'draft', 'cancelled'])],
            'affects_profit_loss' => 'nullable|boolean',
            'attachment' => 'nullable|file|max:10240',
        ]);

        $transaction = $this->financeService->storeTransaction(
            $this->accountId($request),
            [...$validated, 'user_id' => auth()->id()],
            $request->file('attachment')
        );

        return response()->json($this->financeService->transactionPayload($transaction), 201);
    }

    public function updateTransaction(Request $request, int $id)
    {
        $transaction = FinanceTransaction::query()->findOrFail($id);

        if (in_array($transaction->transaction_type, ['transfer_in', 'transfer_out', 'loan_disbursement', 'loan_payment'], true)) {
            return response()->json(['message' => 'Phiếu được sinh tự động, vui lòng sửa từ phân hệ nguồn.'], 422);
        }

        $validated = $request->validate([
            'wallet_id' => 'nullable|integer|exists:finance_wallets,id',
            'category_id' => 'nullable|integer|exists:finance_catalogs,id',
            'direction' => ['required', Rule::in(['in', 'out'])],
            'transaction_type' => 'nullable|string|max:60',
            'payment_method' => 'nullable|string|max:60',
            'transaction_date' => 'required|date',
            'amount' => 'required|numeric|min:0.01',
            'counterparty_type' => 'nullable|string|max:80',
            'counterparty_name' => 'nullable|string|max:180',
            'reference_type' => 'nullable|string|max:80',
            'reference_id' => 'nullable|integer',
            'content' => 'nullable|string|max:255',
            'note' => 'nullable|string|max:5000',
            'status' => ['nullable', Rule::in(['confirmed', 'pending', 'draft', 'cancelled'])],
            'affects_profit_loss' => 'nullable|boolean',
            'remove_attachment' => 'nullable|boolean',
            'attachment' => 'nullable|file|max:10240',
        ]);

        $updated = $this->financeService->storeTransaction(
            $this->accountId($request),
            [...$validated, 'user_id' => auth()->id()],
            $request->file('attachment'),
            $transaction
        );

        return response()->json($this->financeService->transactionPayload($updated));
    }

    public function destroyTransaction(Request $request, int $id)
    {
        $transaction = FinanceTransaction::query()->findOrFail($id);
        $this->financeService->deleteTransaction($transaction, auth()->id());

        return response()->json(['message' => 'Đã xóa mềm phiếu thu chi.']);
    }

    public function restoreTransaction(Request $request, int $id)
    {
        $transaction = FinanceTransaction::withTrashed()->findOrFail($id);
        $restored = $this->financeService->restoreTransaction($transaction, auth()->id());

        return response()->json($this->financeService->transactionPayload($restored));
    }

    public function wallets(Request $request)
    {
        return response()->json($this->financeReadService->wallets($this->accountId($request), $request->all()));
    }

    public function storeWallet(Request $request)
    {
        $validated = $request->validate([
            'code' => 'nullable|string|max:120',
            'name' => 'required|string|max:180',
            'type' => ['required', Rule::in(['cash', 'bank'])],
            'bank_name' => 'nullable|string|max:180',
            'account_number' => 'nullable|string|max:80',
            'currency' => 'nullable|string|max:10',
            'opening_balance' => 'nullable|numeric',
            'color' => 'nullable|string|max:20',
            'note' => 'nullable|string|max:5000',
            'is_default' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
            'sort_order' => 'nullable|integer|min:0',
        ]);

        $wallet = $this->financeService->storeWallet($this->accountId($request), [...$validated, 'user_id' => auth()->id()]);

        return response()->json($this->financeService->walletPayload($wallet), 201);
    }

    public function updateWallet(Request $request, int $id)
    {
        $wallet = FinanceWallet::query()->findOrFail($id);
        $validated = $request->validate([
            'name' => 'required|string|max:180',
            'type' => ['required', Rule::in(['cash', 'bank'])],
            'bank_name' => 'nullable|string|max:180',
            'account_number' => 'nullable|string|max:80',
            'currency' => 'nullable|string|max:10',
            'opening_balance' => 'nullable|numeric',
            'color' => 'nullable|string|max:20',
            'note' => 'nullable|string|max:5000',
            'is_default' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
            'sort_order' => 'nullable|integer|min:0',
        ]);

        $updated = $this->financeService->storeWallet($this->accountId($request), [...$validated, 'user_id' => auth()->id()], $wallet);

        return response()->json($this->financeService->walletPayload($updated));
    }

    public function adjustWallet(Request $request, int $id)
    {
        $wallet = FinanceWallet::query()->findOrFail($id);
        $validated = $request->validate([
            'amount' => 'required|numeric|not_in:0',
            'transaction_date' => 'nullable|date',
            'content' => 'nullable|string|max:255',
            'reason' => 'nullable|string|max:255',
            'note' => 'nullable|string|max:5000',
        ]);

        $transaction = $this->financeService->adjustWallet($wallet, [...$validated, 'user_id' => auth()->id()]);

        return response()->json($this->financeService->transactionPayload($transaction), 201);
    }

    public function walletLedger(Request $request, int $id)
    {
        $wallet = FinanceWallet::query()->findOrFail($id);

        return response()->json($this->financeReadService->walletLedger($wallet, $request->all()));
    }

    public function transfers(Request $request)
    {
        return response()->json($this->financeReadService->paginatedTransfers($this->accountId($request), $request->all()));
    }

    public function storeTransfer(Request $request)
    {
        $validated = $request->validate([
            'from_wallet_id' => 'required|integer|exists:finance_wallets,id',
            'to_wallet_id' => 'required|integer|exists:finance_wallets,id',
            'transfer_date' => 'required|date',
            'amount' => 'required|numeric|min:0.01',
            'status' => ['nullable', Rule::in(['confirmed', 'pending', 'draft'])],
            'content' => 'nullable|string|max:255',
            'note' => 'nullable|string|max:5000',
        ]);

        $transfer = $this->financeService->storeTransfer($this->accountId($request), [...$validated, 'user_id' => auth()->id()]);

        return response()->json($this->financeService->transferPayload($transfer), 201);
    }

    public function destroyTransfer(Request $request, int $id)
    {
        $transfer = FinanceTransfer::query()->with(['outgoingTransaction', 'incomingTransaction'])->findOrFail($id);
        $this->financeService->deleteTransfer($transfer, auth()->id());

        return response()->json(['message' => 'Đã xóa mềm giao dịch chuyển tiền nội bộ.']);
    }

    public function loans(Request $request)
    {
        return response()->json($this->financeReadService->paginatedLoans($this->accountId($request), $request->all()));
    }

    public function storeLoan(Request $request)
    {
        $validated = $request->validate([
            'type' => ['required', Rule::in(['borrowed', 'lent'])],
            'status' => ['nullable', Rule::in(['active', 'closed', 'overdue', 'suspended'])],
            'counterparty_name' => 'required|string|max:180',
            'counterparty_contact' => 'nullable|string|max:180',
            'principal_amount' => 'required|numeric|min:0.01',
            'interest_rate' => 'nullable|numeric|min:0',
            'interest_type' => ['nullable', Rule::in(['percent', 'fixed'])],
            'start_date' => 'required|date',
            'due_date' => 'nullable|date|after_or_equal:start_date',
            'disbursed_wallet_id' => 'nullable|integer|exists:finance_wallets,id',
            'note' => 'nullable|string|max:5000',
            'create_disbursement' => 'nullable|boolean',
        ]);

        $loan = $this->financeService->storeLoan($this->accountId($request), [...$validated, 'user_id' => auth()->id()]);

        return response()->json($this->financeService->loanPayload($loan), 201);
    }

    public function updateLoan(Request $request, int $id)
    {
        $loan = FinanceLoan::query()->findOrFail($id);
        $validated = $request->validate([
            'type' => ['required', Rule::in(['borrowed', 'lent'])],
            'status' => ['nullable', Rule::in(['active', 'closed', 'overdue', 'suspended'])],
            'counterparty_name' => 'required|string|max:180',
            'counterparty_contact' => 'nullable|string|max:180',
            'principal_amount' => 'required|numeric|min:0.01',
            'interest_rate' => 'nullable|numeric|min:0',
            'interest_type' => ['nullable', Rule::in(['percent', 'fixed'])],
            'start_date' => 'required|date',
            'due_date' => 'nullable|date|after_or_equal:start_date',
            'disbursed_wallet_id' => 'nullable|integer|exists:finance_wallets,id',
            'note' => 'nullable|string|max:5000',
            'create_disbursement' => 'nullable|boolean',
        ]);

        if ((float) $validated['principal_amount'] < (float) $loan->principal_paid) {
            return response()->json(['message' => 'Gốc vay không được nhỏ hơn số gốc đã thanh toán.'], 422);
        }

        $updated = $this->financeService->storeLoan($this->accountId($request), [...$validated, 'user_id' => auth()->id()], $loan);

        return response()->json($this->financeService->loanPayload($updated));
    }

    public function destroyLoan(Request $request, int $id)
    {
        $loan = FinanceLoan::query()->with(['payments.transaction', 'disbursementTransaction'])->findOrFail($id);
        $this->financeService->deleteLoan($loan, auth()->id());

        return response()->json(['message' => 'Đã xóa mềm khoản vay.']);
    }

    public function storeLoanPayment(Request $request, int $id)
    {
        $loan = FinanceLoan::query()->findOrFail($id);
        $validated = $request->validate([
            'wallet_id' => 'nullable|integer|exists:finance_wallets,id',
            'payment_date' => 'required|date',
            'principal_amount' => 'nullable|numeric|min:0',
            'interest_amount' => 'nullable|numeric|min:0',
            'total_amount' => 'nullable|numeric|min:0.01',
            'status' => ['nullable', Rule::in(['confirmed', 'pending', 'draft'])],
            'payment_method' => 'nullable|string|max:60',
            'note' => 'nullable|string|max:5000',
        ]);

        $payment = $this->financeService->storeLoanPayment($loan, [...$validated, 'user_id' => auth()->id()]);

        return response()->json($payment, 201);
    }

    public function destroyLoanPayment(Request $request, int $paymentId)
    {
        $payment = FinanceLoanPayment::query()->with(['transaction', 'loan'])->findOrFail($paymentId);
        $this->financeService->deleteLoanPayment($payment, auth()->id());

        return response()->json(['message' => 'Đã xóa mềm lịch sử thanh toán khoản vay.']);
    }

    public function fixedExpenses(Request $request)
    {
        return response()->json($this->financeReadService->fixedExpenses($this->accountId($request), $request->all()));
    }

    public function storeFixedExpense(Request $request)
    {
        $validated = $request->validate([
            'category_id' => 'nullable|integer|exists:finance_catalogs,id',
            'default_wallet_id' => 'nullable|integer|exists:finance_wallets,id',
            'name' => 'required|string|max:180',
            'amount' => 'required|numeric|min:0.01',
            'frequency' => ['nullable', Rule::in(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'])],
            'interval_value' => 'nullable|integer|min:1',
            'reminder_days' => 'nullable|integer|min:0|max:365',
            'status' => ['nullable', Rule::in(['active', 'paused', 'stopped'])],
            'start_date' => 'required|date',
            'next_due_date' => 'nullable|date|after_or_equal:start_date',
            'last_paid_date' => 'nullable|date',
            'note' => 'nullable|string|max:5000',
        ]);

        $expense = $this->financeService->storeFixedExpense($this->accountId($request), [...$validated, 'user_id' => auth()->id()]);

        return response()->json($this->financeService->fixedExpensePayload($expense), 201);
    }

    public function updateFixedExpense(Request $request, int $id)
    {
        $expense = FinanceFixedExpense::query()->findOrFail($id);
        $validated = $request->validate([
            'category_id' => 'nullable|integer|exists:finance_catalogs,id',
            'default_wallet_id' => 'nullable|integer|exists:finance_wallets,id',
            'name' => 'required|string|max:180',
            'amount' => 'required|numeric|min:0.01',
            'frequency' => ['nullable', Rule::in(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'])],
            'interval_value' => 'nullable|integer|min:1',
            'reminder_days' => 'nullable|integer|min:0|max:365',
            'status' => ['nullable', Rule::in(['active', 'paused', 'stopped'])],
            'start_date' => 'required|date',
            'next_due_date' => 'nullable|date|after_or_equal:start_date',
            'last_paid_date' => 'nullable|date',
            'note' => 'nullable|string|max:5000',
        ]);

        $updated = $this->financeService->storeFixedExpense($this->accountId($request), [...$validated, 'user_id' => auth()->id()], $expense);

        return response()->json($this->financeService->fixedExpensePayload($updated));
    }

    public function destroyFixedExpense(Request $request, int $id)
    {
        $expense = FinanceFixedExpense::query()->findOrFail($id);
        $this->financeService->deleteFixedExpense($expense, auth()->id());

        return response()->json(['message' => 'Đã xóa mềm chi phí cố định.']);
    }

    public function payFixedExpense(Request $request, int $id)
    {
        $expense = FinanceFixedExpense::query()->findOrFail($id);
        $validated = $request->validate([
            'wallet_id' => 'nullable|integer|exists:finance_wallets,id',
            'category_id' => 'nullable|integer|exists:finance_catalogs,id',
            'payment_date' => 'required|date',
            'amount' => 'nullable|numeric|min:0.01',
            'status' => ['nullable', Rule::in(['confirmed', 'pending', 'draft'])],
            'payment_method' => 'nullable|string|max:60',
            'counterparty_name' => 'nullable|string|max:180',
            'content' => 'nullable|string|max:255',
            'note' => 'nullable|string|max:5000',
            'attachment' => 'nullable|file|max:10240',
        ]);

        $transaction = $this->financeService->markFixedExpensePaid($expense, [
            ...$validated,
            'attachment' => $request->file('attachment'),
            'user_id' => auth()->id(),
        ]);

        return response()->json($this->financeService->transactionPayload($transaction), 201);
    }

    public function catalogs(Request $request)
    {
        return response()->json($this->financeReadService->catalogs($this->accountId($request), $request->all()));
    }

    public function storeCatalog(Request $request)
    {
        $validated = $request->validate([
            'group_key' => ['required', Rule::in(['income_type', 'expense_type', 'transaction_status', 'loan_status', 'fixed_expense_type'])],
            'code' => 'nullable|string|max:120',
            'name' => 'required|string|max:180',
            'color' => 'nullable|string|max:20',
            'is_active' => 'nullable|boolean',
            'sort_order' => 'nullable|integer|min:0',
        ]);

        $catalog = $this->financeService->storeCatalog($this->accountId($request), [...$validated, 'user_id' => auth()->id()]);

        return response()->json($this->financeService->catalogPayload($catalog), 201);
    }

    public function updateCatalog(Request $request, int $id)
    {
        $catalog = FinanceCatalog::query()->findOrFail($id);
        $validated = $request->validate([
            'group_key' => ['required', Rule::in(['income_type', 'expense_type', 'transaction_status', 'loan_status', 'fixed_expense_type'])],
            'name' => 'required|string|max:180',
            'color' => 'nullable|string|max:20',
            'is_active' => 'nullable|boolean',
            'sort_order' => 'nullable|integer|min:0',
        ]);

        $updated = $this->financeService->storeCatalog($this->accountId($request), [...$validated, 'user_id' => auth()->id()], $catalog);

        return response()->json($this->financeService->catalogPayload($updated));
    }

    public function destroyCatalog(Request $request, int $id)
    {
        $catalog = FinanceCatalog::query()->findOrFail($id);

        if ($catalog->is_system) {
            return response()->json(['message' => 'Danh mục hệ thống chỉ được phép tắt hoặc đổi màu, không xóa.'], 422);
        }

        $this->financeService->deleteCatalog($catalog, auth()->id());

        return response()->json(['message' => 'Đã xóa mềm danh mục.']);
    }

    public function reports(Request $request)
    {
        return response()->json($this->financeReadService->reports($this->accountId($request), $request->all()));
    }

    private function accountId(Request $request): int
    {
        return (int) $request->header('X-Account-Id');
    }
}
