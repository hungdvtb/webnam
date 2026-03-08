<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cart;
use App\Models\CartItem;
use App\Models\Product;
use App\Models\ProductGroup;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class CartController extends Controller
{
    public function index()
    {
        $cart = Cart::with(['items.product', 'items.productGroup'])
            ->where('user_id', Auth::id())
            ->first();

        if (!$cart) {
            return response()->json(['items' => []]);
        }

        return response()->json($cart);
    }

    public function add(Request $request)
    {
        $request->validate([
            'product_id' => 'nullable|exists:products,id',
            'product_group_id' => 'nullable|exists:product_groups,id',
            'quantity' => 'required|integer|min:1',
            'options' => 'nullable|array',
        ]);

        $cart = Cart::firstOrCreate(['user_id' => Auth::id()]);

        $price = 0;
        if ($request->product_id) {
            $product = Product::find($request->product_id);
            $price = $product ? $product->current_price : 0;
        } elseif ($request->product_group_id) {
            $price = ProductGroup::find($request->product_group_id)->price;
        }

        $query = $cart->items()
            ->where('product_id', $request->product_id)
            ->where('product_group_id', $request->product_group_id);

        if ($request->options && count($request->options) > 0) {
            // Sort keys to ensure consistent JSON comparison if needed, 
            // though whereJsonContains/whereJsonLength is often better.
            $query->where('options', json_encode($request->options));
        } else {
            $query->whereNull('options');
        }

        $cartItem = $query->first();

        if ($cartItem) {
            $cartItem->increment('quantity', $request->quantity);
            $cartItem->update(['price' => $price]);
        } else {
            $cartItem = $cart->items()->create([
                'product_id' => $request->product_id,
                'product_group_id' => $request->product_group_id,
                'options' => $request->options,
                'quantity' => $request->quantity,
                'price' => $price,
            ]);
        }

        return response()->json([
            'message' => 'Item added to cart',
            'item' => $cartItem->load(['product', 'productGroup'])
        ]);
    }

    public function update(Request $request)
    {
        $request->validate([
            'cart_item_id' => 'required|exists:cart_items,id',
            'quantity' => 'required|integer|min:1',
        ]);

        $cartItem = CartItem::whereHas('cart', function ($q) {
            $q->where('user_id', Auth::id());
        })->findOrFail($request->cart_item_id);

        $cartItem->update(['quantity' => $request->quantity]);

        return response()->json([
            'message' => 'Cart updated',
            'item' => $cartItem
        ]);
    }

    public function remove(Request $request)
    {
        $request->validate([
            'cart_item_id' => 'required|exists:cart_items,id',
        ]);

        $cartItem = CartItem::whereHas('cart', function ($q) {
            $q->where('user_id', Auth::id());
        })->findOrFail($request->cart_item_id);

        $cartItem->delete();

        return response()->json([
            'message' => 'Item removed from cart'
        ]);
    }
}
