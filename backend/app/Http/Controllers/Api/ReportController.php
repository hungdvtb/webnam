<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Product;
use App\Models\InventoryItem;
use App\Models\StockMovement;
use App\Services\Reports\ProductSalesByDayReportService;
use App\Services\Reports\SalesProductReportService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReportController extends Controller
{
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
        $accountId = $request->header('X-Account-Id');

        $salesToday = Order::where('account_id', $accountId)
            ->whereDate('created_at', now())
            ->where('status', '!=', 'cancelled')
            ->sum('total_price');

        $ordersCount = Order::where('account_id', $accountId)
            ->whereDate('created_at', now())
            ->count();

        $lowStockCount = InventoryItem::whereHas('product', function($q) use ($accountId) {
                $q->where('account_id', $accountId);
            })
            ->whereColumn('qty', '<', 'low_stock_threshold')
            ->count();

        return response()->json([
            'sales_today' => $salesToday,
            'orders_today' => $ordersCount,
            'low_stock_alerts' => $lowStockCount,
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
}
