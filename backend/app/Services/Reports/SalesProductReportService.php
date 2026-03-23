<?php

namespace App\Services\Reports;

use App\Models\Order;
use App\Models\OrderStatus;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SalesProductReportService
{
    public function build(int $accountId, array $filters = []): array
    {
        [$from, $to] = $this->resolveDateRange($filters);
        $dates = $this->buildDateHeaders($from, $to);
        $perPage = $this->resolvePerPage($filters);
        $currentPage = $this->resolvePage($filters);
        $effectiveStatuses = $this->resolveEffectiveStatuses($accountId, $filters);

        if ($effectiveStatuses === []) {
            return [
                'filters' => [
                    'date_from' => $from->toDateString(),
                    'date_to' => $to->toDateString(),
                    'search' => trim((string) ($filters['search'] ?? '')),
                    'category_ids' => $this->normalizeArrayFilter($filters['category_ids'] ?? $filters['category_id'] ?? []),
                    'product_types' => $this->normalizeArrayFilter($filters['product_types'] ?? $filters['type'] ?? []),
                    'warehouse_ids' => $this->normalizeArrayFilter($filters['warehouse_ids'] ?? []),
                    'status' => [],
                    'page' => $currentPage,
                    'per_page' => $perPage,
                ],
                'dates' => $dates,
                'items' => [],
                'pagination' => [
                    'current_page' => $currentPage,
                    'last_page' => 1,
                    'per_page' => $perPage,
                    'total' => 0,
                    'from' => null,
                    'to' => null,
                ],
                'summary' => [
                    'total_products' => 0,
                    'total_quantity' => 0,
                    'total_net_revenue' => 0,
                    'total_cost_amount' => 0,
                    'range_days' => count($dates),
                ],
                'totals_row' => [
                    'label' => 'Tổng tất cả sản phẩm',
                    'totals' => [
                        'quantity' => 0,
                        'net_revenue' => 0,
                        'cost_amount' => 0,
                    ],
                    'days' => collect($dates)->mapWithKeys(fn (array $date) => [
                        $date['date'] => [
                            'quantity' => 0,
                            'net_revenue' => 0,
                            'cost_amount' => 0,
                        ],
                    ])->all(),
                ],
                'meta' => [
                    'effective_statuses' => [],
                    'available_statuses' => [],
                ],
            ];
        }

        $baseQuery = $this->baseQuery($accountId, $filters, $from, $to, $effectiveStatuses);
        $summaryRows = $this->productSummaryQuery(clone $baseQuery)
            ->get()
            ->map(fn ($row) => $this->normalizeProductSummaryRow($row))
            ->values();

        $pageItems = $summaryRows->forPage($currentPage, $perPage)->values();
        $paginator = new LengthAwarePaginator(
            $pageItems,
            $summaryRows->count(),
            $perPage,
            $currentPage,
            [
                'path' => request()->url(),
                'query' => request()->query(),
            ]
        );

        $totalsByDay = $this->dailyTotalsQuery(clone $baseQuery)
            ->get()
            ->map(fn ($row) => [
                'date' => $row->report_date,
                'quantity' => (int) $row->total_quantity,
                'net_revenue' => round((float) $row->total_net_revenue, 2),
                'cost_amount' => round((float) $row->total_cost_amount, 2),
            ])
            ->keyBy('date');

        $pageDailyRows = $pageItems->isEmpty()
            ? collect()
            : $this->dailyProductQuery($this->applyPageProductFilter(clone $baseQuery, $pageItems))
                ->get()
                ->map(fn ($row) => [
                    'row_key' => $this->composeRowKey(
                        $row->product_id,
                        $row->product_name_snapshot,
                        $row->product_sku_snapshot
                    ),
                    'date' => $row->report_date,
                    'quantity' => (int) $row->total_quantity,
                    'net_revenue' => round((float) $row->total_net_revenue, 2),
                    'cost_amount' => round((float) $row->total_cost_amount, 2),
                ]);

        $dailyByProduct = $pageDailyRows->groupBy('row_key');

        $items = $pageItems->map(function (array $item) use ($dates, $dailyByProduct) {
            $dailyRows = collect($dailyByProduct->get($item['row_key'], []))->keyBy('date');

            return [
                ...$item,
                'days' => collect($dates)->mapWithKeys(function (array $date) use ($dailyRows) {
                    $row = $dailyRows->get($date['date']);

                    return [
                        $date['date'] => [
                            'quantity' => (int) ($row['quantity'] ?? 0),
                            'net_revenue' => round((float) ($row['net_revenue'] ?? 0), 2),
                            'cost_amount' => round((float) ($row['cost_amount'] ?? 0), 2),
                        ],
                    ];
                })->all(),
            ];
        })->values();

        $summary = [
            'total_products' => $summaryRows->count(),
            'total_quantity' => (int) $summaryRows->sum('total_quantity'),
            'total_net_revenue' => round((float) $summaryRows->sum('total_net_revenue'), 2),
            'total_cost_amount' => round((float) $summaryRows->sum('total_cost_amount'), 2),
            'range_days' => count($dates),
        ];

        return [
            'filters' => [
                'date_from' => $from->toDateString(),
                'date_to' => $to->toDateString(),
                'search' => trim((string) ($filters['search'] ?? '')),
                'category_ids' => $this->normalizeArrayFilter($filters['category_ids'] ?? $filters['category_id'] ?? []),
                'product_types' => $this->normalizeArrayFilter($filters['product_types'] ?? $filters['type'] ?? []),
                'warehouse_ids' => $this->normalizeArrayFilter($filters['warehouse_ids'] ?? []),
                'status' => $effectiveStatuses,
                'page' => $currentPage,
                'per_page' => $perPage,
            ],
            'dates' => $dates,
            'items' => $items,
            'pagination' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
                'from' => $paginator->firstItem(),
                'to' => $paginator->lastItem(),
            ],
            'summary' => $summary,
            'totals_row' => [
                'label' => 'Tổng tất cả sản phẩm',
                'totals' => [
                    'quantity' => $summary['total_quantity'],
                    'net_revenue' => $summary['total_net_revenue'],
                    'cost_amount' => $summary['total_cost_amount'],
                ],
                'days' => collect($dates)->mapWithKeys(function (array $date) use ($totalsByDay) {
                    $row = $totalsByDay->get($date['date']);

                    return [
                        $date['date'] => [
                            'quantity' => (int) ($row['quantity'] ?? 0),
                            'net_revenue' => round((float) ($row['net_revenue'] ?? 0), 2),
                            'cost_amount' => round((float) ($row['cost_amount'] ?? 0), 2),
                        ],
                    ];
                })->all(),
            ],
            'meta' => [
                'effective_statuses' => $effectiveStatuses,
                'available_statuses' => $this->validStatusOptions($accountId)->values(),
            ],
        ];
    }

    private function baseQuery(int $accountId, array $filters, Carbon $from, Carbon $to, array $effectiveStatuses)
    {
        $orderGrossSub = DB::table('order_items as summary_items')
            ->selectRaw('summary_items.order_id, SUM(summary_items.price * summary_items.quantity) AS gross_item_revenue')
            ->groupBy('summary_items.order_id');

        $search = trim((string) ($filters['search'] ?? ''));
        $categoryIds = $this->normalizeArrayFilter($filters['category_ids'] ?? $filters['category_id'] ?? []);
        $productTypes = $this->normalizeArrayFilter($filters['product_types'] ?? $filters['type'] ?? []);
        $warehouseIds = $this->normalizeArrayFilter($filters['warehouse_ids'] ?? []);

        return DB::table('order_items')
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->leftJoinSub($orderGrossSub, 'order_gross', fn ($join) => $join->on('order_gross.order_id', '=', 'orders.id'))
            ->leftJoin('products', 'products.id', '=', 'order_items.product_id')
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            ->where('orders.account_id', $accountId)
            ->whereNull('orders.deleted_at')
            ->whereBetween('orders.created_at', [$from->copy()->startOfDay(), $to->copy()->endOfDay()])
            ->whereIn('orders.status', $effectiveStatuses)
            ->when($search !== '', function ($query) use ($search) {
                $query->where(function ($builder) use ($search) {
                    $builder
                        ->where('order_items.product_sku_snapshot', 'like', '%' . $search . '%')
                        ->orWhere('order_items.product_name_snapshot', 'like', '%' . $search . '%')
                        ->orWhere('products.sku', 'like', '%' . $search . '%')
                        ->orWhere('products.name', 'like', '%' . $search . '%')
                        ->orWhere('orders.notes', 'like', '%' . $search . '%');
                });
            })
            ->when($categoryIds !== [], fn ($query) => $query->whereIn('products.category_id', $categoryIds))
            ->when($productTypes !== [], fn ($query) => $query->whereIn('products.type', $productTypes))
            ->when($warehouseIds !== [], function ($query) use ($warehouseIds) {
                $query->whereExists(function ($shipmentQuery) use ($warehouseIds) {
                    $shipmentQuery
                        ->selectRaw('1')
                        ->from('shipments')
                        ->whereColumn('shipments.order_id', 'orders.id')
                        ->whereNull('shipments.deleted_at')
                        ->whereIn('shipments.warehouse_id', $warehouseIds);
                });
            });
    }

    private function productSummaryQuery($baseQuery)
    {
        $netRevenueExpression = $this->netRevenueExpression();

        return $baseQuery
            ->selectRaw('order_items.product_id')
            ->selectRaw('order_items.product_name_snapshot')
            ->selectRaw('order_items.product_sku_snapshot')
            ->selectRaw('COALESCE(products.name, order_items.product_name_snapshot) AS product_name')
            ->selectRaw('COALESCE(products.sku, order_items.product_sku_snapshot) AS product_sku')
            ->selectRaw('products.type AS product_type')
            ->selectRaw('products.category_id AS category_id')
            ->selectRaw("COALESCE(categories.name, 'Chưa phân loại') AS category_name")
            ->selectRaw('SUM(order_items.quantity) AS total_quantity')
            ->selectRaw("ROUND(SUM({$netRevenueExpression}), 2) AS total_net_revenue")
            ->selectRaw('ROUND(SUM(order_items.cost_total), 2) AS total_cost_amount')
            ->groupBy(
                'order_items.product_id',
                'order_items.product_name_snapshot',
                'order_items.product_sku_snapshot',
                'products.name',
                'products.sku',
                'products.type',
                'products.category_id',
                'categories.name'
            )
            ->orderByDesc('total_quantity')
            ->orderBy('product_name');
    }

    private function dailyTotalsQuery($baseQuery)
    {
        $netRevenueExpression = $this->netRevenueExpression();

        return $baseQuery
            ->selectRaw('DATE(orders.created_at) AS report_date')
            ->selectRaw('SUM(order_items.quantity) AS total_quantity')
            ->selectRaw("ROUND(SUM({$netRevenueExpression}), 2) AS total_net_revenue")
            ->selectRaw('ROUND(SUM(order_items.cost_total), 2) AS total_cost_amount')
            ->groupByRaw('DATE(orders.created_at)')
            ->orderBy('report_date');
    }

    private function dailyProductQuery($baseQuery)
    {
        $netRevenueExpression = $this->netRevenueExpression();

        return $baseQuery
            ->selectRaw('order_items.product_id')
            ->selectRaw('order_items.product_name_snapshot')
            ->selectRaw('order_items.product_sku_snapshot')
            ->selectRaw('DATE(orders.created_at) AS report_date')
            ->selectRaw('SUM(order_items.quantity) AS total_quantity')
            ->selectRaw("ROUND(SUM({$netRevenueExpression}), 2) AS total_net_revenue")
            ->selectRaw('ROUND(SUM(order_items.cost_total), 2) AS total_cost_amount')
            ->groupBy(
                'order_items.product_id',
                'order_items.product_name_snapshot',
                'order_items.product_sku_snapshot'
            )
            ->groupByRaw('DATE(orders.created_at)')
            ->orderBy('report_date');
    }

    private function applyPageProductFilter($query, Collection $pageItems)
    {
        return $query->where(function ($builder) use ($pageItems) {
            foreach ($pageItems as $item) {
                $builder->orWhere(function ($productQuery) use ($item) {
                    if (!empty($item['product_id'])) {
                        $productQuery->where('order_items.product_id', $item['product_id']);

                        return;
                    }

                    $productQuery
                        ->whereNull('order_items.product_id')
                        ->where('order_items.product_name_snapshot', $item['product_name_snapshot'])
                        ->where(function ($skuQuery) use ($item) {
                            if (filled($item['product_sku_snapshot'])) {
                                $skuQuery->where('order_items.product_sku_snapshot', $item['product_sku_snapshot']);
                            } else {
                                $skuQuery->whereNull('order_items.product_sku_snapshot')
                                    ->orWhere('order_items.product_sku_snapshot', '');
                            }
                        });
                });
            }
        });
    }

    private function normalizeProductSummaryRow(object $row): array
    {
        $rowKey = $this->composeRowKey(
            $row->product_id,
            $row->product_name_snapshot,
            $row->product_sku_snapshot
        );

        return [
            'row_key' => $rowKey,
            'product_id' => $row->product_id ? (int) $row->product_id : null,
            'product_name' => (string) ($row->product_name ?? $row->product_name_snapshot ?? 'Sản phẩm không xác định'),
            'product_sku' => (string) ($row->product_sku ?? $row->product_sku_snapshot ?? ''),
            'product_type' => $row->product_type ?: 'simple',
            'category_id' => $row->category_id ? (int) $row->category_id : null,
            'category_name' => (string) ($row->category_name ?? 'Chưa phân loại'),
            'product_name_snapshot' => (string) ($row->product_name_snapshot ?? ''),
            'product_sku_snapshot' => (string) ($row->product_sku_snapshot ?? ''),
            'totals' => [
                'quantity' => (int) $row->total_quantity,
                'net_revenue' => round((float) $row->total_net_revenue, 2),
                'cost_amount' => round((float) $row->total_cost_amount, 2),
            ],
            'total_quantity' => (int) $row->total_quantity,
            'total_net_revenue' => round((float) $row->total_net_revenue, 2),
            'total_cost_amount' => round((float) $row->total_cost_amount, 2),
        ];
    }

    private function resolveDateRange(array $filters): array
    {
        $to = !empty($filters['date_to'])
            ? Carbon::parse($filters['date_to'])
            : now();
        $from = !empty($filters['date_from'])
            ? Carbon::parse($filters['date_from'])
            : $to->copy()->subDays(6);

        if ($from->gt($to)) {
            [$from, $to] = [$to->copy(), $from->copy()];
        }

        return [$from->startOfDay(), $to->endOfDay()];
    }

    private function buildDateHeaders(Carbon $from, Carbon $to): array
    {
        return collect(CarbonPeriod::create($from->copy()->startOfDay(), $to->copy()->startOfDay()))
            ->map(function (Carbon $date) {
                return [
                    'date' => $date->toDateString(),
                    'label' => $date->format('d/m'),
                    'weekday' => $date->locale('vi')->translatedFormat('D'),
                    'full_label' => $date->locale('vi')->translatedFormat('D, d/m/Y'),
                ];
            })
            ->values()
            ->all();
    }

    private function resolvePerPage(array $filters): int
    {
        $perPage = (int) ($filters['per_page'] ?? 20);

        return min(max($perPage, 10), 100);
    }

    private function resolvePage(array $filters): int
    {
        $page = (int) ($filters['page'] ?? 1);

        return max($page, 1);
    }

    private function resolveEffectiveStatuses(int $accountId, array $filters): array
    {
        $requested = $this->normalizeArrayFilter($filters['status'] ?? []);
        $validStatuses = $this->validStatusOptions($accountId)->pluck('code')->values()->all();

        if ($requested === []) {
            return $validStatuses;
        }

        return collect($requested)
            ->map(fn ($value) => (string) $value)
            ->intersect($validStatuses)
            ->values()
            ->all();
    }

    private function validStatusOptions(int $accountId): Collection
    {
        $configuredStatuses = OrderStatus::query()
            ->where('account_id', $accountId)
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get(['code', 'name', 'color']);

        if ($configuredStatuses->isNotEmpty()) {
            $validConfigured = $configuredStatuses
                ->reject(fn (OrderStatus $status) => $this->isInvalidStatus($status->code, $status->name))
                ->values();

            if ($validConfigured->isNotEmpty()) {
                return $validConfigured->map(fn (OrderStatus $status) => [
                    'code' => (string) $status->code,
                    'name' => (string) $status->name,
                    'color' => $status->color,
                ]);
            }
        }

        return Order::query()
            ->where('account_id', $accountId)
            ->whereNull('deleted_at')
            ->select('status')
            ->distinct()
            ->get()
            ->reject(fn (Order $order) => $this->isInvalidStatus($order->status, $order->status))
            ->map(fn (Order $order) => [
                'code' => (string) $order->status,
                'name' => (string) Str::headline(str_replace('_', ' ', (string) $order->status)),
                'color' => null,
            ])
            ->values();
    }

    private function isInvalidStatus(?string $code, ?string $name): bool
    {
        $haystack = Str::of(trim(($code ?? '') . ' ' . ($name ?? '')))
            ->ascii()
            ->lower()
            ->value();

        foreach ([
            'cancel',
            'canceled',
            'cancelled',
            'return',
            'returned',
            'returning',
            'pending return',
            'pending_return',
            'draft',
            'nhap',
            'huy',
            'hoan',
            'void',
        ] as $invalidKeyword) {
            if (str_contains($haystack, $invalidKeyword)) {
                return true;
            }
        }

        return false;
    }

    private function normalizeArrayFilter($value): array
    {
        if (is_array($value)) {
            return collect($value)
                ->flatten()
                ->map(fn ($item) => trim((string) $item))
                ->filter(fn ($item) => $item !== '')
                ->values()
                ->all();
        }

        $stringValue = trim((string) $value);
        if ($stringValue === '') {
            return [];
        }

        return collect(explode(',', $stringValue))
            ->map(fn ($item) => trim((string) $item))
            ->filter(fn ($item) => $item !== '')
            ->values()
            ->all();
    }

    private function composeRowKey($productId, ?string $snapshotName, ?string $snapshotSku): string
    {
        if ($productId) {
            return 'product-' . (int) $productId;
        }

        return 'snapshot-' . md5(((string) $snapshotSku) . '|' . ((string) $snapshotName));
    }

    private function netRevenueExpression(): string
    {
        $lineGrossExpression = '(order_items.price * order_items.quantity)';
        $discountAllocationExpression = "CASE
            WHEN COALESCE(order_gross.gross_item_revenue, 0) > 0
                THEN COALESCE(orders.discount, 0) * ({$lineGrossExpression} / order_gross.gross_item_revenue)
            ELSE 0
        END";

        return "({$lineGrossExpression} - {$discountAllocationExpression})";
    }
}
