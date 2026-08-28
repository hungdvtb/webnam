<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\InventoryItem;
use App\Models\SiteAnalyticsEvent;
use App\Services\Reports\ProductSalesByDayReportService;
use App\Services\Reports\SalesProductReportService;
use App\Support\InventoryQuantity;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ReportController extends Controller
{
    private const DASHBOARD_REVENUE_STATUS_SCOPE = 'all';

    public function salesProductMatrix(Request $request, SalesProductReportService $salesProductReportService)
    {
        $validated = $request->validate([
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date',
            'search' => 'nullable|string|max:255',
            'category_ids' => 'nullable',
            'product_types' => 'nullable',
            'warehouse_ids' => 'nullable',
            'status' => 'nullable',
            'page' => 'nullable|integer|min:1',
            'per_page' => 'nullable|integer|min:10|max:100',
        ]);

        return response()->json(
            $salesProductReportService->build(
                (int) $request->header('X-Account-Id'),
                $validated
            )
        );
    }

    public function productSalesByDay(Request $request, ProductSalesByDayReportService $productSalesByDayReportService)
    {
        $validated = $request->validate([
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date',
            'search' => 'nullable|string|max:255',
            'product_id' => 'nullable|integer|min:1',
            'force_refresh' => 'nullable|boolean',
            'status' => 'nullable',
            'customer_name' => 'nullable|string|max:255',
            'order_number' => 'nullable|string|max:255',
            'customer_phone' => 'nullable|string|max:50',
            'shipping_address' => 'nullable|string|max:255',
            'created_at_from' => 'nullable|date',
            'created_at_to' => 'nullable|date',
            'shipping_carrier_code' => 'nullable|string|max:100',
            'export_slip_state' => 'nullable|string|max:50',
            'return_slip_state' => 'nullable|string|max:50',
            'damaged_slip_state' => 'nullable|string|max:50',
            'shipping_dispatched_from' => 'nullable|date',
            'shipping_dispatched_to' => 'nullable|date',
        ]);

        foreach ($request->all() as $key => $value) {
            if (str_starts_with((string) $key, 'attr_order_')) {
                $validated[$key] = $value;
            }
        }

        return response()->json(
            $productSalesByDayReportService->build(
                (int) $request->header('X-Account-Id'),
                $validated
            )
        );
    }

    public function dashboardSummary(Request $request)
    {
        $validated = $request->validate([
            'month' => 'nullable|integer|min:1|max:12',
            'year' => 'nullable|integer|min:2000|max:2100',
        ]);

        $accountId = (int) $request->header('X-Account-Id');
        $now = now();
        $selectedMonth = (int) ($validated['month'] ?? $now->month);
        $selectedYear = (int) ($validated['year'] ?? $now->year);

        $todayStart = $now->copy()->startOfDay();
        $todayEnd = $now->copy()->endOfDay();
        $currentMonthStart = $now->copy()->startOfMonth();
        $currentMonthEnd = $now->copy()->endOfMonth();
        $selectedMonthStart = Carbon::create($selectedYear, $selectedMonth, 1, 0, 0, 0, $now->getTimezone())->startOfMonth();
        $selectedMonthEnd = $selectedMonthStart->copy()->endOfMonth();
        $selectedYearStart = Carbon::create($selectedYear, 1, 1, 0, 0, 0, $now->getTimezone())->startOfYear();
        $selectedYearEnd = $selectedYearStart->copy()->endOfYear();

        $dashboardRevenueOrders = $this->dashboardRevenueOrdersQuery($accountId);

        $todaySummary = $this->aggregateRevenueStats(
            (clone $dashboardRevenueOrders)->whereBetween('officialized_at', [$todayStart, $todayEnd])
        );

        $currentMonthSummary = $this->aggregateRevenueStats(
            (clone $dashboardRevenueOrders)->whereBetween('officialized_at', [$currentMonthStart, $currentMonthEnd])
        );

        $dailySeries = $this->buildDailyRevenueSeries(
            (clone $dashboardRevenueOrders),
            $selectedMonthStart,
            $selectedMonthEnd,
            $now
        );

        $monthlySeries = $this->buildMonthlyRevenueSeries(
            (clone $dashboardRevenueOrders),
            $selectedYearStart,
            $selectedYearEnd,
            $now
        );

        $lowStockCount = InventoryItem::whereHas('product', function($q) use ($accountId) {
                $q->where('account_id', $accountId);
            })
            ->whereColumn('qty', '<', 'low_stock_threshold')
            ->count();

        $availableYears = $this->resolveAvailableYears(
            (clone $dashboardRevenueOrders),
            $now->year,
            $selectedYear
        );

        return response()->json([
            'sales_today' => $todaySummary['revenue'],
            'orders_today' => $todaySummary['orders_count'],
            'low_stock_alerts' => $lowStockCount,
            'summary' => [
                'today' => [
                    'label' => $todayStart->format('d/m/Y'),
                    'revenue' => $todaySummary['revenue'],
                    'orders_count' => $todaySummary['orders_count'],
                    'average_order_value' => $todaySummary['average_order_value'],
                ],
                'current_month' => [
                    'label' => $currentMonthStart->format('m/Y'),
                    'revenue' => $currentMonthSummary['revenue'],
                    'orders_count' => $currentMonthSummary['orders_count'],
                    'average_order_value' => $currentMonthSummary['average_order_value'],
                ],
            ],
            'filters' => [
                'selected_month' => $selectedMonth,
                'selected_year' => $selectedYear,
                'available_years' => $availableYears,
            ],
            'charts' => [
                'daily_in_month' => [
                    'label' => $selectedMonthStart->format('m/Y'),
                    'total_revenue' => $dailySeries['total_revenue'],
                    'total_orders' => $dailySeries['total_orders'],
                    'series' => $dailySeries['series'],
                ],
                'monthly_in_year' => [
                    'label' => (string) $selectedYear,
                    'total_revenue' => $monthlySeries['total_revenue'],
                    'total_orders' => $monthlySeries['total_orders'],
                    'series' => $monthlySeries['series'],
                ],
            ],
            'meta' => [
                'generated_at' => $now->toIso8601String(),
                'revenue_logic' => [
                    'status' => self::DASHBOARD_REVENUE_STATUS_SCOPE,
                    'order_kind' => Order::KIND_OFFICIAL,
                    'order_type' => Order::STANDARD_REVENUE_TYPES,
                    'date_field' => 'officialized_at',
                    'amount_field' => 'report_revenue_total',
                    'amount_field_fallback' => 'total_price',
                ],
            ],
        ]);
    }

    public function inventoryReport(Request $request)
    {
        $accountId = $request->header('X-Account-Id');

        $inventory = InventoryItem::whereHas('product', function($q) use ($accountId) {
                $q->where('account_id', $accountId);
            })
            ->with(['product', 'warehouse'])
            ->get();

        return response()->json($inventory);
    }

    public function topSellingProducts(Request $request)
    {
        $accountId = $request->header('X-Account-Id');

        $products = DB::table('order_items')
            ->join('products', 'order_items::order_items.product_id', '=', 'products.id')
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->where('orders.account_id', $accountId)
            ->where('orders.status', 'completed')
            ->select('products.name', 'products.sku', DB::raw('SUM(order_items.quantity) as total_qty'), DB::raw('SUM(order_items.price * order_items.quantity) as total_revenue'))
            ->groupBy('products.id', 'products.name', 'products.sku')
            ->orderByDesc('total_qty')
            ->limit(10)
            ->get();

        return response()->json($products);
    }

    public function salesReport(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        $days = $request->days ?? 30;

        $sales = Order::where('account_id', $accountId)
            ->where('status', '!=', 'cancelled')
            ->where('created_at', '>=', now()->subDays($days))
            ->select(DB::raw('DATE(created_at) as date'), DB::raw('SUM(total_price) as total'))
            ->groupBy('date')
            ->orderBy('date')
            ->get();

        return response()->json($sales);
    }

    public function webAnalytics(Request $request)
    {
        $validated = $request->validate([
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date',
            'product_limit' => 'nullable|integer|min:5|max:100',
            'source' => 'nullable|string|max:30',
        ]);

        $accountId = (int) $request->header('X-Account-Id');
        $now = now();
        $source = $this->normalizeWebAnalyticsSource($validated['source'] ?? 'all');
        $from = Carbon::parse($validated['date_from'] ?? $now->toDateString())->startOfDay();
        $to = Carbon::parse($validated['date_to'] ?? $now->toDateString())->endOfDay();

        if ($from->greaterThan($to)) {
            [$from, $to] = [$to->copy()->startOfDay(), $from->copy()->endOfDay()];
        }

        if ($from->diffInDays($to) > 180) {
            $from = $to->copy()->subDays(180)->startOfDay();
        }

        $fromDate = $from->toDateString();
        $toDate = $to->toDateString();
        $eventsTableExists = Schema::hasTable('site_analytics_events');

        $eventRows = collect();
        if ($eventsTableExists) {
            $eventRowsQuery = DB::table('site_analytics_events')
                ->where('account_id', $accountId)
                ->whereBetween('event_date', [$fromDate, $toDate]);

            $this->applyWebAnalyticsEventSourceFilter($eventRowsQuery, $source);

            $eventRows = $eventRowsQuery
                ->selectRaw('event_date as date_key')
                ->selectRaw("SUM(CASE WHEN event_name = ? THEN 1 ELSE 0 END) as page_views", [SiteAnalyticsEvent::EVENT_PAGE_VIEW])
                ->selectRaw("SUM(CASE WHEN event_name = ? THEN 1 ELSE 0 END) as product_views", [SiteAnalyticsEvent::EVENT_PRODUCT_VIEW])
                ->selectRaw("SUM(CASE WHEN event_name = ? THEN 1 ELSE 0 END) as add_to_carts", [SiteAnalyticsEvent::EVENT_ADD_TO_CART])
                ->selectRaw("SUM(CASE WHEN event_name = ? THEN 1 ELSE 0 END) as checkout_started", [SiteAnalyticsEvent::EVENT_CHECKOUT_STARTED])
                ->groupBy('event_date')
                ->orderBy('event_date')
                ->get()
                ->keyBy(fn ($row) => (string) $row->date_key);
        }

        $orderRowsQuery = DB::table('leads')
            ->where('leads.account_id', $accountId)
            ->where('leads.is_draft', false)
            ->whereNotNull('leads.placed_at')
            ->whereBetween('leads.placed_at', [$from, $to])
            ->whereExists(function ($query) {
                $query
                    ->selectRaw('1')
                    ->from('lead_items')
                    ->whereColumn('lead_items.lead_id', 'leads.id');
            })
            ->when($source !== 'all', fn (QueryBuilder $query) => $this->applyWebAnalyticsLeadSourceFilter($query, $source));

        $orderRows = $orderRowsQuery
            ->selectRaw('DATE(leads.placed_at) as date_key')
            ->selectRaw('COUNT(DISTINCT leads.id) as orders_count')
            ->selectRaw('COALESCE(SUM(leads.total_amount), 0) as order_revenue')
            ->groupBy('date_key')
            ->orderBy('date_key')
            ->get()
            ->keyBy(fn ($row) => (string) $row->date_key);

        $series = [];
        $totals = [
            'page_views' => 0,
            'product_views' => 0,
            'add_to_carts' => 0,
            'checkout_started' => 0,
            'orders_count' => 0,
            'order_revenue' => 0.0,
        ];

        foreach (CarbonPeriod::create($from->copy()->startOfDay(), $to->copy()->startOfDay()) as $date) {
            $dateKey = $date->toDateString();
            $eventRow = $eventRows->get($dateKey);
            $orderRow = $orderRows->get($dateKey);
            $row = [
                'date' => $dateKey,
                'label' => $date->format('d/m'),
                'page_views' => (int) ($eventRow->page_views ?? 0),
                'product_views' => (int) ($eventRow->product_views ?? 0),
                'add_to_carts' => (int) ($eventRow->add_to_carts ?? 0),
                'checkout_started' => (int) ($eventRow->checkout_started ?? 0),
                'orders_count' => (int) ($orderRow->orders_count ?? 0),
                'order_revenue' => round((float) ($orderRow->order_revenue ?? 0), 2),
            ];
            $row['add_to_cart_rate'] = $this->percentage($row['add_to_carts'], $row['page_views']);
            $row['conversion_rate'] = $this->percentage($row['orders_count'], $row['page_views']);
            $row['cart_to_order_rate'] = $this->percentage($row['orders_count'], $row['add_to_carts']);

            foreach ($totals as $key => $value) {
                $totals[$key] += $row[$key];
            }

            $series[] = $row;
        }

        $uniqueVisitors = 0;
        if ($eventsTableExists) {
            $uniqueVisitorsQuery = DB::table('site_analytics_events')
                ->where('account_id', $accountId)
                ->where('event_name', SiteAnalyticsEvent::EVENT_PAGE_VIEW)
                ->whereBetween('event_date', [$fromDate, $toDate]);

            $this->applyWebAnalyticsEventSourceFilter($uniqueVisitorsQuery, $source);

            $uniqueVisitors = (int) $uniqueVisitorsQuery
                ->selectRaw("COUNT(DISTINCT COALESCE(visitor_id, session_id, ip_hash)) as unique_visitors")
                ->value('unique_visitors');
        }

        $totals['order_revenue'] = round((float) $totals['order_revenue'], 2);
        $totals['unique_visitors'] = $uniqueVisitors;
        $totals['add_to_cart_rate'] = $this->percentage($totals['add_to_carts'], $totals['page_views']);
        $totals['conversion_rate'] = $this->percentage($totals['orders_count'], $totals['page_views']);
        $totals['cart_to_order_rate'] = $this->percentage($totals['orders_count'], $totals['add_to_carts']);

        return response()->json([
            'summary' => $totals,
            'series' => $series,
            'products' => $this->buildWebAnalyticsProductRows(
                $accountId,
                $from,
                $to,
                $eventsTableExists,
                (int) ($validated['product_limit'] ?? 25),
                $source
            ),
            'filters' => [
                'date_from' => $fromDate,
                'date_to' => $toDate,
                'product_limit' => (int) ($validated['product_limit'] ?? 25),
                'source' => $source,
            ],
            'meta' => [
                'generated_at' => now()->toIso8601String(),
                'orders_source' => 'website_leads',
                'traffic_source' => 'site_analytics_events',
            ],
        ]);
    }

    private function dashboardRevenueOrdersQuery(int $accountId): Builder
    {
        return Order::query()
            ->where('account_id', $accountId)
            ->where(function ($query) {
                $query->where('order_kind', Order::KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            })
            ->where(function ($query) {
                $query->whereIn('order_type', Order::STANDARD_REVENUE_TYPES)
                    ->orWhereNull('order_type')
                    ->orWhere('order_type', '');
            });
    }

    private function aggregateRevenueStats(Builder $query): array
    {
        $row = (clone $query)
            ->selectRaw('COUNT(*) as order_count')
            ->selectRaw('COALESCE(SUM(COALESCE(report_revenue_total, total_price, 0)), 0) as revenue_total')
            ->first();

        $orderCount = (int) ($row?->order_count ?? 0);
        $revenue = round((float) ($row?->revenue_total ?? 0), 2);

        return [
            'orders_count' => $orderCount,
            'revenue' => $revenue,
            'average_order_value' => $orderCount > 0 ? round($revenue / $orderCount, 2) : 0.0,
        ];
    }

    private function buildDailyRevenueSeries(Builder $query, Carbon $start, Carbon $end, Carbon $now): array
    {
        $rows = (clone $query)
            ->whereBetween('officialized_at', [$start, $end])
            ->selectRaw('DATE(officialized_at) as period_key')
            ->selectRaw('COUNT(*) as order_count')
            ->selectRaw('COALESCE(SUM(COALESCE(report_revenue_total, total_price, 0)), 0) as revenue_total')
            ->groupBy('period_key')
            ->orderBy('period_key')
            ->get()
            ->keyBy('period_key');

        $series = [];
        $totalRevenue = 0.0;
        $totalOrders = 0;

        foreach (CarbonPeriod::create($start->copy()->startOfDay(), $end->copy()->startOfDay()) as $date) {
            $dateKey = $date->format('Y-m-d');
            $row = $rows->get($dateKey);
            $revenue = round((float) ($row->revenue_total ?? 0), 2);
            $orders = (int) ($row->order_count ?? 0);

            $series[] = [
                'key' => $dateKey,
                'date' => $dateKey,
                'day' => (int) $date->format('d'),
                'label' => $date->format('d/m'),
                'short_label' => $date->format('d'),
                'revenue' => $revenue,
                'orders_count' => $orders,
                'is_current' => $dateKey === $now->format('Y-m-d'),
            ];

            $totalRevenue += $revenue;
            $totalOrders += $orders;
        }

        return [
            'series' => $series,
            'total_revenue' => round($totalRevenue, 2),
            'total_orders' => $totalOrders,
        ];
    }

    private function buildMonthlyRevenueSeries(Builder $query, Carbon $start, Carbon $end, Carbon $now): array
    {
        $monthExpression = 'EXTRACT(MONTH FROM officialized_at)';

        $rows = (clone $query)
            ->whereBetween('officialized_at', [$start, $end])
            ->selectRaw($monthExpression . ' as period_month')
            ->selectRaw('COUNT(*) as order_count')
            ->selectRaw('COALESCE(SUM(COALESCE(report_revenue_total, total_price, 0)), 0) as revenue_total')
            ->groupByRaw($monthExpression)
            ->orderByRaw($monthExpression . ' asc')
            ->get()
            ->keyBy(fn ($row) => (int) ($row->period_month ?? 0));

        $series = [];
        $totalRevenue = 0.0;
        $totalOrders = 0;

        for ($month = 1; $month <= 12; $month += 1) {
            $row = $rows->get($month);
            $revenue = round((float) ($row->revenue_total ?? 0), 2);
            $orders = (int) ($row->order_count ?? 0);

            $series[] = [
                'key' => sprintf('%04d-%02d', $start->year, $month),
                'month' => $month,
                'label' => sprintf('Tháng %02d', $month),
                'short_label' => 'T' . $month,
                'revenue' => $revenue,
                'orders_count' => $orders,
                'is_current' => $start->year === $now->year && $month === $now->month,
            ];

            $totalRevenue += $revenue;
            $totalOrders += $orders;
        }

        return [
            'series' => $series,
            'total_revenue' => round($totalRevenue, 2),
            'total_orders' => $totalOrders,
        ];
    }

    private function resolveAvailableYears(Builder $query, int $currentYear, int $selectedYear): array
    {
        $bounds = (clone $query)
            ->selectRaw('MIN(officialized_at) as min_officialized_at')
            ->selectRaw('MAX(officialized_at) as max_officialized_at')
            ->first();

        $years = collect([$currentYear, $selectedYear]);

        if (!empty($bounds?->min_officialized_at)) {
            $years->push((int) Carbon::parse($bounds->min_officialized_at)->year);
        }

        if (!empty($bounds?->max_officialized_at)) {
            $years->push((int) Carbon::parse($bounds->max_officialized_at)->year);
        }

        $minYear = (int) $years->min();
        $maxYear = (int) $years->max();

        return collect(range($minYear, $maxYear))
            ->sortDesc()
            ->values()
            ->all();
    }

    private function buildWebAnalyticsProductRows(int $accountId, Carbon $from, Carbon $to, bool $eventsTableExists, int $limit, string $source): array
    {
        $fromDate = $from->toDateString();
        $toDate = $to->toDateString();
        $productMetrics = [];

        if ($eventsTableExists) {
            $productEventQuery = DB::table('site_analytics_events')
                ->where('account_id', $accountId)
                ->whereNotNull('product_id')
                ->whereBetween('event_date', [$fromDate, $toDate])
                ->whereIn('event_name', [SiteAnalyticsEvent::EVENT_PRODUCT_VIEW, SiteAnalyticsEvent::EVENT_ADD_TO_CART]);

            $this->applyWebAnalyticsEventSourceFilter($productEventQuery, $source);

            $productEventQuery
                ->select('product_id')
                ->selectRaw("SUM(CASE WHEN event_name = ? THEN 1 ELSE 0 END) as product_views", [SiteAnalyticsEvent::EVENT_PRODUCT_VIEW])
                ->selectRaw("SUM(CASE WHEN event_name = ? THEN 1 ELSE 0 END) as add_to_carts", [SiteAnalyticsEvent::EVENT_ADD_TO_CART])
                ->groupBy('product_id')
                ->get()
                ->each(function ($row) use (&$productMetrics) {
                    $productId = (int) $row->product_id;
                    $productMetrics[$productId] = array_replace($productMetrics[$productId] ?? [], [
                        'product_id' => $productId,
                        'product_views' => (int) ($row->product_views ?? 0),
                        'add_to_carts' => (int) ($row->add_to_carts ?? 0),
                    ]);
                });
        }

        $productOrderQuery = DB::table('lead_items')
            ->join('leads', 'leads.id', '=', 'lead_items.lead_id')
            ->where('leads.account_id', $accountId)
            ->where('leads.is_draft', false)
            ->whereNotNull('leads.placed_at')
            ->whereBetween('leads.placed_at', [$from, $to])
            ->whereNotNull('lead_items.product_id');

        $this->applyWebAnalyticsLeadSourceFilter($productOrderQuery, $source);

        $productOrderQuery
            ->select('lead_items.product_id')
            ->selectRaw('COUNT(DISTINCT leads.id) as orders_count')
            ->selectRaw('COALESCE(SUM(lead_items.quantity), 0) as ordered_quantity')
            ->selectRaw('COALESCE(SUM(lead_items.line_total), 0) as ordered_revenue')
            ->groupBy('lead_items.product_id')
            ->get()
            ->each(function ($row) use (&$productMetrics) {
                $productId = (int) $row->product_id;
                $productMetrics[$productId] = array_replace($productMetrics[$productId] ?? [], [
                    'product_id' => $productId,
                    'orders_count' => (int) ($row->orders_count ?? 0),
                    'ordered_quantity' => InventoryQuantity::normalize($row->ordered_quantity ?? 0),
                    'ordered_revenue' => round((float) ($row->ordered_revenue ?? 0), 2),
                ]);
            });

        if (empty($productMetrics)) {
            return [];
        }

        $productIds = array_keys($productMetrics);
        $productsById = DB::table('products')
            ->where('account_id', $accountId)
            ->whereIn('id', $productIds)
            ->get(['id', 'name', 'sku', 'slug'])
            ->keyBy('id');

        return collect($productMetrics)
            ->map(function (array $row) use ($productsById) {
                $product = $productsById->get($row['product_id']);
                $productViews = (int) ($row['product_views'] ?? 0);
                $addToCarts = (int) ($row['add_to_carts'] ?? 0);
                $ordersCount = (int) ($row['orders_count'] ?? 0);

                return [
                    'product_id' => $row['product_id'],
                    'product_name' => $product?->name ?: ('#' . $row['product_id']),
                    'product_sku' => $product?->sku,
                    'product_slug' => $product?->slug,
                    'product_views' => $productViews,
                    'add_to_carts' => $addToCarts,
                    'orders_count' => $ordersCount,
                    'ordered_quantity' => InventoryQuantity::normalize($row['ordered_quantity'] ?? 0),
                    'ordered_revenue' => round((float) ($row['ordered_revenue'] ?? 0), 2),
                    'add_to_cart_rate' => $this->percentage($addToCarts, $productViews),
                    'product_conversion_rate' => $this->percentage($ordersCount, $productViews),
                    'engagement_score' => $productViews + ($addToCarts * 3) + ($ordersCount * 5),
                ];
            })
            ->sortByDesc('engagement_score')
            ->take($limit)
            ->values()
            ->map(function (array $row) {
                unset($row['engagement_score']);
                return $row;
            })
            ->all();
    }

    private function normalizeWebAnalyticsSource(?string $source): string
    {
        return match (strtolower(trim((string) $source))) {
            'facebook', 'fb', 'meta' => 'facebook',
            'google', 'gg', 'ga' => 'google',
            default => 'all',
        };
    }

    private function webAnalyticsSourceAliases(string $source): array
    {
        return match ($source) {
            'facebook' => [
                'FB',
                'fb',
                'Fb',
                'facebook',
                'Facebook',
                'FACEBOOK',
                'meta',
                'Meta',
                'META',
                'facebook_ads',
                'facebook-ad',
                'facebook ads',
                'Facebook Ads',
            ],
            'google' => [
                'GG',
                'gg',
                'Gg',
                'google',
                'Google',
                'GOOGLE',
                'ga',
                'GA',
                'google_ads',
                'google-ad',
                'google ads',
                'Google Ads',
                'googleads',
            ],
            default => [],
        };
    }

    private function webAnalyticsSourceContainsTerms(string $source): array
    {
        return match ($source) {
            'facebook' => ['facebook', 'fbclid', 'meta'],
            'google' => ['google', 'gclid', 'googleads'],
            default => [],
        };
    }

    private function applyWebAnalyticsEventSourceFilter(QueryBuilder $query, string $source): void
    {
        if ($source === 'all') {
            return;
        }

        $aliases = $this->webAnalyticsSourceAliases($source);
        $terms = $this->webAnalyticsSourceContainsTerms($source);
        $clickIdField = $source === 'facebook' ? 'metadata->fbclid' : 'metadata->gclid';
        $exactFields = [
            'metadata->source',
            'metadata->source_label',
            'metadata->utm_source',
        ];
        $containsFields = [
            'metadata->source',
            'metadata->source_label',
            'metadata->utm_source',
            'metadata->utm_medium',
            'metadata->utm_campaign',
            'metadata->raw_query',
        ];

        $query->where(function (QueryBuilder $query) use ($aliases, $terms, $clickIdField, $exactFields, $containsFields) {
            foreach ($exactFields as $field) {
                $query->orWhereIn($field, $aliases);
            }

            foreach ($containsFields as $field) {
                foreach ($terms as $term) {
                    $query->orWhere($field, 'like', '%' . $term . '%');
                }
            }

            $query
                ->orWhere(function (QueryBuilder $query) use ($clickIdField) {
                    $query
                        ->whereNotNull($clickIdField)
                        ->where($clickIdField, '!=', '');
                });
        });
    }

    private function applyWebAnalyticsLeadSourceFilter(QueryBuilder $query, string $source): void
    {
        if ($source === 'all') {
            return;
        }

        $aliases = $this->webAnalyticsSourceAliases($source);
        $terms = $this->webAnalyticsSourceContainsTerms($source);
        $storageSource = $source === 'facebook' ? 'facebook' : 'google';
        $clickIdField = $source === 'facebook' ? 'leads.conversion_data->fbclid' : 'leads.conversion_data->gclid';
        $exactFields = [
            'leads.tag',
            'leads.utm_source',
            'leads.conversion_data->source',
            'leads.conversion_data->utm_source',
            'leads.conversion_data->source_label',
        ];
        $containsFields = [
            'leads.tag',
            'leads.utm_source',
            'leads.utm_medium',
            'leads.utm_campaign',
            'leads.conversion_data->source',
            'leads.conversion_data->source_label',
            'leads.conversion_data->utm_source',
            'leads.conversion_data->utm_medium',
            'leads.conversion_data->utm_campaign',
            'leads.conversion_data->raw_query',
        ];

        $query->where(function (QueryBuilder $query) use ($aliases, $terms, $storageSource, $clickIdField, $exactFields, $containsFields) {
            $query->where('leads.source', $storageSource);

            foreach ($exactFields as $field) {
                $query->orWhereIn($field, $aliases);
            }

            foreach ($containsFields as $field) {
                foreach ($terms as $term) {
                    $query->orWhere($field, 'like', '%' . $term . '%');
                }
            }

            $query->orWhere(function (QueryBuilder $query) use ($clickIdField) {
                $query
                    ->whereNotNull($clickIdField)
                    ->where($clickIdField, '!=', '');
            });
        });
    }

    private function percentage(int|float $numerator, int|float $denominator): float
    {
        return $denominator > 0 ? round(($numerator / $denominator) * 100, 2) : 0.0;
    }
}
