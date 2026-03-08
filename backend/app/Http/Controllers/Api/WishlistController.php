<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Wishlist;
use Illuminate\Http\Request;

class WishlistController extends Controller
{
    public function index(Request $request)
    {
        $userId = auth()->id();
        $wishlist = Wishlist::where('user_id', $userId)
            ->with(['product.images' => function($q) { $q->where('is_primary', true); }])
            ->latest()
            ->get();
        return response()->json($wishlist);
    }

    public function toggle(Request $request, $productId)
    {
        $userId = auth()->id();
        $accountId = $request->header('X-Account-Id');

        $existing = Wishlist::where('user_id', $userId)->where('product_id', $productId)->first();

        if ($existing) {
            $existing->delete();
            return response()->json(['message' => 'Removed from wishlist', 'in_wishlist' => false]);
        } else {
            Wishlist::create([
                'account_id' => $accountId,
                'user_id' => $userId,
                'product_id' => $productId,
            ]);
            return response()->json(['message' => 'Added to wishlist', 'in_wishlist' => true], 201);
        }
    }
}
