<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cart;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Customer;
use App\Models\Invoice;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrderController extends Controller
{
    private function generateOrderNumber()
    {
        $lastOrder = Order::where('order_number', 'LIKE', 'OR%A0')->withTrashed()->orderBy('id', 'desc')->first();
        $nextNumber = 10000;
        if ($lastOrder && preg_match('/OR(\d+)A0/', $lastOrder->order_number, $matches)) {
            $nextNumber = intval($matches[1]) + 1;
        }
        return "OR{$nextNumber}A0";
    }

    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        
        // Base select for listing - avoid * to reduce payload
        $query = Order::query()
            ->where('account_id', $accountId)
            ->select([
                'id', 'order_number', 'total_price', 'status', 'customer_name', 
                'customer_phone', 'shipping_address', 'created_at', 'notes'
            ]);

        // Eager load only what is needed for the table
        $query->with([
            'items:id,order_id,account_id,product_id,product_name_snapshot,product_sku_snapshot,quantity,price',
            'items.product:id,name,sku',
            'customer:id,name,phone',
            'attributeValues:id,order_id,attribute_id,value',
            'attributeValues.attribute:id,name,code'
        ]);

        if ($request->input('trashed') == '1') {
            $query->onlyTrashed();
        }
        
        $query->when($request->filled('search'), function($q) use ($request) {
            $search = $request->input('search');
            $q->where(function($sub) use ($search) {
                // Order-level fields
                $sub->where('order_number', 'like', "{$search}%")
                    ->orWhere('customer_name', 'like', "%{$search}%")
                    ->orWhere('customer_phone', 'like', "{$search}%")
                    ->orWhere('shipping_address', 'like', "%{$search}%")
                    ->orWhere('notes', 'like', "%{$search}%")
                    // Product-level: search by snapshot SKU/name stored in order_items
                    ->orWhereHas('items', function($iq) use ($search) {
                        $iq->where('product_sku_snapshot', 'like', "%{$search}%")
                           ->orWhere('product_name_snapshot', 'like', "%{$search}%");
                    })
                    // Also search live product data via JOIN (catches new/updated products)
                    ->orWhereHas('items.product', function($pq) use ($search) {
                        $pq->where('sku', 'like', "%{$search}%")
                           ->orWhere('name', 'like', "%{$search}%");
                    });
            });
        })
        ->when($request->filled('customer_name'), function($q) use ($request) {
            $q->where('customer_name', 'like', "%{$request->customer_name}%");
        })
        ->when($request->filled('order_number'), function($q) use ($request) {
            $q->where('order_number', 'like', "{$request->order_number}%");
        })
        ->when($request->filled('customer_phone'), function($q) use ($request) {
            $q->where('customer_phone', 'like', "{$request->customer_phone}%");
        })
        ->when($request->filled('shipping_address'), function($q) use ($request) {
            $q->where('shipping_address', 'like', "%{$request->shipping_address}%");
        })
        ->when($request->filled('status'), function($q) use ($request) {
            $statuses = is_array($request->status) ? $request->status : explode(',', $request->status);
            $q->whereIn('status', $statuses);
        })
        ->when($request->filled('created_at_from'), function($q) use ($request) {
            $q->whereDate('created_at', '>=', $request->created_at_from);
        })
        ->when($request->filled('created_at_to'), function($q) use ($request) {
            $q->whereDate('created_at', '<=', $request->created_at_to);
        });

        // Optimize Dynamic Attribute Filters (EAV) using JOIN for large data
        foreach ($request->all() as $key => $value) {
            if (strpos($key, 'attr_order_') === 0 && !empty($value)) {
                $attrId = str_replace('attr_order_', '', $key);
                $query->whereExists(function ($q) use ($attrId, $value) {
                    $q->select(DB::raw(1))
                        ->from('order_attribute_values')
                        ->whereRaw('order_attribute_values.order_id = orders.id')
                        ->where('attribute_id', $attrId)
                        ->where('value', 'like', "%{$value}%");
                });
            }
        }

        $sortBy = $request->input('sort_by', 'created_at');
        $sortOrder = $request->input('sort_order', 'desc');
        
        if ($sortBy === 'status') {
            $query->leftJoin('order_statuses', function($join) use ($accountId) {
                    $join->on('orders.status', '=', 'order_statuses.code')
                         ->where('order_statuses.account_id', '=', $accountId);
                })
                ->orderBy('order_statuses.sort_order', $sortOrder);
        } else {
            $validSortFields = ['id', 'order_number', 'customer_name', 'created_at', 'total_price', 'status'];
            $field = in_array($sortBy, $validSortFields) ? $sortBy : 'created_at';
            $query->orderBy($field, $sortOrder);
        }

        $perPage = (int) $request->input('per_page', 20);
        // Ensure per_page is capped to prevent DOS
        $perPage = min(max($perPage, 1), 100);

        return response()->json($query->paginate($perPage));
    }

    public function store(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        
        \Illuminate\Support\Facades\Log::info('Order Store Reached', [
            'account_id' => $accountId,
            'data' => $request->all()
        ]);

        return DB::transaction(function () use ($request, $accountId) {
            $items = [];
            $totalPrice = 0;

            if ($request->has('items')) {
                foreach ($request->items as $item) {
                    $productId = data_get($item, 'product_id');
                    if (!$productId) continue;

                    $product = \App\Models\Product::find($productId);
                    $price = data_get($item, 'price');
                    $qty = data_get($item, 'quantity');

                    $items[] = [
                        'product_id' => $productId,
                        'product_name_snapshot' => $product ? $product->name : null,
                        'product_sku_snapshot' => $product ? $product->sku : null,
                        'quantity' => $qty,
                        'price' => $price,
                        'cost_price' => data_get($item, 'cost_price', 0),
                    ];
                    $totalPrice += ($price * $qty);
                }
            } else {
                $cart = Cart::with('items.product')->where('user_id', Auth::id())->first();
                if (!$cart || $cart->items->isEmpty()) {
                    return response()->json(['message' => 'Cart is empty'], 400);
                }
                foreach ($cart->items as $item) {
                    $items[] = [
                        'product_id' => $item->product_id,
                        'product_name_snapshot' => $item->product ? $item->product->name : null,
                        'product_sku_snapshot' => $item->product ? $item->product->sku : null,
                        'quantity' => $item->quantity,
                        'price' => $item->product ? ($item->product->current_price ?? $item->price) : $item->price,
                        'cost_price' => $item->product ? ($item->product->cost_price ?? 0) : 0,
                    ];
                    $totalPrice += ($item->product ? ($item->product->current_price ?? $item->price) : $item->price) * $item->quantity;
                }
            }

            $costTotal = array_sum(array_map(fn($item) => $item['cost_price'] * $item['quantity'], $items));

            $customer = Customer::firstOrCreate(
                ['account_id' => $accountId, 'phone' => $request->customer_phone],
                ['name' => $request->customer_name, 'email' => $request->customer_email, 'address' => $request->shipping_address]
            );

            $order = Order::create([
                'user_id' => Auth::id(),
                'account_id' => $accountId,
                'customer_id' => $customer->id,
                'order_number' => $this->generateOrderNumber(),
                'total_price' => $totalPrice,
                'status' => $request->status ?? (\App\Models\OrderStatus::where('account_id', $accountId)->where('is_default', true)->value('code') ?: 'new'),
                'customer_name' => $request->customer_name,
                'customer_email' => $request->customer_email,
                'customer_phone' => $request->customer_phone,
                'shipping_address' => $request->shipping_address,
                'district' => $request->district,
                'ward' => $request->ward,
                'notes' => $request->notes,
                'source' => $request->source,
                'type' => $request->type,
                'shipment_status' => $request->shipment_status,
                'shipping_fee' => $request->shipping_fee ?? 0,
                'discount' => $request->discount ?? 0,
                'cost_total' => $request->cost_total ?? 0,
            ]);

            foreach ($items as $item) {
                OrderItem::create([
                    'order_id' => $order->id,
                    'account_id' => $accountId,
                    'product_id' => $item['product_id'],
                    'product_name_snapshot' => $item['product_name_snapshot'] ?? null,
                    'product_sku_snapshot' => $item['product_sku_snapshot'] ?? null,
                    'quantity' => $item['quantity'],
                    'price' => $item['price'],
                    'cost_price' => $item['cost_price'],
                ]);
            }

            // Sync Order EAV custom attributes
            if ($request->has('custom_attributes')) {
                foreach ($request->custom_attributes as $attrCode => $val) {
                    $attribute = \App\Models\Attribute::firstOrCreate(
                        ['account_id' => $accountId, 'code' => $attrCode],
                        ['name' => ucwords(str_replace('_', ' ', $attrCode)), 'frontend_type' => 'text']
                    );

                    \App\Models\OrderAttributeValue::create([
                        'order_id' => $order->id,
                        'attribute_id' => $attribute->id,
                        'value' => is_array($val) ? json_encode($val) : $val
                    ]);
                }
            }

            $customer->increment('total_orders');
            $customer->increment('total_spent', $totalPrice);

            Invoice::create([
                'order_id' => $order->id,
                'invoice_number' => 'INV-' . strtoupper(Str::random(10)),
                'amount' => $totalPrice,
                'status' => 'pending',
                'due_date' => now()->addDays(3),
            ]);

            if (!$request->has('items')) {
                Cart::where('user_id', Auth::id())->first()->items()->delete();
            }

            return response()->json($order->load(['items', 'customer', 'attributeValues']), 201);
        });
    }

    public function show($id)
    {
        $order = Order::with(['items.product', 'customer', 'shipments', 'payment', 'attributeValues.attribute', 'user'])->findOrFail($id);
        return response()->json($order);
    }

    public function update(Request $request, $id)
    {
        $validator = \Illuminate\Support\Facades\Validator::make($request->all(), [
            'order_number' => 'sometimes|string|max:255',
            'customer_name' => 'sometimes|string|max:255',
            'customer_email' => 'nullable|max:255',
            'customer_phone' => 'nullable|string|max:20',
            'shipping_address' => 'nullable|string',
            'notes' => 'nullable|string',
            'custom_attributes' => 'nullable|array',
        ]);

        if ($validator->fails()) {
            \Illuminate\Support\Facades\Log::error('Order Update Validation Failed', [
                'errors' => $validator->errors()->toArray(),
                'request_data' => $request->all()
            ]);
            return response()->json(['errors' => $validator->errors()], 422);
        }

        $order = Order::findOrFail($id);
        $accountId = $order->account_id;

        // Check unique order_number if provided
        if ($request->has('order_number') && $request->order_number !== $order->order_number) {
            $exists = Order::where('account_id', $accountId)
                ->where('order_number', $request->order_number)
                ->where('id', '!=', $id)
                ->exists();
            if ($exists) {
                return response()->json(['message' => 'Mã đơn hàng này đã tồn tại trong hệ thống!'], 422);
            }
        }

        \Illuminate\Support\Facades\Log::info("Order Update Data for ID: $id", $request->all());

        return DB::transaction(function () use ($request, $order) {
            $data = $request->only([
                'order_number', 'customer_name', 'customer_email', 'customer_phone', 
                'shipping_address', 'district', 'ward', 'notes', 'source', 
                'type', 'shipment_status', 'shipping_fee', 'discount', 'cost_total', 'status'
            ]);
            
            $order->update($data);

            // Sync items if provided
            if ($request->has('items')) {
                $order->items()->delete();
                $totalPrice = 0;
                foreach ($request->items as $item) {
                    $order->items()->create([
                        'account_id' => $order->account_id,
                        'product_id' => $item['product_id'],
                        'quantity' => $item['quantity'],
                        'price' => $item['price'],
                        'cost_price' => $item['cost_price'] ?? 0,
                    ]);
                    $totalPrice += $item['price'] * $item['quantity'];
                }
                
                $finalTotal = $totalPrice + ($request->shipping_fee ?? 0) - ($request->discount ?? 0);
                $order->update(['total_price' => $finalTotal]);
            }

            // Sync Order EAV custom attributes
            if ($request->has('custom_attributes')) {
                foreach ($request->custom_attributes as $attrCode => $val) {
                    $attribute = \App\Models\Attribute::where('code', $attrCode)->first();
                    if ($attribute) {
                        \App\Models\OrderAttributeValue::updateOrCreate(
                            ['order_id' => $order->id, 'attribute_id' => $attribute->id],
                            ['value' => is_array($val) ? json_encode($val) : $val]
                        );
                    }
                }
            }

            return response()->json($order->load(['items.product', 'customer', 'attributeValues.attribute']));
        });
    }

    public function destroy($id)
    {
        $order = Order::findOrFail($id);
        $order->delete();
        return response()->json(['message' => 'Order deleted successfully']);
    }

    public function duplicate($id)
    {
        $original = Order::with(['items', 'attributeValues'])->findOrFail($id);
        
        return DB::transaction(function () use ($original) {
            $new = $original->replicate();
            $new->order_number = $this->generateOrderNumber();
            $new->status = \App\Models\OrderStatus::where('account_id', $original->account_id)->where('is_default', true)->value('code') ?: 'new';
            $new->save();

            foreach ($original->items as $item) {
                $newItem = $item->replicate();
                $newItem->order_id = $new->id;
                $newItem->save();
            }

            foreach ($original->attributeValues as $val) {
                $newVal = $val->replicate();
                $newVal->order_id = $new->id;
                $newVal->save();
            }

            return response()->json($new->load(['items.product', 'customer', 'attributeValues.attribute']));
        });
    }

    public function updateStatus(Request $request, $id)
    {
        try {
            $request->validate(['status' => 'required|string']);
            
            return DB::transaction(function () use ($request, $id) {
                $order = Order::findOrFail($id);
                $newStatus = $request->status;
                $oldStatus = $order->status;

                if ($newStatus === $oldStatus) {
                    return response()->json($order->load(['items', 'customer', 'attributeValues.attribute', 'shipments']));
                }

                // Validate that the status exists in order_statuses for this account
                $exists = \App\Models\OrderStatus::where('account_id', $order->account_id)
                    ->where('code', $newStatus)
                    ->exists();
                
                if (!$exists) {
                    return response()->json(['message' => "Trạng thái '{$newStatus}' không hợp lệ cho hệ thống của bạn."], 422);
                }

                // Check if shipping-related statuses are locked by active shipment
                $shippingLockedStatuses = ['shipping', 'completed', 'pending_return', 'returned'];
                if (in_array($newStatus, $shippingLockedStatuses) && $order->hasActiveShipment()) {
                    $syncService = app(\App\Services\Shipping\ShipmentStatusSyncService::class);
                    $canEdit = $syncService->canManuallyEditOrderShipping($order);
                    
                    if (!$canEdit['allowed']) {
                        return response()->json([
                            'message' => $canEdit['reason'],
                            'shipping_locked' => true,
                            'shipment_number' => $canEdit['shipment_number'] ?? null,
                        ], 422);
                    }
                }

                // Log order status change
                \App\Models\OrderStatusLog::create([
                    'order_id'    => $order->id,
                    'from_status' => $oldStatus,
                    'to_status'   => $newStatus,
                    'source'      => 'manual',
                    'changed_by'  => auth()->id(),
                    'reason'      => $request->reason ?? 'Cập nhật nhanh từ danh sách',
                ]);

                $order->update(['status' => $newStatus]);
                
                return response()->json($order->load(['items', 'customer', 'attributeValues.attribute', 'shipments']));
            });
        } catch (\Illuminate\Validation\ValidationException $e) {
            return response()->json(['errors' => $e->errors(), 'message' => 'Dữ liệu không hợp lệ'], 422);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("Order Status Update Error for ID {$id}: " . $e->getMessage());
            return response()->json(['message' => 'Có lỗi xảy ra: ' . $e->getMessage()], 500);
        }
    }

    public function restore($id)
    {
        $order = Order::withTrashed()->findOrFail($id);
        $order->restore();
        return response()->json(['message' => 'Order restored successfully']);
    }

    public function bulkDelete(Request $request)
    {
        $ids = $request->input('ids', []);
        if (empty($ids)) return response()->json(['message' => 'No IDs provided'], 400);

        if ($request->input('force') == '1') {
            if (Auth::user()->role !== 'admin') {
                return response()->json(['message' => 'Bạn không có quyền xóa vĩnh viễn đơn hàng.'], 403);
            }
            Order::whereIn('id', $ids)->withTrashed()->forceDelete();
        } else {
            Order::whereIn('id', $ids)->delete();
        }

        return response()->json(['message' => 'Thao tác xóa thành công']);
    }

    public function bulkRestore(Request $request)
    {
        $ids = $request->input('ids', []);
        if (empty($ids)) return response()->json(['message' => 'No IDs provided'], 400);

        Order::whereIn('id', $ids)->withTrashed()->restore();
        return response()->json(['message' => 'Orders restored successfully']);
    }

    public function bulkDuplicate(Request $request)
    {
        $ids = $request->input('ids', []);
        if (empty($ids)) return response()->json(['message' => 'No IDs provided'], 400);

        $duplicatedCount = 0;
        DB::transaction(function () use ($ids, &$duplicatedCount) {
            foreach ($ids as $id) {
                $original = Order::with(['items', 'attributeValues'])->find($id);
                if (!$original) continue;

                $new = $original->replicate();
                $new->order_number = $this->generateOrderNumber();
                $new->status = \App\Models\OrderStatus::where('account_id', $original->account_id)->where('is_default', true)->value('code') ?: 'new';
                $new->save();

                foreach ($original->items as $item) {
                    $newItem = $item->replicate();
                    $newItem->order_id = $new->id;
                    $newItem->save();
                }

                foreach ($original->attributeValues as $val) {
                    $newVal = $val->replicate();
                    $newVal->order_id = $new->id;
                    $newVal->save();
                }
                $duplicatedCount++;
            }
        });

        return response()->json(['message' => $duplicatedCount . ' orders duplicated successfully']);
    }

    public function bulkUpdate(Request $request)
    {
        $ids = $request->input('ids', []);
        if (empty($ids)) return response()->json(['message' => 'Chưa chọn đơn hàng nào.'], 400);

        $data = $request->only([
            'status', 'notes', 'source', 'type', 'shipment_status'
        ]);
        
        $customAttributes = $request->input('custom_attributes', []);

        \Illuminate\Support\Facades\DB::transaction(function () use ($ids, $data, $customAttributes) {
            if (!empty($data)) {
                Order::whereIn('id', $ids)->update($data);
            }

            if (!empty($customAttributes)) {
                foreach ($ids as $orderId) {
                    foreach ($customAttributes as $attrId => $val) {
                        \App\Models\OrderAttributeValue::updateOrCreate(
                            ['order_id' => $orderId, 'attribute_id' => $attrId],
                            ['value' => is_array($val) ? json_encode($val) : $val]
                        );
                    }
                }
            }
        });

        return response()->json(['message' => 'Cập nhật hàng loạt thành công']);
    }
}
