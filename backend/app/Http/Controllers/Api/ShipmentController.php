<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Carrier;
use App\Models\Order;
use App\Models\Shipment;
use App\Models\ShipmentItem;
use App\Models\ShipmentNote;
use App\Models\ShipmentStatusLog;
use App\Models\InventoryItem;
use App\Models\ShippingIntegration;
use App\Services\Shipping\ShipmentDispatchService;
use App\Services\Shipping\ShipmentStatusSyncService;
use App\Services\Shipping\ShipmentTransitionGuard;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ShipmentController extends Controller
{
    private ShipmentStatusSyncService $syncService;

    public function __construct(ShipmentStatusSyncService $syncService)
    {
        $this->syncService = $syncService;
    }

    /**
     * Paginated list with advanced filtering
     */
    public function index(Request $request)
    {
        $query = Shipment::with(['order:id,order_number,customer_name,customer_phone,status,total_price,shipping_status,shipping_status_source,shipping_issue_code,shipping_issue_message', 'warehouse:id,name', 'carrier:id,code,name,logo', 'integration:id,carrier_code,carrier_name,connection_status']);

        // Search
        if ($search = $request->search) {
            $query->where(function ($q) use ($search) {
                $q->where('shipment_number', 'like', "%{$search}%")
                  ->orWhere('tracking_number', 'like', "%{$search}%")
                  ->orWhere('carrier_tracking_code', 'like', "%{$search}%")
                  ->orWhere('customer_name', 'like', "%{$search}%")
                  ->orWhere('customer_phone', 'like', "%{$search}%")
                  ->orWhere('order_code', 'like', "%{$search}%");
            });
        }

        // Filters
        if ($request->shipment_status) {
            $statuses = explode(',', $request->shipment_status);
            $query->whereIn('shipment_status', $statuses);
        }
        if ($request->reconciliation_status) {
            $query->where('reconciliation_status', $request->reconciliation_status);
        }
        if ($request->cod_status) {
            $query->where('cod_status', $request->cod_status);
        }
        if ($request->carrier_code) {
            $query->where('carrier_code', $request->carrier_code);
        }
        if ($request->customer_province) {
            $query->where('customer_province', 'like', "%{$request->customer_province}%");
        }
        if ($request->assigned_to) {
            $query->where('assigned_to', $request->assigned_to);
        }
        if ($request->risk_flag) {
            $query->where('risk_flag', $request->risk_flag);
        }

        // Date ranges
        if ($request->created_from) {
            $query->whereDate('created_at', '>=', $request->created_from);
        }
        if ($request->created_to) {
            $query->whereDate('created_at', '<=', $request->created_to);
        }
        if ($request->shipped_from) {
            $query->whereDate('shipped_at', '>=', $request->shipped_from);
        }
        if ($request->shipped_to) {
            $query->whereDate('shipped_at', '<=', $request->shipped_to);
        }

        // COD range
        if ($request->cod_min) {
            $query->where('cod_amount', '>=', $request->cod_min);
        }
        if ($request->cod_max) {
            $query->where('cod_amount', '<=', $request->cod_max);
        }

        // Sorting
        $sortBy = $request->get('sort_by', 'created_at');
        $sortOrder = $request->get('sort_order', 'desc');
        $allowedSorts = ['created_at', 'shipment_number', 'cod_amount', 'shipping_cost', 'shipment_status', 'delivered_at', 'customer_name'];
        if (in_array($sortBy, $allowedSorts)) {
            $query->orderBy($sortBy, $sortOrder);
        } else {
            $query->latest();
        }

        // Include trashed
        if ($request->trashed) {
            $query->onlyTrashed();
        }

        $perPage = $request->get('per_page', 20);
        return response()->json($query->paginate($perPage));
    }

    /**
     * Summary stats for dashboard cards
     */
    public function stats(Request $request)
    {
        $base = Shipment::query();

        $stats = [
            'total' => (clone $base)->count(),
            'in_transit' => (clone $base)->whereIn('shipment_status', ['in_transit', 'out_for_delivery'])->count(),
            'delivered' => (clone $base)->where('shipment_status', 'delivered')->count(),
            'delivery_failed' => (clone $base)->where('shipment_status', 'delivery_failed')->count(),
            'returning' => (clone $base)->whereIn('shipment_status', ['returning', 'returned'])->count(),
            'total_cod' => (clone $base)->sum('cod_amount'),
            'pending_reconciliation' => (clone $base)->where('reconciliation_status', 'pending')->where('shipment_status', 'delivered')->count(),
            'reconciliation_mismatch' => (clone $base)->where('reconciliation_status', 'mismatch')->count(),
            'created_today' => (clone $base)->whereDate('created_at', today())->count(),
            'waiting_pickup' => (clone $base)->where('shipment_status', 'waiting_pickup')->count(),
            // Phase 3: Performance metrics
            'delivery_success_rate' => (function() use ($base) {
                $completed = (clone $base)->whereIn('shipment_status', ['delivered', 'delivery_failed'])->count();
                $delivered = (clone $base)->where('shipment_status', 'delivered')->count();
                return $completed > 0 ? round(($delivered / $completed) * 100, 1) : 0;
            })(),
            'total_cod_collected' => (clone $base)->where('cod_status', 'collected')->sum('cod_amount'),
            'total_mismatch_amount' => (clone $base)->where('reconciliation_status', 'mismatch')->sum(DB::raw('ABS(reconciliation_diff_amount)')),
            'high_risk_count' => (clone $base)->where(function ($q) { $q->where('cod_amount', '>=', 5000000)->orWhere('attempt_delivery_count', '>=', 2)->orWhere('risk_flag', 'high'); })->count(),
            'canceled' => (clone $base)->where('shipment_status', 'canceled')->count(),
        ];

        return response()->json($stats);
    }

    /**
     * Create a new shipment from an order (with auto order sync)
     */
    public function store(Request $request)
    {
        $request->validate([
            'order_id' => 'required|exists:orders,id',
            'carrier_code' => 'nullable|string|max:50',
            'carrier_name' => 'nullable|string',
            'tracking_number' => 'nullable|string',
            'cod_amount' => 'nullable|numeric|min:0',
            'shipping_cost' => 'nullable|numeric|min:0',
            'service_fee' => 'nullable|numeric|min:0',
            'warehouse_id' => 'nullable|exists:warehouses,id',
            'internal_note' => 'nullable|string',
            'items' => 'nullable|array',
        ]);

        return DB::transaction(function () use ($request) {
            $order = Order::with('items')->findOrFail($request->order_id);

            // Generate shipment number
            $today = now()->format('Ymd');
            $count = Shipment::withTrashed()->whereDate('created_at', today())->count() + 1;
            $shipmentNumber = 'VD-' . $today . '-' . str_pad($count, 4, '0', STR_PAD_LEFT);

            // Resolve carrier name from code if not provided
            $carrierName = $request->carrier_name;
            if (!$carrierName && $request->carrier_code) {
                $carrier = Carrier::where('code', $request->carrier_code)->first();
                $carrierName = $carrier ? $carrier->name : $request->carrier_code;
            }

            $codAmount = $request->cod_amount ?? $order->total_price;
            $shippingCost = $request->shipping_cost ?? $order->shipping_fee ?? 0;

            $shipment = Shipment::create([
                'order_id' => $order->id,
                'order_code' => $order->order_number,
                'warehouse_id' => $request->warehouse_id,
                'shipment_number' => $shipmentNumber,
                'tracking_number' => $request->tracking_number,
                'carrier_code' => $request->carrier_code,
                'carrier_name' => $carrierName,
                'carrier_tracking_code' => $request->tracking_number,
                'channel' => 'manual',
                'customer_id' => $order->customer_id,
                'customer_name' => $order->customer_name,
                'customer_phone' => $order->customer_phone,
                'customer_address' => $order->shipping_address,
                'customer_district' => $order->district,
                'customer_ward' => $order->ward,
                'status' => 'created',
                'shipment_status' => 'created',
                'order_status_snapshot' => $order->status,
                'cod_amount' => $codAmount,
                'shipping_cost' => $shippingCost,
                'service_fee' => $request->service_fee ?? 0,
                'actual_received_amount' => $codAmount - $shippingCost - ($request->service_fee ?? 0),
                'internal_note' => $request->internal_note,
                'created_by' => auth()->id(),
            ]);

            // Create shipment items from order items
            if ($request->items && count($request->items) > 0) {
                foreach ($request->items as $item) {
                    ShipmentItem::create([
                        'shipment_id' => $shipment->id,
                        'order_item_id' => $item['order_item_id'],
                        'qty' => $item['qty'],
                    ]);
                }
            } else {
                foreach ($order->items as $orderItem) {
                    ShipmentItem::create([
                        'shipment_id' => $shipment->id,
                        'order_item_id' => $orderItem->id,
                        'qty' => $orderItem->quantity,
                    ]);
                }
            }

            // Log
            ShipmentStatusLog::create([
                'shipment_id' => $shipment->id,
                'from_status' => null,
                'to_status' => 'created',
                'changed_by' => auth()->id(),
                'change_source' => 'manual',
                'reason' => 'Tạo vận đơn mới',
            ]);

            // Auto-sync order status: mark as "confirmed" / shipment created
            $this->syncService->syncOrderFromShipment($shipment, 'system', auth()->id());

            return response()->json($shipment->load(['order', 'items.orderItem.product', 'warehouse']), 201);
        });
    }

    /**
     * Show shipment detail with all relations
     */
    public function show($id)
    {
        $shipment = Shipment::with([
            'order.items.product',
            'order.statusLogs',
            'items.orderItem.product',
            'warehouse',
            'carrier',
            'trackingHistories',
            'reconciliations.reconciledByUser',
            'notes.createdByUser',
            'statusLogs.changedByUser',
            'createdByUser:id,name',
            'assignedToUser:id,name',
        ])->findOrFail($id);

        return response()->json($shipment);
    }

    /**
     * Update shipment status with transition guard and order sync
     */
    public function updateStatus(Request $request, $id)
    {
        $validStatuses = ['created','waiting_pickup','picked_up','in_transit','out_for_delivery','delivered','delivery_failed','returning','returned','canceled'];

        $request->validate([
            'status' => 'required|string|in:' . implode(',', $validStatuses),
            'reason' => 'nullable|string',
            'failed_reason' => 'nullable|string',
            'admin_override' => 'nullable|boolean',
        ]);

        $shipment = Shipment::findOrFail($id);
        $isAdmin = auth()->user()?->is_admin ?? false;
        $isOverride = $request->boolean('admin_override') && $isAdmin;

        $result = $this->syncService->updateShipmentStatus(
            $shipment,
            $request->status,
            'manual',
            auth()->id(),
            $request->reason,
            $request->failed_reason,
            $isOverride
        );

        if (!$result['success']) {
            return response()->json([
                'message' => $result['message'],
                'requires_override' => $result['requires_override'] ?? false,
            ], 422);
        }

        return response()->json([
            'shipment' => $result['shipment']->load(['order', 'carrier']),
            'order_synced' => $result['order_synced'],
            'message' => $result['message'],
        ]);
    }

    /**
     * Update shipment details
     */
    public function update(Request $request, $id)
    {
        $shipment = Shipment::findOrFail($id);

        $fillable = [
            'tracking_number', 'carrier_code', 'carrier_name', 'carrier_tracking_code',
            'cod_amount', 'shipping_cost', 'service_fee', 'return_fee', 'insurance_fee', 'other_fee',
            'internal_note', 'assigned_to', 'priority_level', 'risk_flag',
            'customer_name', 'customer_phone', 'customer_address',
            'customer_ward', 'customer_district', 'customer_province',
        ];

        $data = $request->only($fillable);

        // Recalculate actual_received
        if (isset($data['cod_amount']) || isset($data['shipping_cost']) || isset($data['service_fee']) || isset($data['return_fee']) || isset($data['other_fee'])) {
            $cod = $data['cod_amount'] ?? $shipment->cod_amount;
            $ship = $data['shipping_cost'] ?? $shipment->shipping_cost;
            $svc = $data['service_fee'] ?? $shipment->service_fee;
            $ret = $data['return_fee'] ?? $shipment->return_fee;
            $other = $data['other_fee'] ?? $shipment->other_fee;
            $data['actual_received_amount'] = $cod - $ship - $svc - $ret - $other;
        }

        $shipment->update($data);

        return response()->json($shipment->fresh(['order', 'carrier']));
    }

    /**
     * Add note to a shipment
     */
    public function addNote(Request $request, $id)
    {
        $request->validate([
            'content' => 'required|string',
            'note_type' => 'nullable|string|in:general,internal,warning',
        ]);

        $note = ShipmentNote::create([
            'shipment_id' => $id,
            'content' => $request->content,
            'note_type' => $request->note_type ?? 'general',
            'created_by' => auth()->id(),
        ]);

        return response()->json($note->load('createdByUser'), 201);
    }

    /**
     * Get carriers list
     */
    public function carriers()
    {
        return response()->json(Carrier::where('is_active', true)->orderBy('name')->get());
    }

    /**
     * Bulk status update with sync
     */
    public function bulkUpdateStatus(Request $request)
    {
        $request->validate([
            'ids' => 'required|array|min:1',
            'status' => 'required|string',
            'reason' => 'nullable|string',
        ]);

        $results = ['updated' => 0, 'failed' => 0, 'errors' => []];

        foreach ($request->ids as $id) {
            $shipment = Shipment::find($id);
            if (!$shipment) continue;

            $result = $this->syncService->updateShipmentStatus(
                $shipment,
                $request->status,
                'manual',
                auth()->id(),
                $request->reason ?? 'Cập nhật hàng loạt'
            );

            if ($result['success']) {
                $results['updated']++;
            } else {
                $results['failed']++;
                $results['errors'][] = "VĐ #{$shipment->shipment_number}: {$result['message']}";
            }
        }

        return response()->json($results);
    }

    /**
     * Process carrier webhook/API callback
     */
    public function processCarrierCallback(Request $request)
    {
        $request->validate([
            'shipment_id' => 'required_without:tracking_number',
            'tracking_number' => 'required_without:shipment_id',
            'carrier_code' => 'required|string',
            'raw_status' => 'required|string',
            'raw_payload' => 'nullable|array',
        ]);

        // Find shipment by ID or tracking number
        $shipment = null;
        if ($request->shipment_id) {
            $shipment = Shipment::find($request->shipment_id);
        }
        if (!$shipment && $request->tracking_number) {
            $shipment = Shipment::where('tracking_number', $request->tracking_number)
                ->orWhere('carrier_tracking_code', $request->tracking_number)
                ->first();
        }

        if (!$shipment) {
            return response()->json(['message' => 'Không tìm thấy vận đơn'], 404);
        }

        $result = $this->syncService->processCarrierStatus(
            $shipment,
            $request->raw_status,
            $request->raw_payload
        );

        return response()->json($result, $result['success'] ? 200 : 422);
    }

    /**
     * Mark reconciliation
     */
    public function markReconciled(Request $request, $id)
    {
        $request->validate([
            'reconciled_amount' => 'required|numeric',
            'note' => 'nullable|string',
        ]);

        $shipment = Shipment::findOrFail($id);
        $expected = $shipment->actual_received_amount;
        $actual = $request->reconciled_amount;
        $diff = $actual - $expected;

        $shipment->update([
            'reconciled_amount' => $actual,
            'reconciliation_diff_amount' => $diff,
            'reconciliation_status' => abs($diff) < 1 ? 'reconciled' : 'mismatch',
            'reconciled_at' => now(),
            'last_reconciled_at' => now(),
        ]);

        \App\Models\ShipmentReconciliation::create([
            'shipment_id' => $id,
            'carrier_code' => $shipment->carrier_code,
            'cod_amount' => $shipment->cod_amount,
            'shipping_fee' => $shipment->shipping_cost,
            'service_fee' => $shipment->service_fee,
            'return_fee' => $shipment->return_fee,
            'actual_received_amount' => $actual,
            'system_expected_amount' => $expected,
            'diff_amount' => $diff,
            'status' => abs($diff) < 1 ? 'reconciled' : 'mismatch',
            'note' => $request->note,
            'reconciled_by' => auth()->id(),
            'reconciled_at' => now(),
        ]);

        return response()->json($shipment->fresh());
    }

    /**
     * Soft delete
     */
    public function destroy($id)
    {
        $shipment = Shipment::findOrFail($id);
        $shipment->delete();
        return response()->json(['message' => 'Đã xóa vận đơn']);
    }

    /**
     * Restore
     */
    public function restore($id)
    {
        $shipment = Shipment::withTrashed()->findOrFail($id);
        $shipment->restore();
        return response()->json($shipment);
    }

    public function bulkReconcile(Request $request, ShipmentDispatchService $dispatchService)
    {
        $validated = $request->validate([
            'shipment_ids' => 'required|array|min:1',
            'shipment_ids.*' => 'integer|exists:shipments,id',
        ]);

        $results = [];
        $successCount = 0;
        $failedCount = 0;

        foreach (Shipment::query()->whereIn('id', $validated['shipment_ids'])->get() as $shipment) {
            try {
                $dispatchService->createAutomaticReconciliation($shipment, auth()->id());
                $successCount++;
                $results[] = [
                    'shipment_id' => $shipment->id,
                    'shipment_number' => $shipment->shipment_number,
                    'success' => true,
                ];
            } catch (\Throwable $e) {
                $failedCount++;
                $results[] = [
                    'shipment_id' => $shipment->id,
                    'shipment_number' => $shipment->shipment_number,
                    'success' => false,
                    'message' => $e->getMessage(),
                ];
            }
        }

        return response()->json([
            'success_count' => $successCount,
            'failed_count' => $failedCount,
            'results' => $results,
        ]);
    }

    public function syncCarrierShipments(Request $request)
    {
        $validated = $request->validate([
            'shipment_ids' => 'nullable|array',
            'shipment_ids.*' => 'integer|exists:shipments,id',
            'mode' => 'nullable|string|in:selected,active',
        ]);

        $query = Shipment::query();
        if (($validated['mode'] ?? 'selected') === 'active') {
            $query->whereIn('shipment_status', ['waiting_pickup', 'picked_up', 'in_transit', 'out_for_delivery', 'delivery_failed', 'returning']);
        } elseif (!empty($validated['shipment_ids'])) {
            $query->whereIn('id', $validated['shipment_ids']);
        } else {
            return response()->json(['message' => 'Chưa có vận đơn cần đồng bộ.'], 422);
        }

        $shipments = $query->get();

        return response()->json([
            'message' => 'Danh sách vận đơn đã được refresh từ dữ liệu webhook/API mới nhất.',
            'count' => $shipments->count(),
            'shipments' => $shipments->map(fn ($shipment) => [
                'id' => $shipment->id,
                'shipment_number' => $shipment->shipment_number,
                'shipment_status' => $shipment->shipment_status,
                'last_synced_at' => optional($shipment->last_synced_at)->format('Y-m-d H:i:s'),
            ])->values(),
        ]);
    }

    public function processViettelPostWebhook(Request $request)
    {
        $payload = $request->all();
        $trackingNumber = (string) ($payload['ORDER_NUMBER'] ?? '');
        $orderReference = (string) ($payload['ORDER_REFERENCE'] ?? '');
        $rawStatus = (string) ($payload['ORDER_STATUS'] ?? '');

        if ($trackingNumber === '' || $rawStatus === '') {
            return response()->json(['message' => 'Thiếu ORDER_NUMBER hoặc ORDER_STATUS.'], 422);
        }

        $shipment = Shipment::query()
            ->where(function ($query) use ($trackingNumber, $orderReference) {
                $query->where('tracking_number', $trackingNumber)
                    ->orWhere('carrier_tracking_code', $trackingNumber);

                if ($orderReference !== '') {
                    $query->orWhere('external_order_number', $orderReference)
                        ->orWhere('order_code', $orderReference);
                }
            })
            ->latest('id')
            ->first();

        if (!$shipment) {
            return response()->json(['message' => 'Không tìm thấy vận đơn tương ứng.'], 404);
        }

        $shipment->forceFill([
            'tracking_number' => $shipment->tracking_number ?: $trackingNumber,
            'carrier_tracking_code' => $shipment->carrier_tracking_code ?: $trackingNumber,
            'carrier_status_code' => $rawStatus,
            'carrier_status_text' => 'Webhook ViettelPost',
            'raw_tracking_payload' => $payload,
            'last_webhook_received_at' => now(),
            'cod_amount' => is_numeric($payload['MONEY_COLLECTION'] ?? null) ? (float) $payload['MONEY_COLLECTION'] : $shipment->cod_amount,
            'shipping_cost' => is_numeric($payload['MONEY_TOTAL'] ?? null) ? (float) $payload['MONEY_TOTAL'] : $shipment->shipping_cost,
            'service_fee' => is_numeric($payload['MONEY_FEECOD'] ?? null) ? (float) $payload['MONEY_FEECOD'] : $shipment->service_fee,
            'last_synced_at' => now(),
        ])->save();

        $result = $this->syncService->processCarrierStatus($shipment, $rawStatus, $payload);

        return response()->json([
            'message' => 'Webhook đã được xử lý.',
            'result' => $result,
        ]);
    }
}
