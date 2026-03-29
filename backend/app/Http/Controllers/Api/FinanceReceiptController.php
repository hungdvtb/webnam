<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\FinanceTransaction;
use App\Services\Finance\FinanceReadService;
use App\Services\Finance\FinanceService;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use InvalidArgumentException;

class FinanceReceiptController extends Controller
{
    public function __construct(
        private readonly FinanceService $financeService,
        private readonly FinanceReadService $financeReadService,
    ) {
    }

    public function bootstrap(Request $request)
    {
        return response()->json(
            $this->financeReadService->receiptVoucherBootstrap($this->accountId($request))
        );
    }

    public function index(Request $request)
    {
        $validated = $request->validate([
            'search' => 'nullable|string|max:180',
            'counterparty_name' => 'nullable|string|max:180',
            'counterparty_phone' => 'nullable|string|max:30',
            'source_name' => 'nullable|string|max:180',
            'category_id' => 'nullable|integer',
            'payment_method' => 'nullable|string|max:60',
            'status' => 'nullable|string|max:60',
            'reference_type' => 'nullable|string|max:60',
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date',
            'view' => 'nullable|string|max:20',
            'per_page' => 'nullable|integer|min:1|max:100',
        ]);

        return response()->json(
            $this->financeReadService->paginatedReceiptVouchers($this->accountId($request), $validated)
        );
    }

    public function show(Request $request, int $id)
    {
        $receipt = $this->receiptVoucherQuery(true)->findOrFail($id);

        return response()->json(
            $this->financeService->receiptVoucherPayload(
                $receipt->loadMissing(['wallet:id,name,type,bank_name', 'category:id,name,color,group_key', 'creator:id,name'])
            )
        );
    }

