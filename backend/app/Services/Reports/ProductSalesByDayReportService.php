<?php

namespace App\Services\Reports;

use App\Models\Order;
use App\Models\OrderStatus;
use App\Services\OrderInventorySlipService;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ProductSalesByDayReportService
{
    private const CACHE_TTL_SECONDS = 20;

    public function __construct(
        private readonly OrderInventorySlipService $orderInventorySlipService,
    ) {
    }

    public function build(int $accountId, array $filters = []): array
    {
        $normalizedFilters = $this->normalizeFilters($filters);
        [$from, $to] = $this->resolveDateRange($normalizedFilters);
        $dates = $this->buildDateHeaders($from, $to);
        $requestedStatuses = $normalizedFilters['status'];
        $effectiveStatuses = $requestedStatuses !== []
            ? $requestedStatuses
            : $this->resolveEffectiveStatuses($accountId);
        $effectiveStatusOptions = $requestedStatuses !== []
            ? $this->statusOptionsForCodes($accountId, $effectiveStatuses)
            : $this->validStatusOptions($accountId)
                ->whereIn('code', $effectiveStatuses)
                ->values()
                ->all();

        if ($accountId <= 0 || $effectiveStatuses === []) {
            return $this->emptyResponse($normalizedFilters, $from, $to, $dates, $effectiveStatusOptions);
        }

        if (!$normalizedFilters['force_refresh']) {
            $freshFilters = $filters;
            $freshFilters['force_refresh'] = true;

            return Cache::remember(
                $this->reportCacheKey($accountId, $normalizedFilters, $from, $to, $effectiveStatuses),
                now()->addSeconds(self::CACHE_TTL_SECONDS),
                fn () => $this->build($accountId, $freshFilters)
            );
        }

        $dateKeys = collect($dates)->pluck('date')->all();
        $aggregatedRows = $this->aggregatedRowsQuery($accountId, $from, $to, $normalizedFilters, $effectiveStatuses)->get();

        if ($aggregatedRows->isEmpty()) {
            return $this->emptyResponse($normalizedFilters, $from, $to, $dates, $effectiveStatusOptions);
        }

        $totalMetrics = $this->zeroMetric();
        $totalDays = [];
        $leafRows = [];
        $parentRows = [];
        $parentIdsWithChildren = [];

        foreach ($aggregatedRows as $row) {
            $metric = [
                'quantity' => (int) ($row->total_quantity ?? 0),
                'cost_amount' => (float) ($row->total_cost_amount ?? 0),
                'revenue_amount' => (float) ($row->total_revenue_amount ?? 0),
            ];

            $childKey = $this->composeRowKey(
                $row->child_product_id,
                $row->child_product_name_snapshot,
                $row->child_product_sku_snapshot
            );

            if (!isset($leafRows[$childKey])) {
                $leafRows[$childKey] = [
                    'row_key' => $childKey,
                    'row_type' => $row->parent_product_id ? 'child' : 'product',
                    'product_id' => $row->child_product_id ? (int) $row->child_product_id : null,
                    'product_name' => (string) ($row->child_product_name ?: $row->child_product_name_snapshot ?: 'San pham khong xac dinh'),
                    'product_sku' => (string) ($row->child_product_sku ?: $row->child_product_sku_snapshot ?: ''),
                    'parent_product_id' => $row->parent_product_id ? (int) $row->parent_product_id : null,
                    'totals' => $this->zeroMetric(),
                    'days' => [],
                ];
            }

            $this->addMetricToRow($leafRows[$childKey], $row->report_date, $metric);
            $this->addMetric($totalMetrics, $metric);
            $this->addMetricToDayMap($totalDays, $row->report_date, $metric);

            if ($row->parent_product_id) {
                $parentId = (int) $row->parent_product_id;
                $parentKey = $this->parentRowKey($parentId);
                $parentIdsWithChildren[$parentId] = true;

                if (!isset($parentRows[$parentKey])) {
                    $parentRows[$parentKey] = [
                        'row_key' => $parentKey,
                        'row_type' => 'parent',
                        'product_id' => $parentId,
                        'product_name' => (string) ($row->parent_product_name ?: 'San pham cha #' . $parentId),
                        'product_sku' => (string) ($row->parent_product_sku ?: ''),
                        'parent_product_id' => null,
                        'totals' => $this->zeroMetric(),
                        'days' => [],
                        'children' => [],
                    ];
                }

                $this->addMetricToRow($parentRows[$parentKey], $row->report_date, $metric);
            }
        }

        foreach ($parentRows as &$parentRow) {
            $parentRow['children'] = [];
        }
        unset($parentRow);

        $topLevelRows = [];

        foreach ($leafRows as $leafRow) {
            $leafRow['days'] = $this->normalizeDayMetrics($leafRow['days'], $dateKeys);

            if ($leafRow['parent_product_id']) {
                $parentKey = $this->parentRowKey((int) $leafRow['parent_product_id']);
                $parentRows[$parentKey]['children'][] = $leafRow;
                continue;
            }

            $leafProductId = (int) ($leafRow['product_id'] ?? 0);
            if ($leafProductId > 0 && isset($parentIdsWithChildren[$leafProductId])) {
                $parentKey = $this->parentRowKey($leafProductId);
                $this->addMetric($parentRows[$parentKey]['totals'], $leafRow['totals']);
                foreach ($leafRow['days'] as $dateKey => $metric) {
                    $this->addMetricToDayMap($parentRows[$parentKey]['days'], $dateKey, $metric);
                }
                continue;
            }

            $topLevelRows[] = $leafRow;
        }

        foreach ($parentRows as $parentRow) {
            $parentRow['days'] = $this->normalizeDayMetrics($parentRow['days'], $dateKeys);
            $parentRow['children'] = $this->sortRows(collect($parentRow['children']))->values()->all();
            $parentRow['has_children'] = count($parentRow['children']) > 0;
            $parentRow['children_count'] = count($parentRow['children']);
            $topLevelRows[] = $parentRow;
        }

        $sortedTopLevelRows = $this->sortRows(collect($topLevelRows))->values()->all();

        return [
            'filters' => $this->serializeFilters($normalizedFilters, $from, $to),
            'dates' => $dates,
            'summary_row' => [
                'label' => 'Tong cong toan bang',
                'totals' => $this->normalizeMetric($totalMetrics),
                'days' => $this->normalizeDayMetrics($totalDays, $dateKeys),
            ],
            'rows' => $sortedTopLevelRows,
            'summary' => [
                'top_level_count' => count($sortedTopLevelRows),
                'leaf_count' => count($leafRows),
                'total_quantity' => (int) $totalMetrics['quantity'],
                'total_cost_amount' => round((float) $totalMetrics['cost_amount']),
                'total_revenue_amount' => round((float) $totalMetrics['revenue_amount']),
            ],
            'meta' => [
                'effective_statuses' => $effectiveStatusOptions,
                'date_basis' => 'completed_or_created',
            ],
        ];
    }

    private function aggregatedRowsQuery(
        int $accountId,
        Carbon $from,
        Carbon $to,
        array $filters,
        array $effectiveStatuses
    ) {
        $search = $filters['search'];
        $searchContainsLike = $this->containsLike($search);
        $completedAtSubquery = DB::table('order_status_logs')
            ->selectRaw('order_id, MAX(created_at) AS completed_at')
            ->where('to_status', 'completed')
            ->groupBy('order_id');

        $orderGrossSubquery = DB::table('order_items as gross_items')
            ->join('orders as gross_orders', 'gross_orders.id', '=', 'gross_items.order_id')
            ->leftJoinSub($completedAtSubquery, 'gross_completed_logs', function ($join) {
                $join->on('gross_completed_logs.order_id', '=', 'gross_orders.id');
            })
            ->where('gross_orders.account_id', $accountId)
            ->whereNull('gross_orders.deleted_at')
            ->where(function ($kindQuery) {
                $kindQuery
                    ->where('gross_orders.order_kind', Order::KIND_OFFICIAL)
                    ->orWhereNull('gross_orders.order_kind')
                    ->orWhere('gross_orders.order_kind', '');
            })
            ->whereIn('gross_orders.status', $effectiveStatuses)
            ->whereBetween(DB::raw($this->reportDateExpression('gross_completed_logs', 'gross_orders')), [$from->toDateString(), $to->toDateString()])
            ->groupBy('gross_items.order_id')
            ->selectRaw('gross_items.order_id, SUM(gross_items.price * gross_items.quantity) AS gross_item_revenue');

        $reportDateExpression = $this->reportDateExpression('completed_logs', 'orders');
        $revenueExpression = $this->revenueExpression();

        $query = DB::table('order_items')
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->leftJoinSub($completedAtSubquery, 'completed_logs', function ($join) {
                $join->on('completed_logs.order_id', '=', 'orders.id');
            })
            ->leftJoinSub($orderGrossSubquery, 'order_gross', function ($join) {
                $join->on('order_gross.order_id', '=', 'orders.id');
            })
            ->leftJoin('products as child_products', 'child_products.id', '=', 'order_items.product_id')
            ->leftJoin('product_links as variant_links', function ($join) {
                $join->on('variant_links.linked_product_id', '=', 'order_items.product_id')
                    ->where('variant_links.link_type', '=', 'super_link');
            })
            ->leftJoin('products as parent_products', 'parent_products.id', '=', 'variant_links.product_id')
            ->where('orders.account_id', $accountId)
            ->whereNull('orders.deleted_at')
            ->where(function ($kindQuery) {
                $kindQuery
                    ->where('orders.order_kind', Order::KIND_OFFICIAL)
                    ->orWhereNull('orders.order_kind')
                    ->orWhere('orders.order_kind', '');
            })
            ->whereIn('orders.status', $effectiveStatuses)
            ->whereBetween(DB::raw($reportDateExpression), [$from->toDateString(), $to->toDateString()]);

        if ($search !== '') {
            $query->where(function ($searchQuery) use ($searchContainsLike) {
                $this->applyInsensitiveLike($searchQuery, 'orders.order_number', $searchContainsLike);
                $this->applyInsensitiveLike($searchQuery, 'orders.customer_name', $searchContainsLike, true);
                $this->applyInsensitiveLike($searchQuery, 'orders.customer_phone', $searchContainsLike, true);
                $this->applyInsensitiveLike($searchQuery, 'orders.shipping_address', $searchContainsLike, true);
                $this->applyInsensitiveLike($searchQuery, 'orders.notes', $searchContainsLike, true);
                $this->applyInsensitiveLike($searchQuery, 'orders.shipping_tracking_code', $searchContainsLike, true);
                $this->applyInsensitiveLike($searchQuery, 'order_items.product_name_snapshot', $searchContainsLike, true);
                $this->applyInsensitiveLike($searchQuery, 'order_items.product_sku_snapshot', $searchContainsLike, true);
                $this->applyInsensitiveLike($searchQuery, 'child_products.name', $searchContainsLike, true);
                $this->applyInsensitiveLike($searchQuery, 'child_products.sku', $searchContainsLike, true);
                $this->applyInsensitiveLike($searchQuery, 'parent_products.name', $searchContainsLike, true);
                $this->applyInsensitiveLike($searchQuery, 'parent_products.sku', $searchContainsLike, true);
            });
        }

        if ($filters['customer_name'] !== '') {
            $this->applyInsensitiveLike($query, 'orders.customer_name', $this->containsLike($filters['customer_name']));
        }

        if ($filters['order_number'] !== '') {
            $this->applyInsensitiveLike($query, 'orders.order_number', $this->prefixLike($filters['order_number']));
        }

        if ($filters['customer_phone'] !== '') {
            $this->applyInsensitiveLike($query, 'orders.customer_phone', $this->prefixLike($filters['customer_phone']));
        }

        if ($filters['shipping_address'] !== '') {
            $this->applyInsensitiveLike($query, 'orders.shipping_address', $this->containsLike($filters['shipping_address']));
        }

        if ($filters['created_at_from'] !== '') {
            $query->whereDate('orders.created_at', '>=', $filters['created_at_from']);
        }

        if ($filters['created_at_to'] !== '') {
            $query->whereDate('orders.created_at', '<=', $filters['created_at_to']);
        }

        if ($filters['shipping_carrier_code'] !== '') {
            $query->where('orders.shipping_carrier_code', $filters['shipping_carrier_code']);
        }

        if ($filters['shipping_dispatched_from'] !== '') {
            $query->whereDate('orders.shipping_dispatched_at', '>=', $filters['shipping_dispatched_from']);
        }

        if ($filters['shipping_dispatched_to'] !== '') {
            $query->whereDate('orders.shipping_dispatched_at', '<=', $filters['shipping_dispatched_to']);
        }

        if ($filters['export_slip_state'] !== '') {
            $this->orderInventorySlipService->applyExportSlipStateFilter($query, $filters['export_slip_state']);
        }

        if ($filters['return_slip_state'] !== '') {
            $this->orderInventorySlipService->applyReturnSlipStateFilter($query, $filters['return_slip_state']);
        }

        if ($filters['damaged_slip_state'] !== '') {
            $this->orderInventorySlipService->applyDamagedSlipStateFilter($query, $filters['damaged_slip_state']);
        }

        foreach ($filters['attributes'] as $attributeId => $values) {
            $query->whereExists(function ($attributeQuery) use ($attributeId, $values) {
                $attributeQuery
                    ->select(DB::raw(1))
                    ->from('order_attribute_values')
                    ->whereRaw('order_attribute_values.order_id = orders.id')
                    ->where('attribute_id', $attributeId)
                    ->where(function ($valueQuery) use ($values) {
                        foreach ($values as $value) {
                            $this->applyInsensitiveLike($valueQuery, 'value', $this->containsLike($value), true);
                        }
                    });
            });
        }

        $currentUnitCostExpression = $this->currentUnitCostExpression();

        return $query
            ->selectRaw('order_items.product_id AS child_product_id')
            ->selectRaw('order_items.product_name_snapshot AS child_product_name_snapshot')
            ->selectRaw('order_items.product_sku_snapshot AS child_product_sku_snapshot')
            ->selectRaw('COALESCE(child_products.name, order_items.product_name_snapshot) AS child_product_name')
            ->selectRaw('COALESCE(child_products.sku, order_items.product_sku_snapshot) AS child_product_sku')
            ->selectRaw('parent_products.id AS parent_product_id')
            ->selectRaw('parent_products.name AS parent_product_name')
            ->selectRaw('parent_products.sku AS parent_product_sku')
            ->selectRaw($reportDateExpression . ' AS report_date')
            ->selectRaw('SUM(order_items.quantity) AS total_quantity')
            ->selectRaw('ROUND(SUM((' . $currentUnitCostExpression . ') * order_items.quantity), 2) AS total_cost_amount')
            ->selectRaw('ROUND(SUM(' . $revenueExpression . '), 2) AS total_revenue_amount')
            ->groupBy(
                'order_items.product_id',
                'order_items.product_name_snapshot',
                'order_items.product_sku_snapshot',
                'child_products.name',
                'child_products.sku',
                'parent_products.id',
                'parent_products.name',
                'parent_products.sku'
            )
            ->groupByRaw($reportDateExpression)
            ->orderByRaw($reportDateExpression . ' DESC')
            ->orderBy('child_product_name');
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

    private function normalizeFilters(array $filters): array
    {
        $status = collect(is_array($filters['status'] ?? null) ? $filters['status'] : explode(',', (string) ($filters['status'] ?? '')))
            ->map(fn ($value) => trim((string) $value))
            ->filter()
            ->unique()
            ->values()
            ->all();

        $attributes = [];
        foreach ($filters as $key => $value) {
            if (!str_starts_with((string) $key, 'attr_order_')) {
                continue;
            }

            $attributeId = (int) str_replace('attr_order_', '', (string) $key);
            if ($attributeId <= 0) {
                continue;
            }

            $values = collect(is_array($value) ? $value : explode(',', (string) $value))
                ->map(fn ($item) => trim((string) $item))
                ->filter()
                ->unique()
                ->values()
                ->all();

            if ($values !== []) {
                $attributes[$attributeId] = $values;
            }
        }

        return [
            'date_from' => trim((string) ($filters['date_from'] ?? '')),
            'date_to' => trim((string) ($filters['date_to'] ?? '')),
            'search' => trim((string) ($filters['search'] ?? '')),
            'status' => $status,
            'customer_name' => trim((string) ($filters['customer_name'] ?? '')),
            'order_number' => trim((string) ($filters['order_number'] ?? '')),
            'customer_phone' => trim((string) ($filters['customer_phone'] ?? '')),
            'shipping_address' => trim((string) ($filters['shipping_address'] ?? '')),
            'created_at_from' => trim((string) ($filters['created_at_from'] ?? '')),
            'created_at_to' => trim((string) ($filters['created_at_to'] ?? '')),
            'shipping_carrier_code' => trim((string) ($filters['shipping_carrier_code'] ?? '')),
            'export_slip_state' => trim((string) ($filters['export_slip_state'] ?? '')),
            'return_slip_state' => trim((string) ($filters['return_slip_state'] ?? '')),
            'damaged_slip_state' => trim((string) ($filters['damaged_slip_state'] ?? '')),
            'shipping_dispatched_from' => trim((string) ($filters['shipping_dispatched_from'] ?? '')),
            'shipping_dispatched_to' => trim((string) ($filters['shipping_dispatched_to'] ?? '')),
            'attributes' => $attributes,
            'force_refresh' => filter_var($filters['force_refresh'] ?? false, FILTER_VALIDATE_BOOL),
        ];
    }

    private function serializeFilters(array $filters, Carbon $from, Carbon $to): array
    {
        return [
            'date_from' => $from->toDateString(),
            'date_to' => $to->toDateString(),
            'search' => $filters['search'],
            'status' => $filters['status'],
            'customer_name' => $filters['customer_name'],
            'order_number' => $filters['order_number'],
            'customer_phone' => $filters['customer_phone'],
            'shipping_address' => $filters['shipping_address'],
            'created_at_from' => $filters['created_at_from'],
            'created_at_to' => $filters['created_at_to'],
            'shipping_carrier_code' => $filters['shipping_carrier_code'],
            'export_slip_state' => $filters['export_slip_state'],
            'return_slip_state' => $filters['return_slip_state'],
            'damaged_slip_state' => $filters['damaged_slip_state'],
            'shipping_dispatched_from' => $filters['shipping_dispatched_from'],
            'shipping_dispatched_to' => $filters['shipping_dispatched_to'],
            'attributes' => $filters['attributes'],
        ];
    }

    private function usesPostgresSearchDriver(): bool
    {
        return DB::connection()->getDriverName() === 'pgsql';
    }

    private function loweredSearchExpression(string $column): string
    {
        $column = "COALESCE({$column}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(immutable_unaccent({$column}))";
        }

        return "LOWER({$column})";
    }

    private function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }

    private function normalizeSearchText(string $value): string
    {
        return (string) Str::of($value)
            ->lower()
            ->trim();
    }

    private function containsLike(string $value): ?string
    {
        $normalized = $this->normalizeSearchText($value);

        return $normalized === ''
            ? null
            : '%' . $this->escapeLike($normalized) . '%';
    }

    private function prefixLike(string $value): ?string
    {
        $normalized = $this->normalizeSearchText($value);

        return $normalized === ''
            ? null
            : $this->escapeLike($normalized) . '%';
    }

    private function applyInsensitiveLike($query, string $column, ?string $like, bool $or = false): void
    {
        if ($like === null) {
            return;
        }

        $expression = $this->loweredSearchExpression($column);
        $method = $or ? 'orWhereRaw' : 'whereRaw';
        $query->{$method}("{$expression} LIKE ? ESCAPE '\\'", [$like]);
    }

    private function buildDateHeaders(Carbon $from, Carbon $to): array
    {
        return collect(CarbonPeriod::create($from->copy()->startOfDay(), $to->copy()->startOfDay()))
            ->reverse()
            ->map(function (Carbon $date) {
                return [
                    'date' => $date->toDateString(),
                    'label' => $date->format('d/m'),
                    'full_label' => $date->format('d/m/Y'),
                ];
            })
            ->values()
            ->all();
    }

    private function resolveEffectiveStatuses(int $accountId): array
    {
        return $this->validStatusOptions($accountId)
            ->pluck('code')
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

    private function statusOptionsForCodes(int $accountId, array $codes): array
    {
        $normalizedCodes = collect($codes)
            ->map(fn ($code) => trim((string) $code))
            ->filter()
            ->unique()
            ->values();

        if ($normalizedCodes->isEmpty()) {
            return [];
        }

        $configuredStatuses = OrderStatus::query()
            ->where('account_id', $accountId)
            ->whereIn('code', $normalizedCodes->all())
            ->get(['code', 'name', 'color'])
            ->keyBy('code');

        return $normalizedCodes
            ->map(function (string $code) use ($configuredStatuses) {
                $configured = $configuredStatuses->get($code);

                return [
                    'code' => $code,
                    'name' => (string) ($configured?->name ?? Str::headline(str_replace('_', ' ', $code))),
                    'color' => $configured?->color,
                ];
            })
            ->all();
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

    private function reportDateExpression(string $completedAlias, string $ordersAlias): string
    {
        return "DATE(COALESCE({$completedAlias}.completed_at, {$ordersAlias}.created_at))";
    }

    private function currentUnitCostExpression(): string
    {
        return "COALESCE(
            child_products.cost_price,
            child_products.expected_cost,
            order_items.cost_price,
            CASE
                WHEN COALESCE(order_items.quantity, 0) <> 0 THEN order_items.cost_total / order_items.quantity
                ELSE 0
            END,
            0
        )";
    }

    private function revenueExpression(): string
    {
        $lineGrossExpression = '(order_items.price * order_items.quantity)';
        $grossExpression = 'COALESCE(order_gross.gross_item_revenue, 0)';
        $shippingAllocationExpression = "CASE
            WHEN {$grossExpression} > 0
                THEN COALESCE(orders.shipping_fee, 0) * ({$lineGrossExpression} / {$grossExpression})
            ELSE 0
        END";
        $discountAllocationExpression = "CASE
            WHEN {$grossExpression} > 0
                THEN COALESCE(orders.discount, 0) * ({$lineGrossExpression} / {$grossExpression})
            ELSE 0
        END";

        return "({$lineGrossExpression} + {$shippingAllocationExpression} - {$discountAllocationExpression})";
    }

    private function addMetricToRow(array &$row, string $dateKey, array $metric): void
    {
        $this->addMetric($row['totals'], $metric);
        $this->addMetricToDayMap($row['days'], $dateKey, $metric);
    }

    private function addMetricToDayMap(array &$dayMap, string $dateKey, array $metric): void
    {
        if (!isset($dayMap[$dateKey])) {
            $dayMap[$dateKey] = $this->zeroMetric();
        }

        $this->addMetric($dayMap[$dateKey], $metric);
    }

    private function addMetric(array &$target, array $metric): void
    {
        $target['quantity'] += (int) ($metric['quantity'] ?? 0);
        $target['cost_amount'] += (float) ($metric['cost_amount'] ?? 0);
        $target['revenue_amount'] += (float) ($metric['revenue_amount'] ?? 0);
    }

    private function normalizeDayMetrics(array $days, array $dateKeys): array
    {
        $normalized = [];

        foreach ($dateKeys as $dateKey) {
            $normalized[$dateKey] = $this->normalizeMetric($days[$dateKey] ?? $this->zeroMetric());
        }

        return $normalized;
    }

    private function normalizeMetric(array $metric): array
    {
        return [
            'quantity' => (int) ($metric['quantity'] ?? 0),
            'cost_amount' => round((float) ($metric['cost_amount'] ?? 0)),
            'revenue_amount' => round((float) ($metric['revenue_amount'] ?? 0)),
        ];
    }

    private function zeroMetric(): array
    {
        return [
            'quantity' => 0,
            'cost_amount' => 0.0,
            'revenue_amount' => 0.0,
        ];
    }

    private function sortRows(Collection $rows): Collection
    {
        return $rows
            ->sort(function (array $left, array $right) {
                $quantityComparison = ($right['totals']['quantity'] ?? 0) <=> ($left['totals']['quantity'] ?? 0);
                if ($quantityComparison !== 0) {
                    return $quantityComparison;
                }

                $revenueComparison = ($right['totals']['revenue_amount'] ?? 0) <=> ($left['totals']['revenue_amount'] ?? 0);
                if ($revenueComparison !== 0) {
                    return $revenueComparison;
                }

                return strcasecmp(
                    trim(($left['product_sku'] ?? '') . ' ' . ($left['product_name'] ?? '')),
                    trim(($right['product_sku'] ?? '') . ' ' . ($right['product_name'] ?? ''))
                );
            })
            ->values();
    }

    private function composeRowKey($productId, ?string $snapshotName, ?string $snapshotSku): string
    {
        if ($productId) {
            return 'product-' . (int) $productId;
        }

        return 'snapshot-' . md5(((string) $snapshotSku) . '|' . ((string) $snapshotName));
    }

    private function parentRowKey(int $productId): string
    {
        return 'parent-' . $productId;
    }

    private function reportCacheKey(
        int $accountId,
        array $filters,
        Carbon $from,
        Carbon $to,
        array $effectiveStatuses
    ): string {
        $cacheableFilters = $filters;
        unset($cacheableFilters['force_refresh']);

        if (!empty($cacheableFilters['attributes'])) {
            ksort($cacheableFilters['attributes']);

            foreach ($cacheableFilters['attributes'] as &$values) {
                sort($values);
            }
            unset($values);
        }

        return 'reports:product-sales-by-day:' . md5(json_encode([
            'account_id' => $accountId,
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'filters' => $cacheableFilters,
            'effective_statuses' => array_values($effectiveStatuses),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    private function emptyResponse(array $filters, Carbon $from, Carbon $to, array $dates, array $effectiveStatuses): array
    {
        $dateKeys = collect($dates)->pluck('date')->all();

        return [
            'filters' => $this->serializeFilters($filters, $from, $to),
            'dates' => $dates,
            'summary_row' => [
                'label' => 'Tong cong toan bang',
                'totals' => $this->normalizeMetric($this->zeroMetric()),
                'days' => $this->normalizeDayMetrics([], $dateKeys),
            ],
            'rows' => [],
            'summary' => [
                'top_level_count' => 0,
                'leaf_count' => 0,
                'total_quantity' => 0,
                'total_cost_amount' => 0,
                'total_revenue_amount' => 0,
            ],
            'meta' => [
                'effective_statuses' => $effectiveStatuses,
                'date_basis' => 'completed_or_created',
            ],
        ];
    }
}
