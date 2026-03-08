<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Invoice;
use Illuminate\Http\Request;

class InvoiceController extends Controller
{
    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        
        $invoices = Invoice::whereHas('order', function($q) use ($accountId) {
                $q->where('account_id', $accountId);
            })
            ->with('order')
            ->latest()
            ->paginate($request->per_page ?? 20);

        return response()->json($invoices);
    }

    public function show($id)
    {
        $invoice = Invoice::with(['order.items.product', 'order.customer'])->findOrFail($id);
        return response()->json($invoice);
    }

    public function markAsPaid($id)
    {
        $invoice = Invoice::findOrFail($id);
        $invoice->update([
            'status' => 'paid',
            'paid_at' => now(),
        ]);

        // Auto update order status to paid
        $invoice->order->update(['status' => 'paid']);

        return response()->json($invoice);
    }
}
