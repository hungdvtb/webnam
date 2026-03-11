<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\OrderStatus;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class OrderStatusController extends Controller
{
    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        $query = OrderStatus::where('account_id', $accountId);

        if ($request->has('active_only') && $request->active_only === 'true') {
            $query->where('is_active', true);
        }

        $statuses = $query->orderBy('sort_order')->get();
        return response()->json($statuses);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'account_id' => 'required|exists:accounts,id',
            'code' => 'required|string|unique:order_statuses,code',
            'name' => 'required|string',
            'color' => 'nullable|string',
            'sort_order' => 'nullable|integer',
            'is_default' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
        ]);

        if (!empty($validated['is_default'])) {
            OrderStatus::where('account_id', $validated['account_id'])->update(['is_default' => false]);
        }

        $status = OrderStatus::create($validated);
        return response()->json($status, 201);
    }

    public function show(OrderStatus $orderStatus)
    {
        return response()->json($orderStatus);
    }

    public function update(Request $request, OrderStatus $orderStatus)
    {
        $validated = $request->validate([
            'name' => 'required|string',
            'color' => 'nullable|string',
            'sort_order' => 'nullable|integer',
            'is_default' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
        ]);

        if (!empty($validated['is_default'])) {
            OrderStatus::where('account_id', $orderStatus->account_id)->update(['is_default' => false]);
        }

        $orderStatus->update($validated);
        return response()->json($orderStatus);
    }
    public function reorder(Request $request)
    {
        $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'exists:order_statuses,id'
        ]);

        $accountId = $request->header('X-Account-Id');
        
        DB::transaction(function () use ($request, $accountId) {
            foreach ($request->ids as $index => $id) {
                OrderStatus::where('id', $id)
                    ->where('account_id', $accountId)
                    ->update(['sort_order' => $index + 1]);
            }
        });

        return response()->json(['message' => 'Đã cập nhật thứ tự.']);
    }


    public function destroy(OrderStatus $orderStatus)
    {
        if ($orderStatus->is_system) {
            return response()->json(['message' => 'Cannot delete system status.'], 403);
        }

        $orderStatus->delete();
        return response()->json(null, 204);
    }
}