    public function store(Request $request)
    {
        $validated = $this->validateReceiptPayload($request);

        try {
            $receipt = $this->financeService->storeReceiptVoucher(
                $this->accountId($request),
                [...$validated, 'user_id' => auth()->id()]
            );
        } catch (InvalidArgumentException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json($this->financeService->receiptVoucherPayload($receipt), 201);
    }

    public function update(Request $request, int $id)
    {
        $receipt = $this->receiptVoucherQuery(true)->findOrFail($id);
        $validated = $this->validateReceiptPayload($request);

        try {
            $updated = $this->financeService->storeReceiptVoucher(
                $this->accountId($request),
                [...$validated, 'user_id' => auth()->id()],
                $receipt
            );
        } catch (InvalidArgumentException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json($this->financeService->receiptVoucherPayload($updated));
    }

    public function destroy(Request $request, int $id)
    {
        $receipt = $this->receiptVoucherQuery()->findOrFail($id);
        $this->financeService->deleteTransaction($receipt, auth()->id());

        return response()->json(['message' => 'Đã xóa mềm phiếu thu.']);
    }

    public function restore(Request $request, int $id)
    {
        $receipt = $this->receiptVoucherQuery(true)->findOrFail($id);
        $restored = $this->financeService->restoreTransaction($receipt, auth()->id());

        return response()->json($this->financeService->receiptVoucherPayload($restored));
    }

    public function forceDelete(Request $request, int $id)
    {
        $receipt = $this->receiptVoucherQuery(true)->findOrFail($id);

        if (!$receipt->trashed()) {
            return response()->json(['message' => 'Chỉ có thể xóa vĩnh viễn phiếu thu trong thùng rác.'], 422);
        }

        $this->forceDeleteReceipt($receipt, auth()->id());

        return response()->json(['message' => 'Đã xóa vĩnh viễn phiếu thu.']);
    }

    public function bulkDelete(Request $request)
    {
        $receipts = $this->validatedBulkReceipts($request, false);

        $receipts->each(fn (FinanceTransaction $receipt) => $this->financeService->deleteTransaction($receipt, auth()->id()));

        return response()->json([
            'message' => sprintf('Đã đưa %d phiếu thu vào thùng rác.', $receipts->count()),
            'count' => $receipts->count(),
        ]);
    }

    public function bulkRestore(Request $request)
    {
        $receipts = $this->validatedBulkReceipts($request, true)->filter(fn (FinanceTransaction $receipt) => $receipt->trashed());

        $restored = $receipts->map(fn (FinanceTransaction $receipt) => $this->financeService->restoreTransaction($receipt, auth()->id()));

        return response()->json([
            'message' => sprintf('Đã khôi phục %d phiếu thu.', $restored->count()),
            'count' => $restored->count(),
        ]);
    }

    public function bulkForceDelete(Request $request)
    {
        $receipts = $this->validatedBulkReceipts($request, true)->filter(fn (FinanceTransaction $receipt) => $receipt->trashed());

        $receipts->each(fn (FinanceTransaction $receipt) => $this->forceDeleteReceipt($receipt, auth()->id()));

        return response()->json([
            'message' => sprintf('Đã xóa vĩnh viễn %d phiếu thu.', $receipts->count()),
            'count' => $receipts->count(),
        ]);
    }

    private function validateReceiptPayload(Request $request): array
    {
        $accountId = $this->accountId($request);
        $statusValues = collect($this->financeService->receiptVoucherStatusOptions())->pluck('value')->all();
        $paymentMethodValues = collect($this->financeService->receiptVoucherPaymentMethodOptions())->pluck('value')->all();
        $referenceTypeValues = collect($this->financeService->receiptVoucherReferenceTypeOptions())->pluck('value')->all();

        $validator = Validator::make($request->all(), [
            'transaction_date' => 'required|date',
            'category_id' => [
                'nullable',
                'integer',
                Rule::exists('finance_catalogs', 'id')->where(fn ($query) => $query
                    ->where('account_id', $accountId)
                    ->where('group_key', 'income_type')
                ),
            ],
            'source_name' => 'required|string|max:180',
            'counterparty_name' => 'required|string|max:180',
            'counterparty_phone' => 'nullable|string|max:30',
            'amount' => 'required|numeric|min:0.01',
            'payment_method' => ['required', Rule::in($paymentMethodValues)],
            'wallet_id' => [
                'nullable',
                'integer',
                Rule::exists('finance_wallets', 'id')->where(fn ($query) => $query->where('account_id', $accountId)),
            ],
            'status' => ['required', Rule::in($statusValues)],
            'reference_type' => ['nullable', Rule::in($referenceTypeValues)],
            'reference_id' => 'nullable|integer',
            'reference_code' => 'nullable|string|max:120',
            'reference_label' => 'nullable|string|max:180',
            'note' => 'nullable|string|max:5000',
            'affects_profit_loss' => 'nullable|boolean',
        ]);

        $validator->after(function ($validator) use ($request, $accountId) {
            $referenceType = trim((string) $request->input('reference_type'));
            $referenceId = $request->input('reference_id');

            if ($referenceType === 'order' && !$this->accountScopedExists('orders', $accountId, $referenceId)) {
                $validator->errors()->add('reference_id', 'Đơn hàng liên kết không hợp lệ.');
            }

            if ($referenceType === 'shipment' && !$this->accountScopedExists('shipments', $accountId, $referenceId)) {
                $validator->errors()->add('reference_id', 'Vận đơn liên kết không hợp lệ.');
            }

            if ($referenceType === 'return_slip' && !$this->returnDocumentExists($accountId, $referenceId)) {
                $validator->errors()->add('reference_id', 'Phiếu hoàn liên kết không hợp lệ.');
            }

            if (in_array($referenceType, ['debt', 'other'], true)) {
                $code = trim((string) $request->input('reference_code'));
                $label = trim((string) $request->input('reference_label'));

                if ($code === '' && $label === '') {
                    $validator->errors()->add('reference_code', 'Cần nhập mã hoặc nhãn tham chiếu cho công nợ/liên kết khác.');
                }
            }
        });

        return $validator->validate();
    }

    private function validatedBulkReceipts(Request $request, bool $withTrashed): Collection
    {
        $accountId = $this->accountId($request);

        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => [
                'integer',
                Rule::exists('finance_transactions', 'id')->where(fn ($query) => $query
                    ->where('account_id', $accountId)
                    ->where('direction', 'in')
                    ->where('transaction_type', FinanceTransaction::TYPE_RECEIPT_VOUCHER)
                ),
            ],
        ]);

        return $this->receiptVoucherQuery($withTrashed)
            ->whereIn('id', $validated['ids'])
            ->get();
    }

    private function receiptVoucherQuery(bool $withTrashed = false)
    {
        $query = FinanceTransaction::query()->receiptVouchers();

        return $withTrashed ? $query->withTrashed() : $query;
    }

    private function forceDeleteReceipt(FinanceTransaction $receipt, ?int $userId = null): void
    {
        DB::transaction(function () use ($receipt, $userId) {
            $before = $receipt->getAttributes();
            $attachmentPath = $receipt->attachment_path;

            $receipt->forceDelete();

            if ($attachmentPath) {
                Storage::disk('public')->delete($attachmentPath);
            }

            $this->financeService->logChange(
                (int) $receipt->account_id,
                $receipt,
                'force_deleted',
                $before,
                null,
                $userId ?? auth()->id()
            );
        });
    }

    private function accountScopedExists(string $table, int $accountId, $id): bool
    {
        if (!$id) {
            return false;
        }

        return DB::table($table)
            ->where('account_id', $accountId)
            ->where('id', (int) $id)
            ->exists();
    }

    private function returnDocumentExists(int $accountId, $id): bool
    {
        if (!$id) {
            return false;
        }

        return DB::table('inventory_documents')
            ->where('account_id', $accountId)
            ->where('id', (int) $id)
            ->where('type', 'return')
            ->exists();
    }

    private function accountId(Request $request): int
    {
        return (int) $request->header('X-Account-Id');
    }
}
