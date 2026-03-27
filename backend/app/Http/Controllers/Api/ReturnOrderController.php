<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ReturnOrder;
use App\Models\ReturnOrderItem;
use App\Services\ReturnOrderService;
use Illuminate\Http\Request;

class ReturnOrderController extends Controller
{
    public function __construct(
        private readonly ReturnOrderService $returnOrderService,
    ) {
    }

    public function index(Request $request)
    {
        $query = ReturnOrder::query()
            ->select([
                'id',
                'return_number',
                'origin_order_id',
                'status',
                'exchange_date',
                'customer_name',
                'customer_phone',
                'returned_total_quantity',
                'resent_total_quantity',
                'returned_total_amount',
                'resent_total_amount',
                'profit_loss_amount',
                'return_document_id',
                'export_document_id',
                'created_by',
                'created_at',
                'updated_at',
                'notes',
            ])
            ->with([
                'originOrder:id,order_number,customer_name,customer_phone,status,deleted_at',
                'returnDocument:id,document_number,document_date,deleted_at',
                'exportDocument:id,document_number,document_date,deleted_at',
                'creator:id,name',
            ])
            ->withCount([
                'returnedItems as returned_lines_count',
                'resentItems as resent_lines_count',
            ]);

        if ($request->filled('search')) {
            $search = '%' . mb_strtolower(trim((string) $request->input('search'))) . '%';

            $query->where(function ($builder) use ($search) {
                $builder
                    ->whereRaw('LOWER(COALESCE(return_number, \'\')) LIKE ?', [$search])
                    ->orWhereRaw('LOWER(COALESCE(customer_name, \'\')) LIKE ?', [$search])
                    ->orWhereRaw('LOWER(COALESCE(customer_phone, \'\')) LIKE ?', [$search])
                    ->orWhereRaw('LOWER(COALESCE(notes, \'\')) LIKE ?', [$search])
                    ->orWhereHas('originOrder', function ($orderQuery) use ($search) {
                        $orderQuery
                            ->whereRaw('LOWER(COALESCE(order_number, \'\')) LIKE ?', [$search])
                            ->orWhereRaw('LOWER(COALESCE(customer_name, \'\')) LIKE ?', [$search])
                            ->orWhereRaw('LOWER(COALESCE(customer_phone, \'\')) LIKE ?', [$search]);
                    })
                    ->orWhereHas('items', function ($itemQuery) use ($search) {
                        $itemQuery
                            ->whereRaw('LOWER(COALESCE(product_name_snapshot, \'\')) LIKE ?', [$search])
                            ->orWhereRaw('LOWER(COALESCE(product_sku_snapshot, \'\')) LIKE ?', [$search])
                            ->orWhereRaw('LOWER(COALESCE(notes, \'\')) LIKE ?', [$search]);
                    });
            });
        }

        if ($request->filled('status')) {
            $statuses = collect(explode(',', (string) $request->input('status')))
                ->map(fn ($status) => strtolower(trim($status)))
                ->filter()
                ->values()
                ->all();

            if (!empty($statuses)) {
                $query->whereIn('status', $statuses);
            }
        }

        if ($request->filled('date_from')) {
            $query->whereDate('exchange_date', '>=', $request->input('date_from'));
        }

        if ($request->filled('date_to')) {
            $query->whereDate('exchange_date', '<=', $request->input('date_to'));
        }

        $sortMap = [
            'return_number' => 'return_number',
            'exchange_date' => 'exchange_date',
            'customer_name' => 'customer_name',
            'status' => 'status',
            'returned_total_amount' => 'returned_total_amount',
            'resent_total_amount' => 'resent_total_amount',
            'profit_loss_amount' => 'profit_loss_amount',
            'created_at' => 'created_at',
        ];

        $sortBy = $sortMap[(string) $request->input('sort_by', 'created_at')] ?? 'created_at';
        $sortOrder = strtolower((string) $request->input('sort_order', 'desc')) === 'asc' ? 'asc' : 'desc';

        $query
            ->orderBy($sortBy, $sortOrder)
            ->orderBy('id', $sortOrder === 'asc' ? 'asc' : 'desc');

        $perPage = min(max((int) $request->input('per_page', 20), 1), 100);
        $paginator = $query->paginate($perPage);

        $paginator->setCollection(
            $paginator->getCollection()->map(fn (ReturnOrder $returnOrder) => $this->serializeReturnOrder($returnOrder))
        );

        $response = $paginator->toArray();
        $response['status_options'] = ReturnOrder::statusOptions();

        return response()->json($response);
    }

