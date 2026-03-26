<?php

namespace App\Services;

use App\Models\InventoryBatch;
use App\Models\InventoryDocument;
use App\Models\InventoryDocumentItem;
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
                    'items' => ['Cần nhập ít nhất một dòng sản phẩm có số lượng lớn hơn 0.'],
                ]);
            }

            $orderProducts = $this->aggregateOrderProducts($order);
            $productIds = $items->pluck('product_id')->unique()->values()->all();

            foreach ($productIds as $productId) {
                if (!$orderProducts->has($productId)) {
                    throw ValidationException::withMessages([
                        'items' => ["Sản phẩm #{$productId} không thuộc đơn hàng này."],
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
                    $productName = $progress['product_name'] ?? "Sản phẩm #{$item['product_id']}";

                    throw ValidationException::withMessages([
                        'items' => ["{$productName} chỉ còn {$availableQuantity} đơn vị có thể tạo {$label}."],
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
                    'items' => ['Có sản phẩm không còn tồn tại trong hệ thống.'],
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
                            'source_name' => 'Phiếu hoàn đơn hàng',
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
    ): array
    {
        $orderProducts = $this->aggregateOrderProducts($order);
        $counters = [];
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
            if (!array_key_exists($document->type, $slipCounts)) {
                continue;
            }

            $slipCounts[$document->type]++;

            if (!$this->countsTowardProcessing((string) $document->status)) {
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
            ->map(function (array $product) use ($counters, $automaticExportCounters) {
                $counter = $counters[(int) $product['product_id']] ?? [
                    'exported' => 0,
                    'returned' => 0,
                    'damaged' => 0,
                ];

                $requiredQuantity = (int) $product['required_quantity'];
                $manualExportedQuantity = (int) $counter['exported'];
                $automaticExportedQuantity = (int) ($automaticExportCounters[(int) $product['product_id']] ?? 0);
                $exportedQuantity = max($manualExportedQuantity, $automaticExportedQuantity);
                $returnedQuantity = (int) $counter['returned'];
                $damagedQuantity = (int) $counter['damaged'];
                $remainingQuantity = max(0, $requiredQuantity - $exportedQuantity);
                $reversibleQuantity = max(0, $exportedQuantity - $returnedQuantity - $damagedQuantity);

                return [
                    'product_id' => (int) $product['product_id'],
                    'product_name' => $product['product_name'],
                    'product_sku' => $product['product_sku'],
                    'required_quantity' => $requiredQuantity,
                    'manual_exported_quantity' => $manualExportedQuantity,
                    'automatic_exported_quantity' => $automaticExportedQuantity,
                    'exported_quantity' => $exportedQuantity,
                    'returned_quantity' => $returnedQuantity,
                    'damaged_quantity' => $damagedQuantity,
                    'remaining_quantity' => $remainingQuantity,
                    'exportable_quantity' => $remainingQuantity,
                    'reversible_quantity' => $reversibleQuantity,
                ];
            })
            ->values();

        $requiredQuantity = (int) $products->sum('required_quantity');
        $exportedQuantity = (int) $products->sum('exported_quantity');
        $returnedQuantity = (int) $products->sum('returned_quantity');
        $damagedQuantity = (int) $products->sum('damaged_quantity');
        $remainingQuantity = max(0, $requiredQuantity - $exportedQuantity);

        $summary = $this->buildSummaryPayload(
            $requiredQuantity,
            $exportedQuantity,
            $returnedQuantity,
            $damagedQuantity,
            $remainingQuantity,
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

    private function buildSummaryPayload(
        int $requiredQuantity,
        int $exportedQuantity,
        int $returnedQuantity,
        int $damagedQuantity,
        int $remainingQuantity,
        array $slipCounts
    ): array {
        $state = $slipCounts['export'] === 0
            ? 'not_created'
            : ($remainingQuantity > 0 ? 'partial' : 'fulfilled');

        [$label, $tone] = match ($state) {
            'fulfilled' => ['Xuất đủ', 'emerald'],
            'partial' => ['Xuất thiếu', 'amber'],
            default => ['Chưa tạo phiếu', 'slate'],
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
            'export_slip_count' => (int) ($slipCounts['export'] ?? 0),
            'return_slip_count' => (int) ($slipCounts['return'] ?? 0),
            'damaged_slip_count' => (int) ($slipCounts['damaged'] ?? 0),
            'has_return' => (int) ($slipCounts['return'] ?? 0) > 0,
            'has_damaged' => (int) ($slipCounts['damaged'] ?? 0) > 0,
            'quick_summary' => sprintf(
                'Cần %d • Xuất %d • Thiếu %d • Hoàn %d • Hỏng %d',
                $requiredQuantity,
                $exportedQuantity,
                $remainingQuantity,
                $returnedQuantity,
                $damagedQuantity
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
                    'product_name' => $item->product_name_snapshot ?: "Sản phẩm #{$productId}",
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
            'status_label' => 'Đã xuất',
            'status_tone' => 'emerald',
            'notes' => $this->buildAutomaticExportNotes('Tự tạo từ vận chuyển', $trackingNumber, $carrierName),
            'created_by_name' => null,
            'total_quantity' => (int) $items->sum('quantity'),
            'items' => $items->all(),
            'can_delete' => false,
            'source_label' => 'Tự tạo từ vận chuyển',
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
        $sourceLabel = $isManualExportOrder ? 'Phiếu xuất kho tạo tay' : 'Tự tạo từ vận chuyển';
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
            'status_label' => 'Đã xuất',
            'status_tone' => 'emerald',
            'notes' => $this->buildAutomaticExportNotes($sourceLabel, $trackingNumber, $carrierName),
            'created_by_name' => null,
            'total_quantity' => (int) $items->sum('quantity'),
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
            'product_name' => $orderItem->product_name_snapshot ?: "Sản phẩm #{$orderItem->product_id}",
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
            $parts[] = 'Mã vận đơn: ' . $trackingNumber;
        }
        if ($carrierName !== '') {
            $parts[] = 'Đơn vị: ' . $carrierName;
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
                            'product_name_snapshot',
                            'product_sku_snapshot',
                            'quantity',
                            'unit_cost',
                            'total_cost',
                            'unit_price',
                            'total_price',
                            'notes',
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
                            'product_name_snapshot',
                            'product_sku_snapshot',
                            'quantity',
                            'unit_cost',
                            'total_cost',
                            'unit_price',
                            'total_price',
                            'notes',
                        ])
                        ->with('product:id,sku,name')
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
            'draft' => ['Nháp', 'amber'],
            'canceled' => ['Đã hủy', 'slate'],
            default => ['Hoàn tất', 'emerald'],
        };

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
            'total_quantity' => (int) ($document->total_quantity ?: $document->items->sum('quantity')),
            'can_delete' => true,
            'source_label' => null,
            'items' => $document->items->map(function (InventoryDocumentItem $item) {
                return [
                    'id' => (int) $item->id,
                    'product_id' => (int) $item->product_id,
                    'product_name' => $item->product_name_snapshot ?: $item->product?->name ?: "Sản phẩm #{$item->product_id}",
                    'product_sku' => $item->product_sku_snapshot ?: $item->product?->sku,
                    'quantity' => (int) $item->quantity,
                    'unit_cost' => (float) ($item->unit_cost ?? 0),
                    'total_cost' => (float) ($item->total_cost ?? 0),
                    'unit_price' => $item->unit_price !== null ? (float) $item->unit_price : null,
                    'total_price' => $item->total_price !== null ? (float) $item->total_price : null,
                    'notes' => $item->notes,
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
            return ((int) $product['returned_quantity'] + (int) $product['damaged_quantity']) > (int) $product['exported_quantity'];
        });

        if ($invalidProduct) {
            throw ValidationException::withMessages([
                'document' => ["Không thể xóa phiếu xuất vì {$invalidProduct['product_name']} đang có phiếu hoàn/hỏng phụ thuộc vào số lượng đã xuất."],
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
                    'document' => ['Phiếu hoàn này đã phát sinh luồng kho tiếp theo nên không thể xóa.'],
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
                    'document' => ["Không thể xóa phiếu hỏng vì {$product->sku} - {$product->name} đã được xử lý tiếp trong tồn hỏng."],
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
                'type' => ['Loại phiếu kho không hợp lệ.'],
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
}
