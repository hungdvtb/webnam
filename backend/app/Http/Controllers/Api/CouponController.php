<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Coupon;
use Illuminate\Http\Request;

class CouponController extends Controller
{
    public function validate(Request $request)
    {
        $request->validate([
            'code' => 'required|string',
            'order_value' => 'required|numeric',
        ]);

        $accountId = $request->header('X-Account-Id');
        
        $coupon = Coupon::where('account_id', $accountId)
            ->where('code', strtoupper($request->code))
            ->first();

        if (!$coupon) {
             return response()->json(['message' => 'Coupon không tồn tại.'], 400);
        }

        if (!$coupon->isValid()) {
            return response()->json(['message' => 'Coupon đã hết hạn hoặc hết lượt sử dụng.'], 400);
        }

        if ($request->order_value < $coupon->min_order_value) {
            return response()->json(['message' => 'Giá trị đơn hàng chưa đủ để áp dụng coupon này.'], 400);
        }

        $discountAmount = 0;
        if ($coupon->type === 'percent') {
            $discountAmount = ($request->order_value * $coupon->value) / 100;
            if ($coupon->max_discount_amount && $discountAmount > $coupon->max_discount_amount) {
                $discountAmount = $coupon->max_discount_amount;
            }
        } else {
            $discountAmount = $coupon->value;
        }

        return response()->json([
            'message' => 'Áp dụng mã thành công.',
            'coupon' => $coupon,
            'discount_amount' => min($discountAmount, $request->order_value),
        ]);
    }

    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        $coupons = Coupon::where('account_id', $accountId)->latest()->get();
        return response()->json($coupons);
    }

    public function store(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        $request->validate([
            'code' => 'required|string|unique:coupons,code',
            'type' => 'required|in:fixed,percent',
            'value' => 'required|numeric',
        ]);

        $coupon = Coupon::create(array_merge($request->all(), ['account_id' => $accountId, 'code' => strtoupper($request->code)]));
        return response()->json($coupon, 201);
    }
}
