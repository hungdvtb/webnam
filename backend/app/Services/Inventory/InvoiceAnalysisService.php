<?php

namespace App\Services\Inventory;

use App\Models\InventoryInvoiceAnalysisLog;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\SupplierProductPrice;
use App\Services\AI\GeminiService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

class InvoiceAnalysisService
{
    public function __construct(
        private readonly GeminiService $geminiService,
    ) {
    }

    public function analyzeUploadedInvoice(UploadedFile $file, int $accountId, ?int $supplierId = null, ?int $userId = null): array
    {
        $disk = 'public';
        $storedPath = $file->store('uploads/inventory/invoices', $disk);
        $supplier = $supplierId ? Supplier::query()->find($supplierId) : null;

        $log = InventoryInvoiceAnalysisLog::create([
            'account_id' => $accountId,
            'supplier_id' => $supplier?->id,
            'source_name' => $file->getClientOriginalName(),
            'disk' => $disk,
            'file_path' => $storedPath,
            'mime_type' => $file->getMimeType(),
            'file_size' => $file->getSize(),
            'status' => 'processing',
            'provider' => 'gemini',
            'created_by' => $userId,
        ]);

        try {
            $analysis = $this->extractInvoiceData($log, $accountId, $supplier);
            $draft = $this->buildDraftImport($analysis, $supplier);

            $log->forceFill([
                'status' => !empty($draft['unmatched_lines']) ? 'partial' : 'success',
                'provider' => $analysis['provider'] ?? 'gemini',
                'analysis_result' => [
                    'raw_invoice' => $analysis['invoice'],
                    'mapped_items' => $draft['items'],
                    'unmatched_lines' => $draft['unmatched_lines'],
                    'summary' => [
                        'matched_count' => count($draft['items']) - count($draft['unmatched_lines']),
                        'line_count' => count($draft['items']),
                        'supplier_id' => $supplier?->id,
                    ],
                ],
                'extracted_text' => $analysis['raw_text'] ?? null,
                'error_message' => null,
            ])->save();

            return [
                'log' => $log->fresh(),
                'draft' => $draft,
            ];
        } catch (\Throwable $exception) {
            Log::warning('Invoice analysis failed', [
                'log_id' => $log->id,
                'message' => $exception->getMessage(),
            ]);

            $log->forceFill([
                'status' => 'failed',
                'error_message' => $exception->getMessage(),
            ])->save();

            throw ValidationException::withMessages([
                'invoice_file' => 'Khong the doc hoa don: ' . $exception->getMessage(),
            ]);
        }
    }

    public function getAnalysisLog(int $id): InventoryInvoiceAnalysisLog
    {
        return InventoryInvoiceAnalysisLog::query()
            ->with(['supplier:id,name,code', 'creator:id,name'])
            ->findOrFail($id);
    }

    private function extractInvoiceData(InventoryInvoiceAnalysisLog $log, int $accountId, ?Supplier $supplier = null): array
    {
        $absolutePath = Storage::disk($log->disk)->path($log->file_path);
        $rawBytes = file_get_contents($absolutePath);

        if ($rawBytes === false) {
            throw new \RuntimeException('Khong doc duoc tep hoa don.');
        }

        $prompt = $this->buildInvoicePrompt($supplier);
        $result = $this->geminiService->readImage(
            base64_encode($rawBytes),
            (string) $log->mime_type,
            $prompt,
            $accountId,
            env('GEMINI_INVOICE_MODEL')
        );
        $text = trim((string) ($result['text'] ?? ''));
        $decoded = $this->decodeInvoiceJson($text);

        return [
            'invoice' => $decoded,
            'raw_text' => $text,
            'provider' => $result['model'] ?? 'gemini',
        ];
    }

    private function buildInvoicePrompt(?Supplier $supplier = null): string
    {
        $supplierHint = $supplier
            ? "Nha cung cap du kien: {$supplier->name}. Uu tien tim ma hang nha cung cap cho nha cung cap nay.\n"
            : '';

        return <<<PROMPT
Ban la bo may OCR + parser hoa don mua hang.
Doc tep dinh kem va tra ve DUY NHAT mot JSON hop le, khong markdown, khong giai thich.

{$supplierHint}Can trich xuat cac truong:
{
  "invoice_number": "string|null",
  "invoice_date": "YYYY-MM-DD|null",
  "supplier_name": "string|null",
  "currency": "VND",
  "subtotal_amount": 0,
  "tax_amount": 0,
  "total_amount": 0,
  "notes": "string|null",
  "items": [
    {
      "supplier_product_code": "string|null",
      "description": "string|null",
      "unit_name": "string|null",
      "quantity": 0,
      "unit_cost": 0,
      "line_total": 0,
      "notes": "string|null"
    }
  ]
}

Quy tac:
- Neu ma hang NCC bi xuong dong, hay ghep lai thanh 1 ma duy nhat.
- So tien tra ve dang so, bo dau cham ngan cach hang nghin.
- quantity, unit_cost, line_total phai la so.
- Neu khong chac chan mot truong thi tra ve null.
- items chi gom cac dong hang hoa/dich vu, bo qua dong tong cong.
PROMPT;
    }