    public function show(int $id)
    {
        return response()->json(
            $this->serializeReturnOrder($this->returnOrderService->loadOrder($id, true), true)
        );
    }

    public function store(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $validated = $request->validate([
            'origin_order_id' => 'nullable|integer|exists:orders,id',
            'exchange_date' => 'required|date',
            'notes' => 'nullable|string|max:5000',
            'customer_name' => 'nullable|string|max:255',
            'customer_phone' => 'nullable|string|max:50',
            'customer_address' => 'nullable|string|max:5000',
            'returned_items' => 'required|array',
            'returned_items.*.product_id' => 'nullable|integer|exists:products,id',
            'returned_items.*.quantity' => 'nullable|integer|min:1',
            'returned_items.*.notes' => 'nullable|string|max:1000',
            'resent_items' => 'required|array',
            'resent_items.*.product_id' => 'nullable|integer|exists:products,id',
            'resent_items.*.quantity' => 'nullable|integer|min:1',
            'resent_items.*.notes' => 'nullable|string|max:1000',
        ]);

        $returnOrder = $this->returnOrderService->create($validated, $accountId, auth()->id());

        return response()->json($this->serializeReturnOrder($returnOrder, true), 201);
    }

    public function updateStatus(Request $request, int $id)
    {
        $validated = $request->validate([
            'status' => 'required|string|in:new,received,shipped,completed,cancelled',
        ]);

        $returnOrder = ReturnOrder::query()->findOrFail($id);
        $updated = $this->returnOrderService->updateStatus($returnOrder, $validated['status']);

        return response()->json($this->serializeReturnOrder($updated, true));
    }

