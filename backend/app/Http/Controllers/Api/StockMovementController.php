<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\StockMovement;
use App\Models\InventoryItem;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class StockMovementController extends Controller
{
    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        
        $movements = StockMovement::whereHas('product', function($q) use ($accountId) {
                $q->where('account_id', $accountId);
            })
            ->with(['product', 'warehouse', 'user'])
            ->latest()
            ->paginate($request->per_page ?? 50);

        return response()->json($movements);
    }

    public function store(Request $request)
    {
        $request->validate([
            'warehouse_id' => 'required|exists:warehouses,id',
            'product_id' => 'required|exists:products,id',
            'type' => 'required|in:in,out,adjustment',
            'qty' => 'required|integer',
            'notes' => 'nullable|string',
        ]);

        return DB::transaction(function () use ($request) {
            $movement = StockMovement::create(array_merge($request->all(), [
                'user_id' => auth()->id(),
            ]));

            $inventory = InventoryItem::firstOrNew([
                'warehouse_id' => $request->warehouse_id,
                'product_id' => $request->product_id,
            ]);

            if ($request->type === 'in') {
                $inventory->qty += $request->qty;
            } elseif ($request->type === 'out') {
                $inventory->qty -= $request->qty;
            } elseif ($request->type === 'adjustment') {
                $inventory->qty = $request->qty; // Overwrite for adjustment
            }

            $inventory->save();

            // Sync product total stock
            $product = Product::find($request->product_id);
            $totalStock = InventoryItem::where('product_id', $request->product_id)->sum('qty');
            $product->update(['stock_quantity' => $totalStock]);

            return response()->json($movement->load(['product', 'warehouse']), 201);
        });
    }
}
