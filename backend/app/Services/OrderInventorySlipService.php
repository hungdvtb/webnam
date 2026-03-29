<?php

namespace App\Services;

use App\Models\InventoryBatch;
use App\Models\InventoryDocument;
use App\Models\InventoryDocumentItem;
use App\Models\InventoryDocumentItemOrderLink;
use App\Models\InventoryDocumentOrderLink;
use App\Models\Order;
use App\Models\OrderStatusLog;
use App\Models\Product;
use App\Models\Shipment;
use App\Services\Inventory\InventoryService;
use App\Support\OrderStatusCatalog;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

class OrderInventorySlipService
{
    private const ACTIVE_STATUSES = ['draft', 'completed'];
    private const MANAGED_RETURN_SOURCE = 'order_return_reconciliation';
    private const MANAGED_RETURN_ADJUSTMENT_SOURCE = 'order_return_reconciliation_adjustment';
    private ?bool $inventoryDocumentOrderLinksTableExists = null;
    private ?bool $inventoryDocumentItemOrderLinksTableExists = null;

    public function __construct(
        private readonly InventoryService $inventoryService,
    ) {
    }

    private function hasInventoryDocumentOrderLinksTable(): bool
    {
        return $this->inventoryDocumentOrderLinksTableExists
            ??= Schema::hasTable('inventory_document_order_links');
    }

    private function hasInventoryDocumentItemOrderLinksTable(): bool
    {
        return $this->inventoryDocumentItemOrderLinksTableExists
            ??= Schema::hasTable('inventory_document_item_order_links');
    }

    private function ensureManagedReturnLinkTablesExist(): void
    {
        if (
            $this->hasInventoryDocumentOrderLinksTable()
            && $this->hasInventoryDocumentItemOrderLinksTable()
        ) {
            return;
        }

        throw ValidationException::withMessages([
            'inventory' => ['Tính năng phiếu hoàn theo lô yêu cầu chạy đầy đủ migration kho mới nhất.'],
        ]);
    }

    private function managedReturnOrderLinksCount(InventoryDocument $document): int
    {
        if (!$this->hasInventoryDocumentOrderLinksTable()) {
            return 0;
        }

        if ($document->relationLoaded('orderLinks')) {
            return $document->orderLinks->count();
        }

        return InventoryDocumentOrderLink::query()
            ->where('inventory_document_id', (int) $document->id)
            ->count();
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

    public function buildExportOverviewMap(Collection $orders): array
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
                    true
                );

                $exports = collect(data_get($detail, 'documents.export', []))->values();
                $primaryExport = $exports->first();

                return [
                    (int) $order->id => [
                        'display_code' => trim((string) ($primaryExport['document_number'] ?? $order->order_number)),
                        'exported_at' => $this->normalizeExportOverviewTimestamp($primaryExport, $order),
                        'tracking_number' => trim((string) ($primaryExport['tracking_number'] ?? $order->shipping_tracking_code)) ?: null,
                        'carrier_name' => trim((string) ($primaryExport['carrier_name'] ?? $order->shipping_carrier_name)) ?: null,
                        'exported_quantity' => (int) data_get($detail, 'summary.exported_quantity', 0),
                        'export_slip_count' => (int) data_get($detail, 'summary.export_slip_count', 0),
                        'line_count' => max(
                            count((array) ($primaryExport['items'] ?? [])),
                            (int) $order->items->count()
                        ),
                        'primary_notes' => $primaryExport['notes'] ?? $order->notes,
                        'source_kind' => (string) ($primaryExport['source_kind'] ?? (
                            (string) $order->type === 'inventory_export'
                                ? 'legacy_manual_export'
                                : 'shipment_auto'
                        )),
                    ],
                ];
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
        $normalizedState = strtolower(trim($state));

        if (!in_array($normalizedState, ['created', 'missing'], true)) {
            return;
        }

        $method = $normalizedState === 'created' ? 'whereExists' : 'whereNotExists';

        $query->{$method}(function ($documentQuery) {
            $documentQuery
                ->select(DB::raw(1))
                ->from('inventory_documents')
                ->where('inventory_documents.type', 'return')
                ->whereIn('inventory_documents.status', self::ACTIVE_STATUSES)
                ->where(function ($builder) {
                    $builder
                        ->where(function ($legacyQuery) {
                            $legacyQuery
                                ->where('inventory_documents.reference_type', 'order')
                                ->whereColumn('inventory_documents.reference_id', 'orders.id');
                        });

                    if ($this->hasInventoryDocumentOrderLinksTable()) {
                        $builder->orWhereExists(function ($linkQuery) {
                            $linkQuery
                                ->select(DB::raw(1))
                                ->from('inventory_document_order_links')
                                ->whereColumn('inventory_document_order_links.inventory_document_id', 'inventory_documents.id')
                                ->whereColumn('inventory_document_order_links.order_id', 'orders.id');
                        });
                    }
                });
        });
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

    public function previewBatchReturn(array $orderIds, int $accountId): array
    {
        $this->ensureManagedReturnLinkTablesExist();

        $orders = $this->loadBatchOrders($orderIds, $accountId);
        $this->assertOrdersEligibleForManagedReturn($orders);
        $this->assertNoManagedReturnConflict($orders, null);

        return $this->buildManagedReturnPreviewPayload($orders, null);
    }

    public function createBatchReturn(array $payload, int $accountId, ?int $userId = null): array
    {
        $this->ensureManagedReturnLinkTablesExist();

        $orderIds = collect($payload['order_ids'] ?? [])
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        $orders = $this->loadBatchOrders($orderIds, $accountId);
        $this->assertOrdersEligibleForManagedReturn($orders);
        $this->assertNoManagedReturnConflict($orders, null);

        $document = DB::transaction(function () use ($orders, $payload, $accountId, $userId) {
            return $this->storeManagedReturnDocument(null, $orders, $payload, $accountId, $userId);
        });

        return $this->buildManagedReturnDocumentPayload($document);
    }

    public function getManagedReturnDocumentPayload(InventoryDocument $document): array
    {
        $managedDocument = $this->loadManagedReturnDocument($document);

        if (!$this->isManagedReturnDocument($managedDocument)) {
            throw ValidationException::withMessages([
                'document' => ['Phiếu hoàn này không thuộc luồng đối chiếu theo lô.'],
            ]);
        }

        return $this->buildManagedReturnDocumentPayload($managedDocument);
    }

    public function serializeManagedReturnDocumentForInventory(InventoryDocument $document): array
    {
        $managedDocument = $this->loadManagedReturnDocument($document);
        $payload = $this->buildManagedReturnDocumentPayload($managedDocument);
        $adjustmentDocument = $this->findLinkedAdjustmentDocument($managedDocument);

        return [
            'id' => (int) $managedDocument->id,
            'document_number' => $managedDocument->document_number,
            'type' => $managedDocument->type,
            'document_date' => optional($managedDocument->document_date)->toDateString(),
            'supplier_id' => $managedDocument->supplier_id,
            'notes' => $managedDocument->notes,
            'batch_group_key' => $managedDocument->batch_group_key,
            'meta' => $managedDocument->meta,
            'creator' => $managedDocument->creator,
            'items' => $managedDocument->items->map(function (InventoryDocumentItem $item) {
                return [
                    'id' => (int) $item->id,
                    'product_id' => (int) $item->product_id,
                    'product' => $item->product ? [
                        'id' => (int) $item->product->id,
                        'sku' => $item->product->sku,
                        'name' => $item->product->name,
                    ] : null,
                    'product_name_snapshot' => $item->product_name_snapshot,
                    'product_sku_snapshot' => $item->product_sku_snapshot,
                    'quantity' => (int) $item->quantity,
                    'stock_bucket' => (string) ($item->stock_bucket ?? 'sellable'),
                    'direction' => (string) ($item->direction ?? 'in'),
                    'unit_cost' => (float) ($item->unit_cost ?? 0),
                    'notes' => $item->notes,
                    'meta' => $item->meta,
                ];
            })->values()->all(),
            'managed_batch_return' => [
                ...$payload,
                'adjustment_document_id' => $adjustmentDocument?->id,
                'adjustment_document_number' => $adjustmentDocument?->document_number,
            ],
        ];
    }

    public function updateManagedReturnDocument(InventoryDocument $document, array $payload, ?int $userId = null): array
    {
        $managedDocument = $this->loadManagedReturnDocument($document);

        if (!$this->isManagedReturnDocument($managedDocument)) {
            throw ValidationException::withMessages([
                'document' => ['Phiếu hoàn này không thuộc luồng đối chiếu theo lô.'],
            ]);
        }

        $orders = $managedDocument->orderLinks
            ->pluck('order')
            ->filter()
            ->values();

        if ($orders->isEmpty()) {
            throw ValidationException::withMessages([
                'document' => ['Phiếu hoàn này không còn liên kết đơn hàng để cập nhật.'],
            ]);
        }

        $updated = DB::transaction(function () use ($managedDocument, $orders, $payload, $userId) {
            $this->assertOrdersEligibleForManagedReturn($orders);

            return $this->storeManagedReturnDocument(
                $managedDocument,
                $orders,
                $payload,
                (int) $managedDocument->account_id,
                $userId
            );
        });

        return $this->buildManagedReturnDocumentPayload($updated);
    }

    public function deleteManagedReturnDocument(InventoryDocument $document): void
    {
        $managedDocument = $this->loadManagedReturnDocument($document, true);

        if (!$this->isManagedReturnDocument($managedDocument)) {
            throw ValidationException::withMessages([
                'document' => ['Phiếu hoàn này không thuộc luồng đối chiếu theo lô.'],
            ]);
        }

        DB::transaction(function () use ($managedDocument) {
            $adjustmentDocument = $this->findLinkedAdjustmentDocument($managedDocument, true);
            if ($adjustmentDocument && !$adjustmentDocument->trashed()) {
                $this->inventoryService->deleteDocument($adjustmentDocument);
            }

            $this->ensureReturnSlipCanBeDeleted($managedDocument);

            if (!$managedDocument->trashed()) {
                $this->inventoryService->deleteDocument($managedDocument);
            }

            $this->restoreManagedReturnOrdersToPreviousStatus($managedDocument);
        });
    }

