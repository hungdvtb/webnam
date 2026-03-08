<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use Illuminate\Http\Request;

class CustomerController extends Controller
{
    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        if (!$accountId) return response()->json(['message' => 'Account ID required'], 400);

        $customers = Customer::where('account_id', $accountId)
            ->when($request->search, function($q) use ($request) {
                $q->where('name', 'like', "%{$request->search}%")
                  ->orWhere('email', 'like', "%{$request->search}%")
                  ->orWhere('phone', 'like', "%{$request->search}%");
            })
            ->latest()
            ->paginate($request->per_page ?? 20);

        return response()->json($customers);
    }

    public function store(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        
        $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'nullable|email',
            'phone' => 'nullable|string',
            'address' => 'nullable|string',
            'group' => 'string|in:regular,vip,wholesaler',
        ]);

        $customer = Customer::create(array_merge($request->all(), ['account_id' => $accountId]));
        return response()->json($customer, 201);
    }

    public function show($id)
    {
        $customer = Customer::with('orders.items.product')->findOrFail($id);
        return response()->json($customer);
    }

    public function update(Request $request, $id)
    {
        $customer = Customer::findOrFail($id);
        $customer->update($request->all());
        return response()->json($customer);
    }

    public function destroy($id)
    {
        $customer = Customer::findOrFail($id);
        $customer->delete();
        return response()->json(['message' => 'Customer deleted']);
    }
}
