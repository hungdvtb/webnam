<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Lead;
use Illuminate\Http\Request;

class LeadController extends Controller
{
    /**
     * Display a listing of the leads.
     */
    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        
        $query = Lead::query()
            ->when($accountId, fn($q) => $q->where('account_id', $accountId));

        // Search
        if ($request->filled('search')) {
            $s = $request->search;
            $query->where(function($q) use ($s) {
                $q->where('customer_name', 'like', "%{$s}%")
                  ->orWhere('phone', 'like', "%{$s}%")
                  ->orWhere('email', 'like', "%{$s}%");
            });
        }

        // Filter status
        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }

        // Sort
        $sortBy = $request->get('sort_by', 'created_at');
        $sortDesc = $request->get('sort_desc', 'true') === 'true';
        $query->orderBy($sortBy, $sortDesc ? 'desc' : 'asc');

        $perPage = $request->get('per_page', 20);
        $leads = $query->paginate($perPage);

        return response()->json($leads);
    }

    /**
     * Update the specified lead in storage.
     */
    public function update(Request $request, $id)
    {
        $accountId = $request->header('X-Account-Id');
        
        $lead = Lead::where('id', $id)
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->firstOrFail();

        $validated = $request->validate([
            'status' => 'required|string|in:new,contacted,qualified,won,lost',
            'notes' => 'nullable|string'
        ]);

        $lead->update($validated);

        return response()->json($lead);
    }

    /**
     * Remove the specified lead from storage.
     */
    public function destroy(Request $request, $id)
    {
        $accountId = $request->header('X-Account-Id');
        
        $lead = Lead::where('id', $id)
            ->when($accountId, fn($q) => $q->where('account_id', $accountId))
            ->firstOrFail();

        $lead->delete();

        return response()->json(['message' => 'Lead deleted successfully']);
    }
}
