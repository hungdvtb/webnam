<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductImage;
use App\Models\BulkUpdateLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

use Illuminate\Database\Eloquent\Builder;

class ProductController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        // Start with optimized column selection for products list to reduce memory & payload
        $query = Product::query()
            ->select([
                'id', 'sku', 'name', 'price', 'cost_price', 'stock_quantity', 
                'type', 'category_id', 'is_featured', 'is_new', 'created_at', 'status'
            ])
            ->with([
                'categories:id,name', 
                'category:id,name',                'images:id,product_id,image_url,is_primary',
                'attributeValues:id,product_id,attribute_id,value',
                'attributeValues.attribute:id,name,code,is_filterable,is_filterable_backend',
                'parentProducts:id,name',
                'linkedProducts:id,sku,name,price,cost_price,stock_quantity,type'
            ]);

        // Handle Trash View
        if ($request->boolean('is_trash')) {
            $query->onlyTrashed();
        }

        // Filter by category
        if ($request->filled('category_id')) {
            if ($request->category_id === 'uncategorized') {
                $query->whereNull('category_id')->doesntHave('categories');
            } else {
                $query->where(function($q) use ($request) {
                    $q->where('category_id', $request->category_id)
                      ->orWhereHas('categories', function($sub) use ($request) {
                          $sub->where('categories.id', $request->category_id);
                      });
                });
            }
        }
        
        if ($request->filled('category_ids')) {
            $catIds = is_array($request->category_ids) ? $request->category_ids : explode(',', $request->category_ids);
            $query->where(function($q) use ($catIds) {
                $q->whereIn('category_id', $catIds)
                  ->orWhereHas('categories', function($sub) use ($catIds) {
                      $sub->whereIn('categories.id', $catIds);
                  });
            });
        }

        // Search by name & SKU & more (Advanced Fuzzy & Token Matching)
        if ($request->filled('search')) {
            $search = trim($request->search);
            // Split into tokens
            $tokens = preg_split('/\s+/', $search, -1, PREG_SPLIT_NO_EMPTY);

            if (!empty($tokens)) {
                $query->where(function ($q) use ($tokens) {
                    foreach ($tokens as $token) {
                        $q->where(function ($sub) use ($token) {
                            $escapedToken = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $token) . '%';
                            $fuzzyToken = '%' . implode('%', preg_split('//u', str_replace(['%', '_'], '', $token), -1, PREG_SPLIT_NO_EMPTY)) . '%';

                            // Name match
                            $sub->whereRaw('immutable_unaccent(name) ILIKE immutable_unaccent(?)', [$escapedToken])
                                // SKU match (substring or compacted substring)
                                ->orWhereRaw('immutable_unaccent(sku) ILIKE immutable_unaccent(?)', [$escapedToken])
                                ->orWhereRaw("immutable_unaccent(REGEXP_REPLACE(sku, '[^a-zA-Z0-9]', '', 'g')) ILIKE immutable_unaccent(?)", [$escapedToken])
                                // SKU fuzzy/subsequence match
                                ->orWhereRaw("immutable_unaccent(REGEXP_REPLACE(sku, '[^a-zA-Z0-9]', '', 'g')) ILIKE immutable_unaccent(?)", [$fuzzyToken]);

                        });
                    }
                });
            }
        }

        // Numberic Filters
        if ($request->filled('min_price')) $query->where('price', '>=', $request->min_price);
        if ($request->filled('max_price')) $query->where('price', '<=', $request->max_price);
        if ($request->filled('min_stock')) $query->where('stock_quantity', '>=', $request->min_stock);
        if ($request->filled('max_stock')) $query->where('stock_quantity', '<=', $request->max_stock);

        // Filter by date range
        if ($request->filled('start_date')) $query->whereDate('created_at', '>=', $request->start_date);
        if ($request->filled('end_date')) $query->whereDate('created_at', '<=', $request->end_date);

        // Flags
        if ($request->filled('is_featured')) $query->where('is_featured', $request->boolean('is_featured'));
        if ($request->filled('is_new')) $query->where('is_new', $request->boolean('is_new'));
        // Type Filtering (Improved for Variants logic)
        if ($request->filled('type')) {
            $type = $request->input('type');
            if ($type === 'configurable') {
                // Trả về sản phẩm cha thực sự có biến thể
                $query->where('type', 'configurable')
                      ->whereHas('linkedProducts', function($q) {
                          $q->where('product_links.link_type', 'super_link');
                      });
            } elseif ($type === 'simple') {
                // Trả về sản phẩm đơn độc lập (không phải là biến thể của sản phẩm khác)
                $query->where('type', 'simple')
                      ->whereDoesntHave('parentProducts', function($q) {
                          $q->where('product_links.link_type', 'super_link');
                      });
            } else {
                $query->where('type', $type);
            }
        }

        // Filter by EAV Attributes
        $inputAttributes = $request->input('attributes');
        if (!empty($inputAttributes) && is_array($inputAttributes)) {
            foreach ($inputAttributes as $attrId => $values) {
                if (empty($values)) continue;
                $valueArray = is_array($values) ? $values : explode(',', $values);

                $query->whereHas('attributeValues', function ($q) use ($attrId, $valueArray) {
                    $q->where('attribute_id', $attrId)
                      ->where(function ($sub) use ($valueArray) {
                          foreach ($valueArray as $val) {
                              $sub->orWhere('value', $val)
                                  ->orWhere('value', 'LIKE', '%"' . $val . '"%');
                          }
                      });
                });
            }
        }

        // Sorting
        $sortBy = $request->input('sort_by', 'created_at');
        $sortOrder = $request->input('sort_order', 'desc');

        $sortMapping = ['stock' => 'stock_quantity', 'category' => 'category_id'];
        $validSortFields = ['id', 'sku', 'name', 'price', 'cost_price', 'stock_quantity', 'created_at', 'type', 'category_id'];

        $field = $sortMapping[$sortBy] ?? $sortBy;
        if (!in_array($field, $validSortFields)) $field = 'created_at';
        
        $order = (strtolower($sortOrder) === 'asc') ? 'asc' : 'desc';
        $query->orderBy($field, $order);

        $perPage = (int) $request->get('per_page', 20);
        // Ensure perPage is reasonable
        $perPage = min(max($perPage, 1), 100);

        return response()->json($query->paginate($perPage));
    }


    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'type' => 'required|string|in:simple,configurable,grouped,virtual,bundle,downloadable',
            'name' => 'required|string|max:255',
            'category_id' => 'required|exists:categories,id',
            'category_ids' => 'nullable|array',
            'category_ids.*' => 'exists:categories,id',
            'price' => 'required|numeric|min:0',
            'cost_price' => 'nullable|numeric|min:0',
            'special_price' => 'nullable|numeric|min:0',
            'special_price_from' => 'nullable|date',
            'special_price_to' => 'nullable|date',
            'description' => 'nullable|string',
            'is_featured' => 'boolean',
            'is_new' => 'boolean',
            'stock_quantity' => 'integer|min:0',
            'weight' => 'nullable|string',
            'sku' => 'nullable|string|unique:products,sku',
            'meta_title' => 'nullable|string',
            'meta_description' => 'nullable|string',
            'meta_keywords' => 'nullable|string',
            'specifications' => 'nullable|string',
            // linkages
            'linked_product_ids' => 'nullable|array',
            'linked_product_ids.*' => 'exists:products,id',
            'link_type' => 'nullable|string',
            'super_attribute_ids' => 'nullable|array',
            'super_attribute_ids.*' => 'exists:attributes,id',
            // EAV custom values
            'custom_attributes' => 'nullable|array',
            // images
            'main_image' => 'nullable|image',
            'images' => 'nullable|array',
            'images.*' => 'image',
        ]);

        $product = Product::create(array_merge($validated, ['account_id' => $request->header('X-Account-Id')]));

        if ($request->has('category_ids')) {
            $product->categories()->sync($request->category_ids);
        } else {
            // Default to primary category if no multi-select provided
            $product->categories()->sync([$request->category_id]);
        }

        if ($request->hasFile('main_image')) {
            $path = $request->file('main_image')->store('products', 'public');
            ProductImage::create([
                'product_id' => $product->id,
                'image_url' => Storage::disk('public')->url($path),
                'file_name' => $request->file('main_image')->getClientOriginalName(),
                'file_size' => $request->file('main_image')->getSize(),
                'is_primary' => true
            ]);
        }

        if ($request->hasFile('images')) {
            foreach ($request->file('images') as $idx => $image) {
                $path = $image->store('products', 'public');
                // If no main_image provided, set first in array as primary
                $isPrimary = (!$request->hasFile('main_image')) && ($idx === 0);
                ProductImage::create([
                    'product_id' => $product->id,
                    'image_url' => Storage::disk('public')->url($path),
                    'file_name' => $image->getClientOriginalName(),
                    'file_size' => $image->getSize(),
                    'is_primary' => $isPrimary,
                    'sort_order' => $idx
                ]);
            }
        }

        if ($request->has('custom_attributes')) {
            foreach ($request->custom_attributes as $attrId => $val) {
                $rawValue = is_array($val) ? json_encode($val) : $val;
                \App\Models\ProductAttributeValue::create([
                    'product_id' => $product->id,
                    'attribute_id' => $attrId,
                    'value' => $rawValue
                ]);
            }
        }

        if ($request->has('linked_product_ids')) {
            $type = $request->get('link_type', 'related');
            $links = [];
            foreach ($request->linked_product_ids as $idx => $id) {
                $links[$id] = ['link_type' => $type, 'position' => $idx];
            }
            $product->linkedProducts()->syncWithoutDetaching($links);
        }

        if ($request->has('super_attribute_ids') && $product->type === 'configurable') {
            $attrs = [];
            foreach ($request->super_attribute_ids as $idx => $id) {
                $attrs[$id] = ['position' => $idx];
            }
            $product->superAttributes()->sync($attrs);
        }

        // Handle variants creation
        if ($request->has('variants') && $product->type === 'configurable') {
            foreach ($request->variants as $vData) {
                $variant = Product::create([
                    'account_id' => $product->account_id,
                    'type' => 'simple',
                    'name' => $product->name . ' - ' . ($vData['sku'] ?? 'Variant'),
                    'sku' => $vData['sku'],
                    'price' => $vData['price'],
                    'cost_price' => $vData['cost_price'] ?? null,
                    'weight' => $vData['weight'] ?? null,
                    'stock_quantity' => $vData['stock_quantity'] ?? 0,
                    'category_id' => $product->category_id,
                    'status' => $product->status,
                ]);

                // Link to parent
                $product->linkedProducts()->attach($variant->id, ['link_type' => 'super_link']);

                // Save variant attribute values
                if (isset($vData['attributes'])) {
                    foreach ($vData['attributes'] as $attrId => $val) {
                        \App\Models\ProductAttributeValue::create([
                            'product_id' => $variant->id,
                            'attribute_id' => $attrId,
                            'value' => $val
                        ]);
                    }
                }
            }
        }

        return response()->json($product->load(['category', 'categories', 'images', 'linkedProducts.attributeValues', 'superAttributes', 'attributeValues.attribute']), 201);
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        $product = Product::with([
            'category',
            'categories',
            'images',
            'linkedProducts.attributeValues',
            'superAttributes.options',
            'attributeValues.attribute',
            'approvedReviews.user'
        ])->findOrFail($id);
        return response()->json($product);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, $id)
    {
        $product = Product::findOrFail($id);

        $validated = $request->validate([
            'type' => 'sometimes|required|string|in:simple,configurable,grouped,virtual,bundle,downloadable',
            'name' => 'sometimes|required|string|max:255',
            'category_id' => 'sometimes|required|exists:categories,id',
            'category_ids' => 'nullable|array',
            'category_ids.*' => 'exists:categories,id',
            'price' => 'sometimes|required|numeric|min:0',
            'cost_price' => 'nullable|numeric|min:0',
            'special_price' => 'nullable|numeric|min:0',
            'special_price_from' => 'nullable|date',
            'special_price_to' => 'nullable|date',
            'description' => 'nullable|string',
            'is_featured' => 'boolean',
            'is_new' => 'boolean',
            'stock_quantity' => 'integer|min:0',
            'weight' => 'nullable|string',
            'sku' => 'nullable|string|unique:products,sku,' . $id,
            'meta_title' => 'nullable|string',
            'meta_description' => 'nullable|string',
            'meta_keywords' => 'nullable|string',
            'specifications' => 'nullable|string',
            'linked_product_ids' => 'nullable|array',
            'linked_product_ids.*' => 'exists:products,id',
            'link_type' => 'nullable|string',
            'super_attribute_ids' => 'nullable|array',
            'super_attribute_ids.*' => 'exists:attributes,id',
            // EAV custom values
            'custom_attributes' => 'nullable|array',
        ]);

        // Capture which fields changed before saving
        $nameChanged = $product->isDirty('name');
        $skuChanged = $product->isDirty('sku');

        $product->update($validated);

        // ─── Sync snapshots on all linked order_items (batch UPDATE) ────────────
        // Runs one SQL query regardless of how many orders reference this product.
        if ($nameChanged || $skuChanged) {
            \App\Models\OrderItem::where('product_id', $product->id)
                ->update([
                'product_name_snapshot' => $product->name,
                'product_sku_snapshot' => $product->sku,
            ]);
        }
        // ────────────────────────────────────────────────────────────────────────
        // Sync categories
        if ($request->has('category_ids')) {
            $product->categories()->sync($request->category_ids);
        } elseif ($request->has('category_id')) {
            // If only primary category changed, sync it as well
            $product->categories()->syncWithoutDetaching([$request->category_id]);
        }
        // Sync EAV custom attributes
        if ($request->has('custom_attributes')) {
            foreach ($request->custom_attributes as $attrId => $val) {
                // $val could be string, or array (for multiselect)
                $rawValue = is_array($val) ? json_encode($val) : $val;

                \App\Models\ProductAttributeValue::updateOrCreate(
                ['product_id' => $product->id, 'attribute_id' => $attrId],
                ['value' => $rawValue]
                );
            }
        }

        if ($request->has('linked_product_ids')) {
            $type = $request->get('link_type', 'related');
            $links = [];
            foreach ($request->linked_product_ids as $idx => $id) {
                $links[$id] = ['link_type' => $type, 'position' => $idx];
            }
            
            // Preserve existing super_link variants
            $preserveVariantIds = $product->linkedProducts()->wherePivot('link_type', 'super_link')->pluck('products.id')->toArray();
            foreach ($preserveVariantIds as $vid) {
                if (!isset($links[$vid])) {
                    $links[$vid] = ['link_type' => 'super_link'];
                }
            }
            
            $product->linkedProducts()->sync($links);
        }

        if ($request->has('super_attribute_ids') && $product->type === 'configurable') {
            $attrs = [];
            foreach ($request->super_attribute_ids as $idx => $id) {
                $attrs[$id] = ['position' => $idx];
            }
            $product->superAttributes()->sync($attrs);
        }

        // Handle variants sync
        if ($request->has('variants') && $product->type === 'configurable') {
            $incomingVariantIds = [];
            foreach ($request->variants as $vData) {
                if (isset($vData['id'])) {
                    $variant = Product::findOrFail($vData['id']);
                    $variant->update([
                        'sku' => $vData['sku'],
                        'price' => $vData['price'],
                        'cost_price' => $vData['cost_price'] ?? null,
                        'weight' => $vData['weight'] ?? null,
                        'stock_quantity' => $vData['stock_quantity'] ?? 0,
                    ]);
                    $incomingVariantIds[] = $variant->id;
                } else {
                    $variant = Product::create([
                        'account_id' => $product->account_id,
                        'type' => 'simple',
                        'name' => $product->name . ' - ' . ($vData['sku'] ?? 'Variant'),
                        'sku' => $vData['sku'],
                        'price' => $vData['price'],
                        'cost_price' => $vData['cost_price'] ?? null,
                        'weight' => $vData['weight'] ?? null,
                        'stock_quantity' => $vData['stock_quantity'] ?? 0,
                        'category_id' => $product->category_id,
                        'status' => $product->status,
                    ]);
                    $product->linkedProducts()->attach($variant->id, ['link_type' => 'super_link']);
                    $incomingVariantIds[] = $variant->id;

                    // Save variant attribute values
                    if (isset($vData['attributes'])) {
                        foreach ($vData['attributes'] as $attrId => $val) {
                            \App\Models\ProductAttributeValue::create([
                                'product_id' => $variant->id,
                                'attribute_id' => $attrId,
                                'value' => $val
                            ]);
                        }
                    }
                }
            }

            // Optional: Remove variants that are no longer in the list
            // $existingVariantIds = $product->linkedProducts()->wherePivot('link_type', 'super_link')->pluck('products.id')->toArray();
            // $toDelete = array_diff($existingVariantIds, $incomingVariantIds);
            // Product::whereIn('id', $toDelete)->delete();
        }

        return response()->json($product->load(['category', 'categories', 'images', 'linkedProducts.attributeValues', 'superAttributes', 'attributeValues.attribute']));
    }

    /**
     * Duplicate the specified resource.
     */
    public function duplicate($id)
    {
        $original = Product::with(['attributeValues', 'images', 'superAttributes', 'linkedProducts'])->where('id', $id)->firstOrFail();

        // Clone attributes
        $clone = $original->replicate();
        $clone->name = $original->name . ' (Copy)';
        $clone->sku = $original->sku ? $original->sku . '-COPY-' . strtoupper(\Illuminate\Support\Str::random(4)) : null;
        $clone->slug = \Illuminate\Support\Str::slug($clone->name) . '-' . strtolower(\Illuminate\Support\Str::random(6));
        $clone->status = false; // Set to inactive by default for clone
        $clone->is_new = true;
        $clone->save();

        // Copy images
        foreach ($original->images as $img) {
            ProductImage::create([
                'product_id' => $clone->id,
                'image_url' => $img->image_url,
                'is_primary' => $img->is_primary,
                'sort_order' => $img->sort_order
            ]);
        }

        // Copy EAV attributes
        foreach ($original->attributeValues as $av) {
            \App\Models\ProductAttributeValue::create([
                'product_id' => $clone->id,
                'attribute_id' => $av->attribute_id,
                'value' => $av->value
            ]);
        }

        // Copy super attributes (for configurable)
        if ($original->type === 'configurable') {
            foreach ($original->superAttributes as $sa) {
                $clone->superAttributes()->attach($sa->id, ['position' => $sa->pivot->position]);
            }
        }

        // Copy linked products (for grouped/bundle)
        if (in_array($original->type, ['grouped', 'bundle', 'configurable'])) {
            foreach ($original->linkedProducts as $lp) {
                $clone->linkedProducts()->attach($lp->id, [
                    'link_type' => $lp->pivot->link_type,
                    'position' => $lp->pivot->position
                ]);
            }
        }

        // Copy categories
        $clone->categories()->sync($original->categories->pluck('id')->toArray());

        return response()->json($clone->load(['category', 'categories', 'images', 'attributeValues.attribute']));
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy($id)
    {
        $product = Product::findOrFail($id);
        $product->delete();

        return response()->json(['message' => 'Sản phẩm đã được chuyển vào thùng rác']);
    }

    /**
     * Restore the specified resource from trash.
     */
    public function restore($id)
    {
        $product = Product::onlyTrashed()->findOrFail($id);
        $product->restore();

        return response()->json(['message' => 'Sản phẩm đã được khôi phục thành công']);
    }

    /**
     * Permanently remove the specified resource from storage.
     */
    public function forceDelete($id)
    {
        $product = Product::onlyTrashed()->findOrFail($id);
        $product->forceDelete();

        return response()->json(['message' => 'Sản phẩm đã được xóa vĩnh viễn']);
    }

    /**
     * Bulk restore resources from trash.
     */
    public function bulkRestore(Request $request)
    {
        $ids = $request->input('ids', []);
        Product::onlyTrashed()->whereIn('id', $ids)->restore();
        return response()->json(['message' => 'Đã khôi phục các sản phẩm đã chọn']);
    }

    /**
     * Bulk permanently remove resources.
     */
    public function bulkForceDelete(Request $request)
    {
        $ids = $request->input('ids', []);
        Product::onlyTrashed()->whereIn('id', $ids)->forceDelete();
        return response()->json(['message' => 'Đã xóa vĩnh viễn các sản phẩm đã chọn']);
    }

    /**
     * Bulk move resources to trash.
     */
    public function bulkDelete(Request $request)
    {
        $ids = $request->input('ids', []);
        Product::whereIn('id', $ids)->delete();
        return response()->json(['message' => 'Đã chuyển các sản phẩm đã chọn vào thùng rác']);
    }

    /**
     * Bulk update attributes.
     */
    public function bulkUpdateAttributes(Request $request)
    {
        $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'exists:products,id',
            'basic_info' => 'nullable|array',
            'attributes' => 'nullable|array',
        ]);

        $ids = $request->input('ids');
        $basicInfo = $request->input('basic_info', []);
        $attributesData = $request->input('attributes', []);

        if (empty($basicInfo) && empty($attributesData)) {
            return response()->json(['message' => 'Không có dữ liệu để cập nhật'], 422);
        }

        // --- Logging original data for BACKUP/UNDO ---
        $originalDataLog = [];
        $products = Product::with(['attributeValues', 'categories'])->whereIn('id', $ids)->get();

        foreach ($products as $product) {
            $pData = [
                'id' => $product->id,
                'basic' => [],
                'attributes' => [],
                'category_ids' => $product->categories->pluck('id')->toArray(),
            ];

            // Store original basic fields that ARE being updated
            foreach (['category_id', 'price', 'cost_price', 'stock_quantity', 'is_featured', 'is_new', 'status', 'type'] as $field) {
                if (isset($basicInfo[$field]) && $basicInfo[$field] !== '' && $basicInfo[$field] !== null) {
                    $pData['basic'][$field] = $product->{$field};
                }
            }

            // Store original EAV attributes that ARE being updated
            foreach ($attributesData as $attrId => $val) {
                if ($val !== null && $val !== '') {
                    $av = $product->attributeValues->where('attribute_id', $attrId)->first();
                    $pData['attributes'][$attrId] = $av ? $av->value : null;
                }
            }

            $originalDataLog[] = $pData;
        }

        $log = BulkUpdateLog::create([
            'batch_name' => 'Cập nhật hàng loạt ' . now()->format('d/m/Y H:i'),
            'product_count' => count($ids),
            'original_data' => $originalDataLog,
        ]);
        // ---------------------------------------------

        foreach ($ids as $productId) {
            $product = $products->find($productId);
            if (!$product) continue;
            
            // 1. Update basic info (direct columns)
            if (!empty($basicInfo)) {
                $toUpdate = [];
                foreach (['category_id', 'price', 'cost_price', 'stock_quantity', 'is_featured', 'is_new', 'status', 'type'] as $field) {
                    if (isset($basicInfo[$field]) && $basicInfo[$field] !== '' && $basicInfo[$field] !== null) {
                        $toUpdate[$field] = $basicInfo[$field];
                    }
                }
                if (!empty($toUpdate)) {
                    $product->update($toUpdate);
                }
                if (isset($basicInfo['category_ids']) && is_array($basicInfo['category_ids']) && !empty($basicInfo['category_ids'])) {
                    $product->categories()->sync($basicInfo['category_ids']);
                }
            }

            // 2. Update EAV attributes
            if (!empty($attributesData)) {
                foreach ($attributesData as $attrId => $val) {
                    if ($val === null || $val === '') continue; 
                    $rawValue = is_array($val) ? json_encode($val) : $val;
                    \App\Models\ProductAttributeValue::updateOrCreate(
                        ['product_id' => $productId, 'attribute_id' => $attrId],
                        ['value' => $rawValue]
                    );
                }
            }
        }

        return response()->json([
            'message' => 'Cập nhật hàng loạt thành công',
            'log_id' => $log->id
        ]);
    }

    /**
     * Undo a bulk update operation.
     */
    public function undoBulkUpdate(Request $request)
    {
        $request->validate(['log_id' => 'required|exists:bulk_update_logs,id']);
        
        $log = BulkUpdateLog::findOrFail($request->log_id);
        $originalData = $log->original_data;

        foreach ($originalData as $pData) {
            $product = Product::find($pData['id']);
            if (!$product) continue;

            // Restore basic info
            if (!empty($pData['basic'])) {
                $product->update($pData['basic']);
            }

            // Restore category sync
            if (isset($pData['category_ids'])) {
                $product->categories()->sync($pData['category_ids']);
            }

            // Restore EAV attributes
            if (!empty($pData['attributes'])) {
                foreach ($pData['attributes'] as $attrId => $originalValue) {
                    if ($originalValue === null) {
                        \App\Models\ProductAttributeValue::where('product_id', $product->id)
                            ->where('attribute_id', $attrId)
                            ->delete();
                    } else {
                        \App\Models\ProductAttributeValue::updateOrCreate(
                            ['product_id' => $product->id, 'attribute_id' => $attrId],
                            ['value' => $originalValue]
                        );
                    }
                }
            }
        }

        // Optional: delete the log after undoing
        $log->delete();

        return response()->json(['message' => 'Đã hoàn tác cập nhật thành công']);
    }
}
