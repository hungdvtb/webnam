<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryItem;
use App\Models\Warehouse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class WarehouseController extends Controller
{
    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        if (!$accountId) {
            return response()->json(['message' => 'Account ID required'], 400);
        }

        $warehouses = Warehouse::query()
            ->where('account_id', $accountId)
            ->when($request->boolean('active_only'), fn ($query) => $query->where('is_active', true))
            ->orderByDesc('is_active')
            ->orderBy('name')
            ->get();

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
            'province_name' => 'nullable|string|max:255',
            'district_name' => 'nullable|string|max:255',
            'ward_name' => 'nullable|string|max:255',
            'province_id' => 'nullable|integer',
            'district_id' => 'nullable|integer',
            'ward_id' => 'nullable|integer',
            'is_active' => 'nullable|boolean',
        ]);

        $warehouse = Warehouse::create(array_merge(
            $request->all(),
            ['account_id' => $accountId]
        ));

        return response()->json($warehouse, 201);
    }

    public function show($id)
    {
        $warehouse = $this->findWarehouse(request(), $id)->load('inventoryItems.product');
        return response()->json($warehouse);
    }

    public function update(Request $request, $id)
    {
        $warehouse = $this->findWarehouse($request, $id);
        
        $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'code' => ['sometimes', 'required', 'string', Rule::unique('warehouses', 'code')->ignore($id)],
            'contact_name' => 'nullable|string',
            'phone' => 'nullable|string',
            'email' => 'nullable|email',
            'address' => 'nullable|string',
            'city' => 'nullable|string',
            'province_name' => 'nullable|string|max:255',
            'district_name' => 'nullable|string|max:255',
            'ward_name' => 'nullable|string|max:255',
            'province_id' => 'nullable|integer',
            'district_id' => 'nullable|integer',
            'ward_id' => 'nullable|integer',
            'is_active' => 'boolean',
        ]);

        $warehouse->update($request->all());
        return response()->json($warehouse);
    }

    public function destroy(Request $request, $id)
    {
        $warehouse = $this->findWarehouse($request, $id);
        $warehouse->delete();
        return response()->json(['message' => 'Warehouse deleted']);
    }

    public function getInventory(Request $request, $id)
    {
        $this->findWarehouse($request, $id);
        $inventory = InventoryItem::where('warehouse_id', $id)
            ->with('product')
            ->get();
        return response()->json($inventory);
    }

    public function updateInventory(Request $request, $id)
    {
        $this->findWarehouse($request, $id);
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

    private function findWarehouse(Request $request, int|string $id): Warehouse
    {
        $accountId = $request->header('X-Account-Id');
        abort_unless($accountId, 400, 'Account ID required');

        return Warehouse::query()
            ->where('account_id', $accountId)
            ->findOrFail($id);
    }
}
