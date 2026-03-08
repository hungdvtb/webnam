<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Shipment;
use App\Models\ShipmentItem;
use App\Models\InventoryItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ShipmentController extends Controller
{
    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        $shipments = Shipment::whereHas('order', function($q) use ($accountId) {
            $q->where('account_id', $accountId);
        })->with(['order', 'warehouse'])->latest()->get();

        return response()->json($shipments);
    }

    public function store(Request $request)
    {
        $request->validate([
            'order_id' => 'required|exists:orders,id',
            'warehouse_id' => 'required|exists:warehouses,id',
            'items' => 'required|array',
            'items.*.order_item_id' => 'required|exists:order_items,id',
            'items.*.qty' => 'required|integer|min:1',
            'carrier_name' => 'nullable|string',
            'tracking_number' => 'nullable|string',
        ]);

        return DB::transaction(function () use ($request) {
            $order = Order::findOrFail($request->order_id);
            
            $shipmentCount = Shipment::whereDate('created_at', now())->count() + 1;
            $shipmentNumber = 'SHP-' . now()->format('Ymd') . '-' . str_pad($shipmentCount, 4, '0', STR_PAD_LEFT);

            $shipment = Shipment::create([
                'order_id' => $request->order_id,
                'warehouse_id' => $request->warehouse_id,
                'shipment_number' => $shipmentNumber,
                'carrier_name' => $request->carrier_name,
                'tracking_number' => $request->tracking_number,
                'status' => 'pending',
            ]);

            foreach ($request->items as $item) {
                ShipmentItem::create([
                    'shipment_id' => $shipment->id,
                    'order_item_id' => $item['order_item_id'],
                    'qty' => $item['qty'],
                ]);

                // Deduct from inventory
                $orderItem = \App\Models\OrderItem::find($item['order_item_id']);
                $inventory = InventoryItem::where('warehouse_id', $request->warehouse_id)
                    ->where('product_id', $orderItem->product_id)
                    ->first();

                if ($inventory) {
                    $inventory->decrement('qty', $item['qty']);
                    
                    // Update product total stock
                    $product = \App\Models\Product::find($orderItem->product_id);
                    $totalStock = InventoryItem::where('product_id', $orderItem->product_id)->sum('qty');
                    $product->update(['stock_quantity' => $totalStock]);
                }
            }

            // Update order status if needed
            if ($order->status === 'pending') {
                $order->update(['status' => 'shipping']);
            }

            return response()->json($shipment->load('items.orderItem.product'), 201);
        });
    }

    public function show($id)
    {
        $shipment = Shipment::with(['items.orderItem.product', 'order', 'warehouse'])->findOrFail($id);
        return response()->json($shipment);
    }

    public function updateStatus(Request $request, $id)
    {
        $request->validate([
            'status' => 'required|string|in:pending,processing,shipped,delivered,cancelled',
        ]);

        $shipment = Shipment::findOrFail($id);
        $shipment->status = $request->status;

        if ($request->status === 'shipped') {
            $shipment->shipped_at = now();
        } elseif ($request->status === 'delivered') {
            $shipment->delivered_at = now();
            
            // Check if all items in order are delivered to update order status
            $order = $shipment->order;
            // Logic to check all items could be added here
        }

        $shipment->save();

        return response()->json($shipment);
    }
}