    private function decodeInvoiceJson(string $text): array
    {
        $normalized = trim($text);
        $normalized = preg_replace('/^```json\s*/i', '', $normalized) ?? $normalized;
        $normalized = preg_replace('/```$/', '', $normalized) ?? $normalized;

        $decoded = json_decode($normalized, true);
        if (is_array($decoded)) {
            return $decoded;
        }

        if (preg_match('/\{.*\}/s', $normalized, $matches) === 1) {
            $decoded = json_decode($matches[0], true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }

        throw new \RuntimeException('AI tra ve JSON khong hop le.');
    }

    private function buildDraftImport(array $analysis, ?Supplier $supplier = null): array
    {
        $invoice = $analysis['invoice'] ?? [];
        $rawItems = collect($invoice['items'] ?? [])->values();
        $mappedItems = $rawItems->map(function ($item, $index) use ($supplier) {
            $supplierCode = $this->normalizeSupplierCode($item['supplier_product_code'] ?? '');
            $product = $this->resolveProductFromSupplierCode($supplierCode, $supplier?->id);
            $quantity = (int) round((float) ($item['quantity'] ?? 0));
            $unitCost = round((float) ($item['unit_cost'] ?? 0), 2);
            $lineTotal = round((float) ($item['line_total'] ?? ($quantity * $unitCost)), 2);

            return [
                'row_key' => 'invoice_' . ($index + 1),
                'product_id' => $product?->id,
                'product_name' => $product?->name ?? ($item['description'] ?? null),
                'sku' => $product?->sku,
                'supplier_product_code' => $supplierCode ?: null,
                'quantity' => $quantity,
                'received_quantity' => 0,
                'unit_name' => $product?->unit?->name ?? ($item['unit_name'] ?? null),
                'unit_cost' => $unitCost,
                'line_total' => $lineTotal,
                'notes' => $item['notes'] ?? null,
                'mapping_status' => $product ? 'matched' : 'unmatched',
                'mapping_label' => $product ? 'Da map tu dong' : 'Chua map duoc ma NCC',
            ];
        })->values();

        $unmatchedLines = $mappedItems
            ->filter(fn ($item) => empty($item['product_id']))
            ->values()
            ->all();

        $invoiceDate = $invoice['invoice_date'] ?? null;
        try {
            $importDate = $invoiceDate ? Carbon::parse($invoiceDate)->toDateString() : now()->toDateString();
        } catch (\Throwable $exception) {
            $importDate = now()->toDateString();
        }

        $subtotalAmount = round((float) $mappedItems->sum('line_total'), 2);
        $totalAmount = round((float) ($invoice['total_amount'] ?? $subtotalAmount), 2);

        return [
            'supplier_id' => $supplier?->id,
            'import_date' => $importDate,
            'entry_mode' => 'invoice_ai',
            'notes' => $invoice['notes'] ?? null,
            'invoice_number' => $invoice['invoice_number'] ?? null,
            'subtotal_amount' => $subtotalAmount,
            'total_amount' => $totalAmount,
            'items' => $mappedItems->all(),
            'unmatched_lines' => $unmatchedLines,
        ];
    }

    private function resolveProductFromSupplierCode(string $supplierCode, ?int $supplierId = null): ?Product
    {
        if ($supplierCode === '') {
            return null;
        }

        $compactCode = preg_replace('/[^A-Z0-9]+/', '', strtoupper($supplierCode)) ?: '';
        $supplierPriceQuery = SupplierProductPrice::query()
            ->with(['product.unit:id,name'])
            ->when($supplierId, function ($builder) use ($supplierId) {
                $builder->where('supplier_id', $supplierId);
            });

        $exactSupplierCode = (clone $supplierPriceQuery)
            ->where('supplier_product_code', $supplierCode)
            ->first();

        if ($exactSupplierCode?->product) {
            return $exactSupplierCode->product;
        }

        if ($compactCode !== '') {
            $compactSupplierCode = (clone $supplierPriceQuery)
                ->whereRaw("REGEXP_REPLACE(COALESCE(supplier_product_code, ''), '[^a-zA-Z0-9]', '', 'g') = ?", [$compactCode])
                ->first();

            if ($compactSupplierCode?->product) {
                return $compactSupplierCode->product;
            }
        }

        $exactSku = Product::query()
            ->with(['unit:id,name'])
            ->when($supplierId, function ($builder) use ($supplierId) {
                $builder->where(function ($supplierBuilder) use ($supplierId) {
                    $supplierBuilder
                        ->where('supplier_id', $supplierId)
                        ->orWhereHas('suppliers', function ($supplierQuery) use ($supplierId) {
                            $supplierQuery->where('suppliers.id', $supplierId);
                        })
                        ->orWhereHas('supplierPrices', function ($priceQuery) use ($supplierId) {
                            $priceQuery->where('supplier_id', $supplierId);
                        });
                });
            })
            ->where('sku', $supplierCode)
            ->first();

        if ($exactSku) {
            return $exactSku;
        }

        if ($compactCode === '') {
            return null;
        }

        return Product::query()
            ->with(['unit:id,name'])
            ->when($supplierId, function ($builder) use ($supplierId) {
                $builder->where(function ($supplierBuilder) use ($supplierId) {
                    $supplierBuilder
                        ->where('supplier_id', $supplierId)
                        ->orWhereHas('suppliers', function ($supplierQuery) use ($supplierId) {
                            $supplierQuery->where('suppliers.id', $supplierId);
                        })
                        ->orWhereHas('supplierPrices', function ($priceQuery) use ($supplierId) {
                            $priceQuery->where('supplier_id', $supplierId);
                        });
                });
            })
            ->whereRaw("REGEXP_REPLACE(COALESCE(sku, ''), '[^a-zA-Z0-9]', '', 'g') = ?", [$compactCode])
            ->first();
    }

    private function normalizeSupplierCode(?string $value): string
    {
        return trim(preg_replace('/\s+/', '', (string) $value) ?? '');
    }
}
