<?php

namespace App\Services\Shipping;

use App\Models\InventoryDocument;
use App\Models\Order;
use App\Models\OrderStatus;
use App\Models\OrderStatusLog;
use App\Models\Shipment;
use App\Models\ShipmentStatusLog;
use App\Services\Inventory\InventoryService;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ShipmentRollbackService
{
    private const ROLLBACKABLE_SHIPMENT_STATUSES = [
        'created',
        'waiting_pickup',
        'picked_up',
        'shipped',
        'in_transit',
        'out_for_delivery',
    ];

    private const BLOCKED_ORDER_STATUSES = [
        'completed',
        'pending_return',
        'returned',
        'cancelled',
    ];

    private const SHIPPING_RESET_STATE = [
        'shipment_status' => null,
        'shipping_status' => null,
        'shipping_synced_at' => null,
        'shipping_status_source' => 'manual',
        'shipping_carrier_code' => null,
        'shipping_carrier_name' => null,
        'shipping_tracking_code' => null,
        'shipping_dispatched_at' => null,
        'shipping_issue_code' => null,
        'shipping_issue_message' => null,
        'shipping_issue_detected_at' => null,
    ];

    private const SHIPMENT_STATUS_LABELS = [
        'created' => 'Mới tạo',
        'waiting_pickup' => 'Chờ lấy hàng',
        'picked_up' => 'Đã lấy hàng',
        'shipped' => 'Đã gửi hàng',
        'in_transit' => 'Đang trung chuyển',
        'out_for_delivery' => 'Đang giao hàng',
        'delivered' => 'Giao thành công',
        'delivery_failed' => 'Giao thất bại',
        'returning' => 'Đang hoàn',
        'returned' => 'Đã hoàn',
        'canceled' => 'Đã hủy',
    ];

    public function __construct(
        private readonly InventoryService $inventoryService,
    ) {
    }

    public function cancel(Collection $orders, ?int $userId = null): array
    {
        $results = [];
        $successCount = 0;
        $failedCount = 0;

        foreach ($orders as $order) {
            try {
                $this->cancelOrder($order, $userId);
                $successCount++;
                $results[] = [
                    'order_id' => (int) $order->id,
                    'order_number' => $order->order_number,
                    'success' => true,
                ];
            } catch (ValidationException $exception) {
                $failedCount++;
                $results[] = [
                    'order_id' => (int) $order->id,
                    'order_number' => $order->order_number,
                    'success' => false,
                    'message' => $this->extractValidationMessage($exception),
                ];
            } catch (\Throwable $exception) {
                $failedCount++;
                $results[] = [
                    'order_id' => (int) $order->id,
                    'order_number' => $order->order_number,
                    'success' => false,
                    'message' => $exception->getMessage(),
                ];
            }
        }

        return [
            'success_count' => $successCount,
            'failed_count' => $failedCount,
            'results' => $results,
        ];
    }

    public function cancelOrder(Order $order, ?int $userId = null): Order
    {
        return DB::transaction(function () use ($order, $userId) {
            /** @var Order $lockedOrder */
            $lockedOrder = Order::query()
                ->whereKey($order->id)
                ->lockForUpdate()
                ->firstOrFail();

            $this->ensureOrderCanRollback($lockedOrder);

            $activeShipments = $this->loadActiveShipments($lockedOrder);
            $legacyMarker = $this->hasLegacyDispatchMarker($lockedOrder);

            if ($activeShipments->isEmpty() && !$legacyMarker) {
                throw ValidationException::withMessages([
                    'order' => ['Đơn hàng chưa được gửi vận chuyển nên không thể rollback.'],
                ]);
            }

            $this->ensureOrderHasNoDependentInventoryFlows($lockedOrder);

            foreach ($activeShipments as $shipment) {
                $this->ensureShipmentCanRollback($lockedOrder, $shipment);
            }

            $automaticExportDocuments = $this->loadAutomaticExportDocuments($lockedOrder, $activeShipments);
            foreach ($automaticExportDocuments as $document) {
                $this->inventoryService->deleteDocument($document);
            }

            foreach ($activeShipments as $shipment) {
                $this->cancelShipment($shipment, $userId);
            }

            $targetOrderStatus = $this->resolveRollbackOrderStatus($lockedOrder);
            OrderStatusLog::create([
                'order_id' => $lockedOrder->id,
                'from_status' => $lockedOrder->status,
                'to_status' => $targetOrderStatus,
                'from_shipping_status' => $lockedOrder->shipping_status,
                'to_shipping_status' => null,
                'source' => 'dispatch_cancel',
                'changed_by' => $userId,
                'reason' => $this->buildOrderRollbackReason($activeShipments, $automaticExportDocuments),
            ]);

            $lockedOrder->forceFill(array_merge(
                self::SHIPPING_RESET_STATE,
                [
                    'status' => $targetOrderStatus,
                ]
            ))->save();

            return $lockedOrder->fresh(['activeShipment']);
        });
    }

    private function ensureOrderCanRollback(Order $order): void
    {
        if (!$order->isOfficial()) {
            throw ValidationException::withMessages([
                'order' => ['Chỉ có thể hủy gửi vận chuyển cho đơn hàng chính.'],
            ]);
        }

        if ($order->trashed()) {
            throw ValidationException::withMessages([
                'order' => ['Đơn hàng đang nằm trong thùng rác nên không thể rollback vận chuyển.'],
            ]);
        }

        if ((string) ($order->type ?? '') === 'inventory_export') {
            throw ValidationException::withMessages([
                'order' => ['Phiếu xuất nội bộ không thuộc luồng gửi vận chuyển để rollback.'],
            ]);
        }

        if (in_array((string) $order->status, self::BLOCKED_ORDER_STATUSES, true)) {
            throw ValidationException::withMessages([
                'order' => ["Đơn đang ở trạng thái '{$this->displayOrderStatus($order)}' nên không thể rollback gửi vận chuyển."],
            ]);
        }
    }

    private function ensureOrderHasNoDependentInventoryFlows(Order $order): void
    {
        $counts = InventoryDocument::query()
            ->where('reference_type', 'order')
            ->where('reference_id', (int) $order->id)
            ->whereIn('type', ['return', 'damaged'])
            ->selectRaw('type, COUNT(*) as aggregate')
            ->groupBy('type')
            ->pluck('aggregate', 'type');

        if ($counts->isEmpty()) {
            return;
        }

        $parts = [];
        $returnCount = (int) ($counts->get('return') ?? 0);
        $damagedCount = (int) ($counts->get('damaged') ?? 0);

        if ($returnCount > 0) {
            $parts[] = $returnCount === 1 ? '1 phiếu hoàn kho' : "{$returnCount} phiếu hoàn kho";
        }

        if ($damagedCount > 0) {
            $parts[] = $damagedCount === 1 ? '1 phiếu hàng hỏng' : "{$damagedCount} phiếu hàng hỏng";
        }

        throw ValidationException::withMessages([
            'order' => ["Đơn {$order->order_number} đã phát sinh " . implode(' và ', $parts) . ' nên không thể rollback gửi vận chuyển.'],
        ]);
    }

    private function loadActiveShipments(Order $order): Collection
    {
        return Shipment::query()
            ->where('order_id', (int) $order->id)
            ->whereNull('deleted_at')
            ->whereNotIn('shipment_status', ['canceled'])
            ->orderBy('id')
            ->lockForUpdate()
            ->get();
    }

    private function ensureShipmentCanRollback(Order $order, Shipment $shipment): void
    {
        $status = (string) $shipment->shipment_status;

        if (in_array($status, self::ROLLBACKABLE_SHIPMENT_STATUSES, true)) {
            return;
        }

        $shipmentLabel = $shipment->shipment_number ?: ($shipment->carrier_tracking_code ?: $shipment->tracking_number ?: ('#' . $shipment->id));
        $statusLabel = self::SHIPMENT_STATUS_LABELS[$status] ?? $status;

        throw ValidationException::withMessages([
            'order' => ["Đơn {$order->order_number} không thể hủy gửi vì vận đơn {$shipmentLabel} đang ở trạng thái '{$statusLabel}'."],
        ]);
    }

    private function cancelShipment(Shipment $shipment, ?int $userId = null): void
    {
        ShipmentStatusLog::create([
            'shipment_id' => $shipment->id,
            'from_status' => $shipment->shipment_status,
            'to_status' => 'canceled',
            'changed_by' => $userId,
            'change_source' => 'dispatch_cancel',
            'reason' => 'Hủy gửi vận chuyển từ quản lý đơn hàng',
        ]);

        $shipment->forceFill([
            'status' => 'canceled',
            'shipment_status' => 'canceled',
            'canceled_at' => now(),
        ])->save();

        $shipment->delete();
    }

    private function hasLegacyDispatchMarker(Order $order): bool
    {
        if (filled($order->shipping_tracking_code) || filled($order->shipping_carrier_code) || filled($order->shipping_carrier_name)) {
            return true;
        }

        if ($order->shipping_dispatched_at || filled($order->shipping_status)) {
            return true;
        }

        return false;
    }

    private function loadAutomaticExportDocuments(Order $order, Collection $shipments): Collection
    {
        $markers = $shipments
            ->flatMap(function (Shipment $shipment) {
                return [
                    $shipment->shipment_number,
                    $shipment->tracking_number,
                    $shipment->carrier_tracking_code,
                ];
            })
            ->push($order->shipping_tracking_code)
            ->filter(fn ($value) => filled($value))
            ->map(fn ($value) => trim((string) $value))
            ->unique()
            ->values();

        return InventoryDocument::query()
            ->where('reference_type', 'order')
            ->where('reference_id', (int) $order->id)
            ->where('type', 'export')
            ->whereIn('status', ['draft', 'completed'])
            ->with(['items.allocations.batch'])
            ->get()
            ->filter(fn (InventoryDocument $document) => $this->isAutomaticExportDocument($document, $markers))
            ->values();
    }

    private function isAutomaticExportDocument(InventoryDocument $document, Collection $markers): bool
    {
        $documentNumber = trim((string) $document->document_number);
        if ($documentNumber !== '' && $markers->contains($documentNumber)) {
            return true;
        }

        $normalizedNotes = $this->normalizeAuditText((string) ($document->notes ?? ''));
        if ($normalizedNotes === '') {
            return false;
        }

        if (Str::contains($normalizedNotes, 'tu tao tu van chuyen')) {
            return true;
        }

        return $markers->contains(function (string $marker) use ($normalizedNotes) {
            return Str::contains($normalizedNotes, $this->normalizeAuditText($marker));
        });
    }

    private function resolveRollbackOrderStatus(Order $order): string
    {
        $newStatus = OrderStatus::query()
            ->where('account_id', (int) $order->account_id)
            ->where('code', 'new')
            ->where('is_active', true)
            ->value('code');

        if ($newStatus) {
            return $newStatus;
        }

        $defaultStatus = OrderStatus::query()
            ->where('account_id', (int) $order->account_id)
            ->where('is_default', true)
            ->where('is_active', true)
            ->value('code');

        return $defaultStatus ?: 'new';
    }

    private function buildOrderRollbackReason(Collection $shipments, Collection $documents): string
    {
        $shipmentCount = (int) $shipments->count();
        $documentCount = (int) $documents->count();

        $parts = ['Hủy gửi vận chuyển và đưa đơn về trạng thái Đơn mới'];

        if ($shipmentCount > 0) {
            $parts[] = $shipmentCount === 1
                ? 'đã hủy 1 vận đơn'
                : "đã hủy {$shipmentCount} vận đơn";
        }

        if ($documentCount > 0) {
            $parts[] = $documentCount === 1
                ? 'đã xóa 1 phiếu xuất tự sinh'
                : "đã xóa {$documentCount} phiếu xuất tự sinh";
        }

        return implode(', ', $parts) . '.';
    }

    private function displayOrderStatus(Order $order): string
    {
        $status = (string) $order->status;

        if (!$status) {
            return 'không xác định';
        }

        $name = OrderStatus::query()
            ->where('account_id', (int) $order->account_id)
            ->where('code', $status)
            ->value('name');

        return $name ?: $status;
    }

    private function normalizeAuditText(string $value): string
    {
        return Str::of($value)
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', ' ')
            ->trim()
            ->value();
    }

    private function extractValidationMessage(ValidationException $exception): string
    {
        return collect($exception->errors())
            ->flatten()
            ->filter()
            ->map(fn ($message) => (string) $message)
            ->first() ?: 'Dữ liệu rollback không hợp lệ.';
    }
}