    public function restoreManagedReturnDocument(InventoryDocument $document): array
    {
        $managedDocument = $this->loadManagedReturnDocument($document, true);

        if (!$this->isManagedReturnDocument($managedDocument)) {
            throw ValidationException::withMessages([
                'document' => ['Phiếu hoàn này không thuộc luồng đối chiếu theo lô.'],
            ]);
        }

        $orders = $managedDocument->orderLinks
            ->pluck('order')
            ->filter()
            ->values();

        if ($orders->isNotEmpty()) {
            $this->assertOrdersEligibleForManagedReturn($orders);
            $this->assertNoManagedReturnConflict($orders, (int) $managedDocument->id);
        }

        DB::transaction(function () use ($managedDocument) {
            if ($managedDocument->trashed()) {
                $this->inventoryService->restoreDocument($managedDocument);
            }

            $adjustmentDocument = $this->findLinkedAdjustmentDocument($managedDocument, true);
            if ($adjustmentDocument && $adjustmentDocument->trashed()) {
                $this->inventoryService->restoreDocument($adjustmentDocument);
            }

            $this->syncManagedReturnOrdersToReturned(
                collect($this->extractManagedReturnOrderIds($managedDocument))->map(fn ($id) => ['id' => $id]),
                (string) $managedDocument->document_number,
                null
            );
        });

        return $this->buildManagedReturnDocumentPayload(
            $this->loadManagedReturnDocument($managedDocument->fresh(), false)
        );
    }

    public function forceDeleteManagedReturnDocument(InventoryDocument $document): void
    {
        $managedDocument = $this->loadManagedReturnDocument($document, true);

        if (!$this->isManagedReturnDocument($managedDocument)) {
            throw ValidationException::withMessages([
                'document' => ['Phiếu hoàn này không thuộc luồng đối chiếu theo lô.'],
            ]);
        }

        DB::transaction(function () use ($managedDocument) {
            $adjustmentDocument = $this->findLinkedAdjustmentDocument($managedDocument, true);
            if ($adjustmentDocument) {
                $this->inventoryService->forceDeleteDocument($adjustmentDocument);
            }

            if (!$managedDocument->trashed()) {
                $this->ensureReturnSlipCanBeDeleted($managedDocument);
            }

            $this->inventoryService->forceDeleteDocument($managedDocument);
            $this->restoreManagedReturnOrdersToPreviousStatus($managedDocument);
        });
    }

    public function isManagedReturnDocument(InventoryDocument $document): bool
    {
        if ((string) $document->type !== 'return') {
            return false;
        }

        return !empty($document->batch_group_key)
            || (string) ($document->meta['managed_by'] ?? '') === self::MANAGED_RETURN_SOURCE
            || (
                $this->hasInventoryDocumentOrderLinksTable()
                && (
                    $document->relationLoaded('orderLinks')
                        ? $document->orderLinks->isNotEmpty()
                        : InventoryDocumentOrderLink::query()
                            ->where('inventory_document_id', (int) $document->id)
                            ->exists()
                )
            );
    }

    public function isManagedReturnAdjustmentDocument(InventoryDocument $document): bool
    {
        if ((string) $document->type !== 'adjustment') {
            return false;
        }

        if ((string) ($document->meta['managed_by'] ?? '') === self::MANAGED_RETURN_ADJUSTMENT_SOURCE) {
            return true;
        }

        if ((int) ($document->parent_document_id ?? 0) <= 0) {
            return false;
        }

        return InventoryDocument::withTrashed()
            ->whereKey((int) $document->parent_document_id)
            ->where('type', 'return')
            ->exists();
    }