    private function serializeReturnOrder(ReturnOrder $returnOrder, bool $includeItems = false): array
    {
        $statusMeta = ReturnOrder::statusMeta((string) $returnOrder->status);
        $profitLossAmount = round((float) ($returnOrder->profit_loss_amount ?? 0), 2);
        $profitLossDirection = $profitLossAmount > 0 ? 'profit' : ($profitLossAmount < 0 ? 'loss' : 'balanced');
        $profitLossLabel = match ($profitLossDirection) {
            'profit' => 'Lai',
            'loss' => 'Lo',
            default => 'Can bang',
        };

        $payload = [
            'id' => (int) $returnOrder->id,
            'return_number' => $returnOrder->return_number,
            'status' => (string) $returnOrder->status,
            'status_label' => $statusMeta['label'],
            'status_color' => $statusMeta['color'],
            'exchange_date' => optional($returnOrder->exchange_date)->toDateString(),
            'customer_name' => $returnOrder->customer_name,
            'customer_phone' => $returnOrder->customer_phone,
            'customer_address' => $returnOrder->customer_address,
            'notes' => $returnOrder->notes,
            'returned_total_quantity' => (int) ($returnOrder->returned_total_quantity ?? 0),
            'resent_total_quantity' => (int) ($returnOrder->resent_total_quantity ?? 0),
            'returned_total_amount' => round((float) ($returnOrder->returned_total_amount ?? 0), 2),
            'resent_total_amount' => round((float) ($returnOrder->resent_total_amount ?? 0), 2),
            'profit_loss_amount' => $profitLossAmount,
            'profit_loss_direction' => $profitLossDirection,
            'profit_loss_label' => $profitLossLabel,
            'returned_lines_count' => (int) ($returnOrder->returned_lines_count ?? ($returnOrder->relationLoaded('returnedItems') ? $returnOrder->returnedItems->count() : 0)),
            'resent_lines_count' => (int) ($returnOrder->resent_lines_count ?? ($returnOrder->relationLoaded('resentItems') ? $returnOrder->resentItems->count() : 0)),
            'origin_order' => $returnOrder->originOrder ? [
                'id' => (int) $returnOrder->originOrder->id,
                'order_number' => $returnOrder->originOrder->order_number,
                'customer_name' => $returnOrder->originOrder->customer_name,
                'customer_phone' => $returnOrder->originOrder->customer_phone,
                'shipping_address' => $returnOrder->originOrder->shipping_address,
                'status' => $returnOrder->originOrder->status,
                'order_kind' => $returnOrder->originOrder->order_kind,
                'deleted_at' => optional($returnOrder->originOrder->deleted_at)->toISOString(),
            ] : null,
            'return_document' => $returnOrder->returnDocument ? [
                'id' => (int) $returnOrder->returnDocument->id,
                'document_number' => $returnOrder->returnDocument->document_number,
                'document_date' => optional($returnOrder->returnDocument->document_date)->toDateString(),
                'deleted_at' => optional($returnOrder->returnDocument->deleted_at)->toISOString(),
            ] : null,
            'export_document' => $returnOrder->exportDocument ? [
                'id' => (int) $returnOrder->exportDocument->id,
                'document_number' => $returnOrder->exportDocument->document_number,
                'document_date' => optional($returnOrder->exportDocument->document_date)->toDateString(),
                'deleted_at' => optional($returnOrder->exportDocument->deleted_at)->toISOString(),
            ] : null,
            'creator' => $returnOrder->creator ? [
                'id' => (int) $returnOrder->creator->id,
                'name' => $returnOrder->creator->name,
            ] : null,
            'received_at' => optional($returnOrder->received_at)->toISOString(),
            'shipped_at' => optional($returnOrder->shipped_at)->toISOString(),
            'completed_at' => optional($returnOrder->completed_at)->toISOString(),
            'cancelled_at' => optional($returnOrder->cancelled_at)->toISOString(),
            'created_at' => optional($returnOrder->created_at)->toISOString(),
            'updated_at' => optional($returnOrder->updated_at)->toISOString(),
        ];

        if (!$includeItems) {
            return $payload;
        }

        $groupedItems = $returnOrder->items->groupBy('item_group');

        return [
            ...$payload,
            'returned_items' => $this->serializeItems($groupedItems->get(ReturnOrderItem::GROUP_RETURNED, collect())),
            'resent_items' => $this->serializeItems($groupedItems->get(ReturnOrderItem::GROUP_RESENT, collect())),
            'status_options' => ReturnOrder::statusOptions(),
        ];
    }

    private function serializeItems($items): array
    {
        return collect($items)
            ->map(function (ReturnOrderItem $item) {
                return [
                    'id' => (int) $item->id,
                    'item_group' => $item->item_group,
                    'product_id' => $item->product_id ? (int) $item->product_id : null,
                    'product_name_snapshot' => $item->product_name_snapshot,
                    'product_sku_snapshot' => $item->product_sku_snapshot,
                    'quantity' => (int) $item->quantity,
                    'unit_price_snapshot' => round((float) ($item->unit_price_snapshot ?? 0), 2),
                    'line_total_snapshot' => round((float) ($item->line_total_snapshot ?? 0), 2),
                    'unit_cost_snapshot' => round((float) ($item->unit_cost_snapshot ?? 0), 2),
                    'line_cost_snapshot' => round((float) ($item->line_cost_snapshot ?? 0), 2),
                    'notes' => $item->notes,
                    'sort_order' => (int) ($item->sort_order ?? 0),
                    'product' => $item->product ? [
                        'id' => (int) $item->product->id,
                        'sku' => $item->product->sku,
                        'name' => $item->product->name,
                        'price' => round((float) ($item->product->price ?? 0), 2),
                        'stock_quantity' => (int) ($item->product->stock_quantity ?? 0),
                    ] : null,
                ];
            })
            ->values()
            ->all();
    }
}
