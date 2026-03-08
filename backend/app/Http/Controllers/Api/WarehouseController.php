<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Warehouse;
use App\Models\InventoryItem;
use Illuminate\Http\Request;

class WarehouseController extends Controller
{
    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        if (!$accountId) {
            return response()->json(['message' => 'Account ID required'], 400);
        }

        $warehouses = Warehouse::where('account_id', $accountId)->get();
        return response()->json($warehouses);
    }

    public function store(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        if (!$accountId) {
            return response()->json(['message' => 'Account ID required'], 400);
        }

        $request->validate([
            'name' => 'required|string|max:255',
            'code' => 'required|string|unique:warehouses,code',
            'contact_name' => 'nullable|string',
            'phone' => 'nullable|string',
            'email' => 'nullable|email',
            'address' => 'nullable|string',
            'city' => 'nullable|string',
        ]);

        $warehouse = Warehouse::create(array_merge(
            $request->all(),
            ['account_id' => $accountId]
        ));

        return response()->json($warehouse, 201);
    }

    public function show($id)
    {
        $warehouse = Warehouse::with('inventoryItems.product')->findOrFail($id);
        return response()->json($warehouse);
    }

    public function update(Request $request, $id)
    {
        $warehouse = Warehouse::findOrFail($id);
        
        $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'code' => 'sometimes|required|string|unique:warehouses,code,' . $id,
            'is_active' => 'boolean',
        ]);

        $warehouse->update($request->all());
        return response()->json($warehouse);
    }

    public function destroy($id)
    {
        $warehouse = Warehouse::findOrFail($id);
        $warehouse->delete();
        return response()->json(['message' => 'Warehouse deleted']);
    }

    public function getInventory(Request $request, $id)
    {
        $inventory = InventoryItem::where('warehouse_id', $id)
            ->with('product')
            ->get();
        return response()->json($inventory);
    }

    public function updateInventory(Request $request, $id)
    {
        $request->validate([
            'product_id' => 'required|exists:products,id',
            'qty' => 'required|integer',
        ]);

        $inventory = InventoryItem::updateOrCreate(
            ['warehouse_id' => $id, 'product_id' => $request->product_id],
            ['qty' => $request->qty]
        );

        // Update total stock in product table (optional but good for speed)
        $product = \App\Models\Product::find($request->product_id);
        $totalStock = InventoryItem::where('product_id', $request->product_id)->sum('qty');
        $product->update(['stock_quantity' => $totalStock]);

        return response()->json($inventory);
    }
}
