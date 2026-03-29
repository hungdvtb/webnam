<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\FinanceCatalog;
use App\Models\FinanceTransaction;
use App\Models\FinanceTransfer;
use App\Services\Finance\FinanceCashbookService;
use App\Services\Finance\FinanceService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use InvalidArgumentException;

class FinanceCashbookController extends Controller
{
    public function __construct(
        private readonly FinanceCashbookService $cashbookService,
        private readonly FinanceService $financeService,
    ) {
    }

    public function index(Request $request)
    {
        $accountId = $this->accountId($request);

        $validated = $request->validate([
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date',
            'range' => 'nullable|string|max:20',
            'voucher_type' => ['nullable', Rule::in(['income', 'expense', 'transfer'])],
            'wallet_id' => [
                'nullable',
                'integer',
                Rule::exists('finance_wallets', 'id')->where(fn ($query) => $query->where('account_id', $accountId)),
            ],
            'keyword' => 'nullable|string|max:180',
            'page' => 'nullable|integer|min:1',
            'per_page' => 'nullable|integer|min:1|max:100',
        ]);

        return response()->json($this->cashbookService->cashbook($accountId, $validated));
    }

    public function storeEntry(Request $request)
    {
        $accountId = $this->accountId($request);
        $validated = $this->validateEntryPayload($request, $accountId);

        try {
            if ($validated['voucher_type'] === 'transfer') {
                $transfer = $this->financeService->storeTransfer($accountId, [
                    'from_wallet_id' => $validated['from_wallet_id'],
                    'to_wallet_id' => $validated['to_wallet_id'],
                    'transfer_date' => $validated['transaction_date'],
                    'amount' => $validated['amount'],
                    'content' => $validated['content'] ?? null,
                    'note' => $validated['note'] ?? null,
                    'status' => $validated['status'] ?? 'confirmed',
                    'user_id' => auth()->id(),
                ]);

                return response()->json($this->cashbookService->transferEntryPayload($transfer), 201);
            }

            $transaction = $this->cashbookService->storeTransactionEntry($accountId, [
                ...$validated,
                'wallet_id' => $validated['wallet_id'],
                'user_id' => auth()->id(),
            ]);

            return response()->json($this->cashbookService->transactionEntryPayload($transaction), 201);
        } catch (InvalidArgumentException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    public function updateEntry(Request $request, string $kind, int $id)
    {
        $accountId = $this->accountId($request);
        $validated = $this->validateEntryPayload($request, $accountId);

        try {
            if ($kind === 'transfer') {
                $transfer = FinanceTransfer::query()
                    ->where('account_id', $accountId)
                    ->findOrFail($id);

                $updated = $this->financeService->storeTransfer($accountId, [
                    'from_wallet_id' => $validated['from_wallet_id'],
                    'to_wallet_id' => $validated['to_wallet_id'],
                    'transfer_date' => $validated['transaction_date'],
                    'amount' => $validated['amount'],
                    'content' => $validated['content'] ?? null,
                    'note' => $validated['note'] ?? null,
                    'status' => $validated['status'] ?? $transfer->status,
                    'user_id' => auth()->id(),
                ], $transfer);

                return response()->json($this->cashbookService->transferEntryPayload($updated));
            }

            if ($kind !== 'transaction') {
                return response()->json(['message' => 'Loai dong giao dich khong hop le.'], 422);
            }

            $transaction = FinanceTransaction::query()
                ->where('account_id', $accountId)
                ->findOrFail($id);

            if (in_array($transaction->transaction_type, ['transfer_in', 'transfer_out', 'loan_disbursement', 'loan_payment', 'fixed_expense'], true)) {
                return response()->json(['message' => 'Dong giao dich nay duoc tao tu dong, khong sua tai day.'], 422);
            }

            $updated = $this->cashbookService->storeTransactionEntry($accountId, [
                ...$validated,
                'wallet_id' => $validated['wallet_id'],
                'user_id' => auth()->id(),
            ], $transaction);

            return response()->json($this->cashbookService->transactionEntryPayload($updated));
        } catch (InvalidArgumentException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    public function destroyEntry(Request $request, string $kind, int $id)
    {
        $accountId = $this->accountId($request);

        if ($kind === 'transfer') {
            $transfer = FinanceTransfer::query()
                ->where('account_id', $accountId)
                ->with(['outgoingTransaction', 'incomingTransaction'])
                ->findOrFail($id);

            $this->financeService->deleteTransfer($transfer, auth()->id());

            return response()->json(['message' => 'Da xoa giao dich chuyen quy.']);
        }

        if ($kind !== 'transaction') {
            return response()->json(['message' => 'Loai dong giao dich khong hop le.'], 422);
        }

        $transaction = FinanceTransaction::query()
            ->where('account_id', $accountId)
            ->findOrFail($id);

        if (in_array($transaction->transaction_type, ['transfer_in', 'transfer_out', 'loan_disbursement', 'loan_payment', 'fixed_expense'], true)) {
            return response()->json(['message' => 'Dong giao dich nay duoc tao tu dong, khong xoa tai day.'], 422);
        }

        $this->financeService->deleteTransaction($transaction, auth()->id());

        return response()->json(['message' => 'Da xoa giao dich.']);
    }

    private function validateEntryPayload(Request $request, int $accountId): array
    {
        $walletRule = Rule::exists('finance_wallets', 'id')->where(fn ($query) => $query->where('account_id', $accountId));
        $statusRule = Rule::in(['confirmed', 'draft', 'pending', 'cancelled']);

        $validator = Validator::make($request->all(), [
            'voucher_type' => ['required', Rule::in(['income', 'expense', 'transfer'])],
            'transaction_date' => 'required|date',
            'wallet_id' => ['nullable', 'integer', $walletRule],
            'from_wallet_id' => ['nullable', 'integer', $walletRule],
            'to_wallet_id' => ['nullable', 'integer', $walletRule],
            'category_id' => ['nullable', 'integer'],
            'amount' => 'required|numeric|min:0.01',
            'content' => 'nullable|string|max:255',
            'counterparty_name' => 'nullable|string|max:180',
            'note' => 'nullable|string|max:5000',
            'status' => ['nullable', $statusRule],
        ]);

        $validator->after(function ($validator) use ($request, $accountId) {
            $voucherType = (string) $request->input('voucher_type');

            if ($voucherType === 'transfer') {
                if (!$request->filled('from_wallet_id')) {
                    $validator->errors()->add('from_wallet_id', 'Can chon tai khoan chuyen.');
                }

                if (!$request->filled('to_wallet_id')) {
                    $validator->errors()->add('to_wallet_id', 'Can chon tai khoan nhan.');
                }
            } elseif (!$request->filled('wallet_id')) {
                $validator->errors()->add('wallet_id', 'Can chon tai khoan tien.');
            }

            $categoryId = $request->input('category_id');
            if (!$categoryId || $voucherType === 'transfer') {
                return;
            }

            $expectedGroup = $voucherType === 'income' ? 'income_type' : 'expense_type';
            $categoryExists = FinanceCatalog::query()
                ->where('account_id', $accountId)
                ->where('group_key', $expectedGroup)
                ->where('id', (int) $categoryId)
                ->exists();

            if (!$categoryExists) {
                $validator->errors()->add('category_id', 'Danh muc khong hop le voi loai phieu da chon.');
            }
        });

        return $validator->validate();
    }

    private function accountId(Request $request): int
    {
        return (int) $request->header('X-Account-Id');
    }
}
