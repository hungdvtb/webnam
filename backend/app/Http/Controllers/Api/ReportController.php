<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\InventoryItem;
use App\Services\Reports\ProductSalesByDayReportService;
use App\Services\Reports\SalesProductReportService;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReportController extends Controller
{
    private const DASHBOARD_REVENUE_INCLUDED_STATUS = 'completed';

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

        $validRevenueOrders = $this->validRevenueOrdersQuery($accountId);

        $todaySummary = $this->aggregateRevenueStats(
            (clone $validRevenueOrders)->whereBetween('officialized_at', [$todayStart, $todayEnd])
        );

        $currentMonthSummary = $this->aggregateRevenueStats(
            (clone $validRevenueOrders)->whereBetween('officialized_at', [$currentMonthStart, $currentMonthEnd])
        );

        $dailySeries = $this->buildDailyRevenueSeries(
            (clone $validRevenueOrders),
            $selectedMonthStart,
            $selectedMonthEnd,
            $now
        );

        $monthlySeries = $this->buildMonthlyRevenueSeries(
            (clone $validRevenueOrders),
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
            (clone $validRevenueOrders),
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
                    'status' => self::DASHBOARD_REVENUE_INCLUDED_STATUS,
                    'order_kind' => Order::KIND_OFFICIAL,
                    'order_type' => Order::TYPE_STANDARD,
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

    private function validRevenueOrdersQuery(int $accountId): Builder
    {
        return Order::query()
            ->where('account_id', $accountId)
            ->where('status', self::DASHBOARD_REVENUE_INCLUDED_STATUS)
            ->where(function ($query) {
                $query->where('order_kind', Order::KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            })
            ->where(function ($query) {
                $query->where('order_type', Order::TYPE_STANDARD)
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
}
