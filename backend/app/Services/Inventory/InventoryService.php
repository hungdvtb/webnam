<?php

namespace App\Services\Inventory;

use App\Models\ImportItem;
use App\Models\InventoryBatch;
use App\Models\InventoryBatchAllocation;
use App\Models\InventoryDocument;
use App\Models\InventoryDocumentAllocation;
use App\Models\InventoryDocumentItem;
use App\Models\InventoryImport;
use App\Models\Order;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\SupplierProductPrice;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class InventoryService
{
    public function createImport(array $payload, int $accountId, ?int $userId = null): InventoryImport
    {
        return DB::transaction(function () use ($payload, $accountId, $userId) {
            $items = collect($payload['items'] ?? [])
                ->filter(fn ($item) => (int) ($item['quantity'] ?? 0) > 0)
                ->values();

            if ($items->isEmpty()) {
                throw ValidationException::withMessages([
                    'items' => 'Phiếu nhập cần có ít nhất 1 dòng sản phẩm hợp lệ.',
                ]);
            }

            $supplier = Supplier::query()->findOrFail((int) ($payload['supplier_id'] ?? 0));
            $productIds = $items->pluck('product_id')->map(fn ($id) => (int) $id)->unique()->values()->all();
            $products = Product::query()
                ->whereIn('id', $productIds)
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            if (count($productIds) !== $products->count()) {
                throw ValidationException::withMessages([
                    'items' => 'Có sản phẩm trong phiếu nhập không tồn tại hoặc không thuộc cửa hàng hiện tại.',
                ]);
            }

            $supplierPrices = SupplierProductPrice::query()
                ->where('supplier_id', $supplier->id)
                ->whereIn('product_id', $productIds)
                ->get()
                ->keyBy('product_id');

            $importDate = Carbon::parse($payload['import_date'] ?? now());
            $totalQuantity = (int) $items->sum(fn ($item) => (int) $item['quantity']);
            $totalAmount = round((float) $items->sum(fn ($item) => (float) $item['quantity'] * (float) $item['unit_cost']), 2);

            $import = InventoryImport::create([
                'account_id' => $accountId,
                'supplier_id' => $supplier->id,
                'import_number' => $this->generateImportNumber($accountId),
                'supplier_name' => trim((string) $supplier->name),
                'import_date' => $importDate->toDateString(),
                'status' => 'completed',
                'total_quantity' => $totalQuantity,
                'total_amount' => $totalAmount,
                'notes' => $payload['notes'] ?? null,
                'created_by' => $userId ?? Auth::id(),
            ]);

            $touchedProductIds = [];

            foreach ($items as $index => $item) {
                $product = $products->get((int) $item['product_id']);
                $quantity = (int) $item['quantity'];
                $unitCost = round((float) $item['unit_cost'], 2);
                $lineTotal = round($quantity * $unitCost, 2);
                $supplierPrice = $supplierPrices->get($product->id);
                $snapshotSupplierCost = $supplierPrice ? round((float) $supplierPrice->unit_cost, 2) : null;
                $shouldUpdateSupplierPrice = (bool) ($item['update_supplier_price'] ?? $payload['update_supplier_prices'] ?? false);
                $priceChanged = $snapshotSupplierCost === null || (float) $snapshotSupplierCost !== (float) $unitCost;

                $importItem = ImportItem::create([
                    'account_id' => $accountId,
                    'import_id' => $import->id,
                    'product_id' => $product->id,
                    'supplier_product_price_id' => $supplierPrice?->id,
                    'product_name_snapshot' => $product->name,
                    'product_sku_snapshot' => $product->sku,
                    'quantity' => $quantity,
                    'unit_cost' => $unitCost,
                    'supplier_price_snapshot' => $snapshotSupplierCost,
                    'price_was_updated' => $priceChanged && $shouldUpdateSupplierPrice,
                    'line_total' => $lineTotal,
                    'notes' => $item['notes'] ?? null,
                ]);

                InventoryBatch::create([
                    'account_id' => $accountId,
                    'product_id' => $product->id,
                    'import_id' => $import->id,
                    'import_item_id' => $importItem->id,
                    'source_type' => 'import',
                    'source_id' => $import->id,
                    'batch_number' => $this->generateLotNumber($import->import_number, $index + 1),
                    'received_at' => $importDate->copy()->setTimeFrom(now()),
                    'quantity' => $quantity,
                    'remaining_quantity' => $quantity,
                    'unit_cost' => $unitCost,
                    'status' => 'open',
                    'meta' => [
                        'supplier_id' => $supplier->id,
                        'supplier_name' => $supplier->name,
                        'source_label' => $import->import_number,
                        'source_name' => 'Phiếu nhập',
                    ],
                ]);

                if ($shouldUpdateSupplierPrice || $supplierPrice === null) {
                    $supplierPrices->put(
                        $product->id,
                        $this->upsertSupplierPrice($supplier, $product, $unitCost, $userId, $item['price_notes'] ?? null)
                    );
                }

                $touchedProductIds[] = $product->id;
            }

            $this->refreshProducts($touchedProductIds);

            return $import->load([
                'supplier:id,name,phone,email',
                'items.product:id,sku,name',
                'items.batch',
                'creator:id,name',
            ]);
        });
    }

    public function createDocument(string $type, array $payload, int $accountId, ?int $userId = null): InventoryDocument
    {
        return match ($type) {
            'return' => $this->createReturnDocument($payload, $accountId, $userId),
            'damaged' => $this->createDamagedDocument($payload, $accountId, $userId),
            'adjustment' => $this->createAdjustmentDocument($payload, $accountId, $userId),
            default => throw ValidationException::withMessages([
                'type' => 'Loại phiếu kho không hợp lệ.',
            ]),
        };
    }

    public function updateImport(InventoryImport $import, array $payload, int $accountId, ?int $userId = null): InventoryImport
    {
        return DB::transaction(function () use ($import, $payload, $accountId, $userId) {
            $originalNumber = $import->import_number;
            $originalCreatedAt = $import->created_at;

            $this->ensureImportCanBeReverted($import);
            $this->revertImport($import);
            $import->delete();

            $replacement = $this->createImport($payload, $accountId, $userId);
            $replacement->forceFill([
                'import_number' => $originalNumber,
                'created_at' => $originalCreatedAt,
            ])->save();

            return $replacement->fresh([
                'supplier:id,name,phone,email',
                'items.product:id,sku,name',
                'items.batch',
                'creator:id,name',
            ]);
        });
    }

    public function deleteImport(InventoryImport $import): void
    {
        DB::transaction(function () use ($import) {
            $this->ensureImportCanBeReverted($import);
            $this->revertImport($import);
            $import->delete();
        });
    }

    public function updateDocument(InventoryDocument $document, string $type, array $payload, int $accountId, ?int $userId = null): InventoryDocument
    {
        return DB::transaction(function () use ($document, $type, $payload, $accountId, $userId) {
            $originalNumber = $document->document_number;
            $originalCreatedAt = $document->created_at;

            $this->ensureDocumentCanBeReverted($document);
            $this->revertDocument($document);
            $document->delete();

            $replacement = $this->createDocument($type, $payload, $accountId, $userId);
            $replacement->forceFill([
                'document_number' => $originalNumber,
                'created_at' => $originalCreatedAt,
            ])->save();

            return $replacement->fresh([
                'supplier:id,name,phone,email',
                'items.product:id,sku,name',
                'items.allocations.batch',
                'creator:id,name',
            ]);
        });
    }

    public function deleteDocument(InventoryDocument $document): void
    {
        DB::transaction(function () use ($document) {
            $this->ensureDocumentCanBeReverted($document);
            $this->revertDocument($document);
            $document->delete();
        });
    }

    public function attachInventoryToOrder(Order $order, array $rawItems): array
    {
        $normalizedItems = collect($rawItems)
            ->filter(fn ($item) => (int) ($item['quantity'] ?? 0) > 0 && !empty($item['product_id']))
            ->values();

        if ($normalizedItems->isEmpty()) {
            throw ValidationException::withMessages([
                'items' => 'Phiếu xuất cần có ít nhất 1 sản phẩm hợp lệ.',
            ]);
        }

        $productIds = $normalizedItems->pluck('product_id')->map(fn ($id) => (int) $id)->unique()->values()->all();
        $products = Product::query()
            ->whereIn('id', $productIds)
            ->lockForUpdate()
            ->get()
            ->keyBy('id');

        if (count($productIds) !== $products->count()) {
            throw ValidationException::withMessages([
                'items' => 'Có sản phẩm không tồn tại hoặc không thuộc cửa hàng hiện tại.',
            ]);
        }

        $createdItems = [];
        $touchedProductIds = [];

        foreach ($normalizedItems as $item) {
            $product = $products->get((int) $item['product_id']);
            $quantity = (int) $item['quantity'];
            $sellingPrice = round((float) ($item['price'] ?? $product->price ?? 0), 2);
            $allocation = $this->allocateSellableBatches($order->account_id, $product, $quantity);
            $avgUnitCost = $quantity > 0 ? round($allocation['total_cost'] / $quantity, 2) : 0;
            $revenue = round($sellingPrice * $quantity, 2);
            $profit = round($revenue - $allocation['total_cost'], 2);

            $orderItem = $order->items()->create([
                'account_id' => $order->account_id,
                'product_id' => $product->id,
                'product_name_snapshot' => $product->name,
                'product_sku_snapshot' => $product->sku,
                'quantity' => $quantity,
                'price' => $sellingPrice,
                'cost_price' => $avgUnitCost,
                'cost_total' => $allocation['total_cost'],
                'profit_total' => $profit,
                'options' => $item['options'] ?? null,
            ]);

            foreach ($allocation['allocations'] as $row) {
                InventoryBatchAllocation::create([
                    'account_id' => $order->account_id,
                    'inventory_batch_id' => $row['inventory_batch_id'],
                    'product_id' => $product->id,
                    'order_id' => $order->id,
                    'order_item_id' => $orderItem->id,
                    'quantity' => $row['quantity'],
                    'unit_cost' => $row['unit_cost'],
                    'total_cost' => $row['total_cost'],
                    'allocated_at' => now(),
                ]);
            }

            $createdItems[] = $orderItem;
            $touchedProductIds[] = $product->id;
        }

        $this->refreshProducts($touchedProductIds);

        return [
            'items' => $createdItems,
            'total_price' => round(collect($createdItems)->sum(fn ($row) => (float) $row->price * (int) $row->quantity), 2),
            'cost_total' => round(collect($createdItems)->sum(fn ($row) => (float) $row->cost_total), 2),
            'profit_total' => round(collect($createdItems)->sum(fn ($row) => (float) $row->profit_total), 2),
        ];
    }

    public function releaseOrderInventory(Order $order): void
    {
        $allocations = InventoryBatchAllocation::query()
            ->where('order_id', $order->id)
            ->with('batch')
            ->lockForUpdate()
            ->get();

        if ($allocations->isEmpty()) {
            return;
        }

        $touchedProductIds = [];

        foreach ($allocations as $allocation) {
            $batch = $allocation->batch;
            if (!$batch) {
                continue;
            }

            $batch->remaining_quantity = (int) $batch->remaining_quantity + (int) $allocation->quantity;
            $batch->status = $batch->remaining_quantity > 0 ? 'open' : 'depleted';
            $batch->save();
            $touchedProductIds[] = $batch->product_id;
        }

        InventoryBatchAllocation::query()->where('order_id', $order->id)->delete();
        $this->refreshProducts($touchedProductIds);
    }

    public function refreshProducts(array $productIds): void
    {
        $uniqueProductIds = collect($productIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($uniqueProductIds->isEmpty()) {
            return;
        }

        $batches = InventoryBatch::query()
            ->whereIn('product_id', $uniqueProductIds->all())
            ->where('remaining_quantity', '>', 0)
            ->orderBy('received_at')
            ->orderBy('id')
            ->get()
            ->groupBy('product_id');

        Product::query()
            ->whereIn('id', $uniqueProductIds->all())
            ->lockForUpdate()
            ->get()
            ->each(function (Product $product) use ($batches) {
                $productBatches = $batches->get($product->id, collect());
                $stock = (int) $productBatches->sum('remaining_quantity');
                $nextBatch = $productBatches->first();

                $product->forceFill([
                    'stock_quantity' => $stock,
                    'cost_price' => $nextBatch ? round((float) $nextBatch->unit_cost, 2) : null,
                ])->save();
            });
    }

    private function ensureImportCanBeReverted(InventoryImport $import): void
    {
        $batches = InventoryBatch::query()
            ->where('import_id', $import->id)
            ->withCount(['allocations', 'documentAllocations'])
            ->lockForUpdate()
            ->get();

        foreach ($batches as $batch) {
            if ((int) $batch->remaining_quantity !== (int) $batch->quantity || (int) $batch->allocations_count > 0 || (int) $batch->document_allocations_count > 0) {
                throw ValidationException::withMessages([
                    'import' => 'Phiếu nhập đã phát sinh xuất hoặc điều chỉnh nên không thể sửa/xóa.',
                ]);
            }
        }
    }

    private function revertImport(InventoryImport $import): void
    {
        $productIds = $import->items()->pluck('product_id')->all();

        InventoryBatch::query()->where('import_id', $import->id)->delete();
        ImportItem::query()->where('import_id', $import->id)->delete();

        $this->refreshProducts($productIds);
    }

    private function ensureDocumentCanBeReverted(InventoryDocument $document): void
    {
        $document->loadMissing(['items.allocations', 'items.product']);

        $documentBatches = InventoryBatch::query()
            ->where('source_type', 'document')
            ->where('source_id', $document->id)
            ->withCount(['allocations', 'documentAllocations'])
            ->lockForUpdate()
            ->get();

        foreach ($documentBatches as $batch) {
            if ((int) $batch->remaining_quantity !== (int) $batch->quantity || (int) $batch->allocations_count > 0 || (int) $batch->document_allocations_count > 0) {
                throw ValidationException::withMessages([
                    'document' => 'Phiếu kho này đã phát sinh luồng kho tiếp theo nên không thể sửa/xóa.',
                ]);
            }
        }
    }

    private function revertDocument(InventoryDocument $document): void
    {
        $document->loadMissing(['items.allocations', 'items.product']);

        $productIds = $document->items->pluck('product_id')->all();
        $products = Product::query()
            ->whereIn('id', collect($productIds)->filter()->unique()->values()->all())
            ->lockForUpdate()
            ->get()
            ->keyBy('id');

        $documentBatches = InventoryBatch::query()
            ->where('source_type', 'document')
            ->where('source_id', $document->id)
            ->lockForUpdate()
            ->get()
            ->groupBy(function (InventoryBatch $batch) {
                return $batch->meta['document_item_id'] ?? $batch->product_id;
            });

        foreach ($document->items as $item) {
            $product = $products->get($item->product_id);
            if (!$product) {
                continue;
            }

            if ($item->stock_bucket === 'sellable' && $item->direction === 'in') {
                $relatedBatches = $documentBatches->get($item->id, collect())
                    ->merge($documentBatches->get($item->product_id, collect()))
                    ->unique('id');
                foreach ($relatedBatches as $batch) {
                    $batch->delete();
                }
            } elseif ($item->stock_bucket === 'sellable' && $item->direction === 'out') {
                $allocations = InventoryDocumentAllocation::query()
                    ->where('inventory_document_item_id', $item->id)
                    ->with('batch')
                    ->lockForUpdate()
                    ->get();

                foreach ($allocations as $allocation) {
                    if (!$allocation->batch) {
                        continue;
                    }

                    $allocation->batch->remaining_quantity = (int) $allocation->batch->remaining_quantity + (int) $allocation->quantity;
                    $allocation->batch->status = (int) $allocation->batch->remaining_quantity > 0 ? 'open' : 'depleted';
                    $allocation->batch->save();
                }

                InventoryDocumentAllocation::query()->where('inventory_document_item_id', $item->id)->delete();
            } elseif ($item->stock_bucket === 'damaged' && $item->direction === 'in') {
                $product->damaged_quantity = max(0, (int) ($product->damaged_quantity ?? 0) - (int) $item->quantity);
                $product->save();
            } elseif ($item->stock_bucket === 'damaged' && $item->direction === 'out') {
                $product->damaged_quantity = (int) ($product->damaged_quantity ?? 0) + (int) $item->quantity;
                $product->save();
            }
        }

        InventoryDocumentItem::query()->where('inventory_document_id', $document->id)->delete();
        $this->refreshProducts($productIds);
    }

    private function createReturnDocument(array $payload, int $accountId, ?int $userId): InventoryDocument
    {
        return DB::transaction(function () use ($payload, $accountId, $userId) {
            $items = collect($payload['items'] ?? [])
                ->filter(fn ($item) => (int) ($item['quantity'] ?? 0) > 0)
                ->values();

            if ($items->isEmpty()) {
                throw ValidationException::withMessages([
                    'items' => 'Phiếu hàng hoàn cần có ít nhất 1 dòng hợp lệ.',
                ]);
            }

            $productIds = $items->pluck('product_id')->map(fn ($id) => (int) $id)->unique()->values()->all();
            $products = Product::query()
                ->whereIn('id', $productIds)
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            if (count($productIds) !== $products->count()) {
                throw ValidationException::withMessages([
                    'items' => 'Có sản phẩm trong phiếu hoàn không tồn tại.',
                ]);
            }

            $documentDate = Carbon::parse($payload['document_date'] ?? now());
            $document = $this->createDocumentHead('return', $payload, $accountId, $userId, $documentDate);
            $touchedProductIds = [];

            foreach ($items as $index => $item) {
                $product = $products->get((int) $item['product_id']);
                $quantity = (int) $item['quantity'];
                $unitCost = round((float) ($item['unit_cost'] ?? $product->cost_price ?? $product->expected_cost ?? 0), 2);
                $totalCost = round($quantity * $unitCost, 2);

                $documentItem = InventoryDocumentItem::create([
                    'account_id' => $accountId,
                    'inventory_document_id' => $document->id,
                    'product_id' => $product->id,
                    'product_name_snapshot' => $product->name,
                    'product_sku_snapshot' => $product->sku,
                    'quantity' => $quantity,
                    'stock_bucket' => 'sellable',
                    'direction' => 'in',
                    'unit_cost' => $unitCost,
                    'total_cost' => $totalCost,
                    'notes' => $item['notes'] ?? null,
                ]);

                $this->createSellableBatch(
                    $accountId,
                    $product,
                    $document->document_number,
                    $document->id,
                    $documentDate,
                    $quantity,
                    $unitCost,
                    $index + 1,
                    [
                        'source_name' => 'Phiếu hàng hoàn',
                        'source_label' => $document->document_number,
                        'document_type' => 'return',
                        'document_item_id' => $documentItem->id,
                    ]
                );

                $touchedProductIds[] = $product->id;
            }

            $this->finalizeDocumentTotals($document);
            $this->refreshProducts($touchedProductIds);

            return $document->load(['items.product:id,sku,name', 'creator:id,name']);
        });
    }

    private function createDamagedDocument(array $payload, int $accountId, ?int $userId): InventoryDocument
    {
        return DB::transaction(function () use ($payload, $accountId, $userId) {
            $items = collect($payload['items'] ?? [])
                ->filter(fn ($item) => (int) ($item['quantity'] ?? 0) > 0)
                ->values();

            if ($items->isEmpty()) {
                throw ValidationException::withMessages([
                    'items' => 'Phiếu hàng hỏng cần có ít nhất 1 dòng hợp lệ.',
                ]);
            }

            $productIds = $items->pluck('product_id')->map(fn ($id) => (int) $id)->unique()->values()->all();
            $products = Product::query()
                ->whereIn('id', $productIds)
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            if (count($productIds) !== $products->count()) {
                throw ValidationException::withMessages([
                    'items' => 'Có sản phẩm trong phiếu hỏng không tồn tại.',
                ]);
            }

            $documentDate = Carbon::parse($payload['document_date'] ?? now());
            $document = $this->createDocumentHead('damaged', $payload, $accountId, $userId, $documentDate);
            $touchedProductIds = [];

            foreach ($items as $item) {
                $product = $products->get((int) $item['product_id']);
                $quantity = (int) $item['quantity'];
                $allocation = $this->allocateSellableBatches($accountId, $product, $quantity);
                $avgUnitCost = $quantity > 0 ? round($allocation['total_cost'] / $quantity, 2) : 0;

                $documentItem = InventoryDocumentItem::create([
                    'account_id' => $accountId,
                    'inventory_document_id' => $document->id,
                    'product_id' => $product->id,
                    'product_name_snapshot' => $product->name,
                    'product_sku_snapshot' => $product->sku,
                    'quantity' => $quantity,
                    'stock_bucket' => 'sellable',
                    'direction' => 'out',
                    'unit_cost' => $avgUnitCost,
                    'total_cost' => $allocation['total_cost'],
                    'notes' => $item['notes'] ?? null,
                ]);

                foreach ($allocation['allocations'] as $row) {
                    InventoryDocumentAllocation::create([
                        'account_id' => $accountId,
                        'inventory_document_item_id' => $documentItem->id,
                        'inventory_batch_id' => $row['inventory_batch_id'],
                        'product_id' => $product->id,
                        'quantity' => $row['quantity'],
                        'unit_cost' => $row['unit_cost'],
                        'total_cost' => $row['total_cost'],
                        'allocated_at' => now(),
                    ]);
                }

                $product->damaged_quantity = (int) ($product->damaged_quantity ?? 0) + $quantity;
                $product->save();
                $touchedProductIds[] = $product->id;
            }

            $this->finalizeDocumentTotals($document);
            $this->refreshProducts($touchedProductIds);

            return $document->load(['items.product:id,sku,name', 'creator:id,name']);
        });
    }

    private function createAdjustmentDocument(array $payload, int $accountId, ?int $userId): InventoryDocument
    {
        return DB::transaction(function () use ($payload, $accountId, $userId) {
            $items = collect($payload['items'] ?? [])
                ->filter(fn ($item) => (int) ($item['quantity'] ?? 0) > 0)
                ->values();

            if ($items->isEmpty()) {
                throw ValidationException::withMessages([
                    'items' => 'Phiếu điều chỉnh cần có ít nhất 1 dòng hợp lệ.',
                ]);
            }

            $productIds = $items->pluck('product_id')->map(fn ($id) => (int) $id)->unique()->values()->all();
            $products = Product::query()
                ->whereIn('id', $productIds)
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            if (count($productIds) !== $products->count()) {
                throw ValidationException::withMessages([
                    'items' => 'Có sản phẩm trong phiếu điều chỉnh không tồn tại.',
                ]);
            }

            $documentDate = Carbon::parse($payload['document_date'] ?? now());
            $document = $this->createDocumentHead('adjustment', $payload, $accountId, $userId, $documentDate);
            $touchedProductIds = [];

            foreach ($items as $index => $item) {
                $product = $products->get((int) $item['product_id']);
                $quantity = (int) $item['quantity'];
                $stockBucket = $item['stock_bucket'] ?? 'sellable';
                $direction = $item['direction'] ?? 'in';
                $unitCost = round((float) ($item['unit_cost'] ?? $product->cost_price ?? $product->expected_cost ?? 0), 2);
                $totalCost = round($quantity * $unitCost, 2);

                $documentItem = InventoryDocumentItem::create([
                    'account_id' => $accountId,
                    'inventory_document_id' => $document->id,
                    'product_id' => $product->id,
                    'product_name_snapshot' => $product->name,
                    'product_sku_snapshot' => $product->sku,
                    'quantity' => $quantity,
                    'stock_bucket' => $stockBucket,
                    'direction' => $direction,
                    'unit_cost' => $unitCost,
                    'total_cost' => $totalCost,
                    'notes' => $item['notes'] ?? null,
                ]);

                if ($stockBucket === 'sellable' && $direction === 'in') {
                    $this->createSellableBatch(
                        $accountId,
                        $product,
                        $document->document_number,
                        $document->id,
                        $documentDate,
                        $quantity,
                        $unitCost,
                        $index + 1,
                        [
                            'source_name' => 'Phiếu điều chỉnh',
                            'source_label' => $document->document_number,
                            'document_type' => 'adjustment',
                            'document_item_id' => $documentItem->id,
                        ]
                    );
                } elseif ($stockBucket === 'sellable' && $direction === 'out') {
                    $allocation = $this->allocateSellableBatches($accountId, $product, $quantity);
                    $documentItem->forceFill([
                        'unit_cost' => $quantity > 0 ? round($allocation['total_cost'] / $quantity, 2) : 0,
                        'total_cost' => $allocation['total_cost'],
                    ])->save();

                    foreach ($allocation['allocations'] as $row) {
                        InventoryDocumentAllocation::create([
                            'account_id' => $accountId,
                            'inventory_document_item_id' => $documentItem->id,
                            'inventory_batch_id' => $row['inventory_batch_id'],
                            'product_id' => $product->id,
                            'quantity' => $row['quantity'],
                            'unit_cost' => $row['unit_cost'],
                            'total_cost' => $row['total_cost'],
                            'allocated_at' => now(),
                        ]);
                    }
                } elseif ($stockBucket === 'damaged' && $direction === 'in') {
                    $product->damaged_quantity = (int) ($product->damaged_quantity ?? 0) + $quantity;
                    $product->save();
                } elseif ($stockBucket === 'damaged' && $direction === 'out') {
                    $currentDamaged = (int) ($product->damaged_quantity ?? 0);
                    if ($currentDamaged < $quantity) {
                        throw ValidationException::withMessages([
                            'items' => "Sản phẩm {$product->sku} - {$product->name} không đủ tồn hỏng để điều chỉnh giảm.",
                        ]);
                    }

                    $product->damaged_quantity = $currentDamaged - $quantity;
                    $product->save();
                }

                $touchedProductIds[] = $product->id;
            }

            $this->finalizeDocumentTotals($document);
            $this->refreshProducts($touchedProductIds);

            return $document->load(['items.product:id,sku,name', 'creator:id,name']);
        });
    }

    private function createDocumentHead(string $type, array $payload, int $accountId, ?int $userId, Carbon $documentDate): InventoryDocument
    {
        return InventoryDocument::create([
            'account_id' => $accountId,
            'supplier_id' => $payload['supplier_id'] ?? null,
            'document_number' => $this->generateDocumentNumber($type, $accountId),
            'type' => $type,
            'document_date' => $documentDate->toDateString(),
            'status' => 'completed',
            'reference_type' => $payload['reference_type'] ?? null,
            'reference_id' => $payload['reference_id'] ?? null,
            'notes' => $payload['notes'] ?? null,
            'created_by' => $userId ?? Auth::id(),
        ]);
    }

    private function finalizeDocumentTotals(InventoryDocument $document): void
    {
        $document->forceFill([
            'total_quantity' => (int) $document->items()->sum('quantity'),
            'total_amount' => round((float) $document->items()->sum('total_cost'), 2),
        ])->save();
    }

    private function createSellableBatch(
        int $accountId,
        Product $product,
        string $referenceNumber,
        int $sourceId,
        Carbon $receivedAt,
        int $quantity,
        float $unitCost,
        int $lineNumber,
        array $meta = []
    ): InventoryBatch {
        return InventoryBatch::create([
            'account_id' => $accountId,
            'product_id' => $product->id,
            'source_type' => 'document',
            'source_id' => $sourceId,
            'batch_number' => $this->generateLotNumber($referenceNumber, $lineNumber),
            'received_at' => $receivedAt->copy()->setTimeFrom(now()),
            'quantity' => $quantity,
            'remaining_quantity' => $quantity,
            'unit_cost' => round($unitCost, 2),
            'status' => 'open',
            'meta' => $meta,
        ]);
    }

    private function upsertSupplierPrice(Supplier $supplier, Product $product, float $unitCost, ?int $userId = null, ?string $notes = null): SupplierProductPrice
    {
        $supplierPrice = SupplierProductPrice::query()->firstOrNew([
            'supplier_id' => $supplier->id,
            'product_id' => $product->id,
        ]);

        $product->suppliers()->syncWithoutDetaching([
            $supplier->id => ['account_id' => $supplier->account_id ?? $product->account_id],
        ]);

        if (!$product->supplier_id) {
            $product->forceFill([
                'supplier_id' => $supplier->id,
            ])->save();
        }

        $supplierPrice->fill([
            'account_id' => $supplier->account_id ?? $product->account_id,
            'unit_cost' => $this->normalizeSupplierUnitCost($unitCost),
            'notes' => $notes,
            'updated_by' => $userId ?? Auth::id(),
        ]);
        $supplierPrice->save();

        return $supplierPrice;
    }

    private function normalizeSupplierUnitCost(float $value): int
    {
        return (int) round($value);
    }

    private function allocateSellableBatches(int $accountId, Product $product, int $requestedQty): array
    {
        $batches = InventoryBatch::query()
            ->where('account_id', $accountId)
            ->where('product_id', $product->id)
            ->where('remaining_quantity', '>', 0)
            ->orderBy('received_at')
            ->orderBy('id')
            ->lockForUpdate()
            ->get();

        $available = (int) $batches->sum('remaining_quantity');
        if ($available < $requestedQty) {
            throw ValidationException::withMessages([
                'items' => "Sản phẩm {$product->sku} - {$product->name} không đủ tồn bán được. Còn {$available}, cần {$requestedQty}.",
            ]);
        }

        $remaining = $requestedQty;
        $totalCost = 0.0;
        $allocations = [];

        foreach ($batches as $batch) {
            if ($remaining <= 0) {
                break;
            }

            $takeQty = min($remaining, (int) $batch->remaining_quantity);
            if ($takeQty <= 0) {
                continue;
            }

            $batch->remaining_quantity = (int) $batch->remaining_quantity - $takeQty;
            $batch->status = $batch->remaining_quantity > 0 ? 'open' : 'depleted';
            $batch->save();

            $lineTotal = round($takeQty * (float) $batch->unit_cost, 2);
            $totalCost += $lineTotal;
            $allocations[] = [
                'inventory_batch_id' => $batch->id,
                'quantity' => $takeQty,
                'unit_cost' => round((float) $batch->unit_cost, 2),
                'total_cost' => $lineTotal,
            ];
            $remaining -= $takeQty;
        }

        return [
            'allocations' => $allocations,
            'total_cost' => round($totalCost, 2),
        ];
    }

    private function generateImportNumber(int $accountId): string
    {
        $prefix = 'PNK' . now()->format('ymd');
        $lastImport = InventoryImport::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->where('import_number', 'like', "{$prefix}%")
            ->orderByDesc('id')
            ->first();

        $sequence = 1;
        if ($lastImport && preg_match('/(\d{4})$/', $lastImport->import_number, $matches)) {
            $sequence = ((int) $matches[1]) + 1;
        }

        return sprintf('%s%04d', $prefix, $sequence);
    }

    private function generateDocumentNumber(string $type, int $accountId): string
    {
        $prefix = match ($type) {
            'return' => 'PHH',
            'damaged' => 'PHK',
            'adjustment' => 'PDC',
            default => 'PKH',
        } . now()->format('ymd');

        $lastDocument = InventoryDocument::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->where('type', $type)
            ->where('document_number', 'like', "{$prefix}%")
            ->orderByDesc('id')
            ->first();

        $sequence = 1;
        if ($lastDocument && preg_match('/(\d{4})$/', $lastDocument->document_number, $matches)) {
            $sequence = ((int) $matches[1]) + 1;
        }

        return sprintf('%s%04d', $prefix, $sequence);
    }

    private function generateLotNumber(string $referenceNumber, int $lineNumber): string
    {
        return strtoupper(sprintf('LO-%s-%02d', $referenceNumber, $lineNumber));
    }
}
