<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cart;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Customer;
use App\Models\Invoice;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrderController extends Controller
{
    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        
        $orders = Order::with(['items.product', 'customer'])
            ->where('account_id', $accountId)
            ->when($request->search, function($q) use ($request) {
                $q->where(function($sub) use ($request) {
                    $sub->where('order_number', 'like', "%{$request->search}%")
                        ->orWhere('customer_name', 'like', "%{$request->search}%");
                });
            })
            ->when($request->status, function($q) use ($request) {
                $q->where('status', $request->status);
            })
            ->latest()
            ->paginate($request->per_page ?? 20);

        return response()->json($orders);
    }

    public function store(Request $request)
    {
        $accountId = $request->header('X-Account-Id');

        $request->validate([
            'customer_name' => 'required|string|max:255',
            'customer_email' => 'nullable|email|max:255',
            'customer_phone' => 'required|string|max:20',
            'shipping_address' => 'required|string',
            'items' => 'sometimes|array|min:1', 
            'notes' => 'nullable|string',
            'custom_attributes' => 'nullable|array', // Order EAV
        ]);

        return DB::transaction(function () use ($request, $accountId) {
            $items = [];
            $totalPrice = 0;

            if ($request->has('items')) {
                foreach ($request->items as $item) {
                    $items[] = [
                        'product_id' => $item['product_id'],
                        'quantity' => $item['quantity'],
                        'price' => $item['price'],
                    ];
                    $totalPrice += $item['price'] * $item['quantity'];
                }
            } else {
                $cart = Cart::with('items')->where('user_id', Auth::id())->first();
                if (!$cart || $cart->items->isEmpty()) {
                    return response()->json(['message' => 'Cart is empty'], 400);
                }
                foreach ($cart->items as $item) {
                    $items[] = [
                        'product_id' => $item->product_id,
                        'quantity' => $item->quantity,
                        'price' => $item->product->current_price ?? $item->price,
                    ];
                    $totalPrice += ($item->product->current_price ?? $item->price) * $item->quantity;
                }
            }

            $customer = Customer::firstOrCreate(
                ['account_id' => $accountId, 'phone' => $request->customer_phone],
                ['name' => $request->customer_name, 'email' => $request->customer_email, 'address' => $request->shipping_address]
            );

            $order = Order::create([
                'user_id' => Auth::id(),
                'account_id' => $accountId,
                'customer_id' => $customer->id,
                'order_number' => 'ORD-' . strtoupper(Str::random(10)),
                'total_price' => $totalPrice,
                'status' => 'new', // Default status: Mới
                'customer_name' => $request->customer_name,
                'customer_email' => $request->customer_email,
                'customer_phone' => $request->customer_phone,
                'shipping_address' => $request->shipping_address,
                'notes' => $request->notes,
            ]);

            foreach ($items as $item) {
                OrderItem::create([
                    'order_id' => $order->id,
                    'product_id' => $item['product_id'],
                    'quantity' => $item['quantity'],
                    'price' => $item['price'],
                ]);
            }

            // Sync Order EAV custom attributes
            if ($request->has('custom_attributes')) {
                foreach ($request->custom_attributes as $attrCode => $val) {
                    $attribute = \App\Models\Attribute::firstOrCreate(
                        ['account_id' => $accountId, 'code' => $attrCode],
                        ['name' => ucwords(str_replace('_', ' ', $attrCode)), 'frontend_type' => 'text']
                    );

                    \App\Models\OrderAttributeValue::create([
                        'order_id' => $order->id,
                        'attribute_id' => $attribute->id,
                        'value' => is_array($val) ? json_encode($val) : $val
                    ]);
                }
            }

            $customer->increment('total_orders');
            $customer->increment('total_spent', $totalPrice);

            Invoice::create([
                'order_id' => $order->id,
                'invoice_number' => 'INV-' . strtoupper(Str::random(10)),
                'amount' => $totalPrice,
                'status' => 'pending',
                'due_date' => now()->addDays(3),
            ]);

            if (!$request->has('items')) {
                Cart::where('user_id', Auth::id())->first()->items()->delete();
            }

            return response()->json($order->load(['items', 'customer', 'attributeValues']), 201);
        });
    }

    public function show($id)
    {
        $order = Order::with(['items.product', 'customer', 'shipments', 'payment', 'attributeValues.attribute', 'user'])->findOrFail($id);
        return response()->json($order);
    }

    public function updateStatus(Request $request, $id)
    {
        $request->validate(['status' => 'required|in:new,confirmed,processing,shipping,completed,cancelled,returned']);
        $order = Order::findOrFail($id);
        $order->update(['status' => $request->status]);
        return response()->json($order->load(['items', 'customer', 'attributeValues.attribute']));
    }
}
