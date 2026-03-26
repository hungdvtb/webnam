<?php

namespace App\Services;

use App\Models\InventoryBatch;
use App\Models\InventoryBatchAllocation;
use App\Models\InventoryDocument;
use App\Models\InventoryDocumentAllocation;
use App\Models\InventoryDocumentItem;
use App\Models\InventoryDocumentItemOrderRelease;
use App\Models\Order;
use App\Models\Product;
use App\Models\Shipment;
use App\Services\Inventory\InventoryService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class OrderInventorySlipService
{
    private const ACTIVE_STATUSES = ['draft', 'completed'];
    private const VARIANCE_NONE = 'match';
    private const VARIANCE_PRODUCT = 'product';
    private const VARIANCE_QUANTITY = 'quantity';
    private const VARIANCE_BOTH = 'product_and_quantity';
    private const OVERSOLD_RESERVE_SOURCE = 'oversold_reserve';

    public function __construct(
        private readonly InventoryService $inventoryService,
    ) {
    }

    public function buildListSummaryMap(Collection $orders): array
    {
        if ($orders->isEmpty()) {
            return [];
        }

        $documentsByOrderId = $this->loadDocumentsForOrders($orders);
        $automaticExportsByOrderId = $this->loadAutomaticExportsForOrders($orders);

        return $orders
            ->mapWithKeys(function (Order $order) use ($documentsByOrderId, $automaticExportsByOrderId) {
                $detail = $this->buildDetailPayload(
                    $order,
                    $documentsByOrderId->get((int) $order->id, collect()),
                    $automaticExportsByOrderId->get((int) $order->id, collect()),
                    false
                );

                return [(int) $order->id => $detail['summary']];
            })
            ->all();
    }

    public function applyExportSlipStateFilter($query, string $state): void
    {
        $state = strtolower(trim($state));

        if ($state === 'created') {
            $query->where(function ($builder) {
                $this->applyActiveDocumentSlipStateFilter($builder, 'created', 'export');
                $builder
                    ->orWhereExists(function ($shipmentQuery) {
                        $shipmentQuery
                            ->select(DB::raw(1))
                            ->from('shipments')
                            ->whereColumn('shipments.order_id', 'orders.id')
                            ->whereNull('shipments.deleted_at')
                            ->whereNotIn('shipments.shipment_status', ['canceled']);
                    })
                    ->orWhere('type', 'inventory_export')
                    ->orWhere(function ($trackingQuery) {
                        $trackingQuery
                            ->whereNotNull('shipping_tracking_code')
                            ->where('shipping_tracking_code', '!=', '');
                    });
            });

            return;
        }

        if ($state !== 'missing') {
            return;
        }

        $query
            ->where(function ($builder) {
                $this->applyActiveDocumentSlipStateFilter($builder, 'missing', 'export');
            })
            ->whereNotExists(function ($shipmentQuery) {
                $shipmentQuery
                    ->select(DB::raw(1))
                    ->from('shipments')
                    ->whereColumn('shipments.order_id', 'orders.id')
                    ->whereNull('shipments.deleted_at')
                    ->whereNotIn('shipments.shipment_status', ['canceled']);
            })
            ->where(function ($builder) {
                $builder
                    ->whereNull('shipping_tracking_code')
                    ->orWhere('shipping_tracking_code', '');
            })
            ->where(function ($builder) {
                $builder
                    ->whereNull('type')
                    ->orWhere('type', '!=', 'inventory_export');
            });
    }

    public function applyReturnSlipStateFilter($query, string $state): void
    {
        $this->applyActiveDocumentSlipStateFilter($query, $state, 'return');
    }

    public function applyDamagedSlipStateFilter($query, string $state): void
    {
        $this->applyActiveDocumentSlipStateFilter($query, $state, 'damaged');
    }

    public function getOrderDetail(Order $order): array
    {
        $order->loadMissing(['items']);

        return $this->buildDetailPayload(
            $order,
            $this->loadDocumentsForSingleOrder($order),
            $this->loadAutomaticExportsForSingleOrder($order),
            true
        );
    }

    public function createSlip(Order $order, array $payload, ?int $userId = null): InventoryDocument
    {
        $type = $this->normalizeType((string) ($payload['type'] ?? ''));

        return DB::transaction(function () use ($order, $payload, $type, $userId) {
            $order->loadMissing(['items.batchAllocations.batch']);

            $items = $this->normalizeSlipItems($payload['items'] ?? []);
            if ($items->isEmpty()) {
                throw ValidationException::withMessages([
                    'items' => ['Can nhap it nhat 1 dong san pham hop le.'],
                ]);
            }

            $orderProducts = $this->aggregateOrderProducts($order);
            $existingDocuments = $this->loadDocumentsForSingleOrder($order);
            $automaticExports = $this->loadAutomaticExportsForSingleOrder($order);
            $detail = $this->buildDetailPayload($order, $existingDocuments, $automaticExports, false);
            $progressMap = collect($detail['products'])->keyBy('product_id');

            $this->validateSlipRows($type, $items, $orderProducts, $progressMap);

            $productIds = $items
                ->flatMap(fn (array $item) => [$item['planned_product_id'], $item['actual_product_id']])
                ->filter(fn ($id) => (int) $id > 0)
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
                    'items' => ['Co san pham khong con ton tai trong he thong.'],
                ]);
            }

            $documentDate = Carbon::parse($payload['document_date'] ?? now());
            $document = InventoryDocument::create([
                'account_id' => (int) $order->account_id,
                'document_number' => $this->generateDocumentNumber($type, (int) $order->account_id),
                'type' => $type,
                'document_date' => $documentDate->toDateString(),
                'status' => 'completed',
                'reference_type' => 'order',
                'reference_id' => (int) $order->id,
                'notes' => $this->nullableText($payload['notes'] ?? null),
                'created_by' => $userId,
            ]);

            $touchedProductIds = [];

            foreach ($items->values() as $index => $row) {
                $plannedProductId = (int) $row['planned_product_id'];
                $actualProductId = (int) $row['actual_product_id'];
                $plannedQuantity = (int) $row['planned_quantity'];
                $actualQuantity = (int) $row['actual_quantity'];
                $progress = (array) ($progressMap->get($plannedProductId) ?? []);
                $orderProduct = (array) ($orderProducts->get($plannedProductId) ?? []);
                $plannedProduct = $products->get($plannedProductId);
                $actualProduct = $products->get($actualProductId);

                $plannedName = (string) ($orderProduct['product_name'] ?? $progress['product_name'] ?? $plannedProduct?->name ?? "San pham #{$plannedProductId}");
                $plannedSku = $orderProduct['product_sku'] ?? $progress['product_sku'] ?? $plannedProduct?->sku;
                $plannedUnitPrice = $orderProduct['ordered_unit_price'] ?? $progress['ordered_unit_price'] ?? null;
                $plannedUnitCost = (float) (
                    $orderProduct['ordered_unit_cost']
                    ?? $progress['ordered_unit_cost']
                    ?? $plannedProduct?->cost_price
                    ?? $plannedProduct?->expected_cost
                    ?? 0
                );
                $actualUnitPrice = $plannedUnitPrice !== null ? round((float) $plannedUnitPrice, 2) : null;

                $documentItem = InventoryDocumentItem::create([
                    'account_id' => (int) $order->account_id,
                    'inventory_document_id' => (int) $document->id,
                    'product_id' => $plannedProductId,
                    'actual_product_id' => $actualProductId,
                    'product_name_snapshot' => $plannedName,
                    'product_sku_snapshot' => $plannedSku,
                    'actual_product_name_snapshot' => $actualProduct?->name ?? "San pham #{$actualProductId}",
                    'actual_product_sku_snapshot' => $actualProduct?->sku,
                    'quantity' => $plannedQuantity,
                    'actual_quantity' => $actualQuantity,
                    'stock_bucket' => $this->stockBucketForType($type),
                    'direction' => $this->directionForType($type),
                    'unit_cost' => round($plannedUnitCost, 2),
                    'total_cost' => round($plannedUnitCost * $plannedQuantity, 2),
                    'actual_unit_cost' => 0,
                    'actual_total_cost' => 0,
                    'unit_price' => $plannedUnitPrice !== null ? round((float) $plannedUnitPrice, 2) : null,
                    'total_price' => $plannedUnitPrice !== null ? round((float) $plannedUnitPrice * $plannedQuantity, 2) : null,
                    'actual_unit_price' => $actualUnitPrice,
                    'actual_total_price' => $actualUnitPrice !== null ? round((float) $actualUnitPrice * $actualQuantity, 2) : null,
                    'notes' => $row['notes'],
                    'actual_reason' => $row['actual_reason'],
                    'variance_type' => $row['variance_type'],
                    'planned_order_product_id' => $orderProduct ? $plannedProductId : null,
                    'planned_order_product_name_snapshot' => $orderProduct['product_name'] ?? null,
                    'planned_order_product_sku_snapshot' => $orderProduct['product_sku'] ?? null,
                    'planned_order_quantity' => $orderProduct ? $plannedQuantity : null,
                ]);

                if ($type === 'export') {
                    $this->releaseReservedOrderInventoryForDocumentItem(
                        $order,
                        $documentItem,
                        $plannedProductId,
                        $plannedQuantity
                    );

                    $actualAllocation = $this->allocateActualExportInventoryForDocumentItem(
                        $order,
                        $documentItem,
                        $actualProduct,
                        $actualQuantity
                    );

                    $documentItem->forceFill([
                        'actual_unit_cost' => $actualQuantity > 0
                            ? round((float) $actualAllocation['total_cost'] / $actualQuantity, 2)
                            : 0,
                        'actual_total_cost' => round((float) $actualAllocation['total_cost'], 2),
                    ])->save();
                } else {
                    $actualUnitCost = $this->resolveActualUnitCost(
                        $progressMap,
                        $actualProduct,
                        $actualProductId,
                        (float) $plannedUnitCost
                    );

                    $documentItem->forceFill([
                        'actual_unit_cost' => round($actualUnitCost, 2),
                        'actual_total_cost' => round($actualUnitCost * $actualQuantity, 2),
                    ])->save();

                    if ($type === 'return') {
                        $this->createActualReturnBatch(
                            $order,
                            $document,
                            $documentItem,
                            $actualProduct,
                            $actualQuantity,
                            $actualUnitCost,
                            $index + 1,
                            $documentDate
                        );
                    } elseif ($type === 'damaged') {
                        $actualProduct->damaged_quantity = (int) ($actualProduct->damaged_quantity ?? 0) + $actualQuantity;
                        $actualProduct->save();
                    }
                }

                $touchedProductIds[] = $plannedProductId;
                $touchedProductIds[] = $actualProductId;
            }

            $this->finalizeDocumentTotals($document);
            $this->inventoryService->refreshProducts(array_values(array_unique(array_map('intval', $touchedProductIds))));

            return $document->fresh([
                'creator:id,name',
                'items.product:id,sku,name',
                'items.actualProduct:id,sku,name',
                'items.orderReleases.batch:id,source_type,remaining_quantity',
                'items.allocations.batch:id,source_type,remaining_quantity',
            ]);
        });
    }

    public function deleteSlip(Order $order, int $documentId): void
    {
        DB::transaction(function () use ($order, $documentId) {
            $document = InventoryDocument::query()
                ->where('reference_type', 'order')
                ->where('reference_id', (int) $order->id)
                ->whereIn('type', ['export', 'return', 'damaged'])
                ->whereKey($documentId)
                ->with([
                    'items.product',
                    'items.actualProduct',
                    'items.allocations.batch',
                    'items.orderReleases.batch',
                ])
                ->firstOrFail();

            if ($document->type === 'export') {
                $this->ensureExportSlipCanBeDeleted($order, $document);
            }

            if ($document->type === 'return') {
                $this->ensureReturnSlipCanBeDeleted($document);
            }

            if ($document->type === 'damaged') {
                $this->ensureDamagedSlipCanBeDeleted($document);
            }

            $touchedProductIds = [];

            foreach ($document->items as $item) {
                $plannedProductId = (int) $item->product_id;
                $actualProductId = (int) ($item->actual_product_id ?: $plannedProductId);

                $touchedProductIds[] = $plannedProductId;
                $touchedProductIds[] = $actualProductId;

                if ($document->type === 'export') {
                    $this->revertActualExportAllocations($item);
                    $this->restoreOrderReservationFromReleases($order, $item);
                } elseif ($document->type === 'damaged') {
                    $product = $item->actualProduct ?: $item->product;
                    if ($product instanceof Product) {
                        $product->damaged_quantity = max(
                            0,
                            (int) ($product->damaged_quantity ?? 0) - (int) ($item->actual_quantity ?? $item->quantity ?? 0)
                        );
                        $product->save();
                    }
                }
            }

            if ($document->type === 'return') {
                InventoryBatch::query()
                    ->where('source_type', 'document')
                    ->where('source_id', (int) $document->id)
                    ->delete();
            }

            InventoryDocumentItem::query()
                ->where('inventory_document_id', (int) $document->id)
                ->delete();

            $document->delete();

            $touchedProductIds = array_values(array_unique(array_filter(array_map('intval', $touchedProductIds))));
            if (!empty($touchedProductIds)) {
                $this->inventoryService->refreshProducts($touchedProductIds);
            }
        });
    }

    private function applyActiveDocumentSlipStateFilter($query, string $state, string $type): void
    {
        $normalizedState = strtolower(trim($state));

        if (!in_array($normalizedState, ['created', 'missing'], true)) {
            return;
        }

        $method = $normalizedState === 'created' ? 'whereExists' : 'whereNotExists';

        $query->{$method}(function ($documentQuery) use ($type) {
            $documentQuery
                ->select(DB::raw(1))
                ->from('inventory_documents')
                ->whereColumn('inventory_documents.reference_id', 'orders.id')
                ->where('inventory_documents.reference_type', 'order')
                ->where('inventory_documents.type', $type)
                ->whereIn('inventory_documents.status', self::ACTIVE_STATUSES);
        });
    }

    private function validateSlipRows(
        string $type,
        Collection $items,
        Collection $orderProducts,
        Collection $progressMap
    ): void {
        $plannedTotals = [];

        foreach ($items as $row) {
            $plannedProductId = (int) $row['planned_product_id'];
            $plannedTotals[$plannedProductId] = (int) ($plannedTotals[$plannedProductId] ?? 0) + (int) $row['planned_quantity'];

            if ($type === 'export' && !$orderProducts->has($plannedProductId)) {
                throw ValidationException::withMessages([
                    'items' => ["San pham #{$plannedProductId} khong thuoc don hang nay."],
                ]);
            }

            $hasVariance = $row['variance_type'] !== self::VARIANCE_NONE;
            if ($hasVariance && $row['actual_reason'] === null) {
                throw ValidationException::withMessages([
                    'items' => ['Can nhap ly do khi SKU thuc te hoac so luong thuc te khac du kien.'],
                ]);
            }
        }

        foreach ($plannedTotals as $plannedProductId => $plannedQuantity) {
            $progress = (array) ($progressMap->get((int) $plannedProductId) ?? []);
            $availableQuantity = match ($type) {
                'export' => (int) ($progress['remaining_planned_export_quantity'] ?? $progress['exportable_quantity'] ?? 0),
                'return', 'damaged' => (int) ($progress['reversible_planned_quantity'] ?? $progress['reversible_quantity'] ?? 0),
                default => 0,
            };

            if ($plannedQuantity > $availableQuantity) {
                $productName = $progress['product_name'] ?? "San pham #{$plannedProductId}";
                $label = $this->typeLabel($type);

                throw ValidationException::withMessages([
                    'items' => ["{$productName} chi con {$availableQuantity} don vi co the tao {$label}."],
                ]);
            }
        }
    }

    private function normalizeSlipItems(array $items): Collection
    {
        return collect($items)
            ->map(function ($item) {
                $plannedProductId = (int) ($item['product_id'] ?? 0);
                $plannedQuantity = (int) ($item['quantity'] ?? 0);
                $actualProductId = (int) ($item['actual_product_id'] ?? $plannedProductId);
                $actualQuantity = $item['actual_quantity'] === null || $item['actual_quantity'] === ''
                    ? $plannedQuantity
                    : (int) $item['actual_quantity'];

                return [
                    'planned_product_id' => $plannedProductId,
                    'planned_quantity' => $plannedQuantity,
                    'actual_product_id' => $actualProductId,
                    'actual_quantity' => $actualQuantity,
                    'notes' => $this->nullableText($item['notes'] ?? null),
                    'actual_reason' => $this->nullableText($item['actual_reason'] ?? null),
                    'variance_type' => $this->resolveVarianceType(
                        $plannedProductId,
                        $actualProductId,
                        $plannedQuantity,
                        $actualQuantity
                    ),
                ];
            })
            ->filter(function (array $row) {
                return $row['planned_product_id'] > 0
                    && $row['actual_product_id'] > 0
                    && $row['planned_quantity'] > 0
                    && $row['actual_quantity'] > 0;
            })
            ->values();
    }

    private function resolveVarianceType(int $plannedProductId, int $actualProductId, int $plannedQuantity, int $actualQuantity): string
    {
        $productChanged = $plannedProductId !== $actualProductId;
        $quantityChanged = $plannedQuantity !== $actualQuantity;

        if ($productChanged && $quantityChanged) {
            return self::VARIANCE_BOTH;
        }

        if ($productChanged) {
            return self::VARIANCE_PRODUCT;
        }

        if ($quantityChanged) {
            return self::VARIANCE_QUANTITY;
        }

        return self::VARIANCE_NONE;
    }

    private function releaseReservedOrderInventoryForDocumentItem(
        Order $order,
        InventoryDocumentItem $documentItem,
        int $plannedProductId,
        int $plannedQuantity
    ): void {
        $allocations = InventoryBatchAllocation::query()
            ->where('order_id', (int) $order->id)
            ->where('product_id', $plannedProductId)
            ->with('batch')
            ->orderBy('allocated_at')
            ->orderBy('id')
            ->lockForUpdate()
            ->get();

        $remaining = $plannedQuantity;

        foreach ($allocations as $allocation) {
            if ($remaining <= 0) {
                break;
            }

            $takeQty = min($remaining, (int) $allocation->quantity);
            if ($takeQty <= 0) {
                continue;
            }

            $batch = $allocation->batch;
            $isOversoldBatch = $batch instanceof InventoryBatch
                && (string) ($batch->source_type ?? '') === self::OVERSOLD_RESERVE_SOURCE;

            if ($batch instanceof InventoryBatch && !$isOversoldBatch) {
                $batch->remaining_quantity = (int) $batch->remaining_quantity + $takeQty;
                $batch->status = (int) $batch->remaining_quantity > 0 ? 'open' : $batch->status;
                $batch->save();
            }

            InventoryDocumentItemOrderRelease::create([
                'account_id' => (int) $order->account_id,
                'inventory_document_item_id' => (int) $documentItem->id,
                'inventory_batch_id' => (int) ($allocation->inventory_batch_id ?? 0) ?: null,
                'order_id' => (int) $order->id,
                'order_item_id' => (int) ($allocation->order_item_id ?? 0) ?: null,
                'product_id' => $plannedProductId,
                'quantity' => $takeQty,
                'unit_cost' => round((float) ($allocation->unit_cost ?? 0), 2),
                'total_cost' => round((float) ($allocation->unit_cost ?? 0) * $takeQty, 2),
                'released_at' => now(),
            ]);

            $allocation->quantity = (int) $allocation->quantity - $takeQty;
            if ((int) $allocation->quantity <= 0) {
                $allocation->delete();
            } else {
                $allocation->total_cost = round((float) ($allocation->unit_cost ?? 0) * (int) $allocation->quantity, 2);
                $allocation->save();
            }

            $remaining -= $takeQty;
        }
    }

    private function allocateActualExportInventoryForDocumentItem(
        Order $order,
        InventoryDocumentItem $documentItem,
        Product $actualProduct,
        int $actualQuantity
    ): array {
        $allocation = $this->inventoryService->allocateFlexibleSellableBatches(
            (int) $order->account_id,
            $actualProduct,
            $actualQuantity,
            true
        );

        foreach ($allocation['allocations'] as $row) {
            InventoryDocumentAllocation::create([
                'account_id' => (int) $order->account_id,
                'inventory_document_item_id' => (int) $documentItem->id,
                'inventory_batch_id' => (int) ($row['inventory_batch_id'] ?? 0) ?: null,
                'product_id' => (int) $actualProduct->id,
                'quantity' => (int) ($row['quantity'] ?? 0),
                'unit_cost' => round((float) ($row['unit_cost'] ?? 0), 2),
                'total_cost' => round((float) ($row['total_cost'] ?? 0), 2),
                'allocated_at' => now(),
            ]);
        }

        return [
            'total_cost' => round((float) ($allocation['total_cost'] ?? 0), 2),
        ];
    }

    private function createActualReturnBatch(
        Order $order,
        InventoryDocument $document,
        InventoryDocumentItem $documentItem,
        Product $actualProduct,
        int $actualQuantity,
        float $actualUnitCost,
        int $lineNumber,
        Carbon $documentDate
    ): void {
        InventoryBatch::create([
            'account_id' => (int) $order->account_id,
            'product_id' => (int) $actualProduct->id,
            'source_type' => 'document',
            'source_id' => (int) $document->id,
            'batch_number' => $this->generateLotNumber($document->document_number, $lineNumber),
            'received_at' => $documentDate->copy()->setTimeFrom(now()),
            'quantity' => $actualQuantity,
            'remaining_quantity' => $actualQuantity,
            'unit_cost' => round($actualUnitCost, 2),
            'status' => 'open',
            'meta' => [
                'source_name' => 'Phieu hoan don hang',
                'source_label' => $document->document_number,
                'document_type' => 'return',
                'document_item_id' => (int) $documentItem->id,
                'inventory_document_item_id' => (int) $documentItem->id,
                'order_id' => (int) $order->id,
                'order_number' => $order->order_number,
            ],
        ]);
    }

    private function resolveActualUnitCost(
        Collection $progressMap,
        Product $actualProduct,
        int $actualProductId,
        float $fallbackUnitCost
    ): float {
        $progress = (array) ($progressMap->get($actualProductId) ?? []);
        $actualExportQty = (int) ($progress['actual_exported_quantity'] ?? 0);
        $actualExportTotalCost = (float) ($progress['actual_export_total_cost'] ?? 0);

        if ($actualExportQty > 0 && $actualExportTotalCost > 0) {
            return round($actualExportTotalCost / $actualExportQty, 2);
        }

        return round((float) ($actualProduct->cost_price ?? $actualProduct->expected_cost ?? $fallbackUnitCost), 2);
    }

    private function restoreOrderReservationFromReleases(Order $order, InventoryDocumentItem $documentItem): void
    {
        $releases = $documentItem->orderReleases()
            ->with('batch')
            ->orderBy('id')
            ->lockForUpdate()
            ->get();

        if ($releases->isEmpty()) {
            return;
        }

        $fallbackGroups = [];

        foreach ($releases as $release) {
            $batch = $release->batch;
            $quantity = (int) ($release->quantity ?? 0);
            $isOversoldBatch = $batch instanceof InventoryBatch
                && (string) ($batch->source_type ?? '') === self::OVERSOLD_RESERVE_SOURCE;

            if ($quantity <= 0) {
                continue;
            }

            if ($batch instanceof InventoryBatch && ($isOversoldBatch || (int) $batch->remaining_quantity >= $quantity)) {
                if (!$isOversoldBatch) {
                    $batch->remaining_quantity = (int) $batch->remaining_quantity - $quantity;
                    $batch->status = (int) $batch->remaining_quantity > 0 ? 'open' : 'depleted';
                    $batch->save();
                }

                InventoryBatchAllocation::create([
                    'account_id' => (int) $order->account_id,
                    'inventory_batch_id' => (int) $batch->id,
                    'product_id' => (int) ($release->product_id ?? $documentItem->product_id),
                    'order_id' => (int) $order->id,
                    'order_item_id' => (int) ($release->order_item_id ?? 0) ?: null,
                    'quantity' => $quantity,
                    'unit_cost' => round((float) ($release->unit_cost ?? 0), 2),
                    'total_cost' => round((float) ($release->total_cost ?? 0), 2),
                    'allocated_at' => now(),
                ]);

                continue;
            }

            $fallbackKey = implode(':', [
                (int) ($release->order_item_id ?? 0),
                (int) ($release->product_id ?? $documentItem->product_id),
            ]);

            $fallbackGroups[$fallbackKey] = [
                'order_item_id' => (int) ($release->order_item_id ?? 0) ?: null,
                'product_id' => (int) ($release->product_id ?? $documentItem->product_id),
                'quantity' => (int) (($fallbackGroups[$fallbackKey]['quantity'] ?? 0) + $quantity),
            ];
        }

        if (!empty($fallbackGroups)) {
            $products = Product::query()
                ->whereIn('id', collect($fallbackGroups)->pluck('product_id')->unique()->values()->all())
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            foreach ($fallbackGroups as $group) {
                $product = $products->get((int) $group['product_id']);
                if (!$product instanceof Product || (int) $group['quantity'] <= 0) {
                    continue;
                }

                $allocation = $this->inventoryService->allocateFlexibleSellableBatches(
                    (int) $order->account_id,
                    $product,
                    (int) $group['quantity'],
                    true
                );

                foreach ($allocation['allocations'] as $row) {
                    InventoryBatchAllocation::create([
                        'account_id' => (int) $order->account_id,
                        'inventory_batch_id' => (int) ($row['inventory_batch_id'] ?? 0) ?: null,
                        'product_id' => (int) $product->id,
                        'order_id' => (int) $order->id,
                        'order_item_id' => $group['order_item_id'],
                        'quantity' => (int) ($row['quantity'] ?? 0),
                        'unit_cost' => round((float) ($row['unit_cost'] ?? 0), 2),
                        'total_cost' => round((float) ($row['total_cost'] ?? 0), 2),
                        'allocated_at' => now(),
                    ]);
                }
            }
        }

        $documentItem->orderReleases()->delete();
    }

    private function revertActualExportAllocations(InventoryDocumentItem $documentItem): void
    {
        $allocations = $documentItem->allocations()
            ->with('batch')
            ->orderBy('id')
            ->lockForUpdate()
            ->get();

        foreach ($allocations as $allocation) {
            $batch = $allocation->batch;
            $isOversoldBatch = $batch instanceof InventoryBatch
                && (string) ($batch->source_type ?? '') === self::OVERSOLD_RESERVE_SOURCE;

            if ($batch instanceof InventoryBatch && !$isOversoldBatch) {
                $batch->remaining_quantity = (int) $batch->remaining_quantity + (int) ($allocation->quantity ?? 0);
                $batch->status = (int) $batch->remaining_quantity > 0 ? 'open' : $batch->status;
                $batch->save();
            }
        }

        $documentItem->allocations()->delete();
    }

    private function buildDetailPayload(
        Order $order,
        Collection $documents,
        Collection $automaticExports,
        bool $includeDocuments
    ): array {
        $orderProducts = $this->aggregateOrderProducts($order);
        $nextSortOrder = (int) $orderProducts->count();
        $productMeta = [];

        $ensureProductMeta = function (
            int $productId,
            ?string $name,
            ?string $sku,
            bool $isOrderProduct = false,
            ?int $forcedSortOrder = null
        ) use (&$productMeta, &$nextSortOrder): void {
            if ($productId <= 0) {
                return;
            }

            if (!isset($productMeta[$productId])) {
                $productMeta[$productId] = [
                    'product_id' => $productId,
                    'product_name' => $name ?: "San pham #{$productId}",
                    'product_sku' => $sku,
                    'sort_order' => $forcedSortOrder ?? $nextSortOrder++,
                    'is_order_product' => $isOrderProduct,
                ];

                return;
            }

            if (($productMeta[$productId]['product_name'] ?? '') === '' && $name) {
                $productMeta[$productId]['product_name'] = $name;
            }

            if (($productMeta[$productId]['product_sku'] ?? null) === null && $sku) {
                $productMeta[$productId]['product_sku'] = $sku;
            }

            if ($isOrderProduct) {
                $productMeta[$productId]['is_order_product'] = true;
            }

            if ($forcedSortOrder !== null) {
                $productMeta[$productId]['sort_order'] = min(
                    (int) ($productMeta[$productId]['sort_order'] ?? $forcedSortOrder),
                    $forcedSortOrder
                );
            }
        };

        foreach ($orderProducts as $productId => $meta) {
            $ensureProductMeta(
                (int) $productId,
                $meta['product_name'] ?? null,
                $meta['product_sku'] ?? null,
                true,
                (int) ($meta['sort_order'] ?? 0)
            );
        }

        $plannedExportMap = [];
        $actualExportMap = [];
        $plannedReturnMap = [];
        $actualReturnMap = [];
        $plannedDamagedMap = [];
        $actualDamagedMap = [];
        $actualExportCostMap = [];
        $actualReturnCostMap = [];
        $actualDamagedCostMap = [];

        $slipCounts = [
            'export' => (int) $automaticExports->count(),
            'return' => 0,
            'damaged' => 0,
        ];

        foreach ($automaticExports as $automaticExport) {
            foreach (($automaticExport['items'] ?? []) as $item) {
                $plannedProductId = (int) ($item['product_id'] ?? 0);
                $actualProductId = (int) ($item['actual_product_id'] ?? $plannedProductId);
                $plannedQuantity = (int) ($item['quantity'] ?? 0);
                $actualQuantity = (int) ($item['actual_quantity'] ?? $plannedQuantity);
                $actualTotalCost = (float) ($item['actual_total_cost'] ?? $item['total_cost'] ?? 0);

                $this->bumpQuantity($plannedExportMap, $plannedProductId, $plannedQuantity);
                $this->bumpQuantity($actualExportMap, $actualProductId, $actualQuantity);
                $this->bumpMoney($actualExportCostMap, $actualProductId, $actualTotalCost);

                $ensureProductMeta(
                    $plannedProductId,
                    $item['product_name'] ?? null,
                    $item['product_sku'] ?? null,
                    $orderProducts->has($plannedProductId)
                );
                $ensureProductMeta(
                    $actualProductId,
                    $item['actual_product_name'] ?? $item['product_name'] ?? null,
                    $item['actual_product_sku'] ?? $item['product_sku'] ?? null,
                    $orderProducts->has($actualProductId)
                );
            }
        }

        foreach ($documents as $document) {
            if (!array_key_exists((string) $document->type, $slipCounts)) {
                continue;
            }

            $slipCounts[$document->type]++;

            if (!$this->countsTowardProcessing((string) $document->status)) {
                continue;
            }

            foreach ($document->items as $item) {
                $plannedProductId = (int) ($item->product_id ?? 0);
                $actualProductId = (int) ($item->actual_product_id ?: $plannedProductId);
                $plannedQuantity = (int) ($item->quantity ?? 0);
                $actualQuantity = (int) ($item->actual_quantity ?? $plannedQuantity);
                $actualTotalCost = (float) ($item->actual_total_cost ?? $item->total_cost ?? 0);

                if ($document->type === 'export') {
                    $this->bumpQuantity($plannedExportMap, $plannedProductId, $plannedQuantity);
                    $this->bumpQuantity($actualExportMap, $actualProductId, $actualQuantity);
                    $this->bumpMoney($actualExportCostMap, $actualProductId, $actualTotalCost);
                } elseif ($document->type === 'return') {
                    $this->bumpQuantity($plannedReturnMap, $plannedProductId, $plannedQuantity);
                    $this->bumpQuantity($actualReturnMap, $actualProductId, $actualQuantity);
                    $this->bumpMoney($actualReturnCostMap, $actualProductId, $actualTotalCost);
                } elseif ($document->type === 'damaged') {
                    $this->bumpQuantity($plannedDamagedMap, $plannedProductId, $plannedQuantity);
                    $this->bumpQuantity($actualDamagedMap, $actualProductId, $actualQuantity);
                    $this->bumpMoney($actualDamagedCostMap, $actualProductId, $actualTotalCost);
                }

                $ensureProductMeta(
                    $plannedProductId,
                    $item->product_name_snapshot,
                    $item->product_sku_snapshot,
                    $orderProducts->has($plannedProductId)
                );
                $ensureProductMeta(
                    $actualProductId,
                    $item->actual_product_name_snapshot ?: $item->product_name_snapshot,
                    $item->actual_product_sku_snapshot ?: $item->product_sku_snapshot,
                    $orderProducts->has($actualProductId)
                );
            }
        }

        $productIds = collect(array_keys($productMeta))
            ->merge(array_keys($plannedExportMap))
            ->merge(array_keys($actualExportMap))
            ->merge(array_keys($plannedReturnMap))
            ->merge(array_keys($actualReturnMap))
            ->merge(array_keys($plannedDamagedMap))
            ->merge(array_keys($actualDamagedMap))
            ->filter(fn ($id) => (int) $id > 0)
            ->unique()
            ->sortBy(fn ($id) => (int) ($productMeta[(int) $id]['sort_order'] ?? 999999))
            ->values();

        $products = $productIds
            ->map(function ($productId) use (
                $orderProducts,
                $productMeta,
                $plannedExportMap,
                $actualExportMap,
                $plannedReturnMap,
                $actualReturnMap,
                $plannedDamagedMap,
                $actualDamagedMap,
                $actualExportCostMap,
                $actualReturnCostMap,
                $actualDamagedCostMap
            ) {
                $productId = (int) $productId;
                $meta = $productMeta[$productId] ?? [
                    'product_name' => "San pham #{$productId}",
                    'product_sku' => null,
                    'sort_order' => 999999,
                    'is_order_product' => false,
                ];
                $orderMeta = (array) ($orderProducts->get($productId) ?? []);

                $orderedQuantity = (int) ($orderMeta['required_quantity'] ?? 0);
                $documentExportQuantity = (int) ($plannedExportMap[$productId] ?? 0);
                $actualExportedQuantity = (int) ($actualExportMap[$productId] ?? 0);
                $documentReturnQuantity = (int) ($plannedReturnMap[$productId] ?? 0);
                $actualReturnedQuantity = (int) ($actualReturnMap[$productId] ?? 0);
                $documentDamagedQuantity = (int) ($plannedDamagedMap[$productId] ?? 0);
                $actualDamagedQuantity = (int) ($actualDamagedMap[$productId] ?? 0);
                $remainingPlannedExportQuantity = max(0, $orderedQuantity - $documentExportQuantity);
                $reversiblePlannedQuantity = max(0, $actualExportedQuantity - $actualReturnedQuantity - $actualDamagedQuantity);
                $actualNetQuantity = $actualExportedQuantity - $actualReturnedQuantity - $actualDamagedQuantity;
                $differenceQuantity = $actualNetQuantity - $orderedQuantity;
                $hasVariance = $differenceQuantity !== 0
                    || $documentExportQuantity !== $actualExportedQuantity
                    || $documentReturnQuantity !== $actualReturnedQuantity
                    || $documentDamagedQuantity !== $actualDamagedQuantity;

                $warnings = [];
                if ($orderedQuantity === 0 && $actualNetQuantity !== 0) {
                    $warnings[] = 'SKU thuc te phat sinh ngoai don hang.';
                }
                if ($differenceQuantity > 0) {
                    $warnings[] = "Thuc te dang lech tang {$differenceQuantity}.";
                } elseif ($differenceQuantity < 0) {
                    $warnings[] = 'Thuc te dang thieu so voi don.';
                }
                if ($documentExportQuantity !== $actualExportedQuantity) {
                    $warnings[] = 'So lieu theo phieu xuat khac so lieu thuc xuat.';
                }
                if ($documentReturnQuantity !== $actualReturnedQuantity) {
                    $warnings[] = 'So lieu theo phieu hoan khac so lieu thuc hoan.';
                }
                if ($documentDamagedQuantity !== $actualDamagedQuantity) {
                    $warnings[] = 'So lieu theo phieu hong khac so lieu thuc hong.';
                }

                return [
                    'product_id' => $productId,
                    'product_name' => $meta['product_name'] ?? "San pham #{$productId}",
                    'product_sku' => $meta['product_sku'] ?? null,
                    'sort_order' => (int) ($meta['sort_order'] ?? 999999),
                    'is_order_product' => (bool) ($meta['is_order_product'] ?? false),
                    'required_quantity' => $orderedQuantity,
                    'ordered_quantity' => $orderedQuantity,
                    'ordered_unit_price' => $orderMeta['ordered_unit_price'] ?? null,
                    'ordered_unit_cost' => $orderMeta['ordered_unit_cost'] ?? null,
                    'document_export_quantity' => $documentExportQuantity,
                    'actual_exported_quantity' => $actualExportedQuantity,
                    'document_return_quantity' => $documentReturnQuantity,
                    'actual_returned_quantity' => $actualReturnedQuantity,
                    'document_damaged_quantity' => $documentDamagedQuantity,
                    'actual_damaged_quantity' => $actualDamagedQuantity,
                    'actual_export_total_cost' => round((float) ($actualExportCostMap[$productId] ?? 0), 2),
                    'actual_return_total_cost' => round((float) ($actualReturnCostMap[$productId] ?? 0), 2),
                    'actual_damaged_total_cost' => round((float) ($actualDamagedCostMap[$productId] ?? 0), 2),
                    'remaining_planned_export_quantity' => $remainingPlannedExportQuantity,
                    'reversible_planned_quantity' => $reversiblePlannedQuantity,
                    'actual_net_quantity' => $actualNetQuantity,
                    'difference_quantity' => $differenceQuantity,
                    'remaining_quantity' => $remainingPlannedExportQuantity,
                    'exportable_quantity' => $remainingPlannedExportQuantity,
                    'reversible_quantity' => $reversiblePlannedQuantity,
                    'has_warning' => $hasVariance,
                    'warnings' => array_values(array_unique($warnings)),
                ];
            })
            ->sortBy('sort_order')
            ->values();

        $summary = $this->buildSummaryPayload($products, $slipCounts);

        $payload = [
            'order' => [
                'id' => (int) $order->id,
                'order_number' => $order->order_number,
                'customer_name' => $order->customer_name,
                'customer_phone' => $order->customer_phone,
                'shipping_address' => $order->shipping_address,
                'status' => $order->status,
                'created_at' => optional($order->created_at)?->toISOString(),
                'total_price' => (float) ($order->total_price ?? 0),
            ],
            'summary' => $summary,
            'products' => $products->all(),
        ];

        if (!$includeDocuments) {
            return $payload;
        }

        $timeline = $documents
            ->map(fn (InventoryDocument $document) => $this->normalizeDocument($document))
            ->concat($automaticExports)
            ->sortByDesc(function (array $document) {
                return (string) ($document['sort_key'] ?? sprintf(
                    '%s-%s',
                    (string) ($document['document_date'] ?? ''),
                    (string) ($document['id'] ?? '')
                ));
            })
            ->values();

        $payload['documents'] = [
            'export' => $timeline->where('type', 'export')->values()->all(),
            'return' => $timeline->where('type', 'return')->values()->all(),
            'damaged' => $timeline->where('type', 'damaged')->values()->all(),
        ];
        $payload['timeline'] = $timeline->all();

        return $payload;
    }

    private function buildSummaryPayload(Collection $products, array $slipCounts): array
    {
        $requiredQuantity = (int) $products->sum('required_quantity');
        $documentExportQuantity = (int) $products->sum('document_export_quantity');
        $exportedQuantity = (int) $products->sum('actual_exported_quantity');
        $returnedQuantity = (int) $products->sum('actual_returned_quantity');
        $damagedQuantity = (int) $products->sum('actual_damaged_quantity');
        $remainingQuantity = max(0, $requiredQuantity - $documentExportQuantity);
        $actualNetQuantity = $exportedQuantity - $returnedQuantity - $damagedQuantity;
        $differenceQuantity = $actualNetQuantity - $requiredQuantity;
        $varianceLineCount = (int) $products->where('has_warning', true)->count();
        $varianceProductCount = (int) $products->filter(function (array $product) {
            return (int) ($product['difference_quantity'] ?? 0) !== 0
                || (int) ($product['document_export_quantity'] ?? 0) !== (int) ($product['actual_exported_quantity'] ?? 0)
                || (int) ($product['document_return_quantity'] ?? 0) !== (int) ($product['actual_returned_quantity'] ?? 0)
                || (int) ($product['document_damaged_quantity'] ?? 0) !== (int) ($product['actual_damaged_quantity'] ?? 0);
        })->count();
        $hasVariance = $varianceLineCount > 0 || $differenceQuantity !== 0;

        $state = $slipCounts['export'] === 0 && $exportedQuantity === 0
            ? 'not_created'
            : ($remainingQuantity > 0 ? 'partial' : ($hasVariance ? 'variance' : 'fulfilled'));

        [$label, $tone] = match ($state) {
            'fulfilled' => ['Da khop', 'emerald'],
            'variance' => ['Lech thuc xuat', 'amber'],
            'partial' => ['Con thieu phieu xuat', 'amber'],
            default => ['Chua tao phieu', 'slate'],
        };

        $quickParts = [
            "Don {$requiredQuantity}",
            "Phieu {$documentExportQuantity}",
            "Thuc xuat {$exportedQuantity}",
        ];

        if ($returnedQuantity > 0) {
            $quickParts[] = "Thuc hoan {$returnedQuantity}";
        }

        if ($damagedQuantity > 0) {
            $quickParts[] = "Thuc hong {$damagedQuantity}";
        }

        if ($differenceQuantity !== 0) {
            $quickParts[] = "Lech {$differenceQuantity}";
        } else {
            $quickParts[] = 'Khong lech';
        }

        return [
            'state' => $state,
            'label' => $label,
            'tone' => $tone,
            'required_quantity' => $requiredQuantity,
            'document_export_quantity' => $documentExportQuantity,
            'exported_quantity' => $exportedQuantity,
            'returned_quantity' => $returnedQuantity,
            'damaged_quantity' => $damagedQuantity,
            'remaining_quantity' => $remainingQuantity,
            'actual_net_quantity' => $actualNetQuantity,
            'difference_quantity' => $differenceQuantity,
            'has_variance' => $hasVariance,
            'variance_line_count' => $varianceLineCount,
            'variance_product_count' => $varianceProductCount,
            'export_slip_count' => (int) ($slipCounts['export'] ?? 0),
            'return_slip_count' => (int) ($slipCounts['return'] ?? 0),
            'damaged_slip_count' => (int) ($slipCounts['damaged'] ?? 0),
            'has_return' => (int) ($slipCounts['return'] ?? 0) > 0,
            'has_damaged' => (int) ($slipCounts['damaged'] ?? 0) > 0,
            'quick_summary' => implode(' • ', $quickParts),
        ];
    }

    private function aggregateOrderProducts(Order $order): Collection
    {
        $order->loadMissing(['items']);
        $sortOrder = 0;

        return $order->items
            ->reduce(function (Collection $carry, $item) use (&$sortOrder) {
                $productId = (int) $item->product_id;
                if ($productId <= 0) {
                    return $carry;
                }

                $current = $carry->get($productId, [
                    'product_id' => $productId,
                    'product_name' => $item->product_name_snapshot ?: "San pham #{$productId}",
                    'product_sku' => $item->product_sku_snapshot,
                    'required_quantity' => 0,
                    'ordered_revenue_total' => 0,
                    'ordered_cost_total' => 0,
                    'sort_order' => $sortOrder++,
                ]);

                $quantity = (int) ($item->quantity ?? 0);
                $current['required_quantity'] += $quantity;
                $current['ordered_revenue_total'] += round((float) ($item->price ?? 0) * $quantity, 2);
                $current['ordered_cost_total'] += round(
                    (float) ($item->cost_total ?? ((float) ($item->cost_price ?? 0) * $quantity)),
                    2
                );

                $carry->put($productId, $current);

                return $carry;
            }, collect())
            ->sortBy('sort_order')
            ->map(function (array $item) {
                $requiredQuantity = max(1, (int) $item['required_quantity']);
                $item['ordered_unit_price'] = round((float) $item['ordered_revenue_total'] / $requiredQuantity, 2);
                $item['ordered_unit_cost'] = round((float) $item['ordered_cost_total'] / $requiredQuantity, 2);

                return $item;
            })
            ->values()
            ->keyBy('product_id');
    }

    private function loadAutomaticExportsForOrders(Collection $orders): Collection
    {
        $orderIds = $orders
            ->pluck('id')
            ->filter()
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        if (empty($orderIds)) {
            return collect();
        }

        $shipmentsByOrderId = Shipment::query()
            ->whereIn('order_id', $orderIds)
            ->whereNotIn('shipment_status', ['canceled'])
            ->with([
                'items.orderItem:id,order_id,product_id,product_name_snapshot,product_sku_snapshot,quantity,price,cost_total,cost_price',
            ])
            ->orderBy('shipped_at')
            ->orderBy('id')
            ->get()
            ->groupBy(fn (Shipment $shipment) => (int) $shipment->order_id);

        return $orders->mapWithKeys(function (Order $order) use ($shipmentsByOrderId) {
            return [
                (int) $order->id => $this->buildAutomaticExportsForOrder(
                    $order,
                    $shipmentsByOrderId->get((int) $order->id, collect())
                ),
            ];
        });
    }

    private function loadAutomaticExportsForSingleOrder(Order $order): Collection
    {
        $shipments = Shipment::query()
            ->where('order_id', (int) $order->id)
            ->whereNotIn('shipment_status', ['canceled'])
            ->with([
                'items.orderItem:id,order_id,product_id,product_name_snapshot,product_sku_snapshot,quantity,price,cost_total,cost_price',
            ])
            ->orderByDesc('shipped_at')
            ->orderByDesc('id')
            ->get();

        return $this->buildAutomaticExportsForOrder($order, $shipments);
    }

    private function buildAutomaticExportsForOrder(Order $order, Collection $shipments): Collection
    {
        $order->loadMissing(['items']);

        $automaticExports = $shipments
            ->map(fn (Shipment $shipment) => $this->normalizeAutomaticShipmentExport($order, $shipment))
            ->filter()
            ->values();

        if ($automaticExports->isNotEmpty()) {
            return $automaticExports;
        }

        $legacyExport = $this->normalizeLegacyAutomaticExport($order);
        if ($legacyExport) {
            $automaticExports->push($legacyExport);
        }

        return $automaticExports->values();
    }

    private function normalizeAutomaticShipmentExport(Order $order, Shipment $shipment): ?array
    {
        $items = $this->buildAutomaticExportItemsFromShipment($order, $shipment);
        if ($items->isEmpty()) {
            return null;
        }

        $trackingNumber = trim((string) ($shipment->carrier_tracking_code ?: $shipment->tracking_number ?: $order->shipping_tracking_code));
        $carrierName = trim((string) ($shipment->carrier_name ?: $order->shipping_carrier_name));
        $documentDate = $shipment->shipped_at
            ?: $shipment->out_for_delivery_at
            ?: $shipment->created_at
            ?: $order->shipping_dispatched_at
            ?: $order->created_at;

        return [
            'id' => 'shipment-auto-' . (int) $shipment->id,
            'sort_key' => sprintf(
                '%s-%010d',
                optional($documentDate)?->format('Y-m-d H:i:s') ?: '',
                (int) $shipment->id
            ),
            'type' => 'export',
            'type_label' => $this->typeLabel('export'),
            'document_number' => $shipment->shipment_number ?: ($trackingNumber !== '' ? $trackingNumber : $order->order_number),
            'document_date' => optional($documentDate)?->toISOString(),
            'created_at' => optional($shipment->created_at)?->toISOString(),
            'status' => 'completed',
            'status_label' => 'Da xuat',
            'status_tone' => 'emerald',
            'notes' => $this->buildAutomaticExportNotes('Tu tao tu van chuyen', $trackingNumber, $carrierName),
            'created_by_name' => null,
            'total_quantity' => (int) $items->sum('actual_quantity'),
            'planned_total_quantity' => (int) $items->sum('quantity'),
            'actual_total_quantity' => (int) $items->sum('actual_quantity'),
            'items' => $items->all(),
            'can_delete' => false,
            'source_label' => 'Tu tao tu van chuyen',
            'source_kind' => 'shipment_auto',
        ];
    }

    private function normalizeLegacyAutomaticExport(Order $order): ?array
    {
        if (!$this->hasAutomaticExportMarker($order)) {
            return null;
        }

        $items = $this->buildAutomaticExportItemsFromOrder($order);
        if ($items->isEmpty()) {
            return null;
        }

        $trackingNumber = trim((string) $order->shipping_tracking_code);
        $carrierName = trim((string) $order->shipping_carrier_name);
        $isManualExportOrder = (string) $order->type === 'inventory_export';
        $sourceLabel = $isManualExportOrder ? 'Phieu xuat kho tao tay' : 'Tu tao tu van chuyen';
        $documentDate = $order->shipping_dispatched_at ?: $order->created_at;

        return [
            'id' => 'order-auto-' . (int) $order->id,
            'sort_key' => sprintf(
                '%s-%010d',
                optional($documentDate)?->format('Y-m-d H:i:s') ?: '',
                (int) $order->id
            ),
            'type' => 'export',
            'type_label' => $this->typeLabel('export'),
            'document_number' => $trackingNumber !== '' ? $trackingNumber : $order->order_number,
            'document_date' => optional($documentDate)?->toISOString(),
            'created_at' => optional($order->updated_at ?: $order->created_at)?->toISOString(),
            'status' => 'completed',
            'status_label' => 'Da xuat',
            'status_tone' => 'emerald',
            'notes' => $this->buildAutomaticExportNotes($sourceLabel, $trackingNumber, $carrierName),
            'created_by_name' => null,
            'total_quantity' => (int) $items->sum('actual_quantity'),
            'planned_total_quantity' => (int) $items->sum('quantity'),
            'actual_total_quantity' => (int) $items->sum('actual_quantity'),
            'items' => $items->all(),
            'can_delete' => false,
            'source_label' => $sourceLabel,
            'source_kind' => $isManualExportOrder ? 'legacy_manual_export' : 'legacy_tracking_export',
        ];
    }

    private function buildAutomaticExportItemsFromShipment(Order $order, Shipment $shipment): Collection
    {
        $orderItemsById = $order->items->keyBy('id');

        $items = $shipment->items
            ->map(function ($shipmentItem) use ($orderItemsById) {
                $orderItem = $shipmentItem->orderItem ?: $orderItemsById->get((int) $shipmentItem->order_item_id);
                if (!$orderItem) {
                    return null;
                }

                return $this->normalizeAutomaticExportItem(
                    'shipment-item-' . (int) $shipmentItem->id,
                    $orderItem,
                    (int) ($shipmentItem->qty ?? 0)
                );
            })
            ->filter()
            ->values();

        return $items->isNotEmpty() ? $items : $this->buildAutomaticExportItemsFromOrder($order);
    }

    private function buildAutomaticExportItemsFromOrder(Order $order): Collection
    {
        return $order->items
            ->map(function ($orderItem) {
                return $this->normalizeAutomaticExportItem(
                    'order-item-' . (int) $orderItem->id,
                    $orderItem,
                    (int) ($orderItem->quantity ?? 0)
                );
            })
            ->filter()
            ->values();
    }

    private function normalizeAutomaticExportItem(string $id, $orderItem, int $quantity): ?array
    {
        if ($quantity <= 0) {
            return null;
        }

        $unitCost = $quantity > 0 && $orderItem->cost_total !== null
            ? round((float) $orderItem->cost_total / max(1, (int) ($orderItem->quantity ?? 0)), 2)
            : round((float) ($orderItem->cost_price ?? 0), 2);
        $unitPrice = $orderItem->price !== null ? round((float) $orderItem->price, 2) : null;

        return [
            'id' => $id,
            'product_id' => (int) ($orderItem->product_id ?? 0),
            'actual_product_id' => (int) ($orderItem->product_id ?? 0),
            'product_name' => $orderItem->product_name_snapshot ?: "San pham #{$orderItem->product_id}",
            'actual_product_name' => $orderItem->product_name_snapshot ?: "San pham #{$orderItem->product_id}",
            'product_sku' => $orderItem->product_sku_snapshot,
            'actual_product_sku' => $orderItem->product_sku_snapshot,
            'quantity' => $quantity,
            'actual_quantity' => $quantity,
            'unit_cost' => $unitCost,
            'actual_unit_cost' => $unitCost,
            'total_cost' => round($unitCost * $quantity, 2),
            'actual_total_cost' => round($unitCost * $quantity, 2),
            'unit_price' => $unitPrice,
            'actual_unit_price' => $unitPrice,
            'total_price' => $unitPrice !== null ? round($unitPrice * $quantity, 2) : null,
            'actual_total_price' => $unitPrice !== null ? round($unitPrice * $quantity, 2) : null,
            'notes' => null,
            'actual_reason' => null,
            'variance_type' => self::VARIANCE_NONE,
            'has_variance' => false,
            'product_changed' => false,
            'quantity_changed' => false,
        ];
    }

    private function hasAutomaticExportMarker(Order $order): bool
    {
        return (string) $order->type === 'inventory_export'
            || trim((string) $order->shipping_tracking_code) !== '';
    }

    private function buildAutomaticExportNotes(string $sourceLabel, string $trackingNumber = '', string $carrierName = ''): ?string
    {
        $parts = [$sourceLabel];
        if ($trackingNumber !== '') {
            $parts[] = 'Ma van don: ' . $trackingNumber;
        }
        if ($carrierName !== '') {
            $parts[] = 'Don vi: ' . $carrierName;
        }

        $parts = array_values(array_filter($parts, fn ($value) => trim((string) $value) !== ''));

        return empty($parts) ? null : implode(' • ', $parts);
    }

    private function loadDocumentsForOrders(Collection $orders): Collection
    {
        $orderIds = $orders
            ->pluck('id')
            ->filter()
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        if (empty($orderIds)) {
            return collect();
        }

        return InventoryDocument::query()
            ->where('reference_type', 'order')
            ->whereIn('reference_id', $orderIds)
            ->whereIn('type', ['export', 'return', 'damaged'])
            ->whereIn('status', self::ACTIVE_STATUSES)
            ->with([
                'items' => function ($query) {
                    $query
                        ->select([
                            'id',
                            'inventory_document_id',
                            'product_id',
                            'actual_product_id',
                            'product_name_snapshot',
                            'product_sku_snapshot',
                            'actual_product_name_snapshot',
                            'actual_product_sku_snapshot',
                            'quantity',
                            'actual_quantity',
                            'unit_cost',
                            'total_cost',
                            'actual_unit_cost',
                            'actual_total_cost',
                            'unit_price',
                            'total_price',
                            'actual_unit_price',
                            'actual_total_price',
                            'notes',
                            'actual_reason',
                            'variance_type',
                            'planned_order_product_id',
                            'planned_order_product_name_snapshot',
                            'planned_order_product_sku_snapshot',
                            'planned_order_quantity',
                        ])
                        ->orderBy('id');
                },
            ])
            ->orderBy('document_date')
            ->orderBy('id')
            ->get()
            ->groupBy(fn (InventoryDocument $document) => (int) $document->reference_id);
    }

    private function loadDocumentsForSingleOrder(Order $order): Collection
    {
        return InventoryDocument::query()
            ->where('reference_type', 'order')
            ->where('reference_id', (int) $order->id)
            ->whereIn('type', ['export', 'return', 'damaged'])
            ->whereIn('status', self::ACTIVE_STATUSES)
            ->with([
                'creator:id,name',
                'items' => function ($query) {
                    $query
                        ->select([
                            'id',
                            'inventory_document_id',
                            'product_id',
                            'actual_product_id',
                            'product_name_snapshot',
                            'product_sku_snapshot',
                            'actual_product_name_snapshot',
                            'actual_product_sku_snapshot',
                            'quantity',
                            'actual_quantity',
                            'unit_cost',
                            'total_cost',
                            'actual_unit_cost',
                            'actual_total_cost',
                            'unit_price',
                            'total_price',
                            'actual_unit_price',
                            'actual_total_price',
                            'notes',
                            'actual_reason',
                            'variance_type',
                            'planned_order_product_id',
                            'planned_order_product_name_snapshot',
                            'planned_order_product_sku_snapshot',
                            'planned_order_quantity',
                        ])
                        ->with([
                            'product:id,sku,name',
                            'actualProduct:id,sku,name',
                            'allocations.batch:id,source_type,remaining_quantity',
                            'orderReleases.batch:id,source_type,remaining_quantity',
                        ])
                        ->orderBy('id');
                },
            ])
            ->orderByDesc('document_date')
            ->orderByDesc('id')
            ->get();
    }

    private function normalizeDocument(InventoryDocument $document): array
    {
        [$statusLabel, $statusTone] = match ((string) $document->status) {
            'draft' => ['Nhap', 'amber'],
            'canceled' => ['Da huy', 'slate'],
            default => ['Hoan tat', 'emerald'],
        };

        $plannedTotalQuantity = (int) $document->items->sum(fn (InventoryDocumentItem $item) => (int) ($item->quantity ?? 0));
        $actualTotalQuantity = (int) $document->items->sum(fn (InventoryDocumentItem $item) => (int) ($item->actual_quantity ?? $item->quantity ?? 0));

        return [
            'id' => (int) $document->id,
            'sort_key' => sprintf(
                '%s-%010d',
                optional($document->document_date)?->format('Y-m-d') ?: '',
                (int) $document->id
            ),
            'type' => $document->type,
            'type_label' => $this->typeLabel($document->type),
            'document_number' => $document->document_number,
            'document_date' => optional($document->document_date)->toDateString(),
            'created_at' => optional($document->created_at)?->toISOString(),
            'status' => $document->status,
            'status_label' => $statusLabel,
            'status_tone' => $statusTone,
            'notes' => $document->notes,
            'created_by_name' => $document->creator?->name,
            'total_quantity' => (int) ($document->total_quantity ?: $actualTotalQuantity),
            'planned_total_quantity' => $plannedTotalQuantity,
            'actual_total_quantity' => $actualTotalQuantity,
            'can_delete' => true,
            'source_label' => null,
            'items' => $document->items->map(function (InventoryDocumentItem $item) {
                $plannedProductId = (int) ($item->product_id ?? 0);
                $actualProductId = (int) ($item->actual_product_id ?: $plannedProductId);
                $plannedQuantity = (int) ($item->quantity ?? 0);
                $actualQuantity = (int) ($item->actual_quantity ?? $plannedQuantity);
                $varianceType = $item->variance_type ?: $this->resolveVarianceType(
                    $plannedProductId,
                    $actualProductId,
                    $plannedQuantity,
                    $actualQuantity
                );

                return [
                    'id' => (int) $item->id,
                    'product_id' => $plannedProductId,
                    'product_name' => $item->product_name_snapshot ?: $item->product?->name ?: "San pham #{$plannedProductId}",
                    'product_sku' => $item->product_sku_snapshot ?: $item->product?->sku,
                    'quantity' => $plannedQuantity,
                    'unit_cost' => (float) ($item->unit_cost ?? 0),
                    'total_cost' => (float) ($item->total_cost ?? 0),
                    'unit_price' => $item->unit_price !== null ? (float) $item->unit_price : null,
                    'total_price' => $item->total_price !== null ? (float) $item->total_price : null,
                    'actual_product_id' => $actualProductId,
                    'actual_product_name' => $item->actual_product_name_snapshot ?: $item->actualProduct?->name ?: $item->product_name_snapshot,
                    'actual_product_sku' => $item->actual_product_sku_snapshot ?: $item->actualProduct?->sku ?: $item->product_sku_snapshot,
                    'actual_quantity' => $actualQuantity,
                    'actual_unit_cost' => (float) ($item->actual_unit_cost ?? $item->unit_cost ?? 0),
                    'actual_total_cost' => (float) ($item->actual_total_cost ?? $item->total_cost ?? 0),
                    'actual_unit_price' => $item->actual_unit_price !== null ? (float) $item->actual_unit_price : ($item->unit_price !== null ? (float) $item->unit_price : null),
                    'actual_total_price' => $item->actual_total_price !== null ? (float) $item->actual_total_price : ($item->total_price !== null ? (float) $item->total_price : null),
                    'notes' => $item->notes,
                    'actual_reason' => $item->actual_reason,
                    'variance_type' => $varianceType,
                    'has_variance' => $varianceType !== self::VARIANCE_NONE,
                    'product_changed' => $plannedProductId !== $actualProductId,
                    'quantity_changed' => $plannedQuantity !== $actualQuantity,
                ];
            })->values()->all(),
        ];
    }

    private function countsTowardProcessing(string $status): bool
    {
        return $status !== 'draft' && $status !== 'canceled';
    }

    private function ensureExportSlipCanBeDeleted(Order $order, InventoryDocument $document): void
    {
        $documents = $this->loadDocumentsForSingleOrder($order)
            ->reject(fn (InventoryDocument $item) => (int) $item->id === (int) $document->id)
            ->values();

        $detail = $this->buildDetailPayload(
            $order,
            $documents,
            $this->loadAutomaticExportsForSingleOrder($order),
            false
        );

        $invalidProduct = collect($detail['products'])->first(function (array $product) {
            return (int) ($product['reversible_planned_quantity'] ?? 0) < 0
                || ((int) ($product['actual_returned_quantity'] ?? 0) + (int) ($product['actual_damaged_quantity'] ?? 0)) > (int) ($product['actual_exported_quantity'] ?? 0);
        });

        if ($invalidProduct) {
            throw ValidationException::withMessages([
                'document' => ["Khong the xoa phieu xuat vi {$invalidProduct['product_name']} dang co phieu hoan/hong phu thuoc vao lich su thuc xuat."],
            ]);
        }
    }

    private function ensureReturnSlipCanBeDeleted(InventoryDocument $document): void
    {
        $batches = InventoryBatch::query()
            ->where('source_type', 'document')
            ->where('source_id', (int) $document->id)
            ->withCount(['allocations', 'documentAllocations'])
            ->lockForUpdate()
            ->get();

        foreach ($batches as $batch) {
            if (
                (int) $batch->remaining_quantity !== (int) $batch->quantity
                || (int) $batch->allocations_count > 0
                || (int) $batch->document_allocations_count > 0
            ) {
                throw ValidationException::withMessages([
                    'document' => ['Phieu hoan nay da phat sinh luong kho tiep theo nen khong the xoa.'],
                ]);
            }
        }
    }

    private function ensureDamagedSlipCanBeDeleted(InventoryDocument $document): void
    {
        $productIds = $document->items
            ->map(fn (InventoryDocumentItem $item) => (int) ($item->actual_product_id ?: $item->product_id))
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values()
            ->all();

        $products = Product::query()
            ->whereIn('id', $productIds)
            ->lockForUpdate()
            ->get()
            ->keyBy('id');

        foreach ($document->items as $item) {
            $productId = (int) ($item->actual_product_id ?: $item->product_id);
            $product = $products->get($productId);
            if (!$product instanceof Product) {
                continue;
            }

            $actualQuantity = (int) ($item->actual_quantity ?? $item->quantity ?? 0);
            if ((int) ($product->damaged_quantity ?? 0) < $actualQuantity) {
                throw ValidationException::withMessages([
                    'document' => ["Khong the xoa phieu hong vi {$product->sku} - {$product->name} da duoc xu ly tiep trong ton hong."],
                ]);
            }
        }
    }

    private function finalizeDocumentTotals(InventoryDocument $document): void
    {
        $itemQuery = $document->items();
        $quantityColumn = 'COALESCE(actual_quantity, quantity)';
        $amountColumn = $document->type === 'export'
            ? 'COALESCE(actual_total_price, actual_total_cost, total_price, total_cost)'
            : 'COALESCE(actual_total_cost, total_cost)';

        $document->forceFill([
            'total_quantity' => (int) $itemQuery->sum(DB::raw($quantityColumn)),
            'total_amount' => round((float) $itemQuery->sum(DB::raw($amountColumn)), 2),
        ])->save();
    }

    private function normalizeType(string $type): string
    {
        $normalized = strtolower(trim($type));

        if (!in_array($normalized, ['export', 'return', 'damaged'], true)) {
            throw ValidationException::withMessages([
                'type' => ['Loai phieu kho khong hop le.'],
            ]);
        }

        return $normalized;
    }

    private function stockBucketForType(string $type): string
    {
        return $type === 'damaged' ? 'damaged' : 'sellable';
    }

    private function directionForType(string $type): string
    {
        return $type === 'export' ? 'out' : 'in';
    }

    private function typeLabel(string $type): string
    {
        return match ($type) {
            'export' => 'Phieu xuat',
            'return' => 'Phieu hoan',
            'damaged' => 'Phieu hong',
            default => 'Phieu kho',
        };
    }

    private function generateDocumentNumber(string $type, int $accountId): string
    {
        $prefix = match ($type) {
            'export' => 'PXK',
            'return' => 'PHH',
            'damaged' => 'PHK',
            default => 'PKH',
        } . now()->format('ymd');

        $lastDocument = InventoryDocument::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->where('type', $type)
            ->where('document_number', 'like', "{$prefix}%")
            ->orderByDesc('id')
            ->first();

        $sequence = 1;
        if ($lastDocument && preg_match('/(\d{4})$/', (string) $lastDocument->document_number, $matches)) {
            $sequence = ((int) $matches[1]) + 1;
        }

        return sprintf('%s%04d', $prefix, $sequence);
    }

    private function generateLotNumber(string $referenceNumber, int $lineNumber): string
    {
        return strtoupper(sprintf('LO-%s-%02d', $referenceNumber, $lineNumber));
    }

    private function bumpQuantity(array &$map, int $productId, int $quantity): void
    {
        if ($productId <= 0 || $quantity === 0) {
            return;
        }

        $map[$productId] = (int) ($map[$productId] ?? 0) + $quantity;
    }

    private function bumpMoney(array &$map, int $productId, float $amount): void
    {
        if ($productId <= 0 || $amount == 0.0) {
            return;
        }

        $map[$productId] = round((float) ($map[$productId] ?? 0) + $amount, 2);
    }

    private function nullableText(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $text = trim((string) $value);

        return $text === '' ? null : $text;
    }
}
