<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\StockTransfer;
use App\Models\StockTransferItem;
use App\Models\StockMovement;
use App\Models\InventoryItem;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class StockTransferController extends Controller
{
    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        
        $transfers = StockTransfer::whereHas('fromWarehouse', function($q) use ($accountId) {
                $q->where('account_id', $accountId);
            })
            ->with(['fromWarehouse', 'toWarehouse', 'items.product'])
            ->latest()
            ->paginate($request->per_page ?? 20);

        return response()->json($transfers);
    }

    public function store(Request $request)
    {
        $request->validate([
            'from_warehouse_id' => 'required|exists:warehouses,id',
            'to_warehouse_id' => 'required|exists:warehouses,id|different:from_warehouse_id',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:products,id',
            'items.*.qty' => 'required|integer|min:1',
            'notes' => 'nullable|string',
        ]);

        return DB::transaction(function () use ($request) {
            $transfer = StockTransfer::create([
                'from_warehouse_id' => $request->from_warehouse_id,
                'to_warehouse_id' => $request->to_warehouse_id,
                'transfer_number' => 'TRF-' . strtoupper(Str::random(8)),
                'status' => 'pending',
                'notes' => $request->notes,
            ]);

            foreach ($request->items as $item) {
                StockTransferItem::create([
                    'stock_transfer_id' => $transfer->id,
                    'product_id' => $item['product_id'],
                    'qty' => $item['qty'],
                ]);
            }

            return response()->json($transfer->load('items.product'), 201);
        });
    }

    public function complete($id)
    {
        return DB::transaction(function () use ($id) {
            $transfer = StockTransfer::with('items')->findOrFail($id);
            if ($transfer->status === 'completed') {
                return response()->json(['message' => 'Transfer already completed'], 400);
            }

            foreach ($transfer->items as $item) {
                // Deduct from source
                $fromInv = InventoryItem::firstOrNew([
                    'warehouse_id' => $transfer->from_warehouse_id,
                    'product_id' => $item->product_id,
                ]);
                $fromInv->qty -= $item->qty;
                $fromInv->save();

                StockMovement::create([
                    'warehouse_id' => $transfer->from_warehouse_id,
                    'product_id' => $item->product_id,
                    'type' => 'transfer',
                    'qty' => -$item->qty,
                    'reference_type' => 'StockTransfer',
                    'reference_id' => $transfer->id,
                    'user_id' => auth()->id(),
                ]);

                // Add to destination
                $toInv = InventoryItem::firstOrNew([
                    'warehouse_id' => $transfer->to_warehouse_id,
                    'product_id' => $item->product_id,
                ]);
                $toInv->qty += $item->qty;
                $toInv->save();

                StockMovement::create([
                    'warehouse_id' => $transfer->to_warehouse_id,
                    'product_id' => $item->product_id,
                    'type' => 'transfer',
                    'qty' => $item->qty,
                    'reference_type' => 'StockTransfer',
                    'reference_id' => $transfer->id,
                    'user_id' => auth()->id(),
                ]);

                // Sync total stock (technically doesn't change on transfer, but good for consistency)
                $product = Product::find($item->product_id);
                $totalStock = InventoryItem::where('product_id', $item->product_id)->sum('qty');
                $product->update(['stock_quantity' => $totalStock]);
            }

            $transfer->update([
                'status' => 'completed',
                'received_at' => now(),
            ]);

            return response()->json($transfer);
        });
    }
}