    public function resolveManagedReturnRootDocument(InventoryDocument $document, bool $withTrashed = false): ?InventoryDocument
    {
        if ($this->isManagedReturnDocument($document)) {
            return $this->loadManagedReturnDocument($document, $withTrashed);
        }

        if (!$this->isManagedReturnAdjustmentDocument($document)) {
            return null;
        }

        $query = $withTrashed ? InventoryDocument::withTrashed() : InventoryDocument::query();
        $parent = $query
            ->where('type', 'return')
            ->find((int) $document->parent_document_id);

        return $parent ? $this->loadManagedReturnDocument($parent, $withTrashed) : null;
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

    public function createSlip(Order $order, array $payload, ?int $userId = null): InventoryDocument
    {
        $type = $this->normalizeType($payload['type'] ?? '');

        return DB::transaction(function () use ($order, $payload, $type, $userId) {
            $order->loadMissing(['items']);

            $items = collect($payload['items'] ?? [])
                ->map(function (array $item) {
                    return [
                        'product_id' => (int) ($item['product_id'] ?? 0),
                        'quantity' => (int) ($item['quantity'] ?? 0),
                        'notes' => $item['notes'] ?? null,
                    ];
                })
                ->filter(fn (array $item) => $item['product_id'] > 0 && $item['quantity'] > 0)
                ->groupBy('product_id')
                ->map(function (Collection $groupedItems, $productId) {
                    return [
                        'product_id' => (int) $productId,
                        'quantity' => (int) $groupedItems->sum('quantity'),
                        'notes' => $groupedItems
                            ->pluck('notes')
                            ->filter()
                            ->map(fn ($note) => trim((string) $note))
                            ->filter()
                            ->unique()
                            ->implode(' | '),
                    ];
                })
                ->values();

            if ($items->isEmpty()) {
                throw ValidationException::withMessages([
                    'items' => ['Can nhap it nhat mot dong san pham co so luong lon hon 0.'],
                ]);
            }

            $orderProducts = $this->aggregateOrderProducts($order);
            $productIds = $items->pluck('product_id')->unique()->values()->all();

            foreach ($productIds as $productId) {
                if (!$orderProducts->has($productId)) {
                    throw ValidationException::withMessages([
                        'items' => ["San pham #{$productId} khong thuoc don hang nay."],
                    ]);
                }
            }

            $existingDocuments = $this->loadDocumentsForSingleOrder($order);
            $automaticExports = $this->loadAutomaticExportsForSingleOrder($order);
            $progressMap = collect(
                $this->buildDetailPayload($order, $existingDocuments, $automaticExports, false)['products']
            )->keyBy('product_id');

            foreach ($items as $item) {
                $progress = $progressMap->get($item['product_id']);
                $availableQuantity = match ($type) {
                    'export' => (int) ($progress['exportable_quantity'] ?? 0),
                    'return', 'damaged' => (int) ($progress['reversible_quantity'] ?? 0),
                    default => 0,
                };

                if ($item['quantity'] > $availableQuantity) {
                    $label = $this->typeLabel($type);
                    $productName = $progress['product_name'] ?? "San pham #{$item['product_id']}";

                    throw ValidationException::withMessages([
                        'items' => ["{$productName} chi con {$availableQuantity} don vi co the tao {$label}."],
                    ]);
                }
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
                'notes' => $payload['notes'] ?? null,
                'created_by' => $userId,
            ]);

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

            $touchedProductIds = [];

            foreach ($items->values() as $index => $item) {
                $productId = (int) $item['product_id'];
                $quantity = (int) $item['quantity'];
                $productMeta = $orderProducts->get($productId);
                $product = $products->get($productId);
                $unitCost = round((float) ($productMeta['ordered_unit_cost'] ?? $product->cost_price ?? $product->expected_cost ?? 0), 2);
                $unitPrice = round((float) ($productMeta['ordered_unit_price'] ?? $product->price ?? 0), 2);

                $documentItem = InventoryDocumentItem::create([
                    'account_id' => (int) $order->account_id,
                    'inventory_document_id' => (int) $document->id,
                    'product_id' => $productId,
                    'product_name_snapshot' => $productMeta['product_name'],
                    'product_sku_snapshot' => $productMeta['product_sku'],
                    'quantity' => $quantity,
                    'stock_bucket' => $this->stockBucketForType($type),
                    'direction' => $this->directionForType($type),
                    'unit_cost' => $unitCost,
                    'total_cost' => round($unitCost * $quantity, 2),
                    'unit_price' => $unitPrice,
                    'total_price' => round($unitPrice * $quantity, 2),
                    'notes' => $item['notes'] ?? null,
                ]);

                if ($type === 'return') {
                    InventoryBatch::create([
                        'account_id' => (int) $order->account_id,
                        'product_id' => $productId,
                        'source_type' => 'document',
                        'source_id' => (int) $document->id,
                        'batch_number' => $this->generateLotNumber($document->document_number, $index + 1),
                        'received_at' => $documentDate->copy()->setTimeFrom(now()),
                        'quantity' => $quantity,
                        'remaining_quantity' => $quantity,
                        'unit_cost' => $unitCost,
                        'status' => 'open',
                        'meta' => [
                            'source_name' => 'Phieu hoan don hang',
                            'source_label' => $document->document_number,
                            'document_type' => 'return',
                            'document_item_id' => (int) $documentItem->id,
                            'order_id' => (int) $order->id,
                            'order_number' => $order->order_number,
                        ],
                    ]);

                    $touchedProductIds[] = $productId;
                }

                if ($type === 'damaged') {
                    $product->damaged_quantity = (int) ($product->damaged_quantity ?? 0) + $quantity;
                    $product->save();
                    $touchedProductIds[] = $productId;
                }
            }

            $this->finalizeDocumentTotals($document);

            if (!empty($touchedProductIds)) {
                $this->inventoryService->refreshProducts($touchedProductIds);
            }

            return $document->fresh([
                'creator:id,name',
                'items.product:id,sku,name',
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
                ->with(['items.product'])
                ->firstOrFail();

            if ($document->type === 'export') {
                $this->ensureExportSlipCanBeDeleted($order, $document);
            }

            if ($document->type === 'return') {
                $managedRoot = $this->resolveManagedReturnRootDocument($document);
                if ($managedRoot) {
                    $this->deleteManagedReturnDocument($managedRoot);

                    return;
                }

                $this->ensureReturnSlipCanBeDeleted($document);
            }

            if ($document->type === 'damaged') {
                $this->ensureDamagedSlipCanBeDeleted($document);
            }

            $touchedProductIds = $document->items
                ->pluck('product_id')
                ->filter()
                ->map(fn ($id) => (int) $id)
                ->unique()
                ->values()
                ->all();

            if ($document->type === 'return') {
                InventoryBatch::query()
                    ->where('source_type', 'document')
                    ->where('source_id', (int) $document->id)
                    ->delete();
            }

            if ($document->type === 'damaged') {
                $products = Product::query()
                    ->whereIn('id', $touchedProductIds)
                    ->lockForUpdate()
                    ->get()
                    ->keyBy('id');

                foreach ($document->items as $item) {
                    $product = $products->get((int) $item->product_id);
                    if (!$product) {
                        continue;
                    }

                    $product->damaged_quantity = max(
                        0,
                        (int) ($product->damaged_quantity ?? 0) - (int) $item->quantity
                    );
                    $product->save();
                }
            }

            InventoryDocumentItem::query()
                ->where('inventory_document_id', (int) $document->id)
                ->delete();

            $document->delete();

            if ($document->type === 'return' && !empty($touchedProductIds)) {
                $this->inventoryService->refreshProducts($touchedProductIds);
            }
        });
    }

    private function buildDetailPayload(
        Order $order,
        Collection $documents,
        Collection $automaticExports,
        bool $includeDocuments
    ): array {
        $orderProducts = $this->appendExtraProductsForOrder(
            $this->aggregateOrderProducts($order),
            $documents,
            (int) $order->id
        );

        $counters = [];
        $effectiveExportAdjustments = [];
        $automaticExportCounters = [];
        $slipCounts = [
            'export' => (int) $automaticExports->count(),
            'return' => 0,
            'damaged' => 0,
        ];

        foreach ($automaticExports as $automaticExport) {
            foreach (($automaticExport['items'] ?? []) as $item) {
                $productId = (int) ($item['product_id'] ?? 0);
                if ($productId <= 0) {
                    continue;
                }

                $automaticExportCounters[$productId] = (int) ($automaticExportCounters[$productId] ?? 0)
                    + (int) ($item['quantity'] ?? 0);
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

            if ($document->type === 'return' && $this->isManagedReturnDocument($document)) {
                foreach ($this->managedReturnLinksForOrder($document, (int) $order->id) as $link) {
                    $productId = (int) $link->product_id;
                    if (!isset($counters[$productId])) {
                        $counters[$productId] = [
                            'exported' => 0,
                            'returned' => 0,
                            'damaged' => 0,
                        ];
                    }

                    $counters[$productId]['returned'] += (int) ($link->actual_quantity ?? 0);
                    $effectiveExportAdjustments[$productId] = (int) ($effectiveExportAdjustments[$productId] ?? 0)
                        + (int) ($link->export_adjustment_quantity ?? 0);
                }

                continue;
            }

            foreach ($document->items as $item) {
                $productId = (int) $item->product_id;
                if (!isset($counters[$productId])) {
                    $counters[$productId] = [
                        'exported' => 0,
                        'returned' => 0,
                        'damaged' => 0,
                    ];
                }

                if ($document->type === 'export') {
                    $counters[$productId]['exported'] += (int) $item->quantity;
                } elseif ($document->type === 'return') {
                    $counters[$productId]['returned'] += (int) $item->quantity;
                } elseif ($document->type === 'damaged') {
                    $counters[$productId]['damaged'] += (int) $item->quantity;
                }
            }
        }

        $products = $orderProducts
            ->map(function (array $product) use ($counters, $effectiveExportAdjustments, $automaticExportCounters) {
                $productId = (int) $product['product_id'];
                $counter = $counters[$productId] ?? [
                    'exported' => 0,
                    'returned' => 0,
                    'damaged' => 0,
                ];

                $requiredQuantity = (int) $product['required_quantity'];
                $manualExportedQuantity = (int) $counter['exported'];
                $automaticExportedQuantity = (int) ($automaticExportCounters[$productId] ?? 0);
                $baseExportedQuantity = max($manualExportedQuantity, $automaticExportedQuantity);
                $exportAdjustmentQuantity = (int) ($effectiveExportAdjustments[$productId] ?? 0);
                $exportedQuantity = max(0, $baseExportedQuantity + $exportAdjustmentQuantity);
                $returnedQuantity = (int) $counter['returned'];
                $damagedQuantity = (int) $counter['damaged'];
                $remainingQuantity = max(0, $requiredQuantity - $exportedQuantity);
                $reversibleQuantity = max(0, $exportedQuantity - $returnedQuantity - $damagedQuantity);

                return [
                    'product_id' => $productId,
                    'product_name' => $product['product_name'],
                    'product_sku' => $product['product_sku'],
                    'required_quantity' => $requiredQuantity,
                    'manual_exported_quantity' => $manualExportedQuantity,
                    'automatic_exported_quantity' => $automaticExportedQuantity,
                    'base_exported_quantity' => $baseExportedQuantity,
                    'export_adjustment_quantity' => $exportAdjustmentQuantity,
                    'exported_quantity' => $exportedQuantity,
                    'returned_quantity' => $returnedQuantity,
                    'damaged_quantity' => $damagedQuantity,
                    'remaining_quantity' => $remainingQuantity,
                    'exportable_quantity' => $remainingQuantity,
                    'reversible_quantity' => $reversibleQuantity,
                    'discrepancy_quantity' => $exportAdjustmentQuantity,
                    'discrepancy_state' => $exportAdjustmentQuantity === 0 ? 'matched' : 'mismatch',
                ];
            })
            ->values();

        $requiredQuantity = (int) $products->sum('required_quantity');
        $exportedQuantity = (int) $products->sum('exported_quantity');
        $returnedQuantity = (int) $products->sum('returned_quantity');
        $damagedQuantity = (int) $products->sum('damaged_quantity');
        $remainingQuantity = max(0, $requiredQuantity - $exportedQuantity);
        $discrepancyQuantity = (int) $products->sum('discrepancy_quantity');

        $summary = $this->buildSummaryPayload(
            $requiredQuantity,
            $exportedQuantity,
            $returnedQuantity,
            $damagedQuantity,
            $remainingQuantity,
            $discrepancyQuantity,
            $slipCounts
        );

        $payload = [
            'order' => [
                'id' => (int) $order->id,
                'order_number' => $order->order_number,
                'customer_name' => $order->customer_name,
                'customer_phone' => $order->customer_phone,
                'shipping_address' => $order->shipping_address,
                'status' => $order->status,
                'created_at' => $order->created_at,
                'total_price' => (float) ($order->total_price ?? 0),
            ],
            'summary' => $summary,
            'products' => $products->all(),
        ];

        if (!$includeDocuments) {
            return $payload;
        }

        $timeline = $documents
            ->map(fn (InventoryDocument $document) => $this->normalizeDocumentForOrder($document, (int) $order->id))
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

    private function buildSummaryPayload(
        int $requiredQuantity,
        int $exportedQuantity,
        int $returnedQuantity,
        int $damagedQuantity,
        int $remainingQuantity,
        int $discrepancyQuantity,
        array $slipCounts
    ): array {
        $state = $slipCounts['export'] === 0
            ? 'not_created'
            : ($remainingQuantity > 0 ? 'partial' : 'fulfilled');

        [$label, $tone] = match ($state) {
            'fulfilled' => ['Xuat du', 'emerald'],
            'partial' => ['Xuat thieu', 'amber'],
            default => ['Chua tao phieu', 'slate'],
        };

        return [
            'state' => $state,
            'label' => $label,
            'tone' => $tone,
            'required_quantity' => $requiredQuantity,
            'exported_quantity' => $exportedQuantity,
            'returned_quantity' => $returnedQuantity,
            'damaged_quantity' => $damagedQuantity,
            'remaining_quantity' => $remainingQuantity,
            'discrepancy_quantity' => $discrepancyQuantity,
            'export_slip_count' => (int) ($slipCounts['export'] ?? 0),
            'return_slip_count' => (int) ($slipCounts['return'] ?? 0),
            'damaged_slip_count' => (int) ($slipCounts['damaged'] ?? 0),
            'has_return' => (int) ($slipCounts['return'] ?? 0) > 0,
            'has_damaged' => (int) ($slipCounts['damaged'] ?? 0) > 0,
            'quick_summary' => sprintf(
                'Can %d • Xuat %d • Hoan %d • Hong %d • Lech %d',
                $requiredQuantity,
                $exportedQuantity,
                $returnedQuantity,
                $damagedQuantity,
                $discrepancyQuantity
            ),
        ];
    }

    private function aggregateOrderProducts(Order $order): Collection
    {
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

    private function appendExtraProductsForOrder(Collection $orderProducts, Collection $documents, int $orderId): Collection
    {
        $nextSortOrder = $orderProducts->count();

        $documents
            ->filter(fn (InventoryDocument $document) => $document->type === 'return' && $this->isManagedReturnDocument($document))
            ->each(function (InventoryDocument $document) use (&$orderProducts, $orderId, &$nextSortOrder) {
                foreach ($this->managedReturnLinksForOrder($document, $orderId) as $link) {
                    $productId = (int) $link->product_id;
                    if ($productId <= 0 || $orderProducts->has($productId)) {
                        continue;
                    }

                    $item = $link->item;
                    $orderProducts->put($productId, [
                        'product_id' => $productId,
                        'product_name' => $item?->product_name_snapshot ?: "San pham #{$productId}",
                        'product_sku' => $item?->product_sku_snapshot,
                        'required_quantity' => 0,
                        'ordered_revenue_total' => 0,
                        'ordered_cost_total' => 0,
                        'ordered_unit_price' => 0,
                        'ordered_unit_cost' => round((float) ($item?->unit_cost ?? 0), 2),
                        'sort_order' => $nextSortOrder++,
                    ]);
                }
            });

        return $orderProducts
            ->sortBy('sort_order')
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
            'total_quantity' => (int) $items->sum('quantity'),
            'tracking_number' => $trackingNumber !== '' ? $trackingNumber : null,
            'carrier_name' => $carrierName !== '' ? $carrierName : null,
            'items' => $items->all(),
            'can_delete' => false,
            'can_edit' => false,
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
            'total_quantity' => (int) $items->sum('quantity'),
            'tracking_number' => $trackingNumber !== '' ? $trackingNumber : null,
            'carrier_name' => $carrierName !== '' ? $carrierName : null,
            'items' => $items->all(),
            'can_delete' => false,
            'can_edit' => false,
            'source_label' => $sourceLabel,
            'source_kind' => $isManualExportOrder ? 'legacy_manual_export' : 'legacy_tracking_export',
        ];
    }

    private function normalizeExportOverviewTimestamp(?array $primaryExport, Order $order): ?string
    {
        $candidates = [
            $primaryExport['document_date'] ?? null,
            $primaryExport['created_at'] ?? null,
            optional($order->shipping_dispatched_at)?->toISOString(),
            optional($order->created_at)?->toISOString(),
        ];

        foreach ($candidates as $candidate) {
            $value = trim((string) $candidate);
            if ($value === '') {
                continue;
            }

            return Carbon::parse($value)->toISOString();
        }

        return null;
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
            'product_name' => $orderItem->product_name_snapshot ?: "San pham #{$orderItem->product_id}",
            'product_sku' => $orderItem->product_sku_snapshot,
            'quantity' => $quantity,
            'unit_cost' => $unitCost,
            'total_cost' => round($unitCost * $quantity, 2),
            'unit_price' => $unitPrice,
            'total_price' => $unitPrice !== null ? round($unitPrice * $quantity, 2) : null,
            'notes' => null,
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

        $documentsQuery = InventoryDocument::query()
            ->whereIn('type', ['export', 'return', 'damaged'])
            ->whereIn('status', self::ACTIVE_STATUSES)
            ->where(function ($query) use ($orderIds) {
                $query->where(function ($legacyQuery) use ($orderIds) {
                    $legacyQuery
                        ->where('reference_type', 'order')
                        ->whereIn('reference_id', $orderIds);
                });

                if ($this->hasInventoryDocumentOrderLinksTable()) {
                    $query->orWhereExists(function ($linkQuery) use ($orderIds) {
                        $linkQuery
                            ->select(DB::raw(1))
                            ->from('inventory_document_order_links')
                            ->whereColumn('inventory_document_order_links.inventory_document_id', 'inventory_documents.id')
                            ->whereIn('inventory_document_order_links.order_id', $orderIds);
                    });
                }
            })
            ->with([
                'creator:id,name',
                'items' => function ($query) {
                    $itemRelations = ['product:id,sku,name'];

                    if ($this->hasInventoryDocumentItemOrderLinksTable()) {
                        $itemRelations[] = 'orderLinks.order:id,order_number,customer_name';
                    }

                    $query
                        ->select([
                            'id',
                            'inventory_document_id',
                            'product_id',
                            'product_name_snapshot',
                            'product_sku_snapshot',
                            'quantity',
                            'stock_bucket',
                            'direction',
                            'unit_cost',
                            'total_cost',
                            'unit_price',
                            'total_price',
                            'notes',
                            'meta',
                        ])
                        ->with($itemRelations)
                        ->orderBy('id');
                },
            ])
            ->orderBy('document_date')
            ->orderBy('id');

        if ($this->hasInventoryDocumentOrderLinksTable()) {
            $documentsQuery->with('orderLinks.order:id,order_number,customer_name,customer_phone');
        }

        $documents = $documentsQuery->get();

        $map = collect();

        foreach ($documents as $document) {
            $targetOrderIds = collect();

            if ((string) $document->reference_type === 'order' && in_array((int) $document->reference_id, $orderIds, true)) {
                $targetOrderIds->push((int) $document->reference_id);
            }

            if ($this->hasInventoryDocumentOrderLinksTable()) {
                foreach ($document->orderLinks as $link) {
                    if (in_array((int) $link->order_id, $orderIds, true)) {
                        $targetOrderIds->push((int) $link->order_id);
                    }
                }
            }

            foreach ($targetOrderIds->unique() as $orderId) {
                $existing = $map->get($orderId, collect());
                $map->put($orderId, $existing->push($document)->unique('id')->values());
            }
        }

        return $map;
    }

    private function loadDocumentsForSingleOrder(Order $order): Collection
    {
        $documentsQuery = InventoryDocument::query()
            ->whereIn('type', ['export', 'return', 'damaged'])
            ->whereIn('status', self::ACTIVE_STATUSES)
            ->where(function ($query) use ($order) {
                $query->where(function ($legacyQuery) use ($order) {
                    $legacyQuery
                        ->where('reference_type', 'order')
                        ->where('reference_id', (int) $order->id);
                });

                if ($this->hasInventoryDocumentOrderLinksTable()) {
                    $query->orWhereExists(function ($linkQuery) use ($order) {
                        $linkQuery
                            ->select(DB::raw(1))
                            ->from('inventory_document_order_links')
                            ->whereColumn('inventory_document_order_links.inventory_document_id', 'inventory_documents.id')
                            ->where('inventory_document_order_links.order_id', (int) $order->id);
                    });
                }
            })
            ->with([
                'creator:id,name',
                'items' => function ($query) {
                    $itemRelations = ['product:id,sku,name'];

                    if ($this->hasInventoryDocumentItemOrderLinksTable()) {
                        $itemRelations[] = 'orderLinks.order:id,order_number,customer_name';
                    }

                    $query
                        ->select([
                            'id',
                            'inventory_document_id',
                            'product_id',
                            'product_name_snapshot',
                            'product_sku_snapshot',
                            'quantity',
                            'stock_bucket',
                            'direction',
                            'unit_cost',
                            'total_cost',
                            'unit_price',
                            'total_price',
                            'notes',
                            'meta',
                        ])
                        ->with($itemRelations)
                        ->orderBy('id');
                },
            ])
            ->orderByDesc('document_date')
            ->orderByDesc('id');

        if ($this->hasInventoryDocumentOrderLinksTable()) {
            $documentsQuery->with('orderLinks.order:id,order_number,customer_name,customer_phone');
        }

        $documents = $documentsQuery->get();

        return $documents->unique('id')->values();
    }

    private function normalizeDocumentForOrder(InventoryDocument $document, int $orderId): array
    {
        [$statusLabel, $statusTone] = match ((string) $document->status) {
            'draft' => ['Nhap', 'amber'],
            'canceled' => ['Da huy', 'slate'],
            default => ['Hoan tat', 'emerald'],
        };

        $isManagedReturn = $document->type === 'return' && $this->isManagedReturnDocument($document);
        $items = $isManagedReturn
            ? $this->normalizeManagedReturnItemsForOrder($document, $orderId)
            : $document->items->map(function (InventoryDocumentItem $item) {
                return [
                    'id' => (int) $item->id,
                    'product_id' => (int) $item->product_id,
                    'product_name' => $item->product_name_snapshot ?: $item->product?->name ?: "San pham #{$item->product_id}",
                    'product_sku' => $item->product_sku_snapshot ?: $item->product?->sku,
                    'quantity' => (int) $item->quantity,
                    'unit_cost' => (float) ($item->unit_cost ?? 0),
                    'total_cost' => (float) ($item->total_cost ?? 0),
                    'unit_price' => $item->unit_price !== null ? (float) $item->unit_price : null,
                    'total_price' => $item->total_price !== null ? (float) $item->total_price : null,
                    'notes' => $item->notes,
                ];
            })->values();

        $adjustmentDocument = $isManagedReturn ? $this->findLinkedAdjustmentDocument($document) : null;

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
            'total_quantity' => (int) $items->sum('quantity'),
            'tracking_number' => trim((string) ($document->meta['tracking_number'] ?? '')) ?: null,
            'carrier_name' => trim((string) ($document->meta['carrier_name'] ?? '')) ?: null,
            'can_delete' => !$isManagedReturn,
            'can_edit' => $isManagedReturn,
            'is_batch_return' => $isManagedReturn,
            'batch_group_key' => $document->batch_group_key,
            'discrepancy_quantity' => $isManagedReturn
                ? (int) $items->sum('discrepancy_quantity')
                : 0,
            'adjustment_document_id' => $adjustmentDocument?->id,
            'adjustment_document_number' => $adjustmentDocument?->document_number,
            'source_kind' => $document->type === 'export' ? 'document' : null,
            'source_label' => $isManagedReturn && $this->managedReturnOrderLinksCount($document) > 1
                ? 'Phiếu hoàn theo lô'
                : null,
            'items' => $items->all(),
        ];
    }

    private function normalizeManagedReturnItemsForOrder(InventoryDocument $document, int $orderId): Collection
    {
        if (!$this->hasInventoryDocumentItemOrderLinksTable()) {
            return collect();
        }

        return $document->items
            ->flatMap(function (InventoryDocumentItem $item) use ($orderId) {
                return $item->orderLinks
                    ->filter(function (InventoryDocumentItemOrderLink $link) use ($orderId) {
                        return (int) $link->order_id === $orderId
                            && (
                                (int) ($link->actual_quantity ?? 0) > 0
                                || (int) ($link->exported_quantity ?? 0) > 0
                                || (int) ($link->export_adjustment_quantity ?? 0) !== 0
                            );
                    })
                    ->map(function (InventoryDocumentItemOrderLink $link) use ($item) {
                        $actualQuantity = (int) ($link->actual_quantity ?? 0);
                        $exportedQuantity = (int) ($link->exported_quantity ?? 0);
                        $discrepancyQuantity = (int) ($link->export_adjustment_quantity ?? 0);
                        $unitCost = round((float) ($item->unit_cost ?? 0), 2);
                        $unitPrice = $item->unit_price !== null ? round((float) $item->unit_price, 2) : null;

                        return [
                            'id' => (int) $item->id . ':' . (int) $link->id,
                            'product_id' => (int) $item->product_id,
                            'product_name' => $item->product_name_snapshot ?: $item->product?->name ?: "San pham #{$item->product_id}",
                            'product_sku' => $item->product_sku_snapshot ?: $item->product?->sku,
                            'quantity' => $actualQuantity,
                            'unit_cost' => $unitCost,
                            'total_cost' => round($unitCost * $actualQuantity, 2),
                            'unit_price' => $unitPrice,
                            'total_price' => $unitPrice !== null ? round($unitPrice * $actualQuantity, 2) : null,
                            'notes' => $item->notes,
                            'exported_quantity_snapshot' => $exportedQuantity,
                            'discrepancy_quantity' => $discrepancyQuantity,
                            'adjusted_exported_quantity' => max(0, $exportedQuantity + $discrepancyQuantity),
                            'is_extra_product' => $exportedQuantity === 0 && $actualQuantity > 0,
                        ];
                    });
            })
            ->values();
    }

    private function managedReturnLinksForOrder(InventoryDocument $document, int $orderId): Collection
    {
        if (!$this->hasInventoryDocumentItemOrderLinksTable()) {
            return collect();
        }

        return $document->items
            ->flatMap(function (InventoryDocumentItem $item) use ($orderId) {
                return $item->orderLinks
                    ->filter(fn (InventoryDocumentItemOrderLink $link) => (int) $link->order_id === $orderId);
            })
            ->values();
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
            return ((int) $product['returned_quantity'] + (int) $product['damaged_quantity']) > (int) $product['exported_quantity'];
        });

        if ($invalidProduct) {
            throw ValidationException::withMessages([
                'document' => ["Khong the xoa phieu xuat vi {$invalidProduct['product_name']} dang co phieu hoan/hong phu thuoc vao so luong da xuat."],
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
            if ((int) $batch->remaining_quantity !== (int) $batch->quantity || (int) $batch->allocations_count > 0 || (int) $batch->document_allocations_count > 0) {
                throw ValidationException::withMessages([
                    'document' => ['Phiếu hoàn này đã phát sinh luồng kho tiếp theo nên không thể xóa hoặc sửa.'],
                ]);
            }
        }
    }

    private function ensureDamagedSlipCanBeDeleted(InventoryDocument $document): void
    {
        $productIds = $document->items
            ->pluck('product_id')
            ->filter()
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        $products = Product::query()
            ->whereIn('id', $productIds)
            ->lockForUpdate()
            ->get()
            ->keyBy('id');

        foreach ($document->items as $item) {
            $product = $products->get((int) $item->product_id);
            if (!$product) {
                continue;
            }

            if ((int) ($product->damaged_quantity ?? 0) < (int) $item->quantity) {
                throw ValidationException::withMessages([
                    'document' => ["Khong the xoa phieu hong vi {$product->sku} - {$product->name} da duoc xu ly tiep trong ton hong."],
                ]);
            }
        }
    }

    private function finalizeDocumentTotals(InventoryDocument $document): void
    {
        $itemQuery = $document->items();

        $totalAmount = $document->type === 'export'
            ? round((float) $itemQuery->sum(DB::raw('COALESCE(total_price, total_cost)')), 2)
            : round((float) $itemQuery->sum('total_cost'), 2);

        $document->forceFill([
            'total_quantity' => (int) $itemQuery->sum('quantity'),
            'total_amount' => $totalAmount,
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
            'export' => 'phiếu xuất',
            'return' => 'phiếu hoàn',
            'damaged' => 'phiếu hỏng',
            default => 'phiếu kho',
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

    private function loadBatchOrders(array $orderIds, int $accountId): Collection
    {
        if (empty($orderIds)) {
            throw ValidationException::withMessages([
                'order_ids' => ['Cần chọn ít nhất một đơn hàng để tạo phiếu hoàn theo lô.'],
            ]);
        }

        $orders = Order::query()
            ->when($accountId > 0, fn ($query) => $query->where('account_id', $accountId))
            ->whereIn('id', $orderIds)
            ->with('items')
            ->get()
            ->sortBy(function (Order $order) use ($orderIds) {
                return array_search((int) $order->id, $orderIds, true);
            })
            ->values();

        if ($orders->count() !== count(array_unique($orderIds))) {
            throw ValidationException::withMessages([
                'order_ids' => ['Có đơn hàng không tồn tại hoặc không thuộc tài khoản hiện tại.'],
            ]);
        }

        return $orders;
    }

    private function assertOrdersEligibleForManagedReturn(Collection $orders): void
    {
        $invalidOrder = $orders->first(function (Order $order) {
            return !((string) ($order->order_kind ?: Order::KIND_OFFICIAL) === Order::KIND_OFFICIAL);
        });

        if ($invalidOrder) {
            throw ValidationException::withMessages([
                'order_ids' => ["Đơn {$invalidOrder->order_number} không thuộc nhóm đơn chính để lập phiếu hoàn theo lô."],
            ]);
        }
    }

    private function assertNoManagedReturnConflict(Collection $orders, ?int $excludingDocumentId): void
    {
        $orderIds = $orders->pluck('id')->map(fn ($id) => (int) $id)->values()->all();

        $conflict = InventoryDocument::query()
            ->where('type', 'return')
            ->whereIn('status', self::ACTIVE_STATUSES)
            ->whereNotNull('batch_group_key')
            ->when($excludingDocumentId, fn ($query) => $query->whereKeyNot($excludingDocumentId))
            ->where(function ($query) use ($orderIds) {
                $query
                    ->where(function ($legacyQuery) use ($orderIds) {
                        $legacyQuery
                            ->where('reference_type', 'order')
                            ->whereIn('reference_id', $orderIds);
                    })
                    ->orWhereExists(function ($linkQuery) use ($orderIds) {
                        $linkQuery
                            ->select(DB::raw(1))
                            ->from('inventory_document_order_links')
                            ->whereColumn('inventory_document_order_links.inventory_document_id', 'inventory_documents.id')
                            ->whereIn('inventory_document_order_links.order_id', $orderIds);
                    });
            })
            ->orderByDesc('id')
            ->first();

        if ($conflict) {
            throw ValidationException::withMessages([
                'order_ids' => ["Đã tồn tại phiếu hoàn đối chiếu {$conflict->document_number} cho một trong các đơn đã chọn. Hãy sửa phiếu này thay vì tạo mới."],
            ]);
        }
    }

    private function buildManagedReturnPreviewPayload(Collection $orders, ?int $excludingDocumentId): array
    {
        $sourceContext = $this->buildManagedReturnSourceContext($orders, $excludingDocumentId);

        $products = collect($sourceContext['products'])
            ->map(function (array $row) {
                return [
                    'product_id' => (int) $row['product_id'],
                    'product_name' => $row['product_name'],
                    'product_sku' => $row['product_sku'],
                    'exported_quantity' => (int) $row['exported_quantity'],
                    'actual_quantity' => (int) $row['exported_quantity'],
                    'discrepancy_quantity' => 0,
                    'notes' => '',
                    'is_extra_product' => false,
                    'can_remove' => false,
                    'order_breakdown' => $row['order_breakdown'],
                ];
            })
            ->values();

        return [
            'document' => [
                'id' => null,
                'document_number' => null,
                'batch_group_key' => null,
                'document_date' => now()->toDateString(),
                'notes' => '',
                'adjustment_document_id' => null,
                'adjustment_document_number' => null,
            ],
            'orders' => $sourceContext['orders'],
            'source_orders' => $sourceContext['orders'],
            'summary' => [
                'order_count' => $orders->count(),
                'exported_quantity' => (int) $products->sum('exported_quantity'),
                'actual_quantity' => (int) $products->sum('actual_quantity'),
                'discrepancy_quantity' => 0,
                'discrepancy_abs_quantity' => 0,
            ],
            'products' => $products->all(),
        ];
    }

    private function buildManagedReturnSourceContext(Collection $orders, ?int $excludingDocumentId): array
    {
        $productMap = [];
        $orderPayloads = [];

        foreach ($orders as $order) {
            $orderProducts = $this->aggregateOrderProducts($order);
            $documents = $this->loadDocumentsForSingleOrder($order)
                ->reject(fn (InventoryDocument $document) => $excludingDocumentId !== null && (int) $document->id === $excludingDocumentId)
                ->values();

            $detail = $this->buildDetailPayload(
                $order,
                $documents,
                $this->loadAutomaticExportsForSingleOrder($order),
                false
            );

            $orderPayloads[] = [
                'id' => (int) $order->id,
                'order_number' => $order->order_number,
                'customer_name' => $order->customer_name,
                'customer_phone' => $order->customer_phone,
            ];

            foreach ($detail['products'] as $product) {
                $productId = (int) ($product['product_id'] ?? 0);
                $exportedQuantity = (int) ($product['base_exported_quantity'] ?? $product['exported_quantity'] ?? 0);
                $orderProduct = $orderProducts->get($productId, []);
                if ($productId <= 0 || $exportedQuantity <= 0) {
                    continue;
                }

                if (!isset($productMap[$productId])) {
                    $productMap[$productId] = [
                        'product_id' => $productId,
                        'product_name' => $product['product_name'],
                        'product_sku' => $product['product_sku'],
                        'exported_quantity' => 0,
                        'order_breakdown' => [],
                    ];
                }

                $productMap[$productId]['exported_quantity'] += $exportedQuantity;
                $productMap[$productId]['order_breakdown'][] = [
                    'order_id' => (int) $order->id,
                    'order_number' => $order->order_number,
                    'customer_name' => $order->customer_name,
                    'exported_quantity' => $exportedQuantity,
                    'actual_quantity' => 0,
                    'discrepancy_quantity' => 0,
                    'unit_cost' => round((float) ($orderProduct['ordered_unit_cost'] ?? 0), 2),
                    'unit_price' => round((float) ($orderProduct['ordered_unit_price'] ?? 0), 2),
                ];
            }
        }

        return [
            'orders' => $orderPayloads,
            'products' => collect($productMap)
                ->sortBy(fn (array $row) => mb_strtolower((string) ($row['product_name'] ?? '')))
                ->values()
                ->all(),
        ];
    }

    private function storeManagedReturnDocument(
        ?InventoryDocument $document,
        Collection $orders,
        array $payload,
        int $accountId,
        ?int $userId
    ): InventoryDocument {
        $orders = $orders->values();
        $excludingDocumentId = $document?->id ? (int) $document->id : null;

        if ($document === null) {
            $this->assertNoManagedReturnConflict($orders, null);
        }

        $sourceContext = $this->buildManagedReturnSourceContext($orders, $excludingDocumentId);
        $normalizedItems = $this->normalizeManagedReturnItems(
            $payload,
            $sourceContext['products'],
            $sourceContext['orders']
        );

        if ($normalizedItems->isEmpty()) {
            throw ValidationException::withMessages([
                'items' => ['Cần nhập ít nhất một sản phẩm hoàn có số lượng lớn hơn 0.'],
            ]);
        }

        $documentDate = Carbon::parse($payload['document_date'] ?? now());
        $selectedOrders = collect($sourceContext['orders']);

        if ($document !== null) {
            $this->ensureReturnSlipCanBeDeleted($document);

            $existingAdjustmentDocument = $this->findLinkedAdjustmentDocument($document);
            if ($existingAdjustmentDocument) {
                $this->inventoryService->deleteDocument($existingAdjustmentDocument);
            }

            InventoryBatch::query()
                ->where('source_type', 'document')
                ->where('source_id', (int) $document->id)
                ->delete();

            InventoryDocumentItem::query()
                ->where('inventory_document_id', (int) $document->id)
                ->delete();

            if ($this->hasInventoryDocumentOrderLinksTable()) {
                InventoryDocumentOrderLink::query()
                    ->where('inventory_document_id', (int) $document->id)
                    ->delete();
            }
        }

        if ($document === null) {
            $referenceType = $orders->count() === 1 ? 'order' : 'order_batch';
            $document = InventoryDocument::create([
                'account_id' => $accountId,
                'document_number' => $this->generateDocumentNumber('return', $accountId),
                'type' => 'return',
                'document_date' => $documentDate->toDateString(),
                'status' => 'completed',
                'reference_type' => $referenceType,
                'reference_id' => (int) ($orders->first()?->id ?? 0) ?: null,
                'notes' => $payload['notes'] ?? null,
                'meta' => [
                    'managed_by' => self::MANAGED_RETURN_SOURCE,
                    'mode' => 'batch_return',
                ],
                'created_by' => $userId,
            ]);

            $document->batch_group_key = 'BTH-' . $document->document_number;
            $document->save();
        } else {
            $document->forceFill([
                'document_date' => $documentDate->toDateString(),
                'notes' => $payload['notes'] ?? null,
                'reference_type' => $orders->count() === 1 ? 'order' : 'order_batch',
                'reference_id' => (int) ($orders->first()?->id ?? 0) ?: null,
                'meta' => array_merge((array) ($document->meta ?? []), [
                    'managed_by' => self::MANAGED_RETURN_SOURCE,
                    'mode' => 'batch_return',
                ]),
            ])->save();
        }

        $this->syncManagedReturnOrderLinks($document, $selectedOrders, $accountId);

        $productIds = $normalizedItems
            ->pluck('product_id')
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
                'items' => ['Co san pham khong con ton tai trong he thong.'],
            ]);
        }

        $touchedProductIds = [];

        foreach ($normalizedItems->values() as $index => $item) {
            $product = $products->get((int) $item['product_id']);
            $actualQuantity = (int) $item['actual_quantity'];
            $unitCostDraft = (float) ($item['unit_cost'] ?? 0);
            $unitPriceDraft = (float) ($item['unit_price'] ?? 0);
            $unitCost = round($unitCostDraft > 0 ? $unitCostDraft : (float) ($product->cost_price ?? $product->expected_cost ?? 0), 2);
            $unitPrice = round($unitPriceDraft > 0 ? $unitPriceDraft : (float) ($product->price ?? 0), 2);
            $discrepancyQuantity = (int) $item['discrepancy_quantity'];
            $orderBreakdown = collect($item['order_breakdown'] ?? []);

            $documentItem = InventoryDocumentItem::create([
                'account_id' => $accountId,
                'inventory_document_id' => (int) $document->id,
                'product_id' => (int) $product->id,
                'product_name_snapshot' => $item['product_name'] ?: $product->name,
                'product_sku_snapshot' => $item['product_sku'] ?: $product->sku,
                'quantity' => $actualQuantity,
                'stock_bucket' => 'sellable',
                'direction' => 'in',
                'unit_cost' => $unitCost,
                'total_cost' => round($unitCost * $actualQuantity, 2),
                'unit_price' => $unitPrice,
                'total_price' => round($unitPrice * $actualQuantity, 2),
                'notes' => $item['notes'] ?? null,
                'meta' => [
                    'exported_quantity_snapshot' => (int) $item['exported_quantity'],
                    'actual_quantity' => $actualQuantity,
                    'discrepancy_quantity' => $discrepancyQuantity,
                    'is_extra_product' => (bool) ($item['is_extra_product'] ?? false),
                ],
            ]);

            foreach ($orderBreakdown as $allocation) {
                InventoryDocumentItemOrderLink::create([
                    'account_id' => $accountId,
                    'inventory_document_item_id' => (int) $documentItem->id,
                    'order_id' => (int) ($allocation['order_id'] ?? 0) ?: null,
                    'product_id' => (int) $product->id,
                    'exported_quantity' => (int) ($allocation['exported_quantity'] ?? 0),
                    'actual_quantity' => (int) ($allocation['actual_quantity'] ?? 0),
                    'export_adjustment_quantity' => (int) ($allocation['discrepancy_quantity'] ?? 0),
                    'meta' => [
                        'order_number' => $allocation['order_number'] ?? null,
                        'customer_name' => $allocation['customer_name'] ?? null,
                    ],
                ]);
            }

            if ($actualQuantity > 0) {
                InventoryBatch::create([
                    'account_id' => $accountId,
                    'product_id' => (int) $product->id,
                    'source_type' => 'document',
                    'source_id' => (int) $document->id,
                    'batch_number' => $this->generateLotNumber($document->document_number, $index + 1),
                    'received_at' => $documentDate->copy()->setTimeFrom(now()),
                    'quantity' => $actualQuantity,
                    'remaining_quantity' => $actualQuantity,
                    'unit_cost' => $unitCost,
                    'status' => 'open',
                    'meta' => [
                        'source_name' => 'Phiếu hoàn theo lô',
                        'source_label' => $document->document_number,
                        'document_type' => 'return',
                        'document_item_id' => (int) $documentItem->id,
                        'batch_group_key' => $document->batch_group_key,
                    ],
                ]);
            }

            $touchedProductIds[] = (int) $product->id;
        }

        $this->finalizeDocumentTotals($document);

        $adjustmentDocument = $this->upsertManagedReturnAdjustmentDocument(
            $document,
            $normalizedItems,
            $accountId,
            $userId
        );

        $existingStatusSnapshots = $this->storedManagedReturnOrderStatusSnapshots($document);
        $updatedStatusSnapshots = $this->syncManagedReturnOrdersToReturned(
            $orders,
            (string) $document->document_number,
            $userId
        );

        $document->forceFill([
            'meta' => array_merge((array) ($document->meta ?? []), [
                'managed_by' => self::MANAGED_RETURN_SOURCE,
                'mode' => 'batch_return',
                'order_ids' => $selectedOrders->pluck('id')->map(fn ($id) => (int) $id)->values()->all(),
                'adjustment_document_id' => $adjustmentDocument?->id,
                'adjustment_document_number' => $adjustmentDocument?->document_number,
                'order_status_snapshots' => $this->mergeManagedReturnOrderStatusSnapshots(
                    $selectedOrders,
                    $existingStatusSnapshots,
                    $updatedStatusSnapshots
                ),
            ]),
        ])->save();

        if (!empty($touchedProductIds)) {
            $this->inventoryService->refreshProducts($touchedProductIds);
        }

        return $this->loadManagedReturnDocument($document);
    }

    private function syncManagedReturnOrdersToReturned(
        Collection $orders,
        string $documentNumber,
        ?int $userId
    ): array {
        $orderIds = $orders
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($orderIds)) {
            return [];
        }

        $lockedOrders = Order::query()
            ->whereIn('id', $orderIds)
            ->lockForUpdate()
            ->get()
            ->keyBy(fn (Order $order) => (int) $order->id);

        $ensuredAccounts = [];
        $snapshots = [];

        foreach ($orderIds as $orderId) {
            $order = $lockedOrders->get((int) $orderId);

            if (!$order) {
                continue;
            }

            $accountId = (int) ($order->account_id ?? 0);
            if ($accountId > 0 && !isset($ensuredAccounts[$accountId])) {
                OrderStatusCatalog::ensureReturnedStatus($accountId);
                $ensuredAccounts[$accountId] = true;
            }

            $oldStatus = trim((string) $order->status);
            if ($oldStatus === OrderStatusCatalog::RETURNED_CODE) {
                continue;
            }

            $snapshots[(string) $order->id] = $oldStatus !== '' ? $oldStatus : null;

            OrderStatusLog::create([
                'order_id' => (int) $order->id,
                'from_status' => $oldStatus !== '' ? $oldStatus : null,
                'to_status' => OrderStatusCatalog::RETURNED_CODE,
                'source' => 'system',
                'changed_by' => $userId,
                'reason' => "Tu dong cap nhat tu phieu hoan {$documentNumber}",
            ]);

            $order->forceFill([
                'status' => OrderStatusCatalog::RETURNED_CODE,
            ])->save();
        }

        return $snapshots;
    }

    private function restoreManagedReturnOrdersToPreviousStatus(InventoryDocument $document, ?int $userId = null): void
    {
        $orderIds = $this->extractManagedReturnOrderIds($document);
        if (empty($orderIds)) {
            return;
        }

        $snapshots = $this->resolveManagedReturnOrderStatusSnapshots($document, $orderIds);
        if (empty($snapshots)) {
            return;
        }

        $lockedOrders = Order::query()
            ->whereIn('id', $orderIds)
            ->lockForUpdate()
            ->get()
            ->keyBy(fn (Order $order) => (int) $order->id);

        foreach ($orderIds as $orderId) {
            $order = $lockedOrders->get((int) $orderId);
            if (!$order) {
                continue;
            }

            $currentStatus = trim((string) $order->status);
            if ($currentStatus !== OrderStatusCatalog::RETURNED_CODE) {
                continue;
            }

            $snapshotKey = (string) $orderId;
            if (!array_key_exists($snapshotKey, $snapshots)) {
                continue;
            }

            $targetStatus = $snapshots[$snapshotKey];
            if ($targetStatus === OrderStatusCatalog::RETURNED_CODE) {
                continue;
            }

            OrderStatusLog::create([
                'order_id' => (int) $order->id,
                'from_status' => $currentStatus !== '' ? $currentStatus : null,
                'to_status' => $targetStatus ?? '',
                'source' => 'system',
                'changed_by' => $userId,
                'reason' => "Khoi phuc trang thai truoc khi lap phieu hoan {$document->document_number}",
            ]);

            $order->forceFill([
                'status' => $targetStatus ?? '',
            ])->save();
        }
    }

    private function extractManagedReturnOrderIds(InventoryDocument $document): array
    {
        $orderIds = collect();

        if ($document->relationLoaded('orderLinks')) {
            $orderIds = $orderIds->merge($document->orderLinks->pluck('order_id'));
        } elseif ($this->hasInventoryDocumentOrderLinksTable()) {
            $orderIds = $orderIds->merge(
                InventoryDocumentOrderLink::query()
                    ->where('inventory_document_id', (int) $document->id)
                    ->pluck('order_id')
            );
        }

        if (
            in_array((string) $document->reference_type, ['order', 'order_batch'], true)
            && (int) ($document->reference_id ?? 0) > 0
        ) {
            $orderIds->push((int) $document->reference_id);
        }

        return $orderIds
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function storedManagedReturnOrderStatusSnapshots(InventoryDocument $document): array
    {
        $rawSnapshots = data_get((array) ($document->meta ?? []), 'order_status_snapshots', []);
        if (!is_array($rawSnapshots)) {
            return [];
        }

        $snapshots = [];
        foreach ($rawSnapshots as $orderId => $status) {
            $normalizedOrderId = (int) $orderId;
            if ($normalizedOrderId <= 0) {
                continue;
            }

            $snapshots[(string) $normalizedOrderId] = $this->normalizeManagedReturnOrderStatusValue($status);
        }

        return $snapshots;
    }

    private function mergeManagedReturnOrderStatusSnapshots(
        Collection $orders,
        array $existingSnapshots,
        array $updatedSnapshots
    ): array {
        $merged = [];
        $orderIds = $orders
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        foreach ($orderIds as $orderId) {
            $snapshotKey = (string) $orderId;

            if (array_key_exists($snapshotKey, $updatedSnapshots)) {
                $merged[$snapshotKey] = $updatedSnapshots[$snapshotKey];
                continue;
            }

            if (array_key_exists($snapshotKey, $existingSnapshots)) {
                $merged[$snapshotKey] = $existingSnapshots[$snapshotKey];
            }
        }

        return $merged;
    }

    private function resolveManagedReturnOrderStatusSnapshots(InventoryDocument $document, array $orderIds): array
    {
        $snapshots = array_filter(
            $this->storedManagedReturnOrderStatusSnapshots($document),
            fn ($orderId) => in_array((int) $orderId, $orderIds, true),
            ARRAY_FILTER_USE_KEY
        );

        $missingOrderIds = array_values(array_filter(
            $orderIds,
            fn ($orderId) => !array_key_exists((string) $orderId, $snapshots)
        ));

        if (empty($missingOrderIds)) {
            return $snapshots;
        }

        $logsByOrderId = OrderStatusLog::query()
            ->whereIn('order_id', $missingOrderIds)
            ->where('source', 'system')
            ->where('to_status', OrderStatusCatalog::RETURNED_CODE)
            ->orderByDesc('id')
            ->get()
            ->groupBy(fn (OrderStatusLog $log) => (int) $log->order_id);

        $documentNumber = trim((string) $document->document_number);

        foreach ($missingOrderIds as $orderId) {
            $logs = $logsByOrderId->get((int) $orderId, collect());
            if ($logs->isEmpty()) {
                continue;
            }

            $matchedLog = $logs->first(function (OrderStatusLog $log) use ($documentNumber) {
                $reason = (string) ($log->reason ?? '');

                return $documentNumber !== '' && str_contains($reason, $documentNumber);
            }) ?? $logs->first();

            if (!$matchedLog) {
                continue;
            }

            $snapshots[(string) $orderId] = $this->normalizeManagedReturnOrderStatusValue($matchedLog->from_status);
        }

        return $snapshots;
    }

    private function normalizeManagedReturnOrderStatusValue(mixed $value): ?string
    {
        $normalized = trim((string) ($value ?? ''));

        return $normalized !== '' ? $normalized : null;
    }

    private function normalizeManagedReturnItems(array $payload, array $sourceProducts, array $sourceOrders): Collection
    {
        $sourceMap = collect($sourceProducts)->keyBy('product_id');
        $normalized = [];
        $primaryOrder = collect($sourceOrders)->first();

        foreach ((array) ($payload['items'] ?? []) as $item) {
            $productId = (int) ($item['product_id'] ?? 0);
            $actualQuantity = (int) ($item['quantity'] ?? 0);

            if ($productId <= 0 || $actualQuantity < 0) {
                continue;
            }

            $source = $sourceMap->get($productId);
            $exportedQuantity = (int) ($source['exported_quantity'] ?? 0);

            if ($actualQuantity === 0 && $exportedQuantity === 0) {
                continue;
            }

            $orderBreakdown = collect($source['order_breakdown'] ?? []);

            $allocation = $this->allocateManagedReturnToOrders($orderBreakdown, $actualQuantity, $primaryOrder);

            $normalized[$productId] = [
                'product_id' => $productId,
                'product_name' => $source['product_name'] ?? ($item['product_name'] ?? "San pham #{$productId}"),
                'product_sku' => $source['product_sku'] ?? ($item['product_sku'] ?? null),
                'exported_quantity' => $exportedQuantity,
                'actual_quantity' => $actualQuantity,
                'discrepancy_quantity' => $actualQuantity - $exportedQuantity,
                'notes' => $item['notes'] ?? null,
                'is_extra_product' => $exportedQuantity === 0,
                'order_breakdown' => $allocation->all(),
                'unit_cost' => $this->resolveManagedReturnWeightedUnitCost($allocation),
                'unit_price' => $this->resolveManagedReturnWeightedUnitPrice($allocation),
            ];
        }

        return collect($normalized)
            ->sortBy(fn (array $item) => mb_strtolower((string) ($item['product_name'] ?? '')))
            ->values();
    }

    private function allocateManagedReturnToOrders(Collection $orderBreakdown, int $actualQuantity, ?array $primaryOrder = null): Collection
    {
        $rows = $orderBreakdown
            ->map(function (array $row) {
                return [
                    'order_id' => (int) ($row['order_id'] ?? 0) ?: null,
                    'order_number' => $row['order_number'] ?? null,
                    'customer_name' => $row['customer_name'] ?? null,
                    'exported_quantity' => (int) ($row['exported_quantity'] ?? 0),
                    'actual_quantity' => 0,
                    'discrepancy_quantity' => 0,
                    'unit_cost' => round((float) ($row['unit_cost'] ?? 0), 2),
                    'unit_price' => round((float) ($row['unit_price'] ?? 0), 2),
                ];
            })
            ->values()
            ->all();

        $remainingActual = $actualQuantity;

        foreach ($rows as $index => $row) {
            if ($remainingActual <= 0) {
                break;
            }

            $takeQuantity = min($remainingActual, (int) $row['exported_quantity']);
            $rows[$index]['actual_quantity'] = $takeQuantity;
            $remainingActual -= $takeQuantity;
        }

        if (empty($rows)) {
            $rows[] = [
                'order_id' => $primaryOrder['id'] ?? null,
                'order_number' => $primaryOrder['order_number'] ?? null,
                'customer_name' => $primaryOrder['customer_name'] ?? null,
                'exported_quantity' => 0,
                'actual_quantity' => $actualQuantity,
                'discrepancy_quantity' => $actualQuantity,
                'unit_cost' => 0.0,
                'unit_price' => 0.0,
            ];
        } elseif ($remainingActual > 0) {
            $rows[0]['actual_quantity'] = (int) $rows[0]['actual_quantity'] + $remainingActual;
            $remainingActual = 0;
        }

        foreach ($rows as $index => $row) {
            $rows[$index]['discrepancy_quantity'] = (int) ($rows[$index]['actual_quantity'] ?? 0)
                - (int) ($rows[$index]['exported_quantity'] ?? 0);
        }

        return collect($rows)->values();
    }

    private function resolveManagedReturnWeightedUnitCost(Collection $allocation): float
    {
        $weightedQuantity = (float) $allocation
            ->sum(fn (array $row) => max(0, (int) ($row['actual_quantity'] ?? 0)));

        if ($weightedQuantity <= 0) {
            return 0.0;
        }

        $weightedTotal = (float) $allocation->sum(function (array $row) {
            $quantity = max(0, (int) ($row['actual_quantity'] ?? 0));
            $unitCost = round((float) ($row['unit_cost'] ?? 0), 2);

            return $quantity * $unitCost;
        });

        return round($weightedTotal / $weightedQuantity, 2);
    }

    private function resolveManagedReturnWeightedUnitPrice(Collection $allocation): float
    {
        $weightedQuantity = (float) $allocation
            ->sum(fn (array $row) => max(0, (int) ($row['actual_quantity'] ?? 0)));

        if ($weightedQuantity <= 0) {
            return 0.0;
        }

        $weightedTotal = (float) $allocation->sum(function (array $row) {
            $quantity = max(0, (int) ($row['actual_quantity'] ?? 0));
            $unitPrice = round((float) ($row['unit_price'] ?? 0), 2);

            return $quantity * $unitPrice;
        });

        return round($weightedTotal / $weightedQuantity, 2);
    }

    private function syncManagedReturnOrderLinks(InventoryDocument $document, Collection $orders, int $accountId): void
    {
        $this->ensureManagedReturnLinkTablesExist();

        InventoryDocumentOrderLink::query()
            ->where('inventory_document_id', (int) $document->id)
            ->delete();

        foreach ($orders as $order) {
            InventoryDocumentOrderLink::create([
                'account_id' => $accountId,
                'inventory_document_id' => (int) $document->id,
                'order_id' => (int) $order['id'],
            ]);
        }
    }

    private function upsertManagedReturnAdjustmentDocument(
        InventoryDocument $document,
        Collection $normalizedItems,
        int $accountId,
        ?int $userId
    ): ?InventoryDocument {
        $adjustmentItems = $normalizedItems
            ->filter(fn (array $item) => (int) ($item['discrepancy_quantity'] ?? 0) !== 0)
            ->map(function (array $item) {
                $discrepancyQuantity = (int) $item['discrepancy_quantity'];

                return [
                    'product_id' => (int) $item['product_id'],
                    'quantity' => $discrepancyQuantity,
                    'unit_cost' => ((float) ($item['unit_cost'] ?? 0)) > 0
                        ? round((float) $item['unit_cost'], 2)
                        : null,
                    'notes' => $discrepancyQuantity > 0
                        ? 'Phần lệch dương từ phiếu hoàn đối chiếu'
                        : 'Phần lệch âm từ phiếu hoàn đối chiếu',
                    'allow_oversold' => $discrepancyQuantity < 0,
                ];
            })
            ->values();

        $existingAdjustmentDocument = $this->findLinkedAdjustmentDocument($document);

        if ($adjustmentItems->isEmpty()) {
            if ($existingAdjustmentDocument) {
                $this->inventoryService->deleteDocument($existingAdjustmentDocument);
            }

            return null;
        }

        $payload = [
            'document_date' => optional($document->document_date)->toDateString() ?: now()->toDateString(),
            'notes' => 'Tự động cập nhật từ phiếu hoàn đối chiếu ' . $document->document_number,
            'reference_type' => 'inventory_document',
            'reference_id' => (int) $document->id,
            'parent_document_id' => (int) $document->id,
            'batch_group_key' => $document->batch_group_key,
            'meta' => [
                'managed_by' => self::MANAGED_RETURN_ADJUSTMENT_SOURCE,
                'return_document_id' => (int) $document->id,
                'return_document_number' => $document->document_number,
            ],
            'allow_oversold' => true,
            'items' => $adjustmentItems->all(),
        ];

        if ($existingAdjustmentDocument) {
            return $this->inventoryService->updateDocument(
                $existingAdjustmentDocument,
                'adjustment',
                $payload,
                $accountId,
                $userId
            );
        }

        return $this->inventoryService->createDocument('adjustment', $payload, $accountId, $userId);
    }

    private function findLinkedAdjustmentDocument(InventoryDocument $document, bool $withTrashed = false): ?InventoryDocument
    {
        $query = $withTrashed ? InventoryDocument::withTrashed() : InventoryDocument::query();

        return $query
            ->where('type', 'adjustment')
            ->where('parent_document_id', (int) $document->id)
            ->orderByDesc('id')
            ->first();
    }

    private function loadManagedReturnDocument(InventoryDocument $document, bool $withTrashed = false): InventoryDocument
    {
        $this->ensureManagedReturnLinkTablesExist();

        $query = $withTrashed ? InventoryDocument::withTrashed() : InventoryDocument::query();

        return $query
            ->with([
                'creator:id,name',
                'orderLinks.order:id,order_number,customer_name,customer_phone,status',
                'items' => function ($query) {
                    $query
                        ->with([
                            'product:id,sku,name,cost_price,expected_cost',
                            'orderLinks.order:id,order_number,customer_name,customer_phone',
                        ])
                        ->orderBy('id');
                },
            ])
            ->findOrFail((int) $document->id);
    }

    private function buildManagedReturnDocumentPayload(InventoryDocument $document): array
    {
        $adjustmentDocument = $this->findLinkedAdjustmentDocument($document);
        $orders = $document->orderLinks
            ->map(function (InventoryDocumentOrderLink $link) {
                return [
                    'id' => (int) $link->order_id,
                    'order_number' => $link->order?->order_number,
                    'customer_name' => $link->order?->customer_name,
                    'customer_phone' => $link->order?->customer_phone,
                    'status' => $link->order?->status,
                ];
            })
            ->filter(fn (array $row) => (int) ($row['id'] ?? 0) > 0)
            ->values();

        $products = $document->items
            ->map(function (InventoryDocumentItem $item) {
                $exportedQuantity = (int) (($item->meta['exported_quantity_snapshot'] ?? null) ?? $item->orderLinks->sum('exported_quantity'));
                $actualQuantity = (int) $item->quantity;
                $discrepancyQuantity = (int) (($item->meta['discrepancy_quantity'] ?? null) ?? $item->orderLinks->sum('export_adjustment_quantity'));

                return [
                    'item_id' => (int) $item->id,
                    'product_id' => (int) $item->product_id,
                    'product_name' => $item->product_name_snapshot ?: $item->product?->name ?: "San pham #{$item->product_id}",
                    'product_sku' => $item->product_sku_snapshot ?: $item->product?->sku,
                    'exported_quantity' => $exportedQuantity,
                    'actual_quantity' => $actualQuantity,
                    'discrepancy_quantity' => $discrepancyQuantity,
                    'notes' => $item->notes,
                    'is_extra_product' => (bool) ($item->meta['is_extra_product'] ?? false),
                    'order_breakdown' => $item->orderLinks
                        ->map(function (InventoryDocumentItemOrderLink $link) {
                            return [
                                'order_id' => $link->order_id ? (int) $link->order_id : null,
                                'order_number' => $link->order?->order_number ?? ($link->meta['order_number'] ?? null),
                                'customer_name' => $link->order?->customer_name ?? ($link->meta['customer_name'] ?? null),
                                'exported_quantity' => (int) ($link->exported_quantity ?? 0),
                                'actual_quantity' => (int) ($link->actual_quantity ?? 0),
                                'discrepancy_quantity' => (int) ($link->export_adjustment_quantity ?? 0),
                            ];
                        })
                        ->filter(function (array $row) {
                            return (int) ($row['exported_quantity'] ?? 0) > 0
                                || (int) ($row['actual_quantity'] ?? 0) > 0
                                || (int) ($row['discrepancy_quantity'] ?? 0) !== 0;
                        })
                        ->values()
                        ->all(),
                ];
            })
            ->values();

        return [
            'document' => [
                'id' => (int) $document->id,
                'document_number' => $document->document_number,
                'batch_group_key' => $document->batch_group_key,
                'document_date' => optional($document->document_date)->toDateString(),
                'notes' => $document->notes,
                'created_at' => optional($document->created_at)?->toISOString(),
                'created_by_name' => $document->creator?->name,
                'adjustment_document_id' => $adjustmentDocument?->id,
                'adjustment_document_number' => $adjustmentDocument?->document_number,
            ],
            'orders' => $orders->all(),
            'source_orders' => $orders->all(),
            'summary' => [
                'order_count' => $orders->count(),
                'exported_quantity' => (int) $products->sum('exported_quantity'),
                'actual_quantity' => (int) $products->sum('actual_quantity'),
                'discrepancy_quantity' => (int) $products->sum('discrepancy_quantity'),
                'discrepancy_abs_quantity' => (int) $products->sum(fn (array $row) => abs((int) ($row['discrepancy_quantity'] ?? 0))),
            ],
            'products' => $products->all(),
        ];
    }
}
