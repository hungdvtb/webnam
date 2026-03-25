<?php

namespace App\Services\Inventory;

use App\Models\ImportItem;
use App\Models\InventoryBatch;
use App\Models\InventoryBatchAllocation;
use App\Models\InventoryDocument;
use App\Models\InventoryDocumentAllocation;
use App\Models\InventoryDocumentItem;
use App\Models\InventoryImport;
use App\Models\InventoryImportAttachment;
use App\Models\InventoryImportStatus;
use App\Models\InventoryInvoiceAnalysisLog;
use App\Models\Order;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\SupplierProductPrice;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class InventoryService
{
    public function __construct(
        private readonly ProductPricingService $productPricingService
    ) {
    }

    public function createImport(array $payload, int $accountId, ?int $userId = null): InventoryImport
    {
        return DB::transaction(function () use ($payload, $accountId, $userId) {
            $context = $this->prepareImportContext($payload, $accountId);
            $status = $context['status'];
            $items = $context['items'];

            if ($items->isEmpty()) {
                throw ValidationException::withMessages([
                    'items' => 'Phiếu nhập cần có ít nhất 1 dòng sản phẩm hợp lệ.',
                ]);
            }

            $supplier = $context['supplier'];
            $supplierName = $context['supplier_name'];
            $productIds = $context['product_ids'];
            $products = $context['products'];

            if (count($productIds) !== $products->count()) {
                throw ValidationException::withMessages([
                    'items' => 'Có sản phẩm trong phiếu nhập không tồn tại hoặc không thuộc cửa hàng hiện tại.',
                ]);
            }

            $supplierPrices = $context['supplier_prices'];

            $importDate = $context['import_date'];
            $totalQuantity = $context['total_quantity'];
            $totalAmount = $context['total_amount'];

            $import = InventoryImport::create([
                'account_id' => $accountId,
                'supplier_id' => $supplier?->id,
                'inventory_import_status_id' => $status->id,
                'import_number' => $this->generateImportNumber($accountId),
                'supplier_name' => $supplierName,
                'import_date' => $importDate->toDateString(),
                'status' => $status->code,
                'entry_mode' => $context['entry_mode'],
                'total_quantity' => $totalQuantity,
                'subtotal_amount' => $context['subtotal_amount'],
                'extra_charge_percent' => $context['extra_charge_percent'],
                'extra_charge_mode' => $context['extra_charge_mode'],
                'extra_charge_value' => $context['extra_charge_value'],
                'extra_charge_amount' => $context['extra_charge_amount'],
                'total_amount' => $totalAmount,
                'notes' => $payload['notes'] ?? null,
                'created_by' => $userId ?? Auth::id(),
                'inventory_applied_at' => $this->importAffectsInventory($status)
                    ? $importDate->copy()->setTimeFrom(now())
                    : null,
            ]);

            $touchedProductIds = [];

            foreach ($items as $index => $item) {
                $product = $products->get((int) $item['product_id']);
                $quantity = (int) $item['quantity'];
                $receivedQuantity = max(0, min($quantity, (int) ($item['received_quantity'] ?? $quantity)));
                $unitCost = round((float) $item['unit_cost'], 2);
                $lineTotal = round($quantity * $unitCost, 2);
                $supplierPrice = $supplierPrices->get($product->id);
                $snapshotSupplierCost = $supplierPrice ? round((float) $supplierPrice->unit_cost, 2) : null;
                $shouldUpdateSupplierPrice = (bool) ($item['update_supplier_price'] ?? $payload['update_supplier_prices'] ?? true);
                $priceChanged = $snapshotSupplierCost === null || (float) $snapshotSupplierCost !== (float) $unitCost;

                $importItem = ImportItem::create([
                    'account_id' => $accountId,
                    'import_id' => $import->id,
                    'product_id' => $product->id,
                    'supplier_product_price_id' => $supplierPrice?->id,
                    'product_name_snapshot' => $product->name,
                    'product_sku_snapshot' => $product->sku,
                    'supplier_product_code_snapshot' => $item['supplier_product_code'] ?? $supplierPrice?->supplier_product_code,
                    'unit_name_snapshot' => $item['unit_name'] ?? $product->unit?->name,
                    'quantity' => $quantity,
                    'received_quantity' => $receivedQuantity,
                    'unit_cost' => $unitCost,
                    'supplier_price_snapshot' => $snapshotSupplierCost,
                    'price_was_updated' => $priceChanged && $shouldUpdateSupplierPrice,
                    'line_total' => $lineTotal,
                    'notes' => $item['notes'] ?? null,
                    'sort_order' => $index + 1,
                ]);

                if ($this->importAffectsInventory($status) && $receivedQuantity > 0) {
                    InventoryBatch::create([
                    'account_id' => $accountId,
                    'product_id' => $product->id,
                    'import_id' => $import->id,
                    'import_item_id' => $importItem->id,
                    'source_type' => 'import',
                    'source_id' => $import->id,
                    'batch_number' => $this->generateLotNumber($import->import_number, $index + 1),
                    'received_at' => $importDate->copy()->setTimeFrom(now()),
                    'quantity' => $receivedQuantity,
                    'remaining_quantity' => $receivedQuantity,
                    'unit_cost' => $unitCost,
                    'status' => 'open',
                    'meta' => [
                        'supplier_id' => $supplier?->id,
                        'supplier_name' => $supplierName,
                        'source_label' => $import->import_number,
                        'source_name' => 'Phiếu nhập',
                    ],
                ]);

                }

                if ($supplier && ($shouldUpdateSupplierPrice || $supplierPrice === null || array_key_exists('supplier_product_code', $item))) {
                    $supplierPrice = $this->upsertSupplierPrice(
                        $supplier,
                        $product,
                        $unitCost,
                        $userId,
                        $item['price_notes'] ?? null,
                        $item['supplier_product_code'] ?? null
                    );
                    $supplierPrices->put($product->id, $supplierPrice);
                    $importItem->forceFill([
                        'supplier_product_price_id' => $supplierPrice->id,
                        'supplier_product_code_snapshot' => $item['supplier_product_code'] ?? $supplierPrice->supplier_product_code,
                    ])->save();

                    if ($shouldUpdateSupplierPrice) {
                        $this->productPricingService->syncProductFromSupplierPrice($supplierPrice, $userId);
                    }
                }

                $touchedProductIds[] = $product->id;
            }

            if ($this->importAffectsInventory($status)) {
                $this->applyImportAggregateDeltaMap(
                    $this->buildImportAggregateMap($items, (float) $context['extra_charge_amount'])
                );
            }
            $this->syncImportAttachments($import, $payload, $accountId, $userId);
            $this->refreshProducts($touchedProductIds);

            return $this->loadImportRelations($import->fresh());
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
            $this->ensureImportCanBeReverted($import);
            $context = $this->prepareImportContext($payload, $accountId);
            $status = $context['status'];
            $previousProductIds = $import->items()->pluck('product_id')->all();
            $this->revertImportAggregate($import);

            $this->revertImportInventory($import);
            ImportItem::query()->where('import_id', $import->id)->delete();

            $import->forceFill([
                'supplier_id' => $context['supplier']?->id,
                'inventory_import_status_id' => $status->id,
                'supplier_name' => $context['supplier_name'],
                'import_date' => $context['import_date']->toDateString(),
                'status' => $status->code,
                'entry_mode' => $context['entry_mode'],
                'total_quantity' => $context['total_quantity'],
                'subtotal_amount' => $context['subtotal_amount'],
                'extra_charge_percent' => $context['extra_charge_percent'],
                'extra_charge_mode' => $context['extra_charge_mode'],
                'extra_charge_value' => $context['extra_charge_value'],
                'extra_charge_amount' => $context['extra_charge_amount'],
                'total_amount' => $context['total_amount'],
                'notes' => $payload['notes'] ?? null,
                'inventory_applied_at' => $this->importAffectsInventory($status)
                    ? $context['import_date']->copy()->setTimeFrom(now())
                    : null,
            ])->save();

            $touchedProductIds = array_merge(
                $previousProductIds,
                $this->syncImportItems($import, $context, $userId)
            );

            if ($this->importAffectsInventory($status)) {
                $this->applyImportAggregateDeltaMap(
                    $this->buildImportAggregateMap($context['items'], (float) $context['extra_charge_amount'])
                );
            }
            $this->syncImportAttachments($import, $payload, $accountId, $userId);
            $this->refreshProducts($touchedProductIds);

            return $this->loadImportRelations($import->fresh());
        });
    }

    public function deleteImport(InventoryImport $import): void
    {
        DB::transaction(function () use ($import) {
            $productIds = $import->items()->pluck('product_id')->all();
            $this->ensureImportCanBeReverted($import);
            $this->revertImportAggregate($import);
            $this->revertImportInventory($import);
            $import->delete();
            $this->refreshProducts($productIds);
        });
    }

    public function restoreImport(InventoryImport $import): InventoryImport
    {
        return DB::transaction(function () use ($import) {
            if (!$import->trashed()) {
                return $this->loadImportRelations($import->fresh());
            }

            $import->restore();

            $status = $import->statusConfig()->first();
            $items = $import->items()
                ->with(['product:id,sku,name,inventory_unit_id', 'product.unit:id,name'])
                ->orderBy('sort_order')
                ->orderBy('id')
                ->get();

            $supplier = $import->supplier()->withTrashed()->first();
            $supplierName = trim((string) ($supplier?->name ?? $import->supplier_name ?? ''));
            $importDate = Carbon::parse($import->import_date ?? now());
            $touchedProductIds = [];

            foreach ($items as $index => $item) {
                $receivedQuantity = max(0, (int) ($item->received_quantity ?? 0));
                if ($this->importAffectsInventory($status) && $receivedQuantity > 0) {
                    InventoryBatch::create([
                        'account_id' => $import->account_id,
                        'product_id' => $item->product_id,
                        'import_id' => $import->id,
                        'import_item_id' => $item->id,
                        'source_type' => 'import',
                        'source_id' => $import->id,
                        'batch_number' => $this->generateLotNumber($import->import_number, $index + 1),
                        'received_at' => $importDate->copy()->setTimeFrom(now()),
                        'quantity' => $receivedQuantity,
                        'remaining_quantity' => $receivedQuantity,
                        'unit_cost' => round((float) $item->unit_cost, 2),
                        'status' => 'open',
                        'meta' => [
                            'supplier_id' => $supplier?->id,
                            'supplier_name' => $supplierName,
                            'source_label' => $import->import_number,
                            'source_name' => 'Phieu nhap',
                        ],
                    ]);
                }

                $touchedProductIds[] = (int) $item->product_id;
            }

            $this->applyStoredImportAggregate($import);
            $this->refreshProducts($touchedProductIds);

            return $this->loadImportRelations($import->fresh());
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

    public function reserveOrderInventory(Order $order): array
    {
        $items = $order->items()
            ->where('quantity', '>', 0)
            ->get();

        if ($items->isEmpty()) {
            throw ValidationException::withMessages([
                'items' => 'Don hang can co it nhat 1 san pham hop le de khoi phuc ton kho.',
            ]);
        }

        if (InventoryBatchAllocation::query()->where('order_id', $order->id)->exists()) {
            $this->releaseOrderInventory($order);
        }

        $productIds = $items->pluck('product_id')
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        $products = Product::query()
            ->whereIn('id', $productIds)
            ->lockForUpdate()
            ->get()
            ->keyBy('id');

        if (count($productIds) !== $products->count()) {
            throw ValidationException::withMessages([
                'items' => 'Co san pham trong don hang khong ton tai hoac khong thuoc cua hang hien tai.',
            ]);
        }

        $touchedProductIds = [];
        $totalPrice = 0;
        $costTotal = 0;
        $profitTotal = 0;

        foreach ($items as $item) {
            $product = $products->get((int) $item->product_id);
            $quantity = (int) $item->quantity;
            $sellingPrice = round((float) ($item->price ?? 0), 2);
            $allocation = $this->allocateSellableBatches($order->account_id, $product, $quantity);
            $avgUnitCost = $quantity > 0 ? round($allocation['total_cost'] / $quantity, 2) : 0;
            $lineTotalPrice = round($sellingPrice * $quantity, 2);
            $lineProfit = round($lineTotalPrice - $allocation['total_cost'], 2);

            $item->forceFill([
                'cost_price' => $avgUnitCost,
                'cost_total' => $allocation['total_cost'],
                'profit_total' => $lineProfit,
            ])->save();

            foreach ($allocation['allocations'] as $row) {
                InventoryBatchAllocation::create([
                    'account_id' => $order->account_id,
                    'inventory_batch_id' => $row['inventory_batch_id'],
                    'product_id' => $product->id,
                    'order_id' => $order->id,
                    'order_item_id' => $item->id,
                    'quantity' => $row['quantity'],
                    'unit_cost' => $row['unit_cost'],
                    'total_cost' => $row['total_cost'],
                    'allocated_at' => now(),
                ]);
            }

            $touchedProductIds[] = $product->id;
            $totalPrice += $lineTotalPrice;
            $costTotal += (float) $allocation['total_cost'];
            $profitTotal += $lineProfit;
        }

        $this->refreshProducts($touchedProductIds);

        return [
            'items' => $order->items()->whereIn('id', $items->pluck('id'))->get(),
            'total_price' => round($totalPrice, 2),
            'cost_total' => round($costTotal, 2),
            'profit_total' => round($profitTotal, 2),
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
                $importedQuantityTotal = max(0, (int) ($product->imported_quantity_total ?? 0));
                $importedValueTotal = round((float) ($product->imported_value_total ?? 0), 2);
                $currentCost = $importedQuantityTotal > 0
                    ? round($importedValueTotal / $importedQuantityTotal, 2)
                    : null;

                $product->forceFill([
                    'stock_quantity' => $stock,
                    'cost_price' => $currentCost,
                ])->save();
            });
    }

    private function revertImportAggregate(InventoryImport $import): void
    {
        $this->applyImportAggregateDeltaMap(
            $this->buildStoredImportAggregateMap($import),
            -1
        );
    }

    private function applyStoredImportAggregate(InventoryImport $import): void
    {
        $this->applyImportAggregateDeltaMap(
            $this->buildStoredImportAggregateMap($import)
        );
    }

    private function buildStoredImportAggregateMap(InventoryImport $import): array
    {
        $status = $import->statusConfig()->first();
        if (!$this->importAffectsInventory($status)) {
            return [];
        }

        $items = $import->items()
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get([
                'product_id',
                'quantity',
                'received_quantity',
                'unit_cost',
            ]);

        return $this->buildImportAggregateMap(
            $items,
            round((float) ($import->extra_charge_amount ?? 0), 2)
        );
    }

    private function buildImportAggregateMap($items, float $extraChargeAmount): array
    {
        $normalizedItems = collect($items)
            ->map(function ($item) {
                if (is_array($item)) {
                    $payload = $item;
                } elseif ($item instanceof \Illuminate\Contracts\Support\Arrayable) {
                    $payload = $item->toArray();
                } else {
                    $payload = get_object_vars($item);
                }

                $receivedQuantity = max(0, (int) ($payload['received_quantity'] ?? $payload['quantity'] ?? 0));
                $unitCost = round((float) ($payload['unit_cost'] ?? 0), 2);

                return [
                    'product_id' => (int) ($payload['product_id'] ?? 0),
                    'received_quantity' => $receivedQuantity,
                    'base_value' => round($receivedQuantity * $unitCost, 2),
                ];
            })
            ->filter(fn ($row) => $row['product_id'] > 0 && $row['received_quantity'] > 0)
            ->values();

        if ($normalizedItems->isEmpty()) {
            return [];
        }

        $receivedSubtotal = round((float) $normalizedItems->sum('base_value'), 2);
        $remainingExtraCharge = round($extraChargeAmount, 2);
        $lastIndex = $normalizedItems->count() - 1;
        $aggregateMap = [];

        foreach ($normalizedItems as $index => $row) {
            if ($index === $lastIndex) {
                $allocatedExtraCharge = $remainingExtraCharge;
            } elseif ($receivedSubtotal > 0) {
                $allocatedExtraCharge = round(
                    ($row['base_value'] / $receivedSubtotal) * $extraChargeAmount,
                    2
                );
                $remainingExtraCharge = round($remainingExtraCharge - $allocatedExtraCharge, 2);
            } else {
                $allocatedExtraCharge = 0.0;
            }

            $productId = (int) $row['product_id'];
            if (!isset($aggregateMap[$productId])) {
                $aggregateMap[$productId] = [
                    'quantity' => 0,
                    'value' => 0.0,
                ];
            }

            $aggregateMap[$productId]['quantity'] += (int) $row['received_quantity'];
            $aggregateMap[$productId]['value'] = round(
                (float) $aggregateMap[$productId]['value'] + (float) $row['base_value'] + (float) $allocatedExtraCharge,
                2
            );
        }

        return $aggregateMap;
    }

    private function applyImportAggregateDeltaMap(array $aggregateMap, int $direction = 1): void
    {
        if (empty($aggregateMap)) {
            return;
        }

        $productIds = collect(array_keys($aggregateMap))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        Product::query()
            ->whereIn('id', $productIds)
            ->lockForUpdate()
            ->get()
            ->each(function (Product $product) use ($aggregateMap, $direction) {
                $row = $aggregateMap[$product->id] ?? null;
                if (!$row) {
                    return;
                }

                $nextQuantity = max(
                    0,
                    (int) ($product->imported_quantity_total ?? 0) + ($direction * (int) ($row['quantity'] ?? 0))
                );
                $nextValue = round(
                    max(
                        0,
                        (float) ($product->imported_value_total ?? 0) + ($direction * (float) ($row['value'] ?? 0))
                    ),
                    2
                );

                if ($nextQuantity === 0) {
                    $nextValue = 0.0;
                }

                $product->forceFill([
                    'imported_quantity_total' => $nextQuantity,
                    'imported_value_total' => $nextValue,
                    'cost_price' => $nextQuantity > 0 ? round($nextValue / $nextQuantity, 2) : null,
                ])->save();
            });
    }

    private function prepareImportContext(array $payload, int $accountId): array
    {
        $status = $this->resolveImportStatus($payload, $accountId);
        $statusWasManuallySelected = filter_var($payload['status_is_manual'] ?? false, FILTER_VALIDATE_BOOL);

        $items = collect($payload['items'] ?? [])
            ->map(function ($item) {
                $quantity = (int) ($item['quantity'] ?? 0);
                $receivedQuantity = isset($item['received_quantity'])
                    ? (int) $item['received_quantity']
                    : 0;

                if ($receivedQuantity < 0) {
                    $receivedQuantity = 0;
                }
                if ($receivedQuantity > $quantity) {
                    $receivedQuantity = $quantity;
                }

                return [
                    'product_id' => (int) ($item['product_id'] ?? 0),
                    'quantity' => $quantity,
                    'received_quantity' => $receivedQuantity,
                    'unit_cost' => round((float) ($item['unit_cost'] ?? 0), 2),
                    'notes' => $item['notes'] ?? null,
                    'price_notes' => $item['price_notes'] ?? null,
                    'supplier_product_code' => $item['supplier_product_code'] ?? null,
                    'unit_name' => $item['unit_name'] ?? null,
                    'update_supplier_price' => $item['update_supplier_price'] ?? null,
                ];
            })
            ->filter(fn ($item) => $item['product_id'] > 0 && $item['quantity'] > 0)
            ->values();

        if ($items->isEmpty()) {
            throw ValidationException::withMessages([
                'items' => 'Phieu nhap can co it nhat 1 dong san pham hop le.',
            ]);
        }

        $allItemsCompleted = $items->every(fn ($item) => (int) $item['received_quantity'] >= (int) $item['quantity']);
        if (!$statusWasManuallySelected && $allItemsCompleted) {
            $completedStatus = $this->resolveCompletedImportStatus($accountId);
            if ($completedStatus) {
                $status = $completedStatus;
            }
        } elseif (!$statusWasManuallySelected && !$allItemsCompleted && $this->isCompletedImportStatus($status)) {
            $incompleteStatus = $this->resolveIncompleteImportStatus($accountId);
            if ($incompleteStatus) {
                $status = $incompleteStatus;
            }
        }

        $supplierId = (int) ($payload['supplier_id'] ?? 0);
        $supplier = $supplierId > 0
            ? Supplier::query()->findOrFail($supplierId)
            : null;
        $supplierName = $this->resolvedImportSupplierName($supplier);
        $productIds = $items->pluck('product_id')->unique()->values()->all();
        $products = Product::query()
            ->with(['unit:id,name'])
            ->whereIn('id', $productIds)
            ->lockForUpdate()
            ->get()
            ->keyBy('id');

        if (count($productIds) !== $products->count()) {
            throw ValidationException::withMessages([
                'items' => 'Co san pham trong phieu nhap khong ton tai hoac khong thuoc cua hang hien tai.',
            ]);
        }

        $supplierPrices = $supplier
            ? SupplierProductPrice::query()
                ->where('supplier_id', $supplier->id)
                ->whereIn('product_id', $productIds)
                ->get()
                ->keyBy('product_id')
            : collect();

        $importDate = Carbon::parse($payload['import_date'] ?? now());
        $subtotalAmount = round((float) $items->sum(fn ($item) => $item['quantity'] * $item['unit_cost']), 2);
        $extraCharge = $this->resolveImportExtraCharge($payload, $subtotalAmount);
        $totalAmount = round($subtotalAmount + $extraCharge['amount'], 2);

        return [
            'items' => $items,
            'supplier' => $supplier,
            'supplier_name' => $supplierName,
            'product_ids' => $productIds,
            'products' => $products,
            'supplier_prices' => $supplierPrices,
            'import_date' => $importDate,
            'status' => $status,
            'entry_mode' => $this->resolveImportEntryMode($payload),
            'total_quantity' => (int) $items->sum('quantity'),
            'total_received_quantity' => (int) $items->sum('received_quantity'),
            'subtotal_amount' => $subtotalAmount,
            'extra_charge_percent' => $extraCharge['percent'],
            'extra_charge_mode' => $extraCharge['mode'],
            'extra_charge_value' => $extraCharge['value'],
            'extra_charge_amount' => $extraCharge['amount'],
            'total_amount' => $totalAmount,
        ];
    }

    private function resolvedImportSupplierName(?Supplier $supplier): string
    {
        $name = trim((string) ($supplier?->name ?? ''));
        return $name !== '' ? $name : 'Tất cả sản phẩm';
    }

    private function resolveImportExtraCharge(array $payload, float $subtotalAmount): array
    {
        $mode = in_array(($payload['extra_charge_mode'] ?? null), ['percent', 'amount', 'mixed'], true)
            ? (string) $payload['extra_charge_mode']
            : 'percent';

        $rawValue = array_key_exists('extra_charge_value', $payload) && $payload['extra_charge_value'] !== null && $payload['extra_charge_value'] !== ''
            ? round((float) $payload['extra_charge_value'], 2)
            : null;

        if ($mode === 'amount') {
            $value = $rawValue ?? round((float) ($payload['extra_charge_amount'] ?? 0), 2);
            $fixedAmount = round($value, 2);
            $percent = $subtotalAmount > 0
                ? round(($fixedAmount / $subtotalAmount) * 100, 2)
                : 0;
        } elseif ($mode === 'mixed') {
            $value = $rawValue ?? 0;
            $fixedAmount = round($value, 2);
            $percent = round((float) ($payload['extra_charge_percent'] ?? 0), 2);
        } else {
            $value = $rawValue ?? round((float) ($payload['extra_charge_percent'] ?? 0), 2);
            $percent = round($value, 2);
            $fixedAmount = 0;
            $mode = 'percent';
        }

        $amount = round($fixedAmount + (($subtotalAmount * $percent) / 100), 2);

        return [
            'mode' => $mode,
            'value' => round($value, 2),
            'amount' => round($amount, 2),
            'percent' => round($percent, 2),
        ];
    }

    private function resolveImportStatus(array $payload, int $accountId): InventoryImportStatus
    {
        $query = InventoryImportStatus::query()
            ->where(function ($builder) use ($accountId) {
                $builder
                    ->whereNull('account_id')
                    ->orWhere('account_id', $accountId);
            })
            ->where('is_active', true)
            ->orderByRaw('CASE WHEN account_id = ? THEN 0 ELSE 1 END', [$accountId])
            ->orderByDesc('is_default')
            ->orderBy('sort_order')
            ->orderBy('id');

        $statusId = (int) ($payload['inventory_import_status_id'] ?? $payload['status_id'] ?? 0);
        if ($statusId > 0) {
            $status = (clone $query)->where('id', $statusId)->first();
            if ($status) {
                return $status;
            }
        }

        $statusNeedle = trim((string) ($payload['status_code'] ?? $payload['status'] ?? ''));
        if ($statusNeedle !== '') {
            $needle = mb_strtolower($statusNeedle);
            $status = (clone $query)->get()->first(function (InventoryImportStatus $item) use ($needle) {
                return mb_strtolower((string) $item->code) === $needle
                    || mb_strtolower((string) $item->name) === $needle;
            });

            if ($status) {
                return $status;
            }
        }

        $status = $query->first();
        if (!$status) {
            throw ValidationException::withMessages([
                'inventory_import_status_id' => 'Chua co cau hinh trang thai phieu nhap.',
            ]);
        }

        return $status;
    }

    private function resolveCompletedImportStatus(int $accountId): ?InventoryImportStatus
    {
        return InventoryImportStatus::query()
            ->where(function ($builder) use ($accountId) {
                $builder
                    ->whereNull('account_id')
                    ->orWhere('account_id', $accountId);
            })
            ->where('is_active', true)
            ->orderByRaw('CASE WHEN account_id = ? THEN 0 ELSE 1 END', [$accountId])
            ->orderByDesc('is_default')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->first(fn (InventoryImportStatus $status) => $this->isCompletedImportStatus($status));
    }

    private function resolveIncompleteImportStatus(int $accountId): ?InventoryImportStatus
    {
        return InventoryImportStatus::query()
            ->where(function ($builder) use ($accountId) {
                $builder
                    ->whereNull('account_id')
                    ->orWhere('account_id', $accountId);
            })
            ->where('is_active', true)
            ->orderByRaw('CASE WHEN account_id = ? THEN 0 ELSE 1 END', [$accountId])
            ->orderByDesc('is_default')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->first(function (InventoryImportStatus $status) {
                $normalizedCode = $this->normalizeStatusText($status->code);
                $normalizedName = $this->normalizeStatusText($status->name);

                return in_array($normalizedCode, ['hoan_thanh_1_phan', 'partial', 'partially_completed'], true)
                    || str_contains($normalizedName, '1 phan')
                    || str_contains($normalizedName, 'mot phan')
                    || str_contains($normalizedName, 'chua du')
                    || !$this->isCompletedImportStatus($status);
            });
    }

    private function isCompletedImportStatus(?InventoryImportStatus $status): bool
    {
        if (!$status) {
            return false;
        }

        $normalizedCode = $this->normalizeStatusText($status->code);
        $normalizedName = $this->normalizeStatusText($status->name);

        return in_array($normalizedCode, ['hoan_thanh', 'completed', 'complete', 'done'], true)
            || in_array($normalizedName, ['hoan thanh', 'completed', 'complete', 'done'], true)
            || str_contains($normalizedName, 'completed')
            || str_contains($normalizedName, 'complete');
    }

    private function normalizeStatusText(?string $value): string
    {
        return Str::lower(trim((string) Str::of((string) $value)->ascii()));
    }

    private function resolveImportEntryMode(array $payload): string
    {
        $entryMode = trim((string) ($payload['entry_mode'] ?? ''));
        if ($entryMode !== '') {
            return $entryMode;
        }

        return !empty($payload['invoice_analysis_log_id']) ? 'invoice_ai' : 'manual';
    }

    private function syncImportItems(InventoryImport $import, array $context, ?int $userId = null): array
    {
        $touchedProductIds = [];
        $status = $context['status'];
        $items = $context['items'];
        $products = $context['products'];
        $supplierPrices = $context['supplier_prices'];
        $supplier = $context['supplier'];
        $supplierName = $context['supplier_name'];
        $importDate = $context['import_date'];

        foreach ($items as $index => $item) {
            $product = $products->get((int) $item['product_id']);
            if (!$product) {
                continue;
            }

            $quantity = (int) $item['quantity'];
            $receivedQuantity = max(0, min($quantity, (int) ($item['received_quantity'] ?? $quantity)));
            $unitCost = round((float) $item['unit_cost'], 2);
            $lineTotal = round($quantity * $unitCost, 2);
            $supplierPrice = $supplierPrices->get($product->id);
            $snapshotSupplierCost = $supplierPrice ? round((float) $supplierPrice->unit_cost, 2) : null;
            $shouldUpdateSupplierPrice = (bool) ($item['update_supplier_price'] ?? true);
            $priceChanged = $snapshotSupplierCost === null || (float) $snapshotSupplierCost !== (float) $unitCost;

            $importItem = ImportItem::create([
                'account_id' => $import->account_id,
                'import_id' => $import->id,
                'product_id' => $product->id,
                'supplier_product_price_id' => $supplierPrice?->id,
                'product_name_snapshot' => $product->name,
                'product_sku_snapshot' => $product->sku,
                'supplier_product_code_snapshot' => $item['supplier_product_code'] ?? $supplierPrice?->supplier_product_code,
                'unit_name_snapshot' => $item['unit_name'] ?? $product->unit?->name,
                'quantity' => $quantity,
                'received_quantity' => $receivedQuantity,
                'unit_cost' => $unitCost,
                'supplier_price_snapshot' => $snapshotSupplierCost,
                'price_was_updated' => $priceChanged && $shouldUpdateSupplierPrice,
                'line_total' => $lineTotal,
                'notes' => $item['notes'] ?? null,
                'sort_order' => $index + 1,
            ]);

            if ($supplier && ($shouldUpdateSupplierPrice || $supplierPrice === null || array_key_exists('supplier_product_code', $item))) {
                $supplierPrice = $this->upsertSupplierPrice(
                    $supplier,
                    $product,
                    $unitCost,
                    $userId,
                    $item['price_notes'] ?? null,
                    $item['supplier_product_code'] ?? null
                );
                $supplierPrices->put($product->id, $supplierPrice);
                $importItem->forceFill([
                    'supplier_product_price_id' => $supplierPrice->id,
                    'supplier_product_code_snapshot' => $item['supplier_product_code'] ?? $supplierPrice->supplier_product_code,
                ])->save();

                if ($shouldUpdateSupplierPrice) {
                    $this->productPricingService->syncProductFromSupplierPrice($supplierPrice, $userId);
                }
            }

            if ($this->importAffectsInventory($status) && $receivedQuantity > 0) {
                InventoryBatch::create([
                    'account_id' => $import->account_id,
                    'product_id' => $product->id,
                    'import_id' => $import->id,
                    'import_item_id' => $importItem->id,
                    'source_type' => 'import',
                    'source_id' => $import->id,
                    'batch_number' => $this->generateLotNumber($import->import_number, $index + 1),
                    'received_at' => $importDate->copy()->setTimeFrom(now()),
                    'quantity' => $receivedQuantity,
                    'remaining_quantity' => $receivedQuantity,
                    'unit_cost' => $unitCost,
                    'status' => 'open',
                    'meta' => [
                        'supplier_id' => $supplier?->id,
                        'supplier_name' => $supplierName,
                        'source_label' => $import->import_number,
                        'source_name' => 'Phieu nhap',
                    ],
                ]);
            }

            $touchedProductIds[] = $product->id;
        }

        return $touchedProductIds;
    }

    private function syncImportAttachments(InventoryImport $import, array $payload, int $accountId, ?int $userId = null): void
    {
        $attachments = collect($payload['attachments'] ?? [])
            ->filter(fn ($attachment) => !empty($attachment['file_path']))
            ->values();

        $keepAttachmentIds = $attachments
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->values()
            ->all();

        $deleteQuery = InventoryImportAttachment::query()->where('import_id', $import->id);
        if (!empty($keepAttachmentIds)) {
            $deleteQuery->whereNotIn('id', $keepAttachmentIds);
        }
        $deleteQuery->delete();

        foreach ($attachments as $attachment) {
            $record = null;

            if (!empty($attachment['id'])) {
                $record = InventoryImportAttachment::query()
                    ->where('import_id', $import->id)
                    ->find((int) $attachment['id']);
            }

            if (!$record) {
                $record = new InventoryImportAttachment();
            }

            $record->fill([
                'account_id' => $accountId,
                'import_id' => $import->id,
                'invoice_analysis_log_id' => $attachment['invoice_analysis_log_id'] ?? null,
                'source_type' => $attachment['source_type'] ?? 'manual',
                'disk' => $attachment['disk'] ?? 'public',
                'file_path' => $attachment['file_path'],
                'original_name' => $attachment['original_name'] ?? basename((string) $attachment['file_path']),
                'mime_type' => $attachment['mime_type'] ?? null,
                'file_size' => $attachment['file_size'] ?? null,
                'uploaded_by' => $userId ?? Auth::id(),
            ]);
            $record->save();
        }

        $analysisLogId = (int) ($payload['invoice_analysis_log_id'] ?? 0);
        if ($analysisLogId <= 0) {
            return;
        }

        $analysisLog = InventoryInvoiceAnalysisLog::query()->find($analysisLogId);
        if (!$analysisLog) {
            return;
        }

        $analysisLog->forceFill([
            'supplier_id' => $import->supplier_id,
            'import_id' => $import->id,
        ])->save();

        InventoryImportAttachment::query()->updateOrCreate(
            [
                'import_id' => $import->id,
                'invoice_analysis_log_id' => $analysisLog->id,
            ],
            [
                'account_id' => $accountId,
                'source_type' => 'invoice',
                'disk' => $analysisLog->disk,
                'file_path' => $analysisLog->file_path,
                'original_name' => $analysisLog->source_name,
                'mime_type' => $analysisLog->mime_type,
                'file_size' => $analysisLog->file_size,
                'uploaded_by' => $userId ?? Auth::id(),
            ]
        );
    }

    private function loadImportRelations(InventoryImport $import): InventoryImport
    {
        return $import->load([
            'supplier:id,name,phone,email,address',
            'statusConfig:id,code,name,color,affects_inventory,is_default,is_system',
            'items' => function ($builder) {
                $builder->orderBy('sort_order')->orderBy('id');
            },
            'items.product:id,sku,name,price,stock_quantity,inventory_unit_id,inventory_import_starred',
            'items.product.unit:id,name',
            'items.batch',
            'items.supplierPrice:id,supplier_id,product_id,supplier_product_code,unit_cost,notes,updated_at',
            'attachments:id,import_id,invoice_analysis_log_id,source_type,disk,file_path,original_name,mime_type,file_size,uploaded_by,created_at',
            'attachments.invoiceAnalysisLog:id,status,provider',
            'invoiceAnalysisLogs:id,import_id,supplier_id,source_name,status,provider,analysis_result,error_message,created_at',
            'creator:id,name',
        ]);
    }

    private function importAffectsInventory(?InventoryImportStatus $status): bool
    {
        return (bool) ($status?->affects_inventory ?? false);
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

    private function revertImportInventory(InventoryImport $import): void
    {
        InventoryBatch::query()->where('import_id', $import->id)->delete();
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

    private function upsertSupplierPrice(
        Supplier $supplier,
        Product $product,
        float $unitCost,
        ?int $userId = null,
        ?string $notes = null,
        ?string $supplierProductCode = null
    ): SupplierProductPrice
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

        $supplierPriceData = [
            'account_id' => $supplier->account_id ?? $product->account_id,
            'unit_cost' => $this->normalizeSupplierUnitCost($unitCost),
            'notes' => $notes,
            'updated_by' => $userId ?? Auth::id(),
        ];

        if ($supplierProductCode !== null) {
            $normalizedSupplierCode = trim((string) $supplierProductCode);
            $supplierPriceData['supplier_product_code'] = $normalizedSupplierCode !== '' ? $normalizedSupplierCode : null;
        }

        $supplierPrice->fill($supplierPriceData);
        $supplierPrice->save();

        return $supplierPrice;
    }

    private function normalizeSupplierUnitCost(float $value): float
    {
        return round($value, 2);
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
