<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Product;
use App\Models\InventoryItem;
use App\Models\StockMovement;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReportController extends Controller
{
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
