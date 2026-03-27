<?php

namespace App\Services;

use App\Models\InventoryDocument;
use App\Models\Order;
use App\Models\Product;
use App\Models\ReturnOrder;
use App\Models\ReturnOrderItem;
use App\Services\Inventory\InventoryService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ReturnOrderService
{
    public function __construct(
        private readonly InventoryService $inventoryService,
    ) {
    }

    public function create(array $payload, int $accountId, ?int $userId = null): ReturnOrder
    {
        return DB::transaction(function () use ($payload, $accountId, $userId) {
            $exchangeDate = Carbon::parse($payload['exchange_date'] ?? now());
            $originOrder = $this->resolveOriginOrder($payload['origin_order_id'] ?? null);
            $returnedItems = $this->prepareItems($payload['returned_items'] ?? [], ReturnOrderItem::GROUP_RETURNED);
            $resentItems = $this->prepareItems($payload['resent_items'] ?? [], ReturnOrderItem::GROUP_RESENT);

            if ($returnedItems->isEmpty() && $resentItems->isEmpty()) {
                throw ValidationException::withMessages([
                    'items' => ['Don doi tra can co it nhat 1 dong hang tra ve hoac gui lai.'],
                ]);
            }

            $returnOrder = ReturnOrder::query()->create([
                'account_id' => $accountId,
                'return_number' => 'TMP-' . Str::uuid()->toString(),
                'origin_order_id' => $originOrder?->id,
                'status' => ReturnOrder::STATUS_NEW,
                'exchange_date' => $exchangeDate->toDateString(),
                'customer_name' => $payload['customer_name'] ?? $originOrder?->customer_name,
                'customer_phone' => $payload['customer_phone'] ?? $originOrder?->customer_phone,
                'customer_address' => $payload['customer_address'] ?? $originOrder?->shipping_address,
                'notes' => $payload['notes'] ?? null,
                'created_by' => $userId,
            ]);

            $returnOrder->forceFill([
                'return_number' => $this->buildReturnNumber($exchangeDate, (int) $returnOrder->id),
            ])->save();

            foreach ($returnedItems as $item) {
                $returnOrder->items()->create([
                    'account_id' => $accountId,
                    ...$item,
                ]);
            }

            foreach ($resentItems as $item) {
                $returnOrder->items()->create([
                    'account_id' => $accountId,
                    ...$item,
                ]);
            }

            $returnDocument = $returnedItems->isNotEmpty()
                ? $this->inventoryService->createDocument(
                    'return',
                    $this->returnDocumentPayload($returnOrder, $returnedItems, $exchangeDate),
                    $accountId,
                    $userId
                )
                : null;

            $exportDocument = $resentItems->isNotEmpty()
                ? $this->inventoryService->createDocument(
                    'export',
                    $this->exportDocumentPayload($returnOrder, $resentItems, $exchangeDate),
                    $accountId,
                    $userId
                )
                : null;

            $totals = $this->summarizeItems($returnedItems, $resentItems);

            $returnOrder->forceFill([
                'returned_total_quantity' => $totals['returned_total_quantity'],
                'resent_total_quantity' => $totals['resent_total_quantity'],
                'returned_total_amount' => $totals['returned_total_amount'],
                'resent_total_amount' => $totals['resent_total_amount'],
                'profit_loss_amount' => $totals['profit_loss_amount'],
                'return_document_id' => $returnDocument?->id,
                'export_document_id' => $exportDocument?->id,
            ])->save();

            return $this->loadOrder((int) $returnOrder->id, true);
        });
    }

    public function updateStatus(ReturnOrder $returnOrder, string $status): ReturnOrder
    {
        $status = $this->normalizeStatus($status);

        return DB::transaction(function () use ($returnOrder, $status) {
            $returnOrder = $this->loadOrder((int) $returnOrder->id, true);
            $wasCancelled = (string) $returnOrder->status === ReturnOrder::STATUS_CANCELLED;

            if ($status === ReturnOrder::STATUS_CANCELLED && !$wasCancelled) {
                $this->cancelLinkedDocuments($returnOrder);
            }

            if ($status !== ReturnOrder::STATUS_CANCELLED && $wasCancelled) {
                $this->restoreLinkedDocuments($returnOrder);
            }

            $now = now();
            $updates = ['status' => $status];

            if (in_array($status, [ReturnOrder::STATUS_RECEIVED, ReturnOrder::STATUS_COMPLETED], true) && $returnOrder->received_at === null) {
                $updates['received_at'] = $now;
            }

            if (in_array($status, [ReturnOrder::STATUS_SHIPPED, ReturnOrder::STATUS_COMPLETED], true) && $returnOrder->shipped_at === null) {
                $updates['shipped_at'] = $now;
            }

            if ($status === ReturnOrder::STATUS_COMPLETED && $returnOrder->completed_at === null) {
                $updates['completed_at'] = $now;
            }

            if ($status === ReturnOrder::STATUS_CANCELLED && $returnOrder->cancelled_at === null) {
                $updates['cancelled_at'] = $now;
            }

            $returnOrder->forceFill($updates)->save();

            return $this->loadOrder((int) $returnOrder->id, true);
        });
    }

    public function loadOrder(int $id, bool $withTrashedDocuments = false): ReturnOrder
    {
        $query = ReturnOrder::query()
            ->with([
                'originOrder:id,order_number,customer_name,customer_phone,shipping_address,status,order_kind,created_at,deleted_at',
                'items.product:id,sku,name,price,cost_price,expected_cost,stock_quantity,deleted_at',
                'creator:id,name',
            ]);

        if ($withTrashedDocuments) {
            $query->with([
                'returnDocument' => fn ($builder) => $builder->withTrashed(),
                'exportDocument' => fn ($builder) => $builder->withTrashed(),
            ]);
        } else {
            $query->with(['returnDocument', 'exportDocument']);
        }

        return $query->findOrFail($id);
    }

    private function resolveOriginOrder(mixed $originOrderId): ?Order
    {
        $originOrderId = (int) $originOrderId;

        if ($originOrderId <= 0) {
            return null;
        }

        return Order::withTrashed()->findOrFail($originOrderId);
    }

    private function prepareItems(array $rawItems, string $group): Collection
    {
        $items = collect($rawItems)
            ->map(function ($item, int $index) {
                return [
                    'index' => $index,
                    'product_id' => (int) ($item['product_id'] ?? 0),
                    'quantity' => (int) ($item['quantity'] ?? 0),
                    'notes' => filled($item['notes'] ?? null) ? trim((string) $item['notes']) : null,
                ];
            })
            ->filter(fn (array $item) => $item['product_id'] > 0 && $item['quantity'] > 0)
            ->values();

        if ($items->isEmpty()) {
            return collect();
        }

        $products = Product::query()
            ->whereIn('id', $items->pluck('product_id')->unique()->values()->all())
            ->lockForUpdate()
            ->get()
            ->keyBy('id');

        if ($products->count() !== $items->pluck('product_id')->unique()->count()) {
            throw ValidationException::withMessages([
                'items' => ['Co san pham trong don doi tra khong ton tai hoac khong thuoc cua hang hien tai.'],
            ]);
        }

        return $items->map(function (array $item) use ($products, $group) {
            /** @var Product $product */
            $product = $products->get($item['product_id']);
            $unitPrice = round((float) ($product->current_price ?? $product->price ?? 0), 2);
            $unitCost = round((float) ($product->cost_price ?? $product->expected_cost ?? 0), 2);
            $quantity = (int) $item['quantity'];

            return [
                'item_group' => $group,
                'product_id' => (int) $product->id,
                'product_name_snapshot' => (string) $product->name,
                'product_sku_snapshot' => $product->sku,
                'quantity' => $quantity,
                'unit_price_snapshot' => $unitPrice,
                'line_total_snapshot' => round($unitPrice * $quantity, 2),
                'unit_cost_snapshot' => $unitCost,
                'line_cost_snapshot' => round($unitCost * $quantity, 2),
                'notes' => $item['notes'],
                'sort_order' => ((int) $item['index']) + 1,
            ];
        });
    }

    private function summarizeItems(Collection $returnedItems, Collection $resentItems): array
    {
        $returnedTotal = round((float) $returnedItems->sum('line_total_snapshot'), 2);
        $resentTotal = round((float) $resentItems->sum('line_total_snapshot'), 2);

        return [
            'returned_total_quantity' => (int) $returnedItems->sum('quantity'),
            'resent_total_quantity' => (int) $resentItems->sum('quantity'),
            'returned_total_amount' => $returnedTotal,
            'resent_total_amount' => $resentTotal,
            'profit_loss_amount' => round($returnedTotal - $resentTotal, 2),
        ];
    }

    private function returnDocumentPayload(ReturnOrder $returnOrder, Collection $items, Carbon $exchangeDate): array
    {
        return [
            'document_date' => $exchangeDate->toDateString(),
            'reference_type' => 'return_order',
            'reference_id' => $returnOrder->id,
            'notes' => $this->buildDocumentNotes($returnOrder, 'Khach tra hang ve'),
            'meta' => [
                'managed_by' => 'return_order',
                'flow' => 'customer_return',
                'return_order_id' => (int) $returnOrder->id,
                'return_order_number' => $returnOrder->return_number,
            ],
            'items' => $items->map(fn (array $item) => [
                'product_id' => $item['product_id'],
                'quantity' => $item['quantity'],
                'notes' => $item['notes'],
                'unit_cost' => $item['unit_cost_snapshot'],
            ])->values()->all(),
        ];
    }

    private function exportDocumentPayload(ReturnOrder $returnOrder, Collection $items, Carbon $exchangeDate): array
    {
        return [
            'document_date' => $exchangeDate->toDateString(),
            'reference_type' => 'return_order',
            'reference_id' => $returnOrder->id,
            'notes' => $this->buildDocumentNotes($returnOrder, 'Gui hang lai cho khach'),
            'meta' => [
                'managed_by' => 'return_order',
                'flow' => 'resend_to_customer',
                'return_order_id' => (int) $returnOrder->id,
                'return_order_number' => $returnOrder->return_number,
            ],
            'items' => $items->map(fn (array $item) => [
                'product_id' => $item['product_id'],
                'quantity' => $item['quantity'],
                'notes' => $item['notes'],
                'unit_price' => $item['unit_price_snapshot'],
            ])->values()->all(),
        ];
    }

    private function buildDocumentNotes(ReturnOrder $returnOrder, string $prefix): string
    {
        return trim(sprintf(
            '%s - %s%s',
            $prefix,
            $returnOrder->return_number,
            filled($returnOrder->notes) ? ' | ' . $returnOrder->notes : ''
        ));
    }

    private function buildReturnNumber(Carbon $exchangeDate, int $id): string
    {
        return sprintf('DTR%s%05d', $exchangeDate->format('ymd'), $id);
    }

    private function normalizeStatus(string $status): string
    {
        $normalized = strtolower(trim($status));

        if (!in_array($normalized, ReturnOrder::STATUSES, true)) {
            throw ValidationException::withMessages([
                'status' => ['Trang thai don doi tra khong hop le.'],
            ]);
        }

        return $normalized;
    }

    private function cancelLinkedDocuments(ReturnOrder $returnOrder): void
    {
        foreach ($this->linkedDocuments($returnOrder) as $document) {
            if ($document->trashed()) {
                continue;
            }

            $this->inventoryService->deleteDocument($document);
        }
    }

    private function restoreLinkedDocuments(ReturnOrder $returnOrder): void
    {
        foreach ($this->linkedDocuments($returnOrder) as $document) {
            if (!$document->trashed()) {
                continue;
            }

            $this->inventoryService->restoreDocument($document);
        }
    }

    private function linkedDocuments(ReturnOrder $returnOrder): Collection
    {
        return collect([
            $returnOrder->returnDocument,
            $returnOrder->exportDocument,
        ])->filter(fn ($document) => $document instanceof InventoryDocument)->values();
    }
}
