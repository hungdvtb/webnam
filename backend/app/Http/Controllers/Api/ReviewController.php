<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Review; // Oh wait, I named it ProductReview
use App\Models\ProductReview;
use Illuminate\Http\Request;

class ReviewController extends Controller
{
    public function index(Request $request, $productId)
    {
        $reviews = ProductReview::where('product_id', $productId)
            ->where('is_approved', true)
            ->with('user')
            ->latest()
            ->get();
        return response()->json($reviews);
    }

    public function store(Request $request, $productId)
    {
        $request->validate([
            'rating' => 'required|integer|min:1|max:5',
            'comment' => 'nullable|string',
            'customer_name' => 'nullable|string',
        ]);

        $review = ProductReview::create([
            'account_id' => $request->header('X-Account-Id'),
            'product_id' => $productId,
            'user_id' => auth()->id(),
            'customer_name' => $request->customer_name ?: auth()->user()?->name,
            'rating' => $request->rating,
            'comment' => $request->comment,
            'is_approved' => false, // Approval needed for professional sites
        ]);

        return response()->json(['message' => 'Review submitted successfully. It will be visible after approval.', 'review' => $review], 201);
    }

    public function adminIndex(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        $reviews = ProductReview::where('account_id', $accountId)
            ->with(['product', 'user'])
            ->latest()
            ->paginate($request->per_page ?? 20);
        return response()->json($reviews);
    }

    public function approve($id)
    {
        $review = ProductReview::findOrFail($id);
        $review->update(['is_approved' => true]);
        return response()->json(['message' => 'Review approved']);
    }
}
