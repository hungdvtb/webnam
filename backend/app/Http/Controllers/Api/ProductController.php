<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductImage;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class ProductController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = Product::with(['category', 'images', 'attributeValues.attribute']);

        // Filter by category
        if ($request->filled('category_id')) {
            $query->where('category_id', $request->category_id);
        }

        // Search by name & SKU
        if ($request->filled('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', '%' . $search . '%')
                    ->orWhere('sku', 'like', '%' . $search . '%');
            });
        }

        // Filter by price range
        if ($request->filled('min_price')) {
            $query->where('price', '>=', $request->min_price);
        }
        if ($request->filled('max_price')) {
            $query->where('price', '<=', $request->max_price);
        }

        // Filter by stock range
        if ($request->filled('min_stock')) {
            $query->where('stock_quantity', '>=', $request->min_stock);
        }
        if ($request->filled('max_stock')) {
            $query->where('stock_quantity', '<=', $request->max_stock);
        }

        // Filter by date range (created_at)
        if ($request->filled('start_date')) {
            $query->whereDate('created_at', '>=', $request->start_date);
        }
        if ($request->filled('end_date')) {
            $query->whereDate('created_at', '<=', $request->end_date);
        }

        // Filter by featured
        if ($request->filled('is_featured')) {
            $query->where('is_featured', $request->boolean('is_featured'));
        }

        // Filter by is_new
        if ($request->filled('is_new')) {
            $query->where('is_new', $request->boolean('is_new'));
        }

        // Filter by type
        if ($request->filled('type')) {
            $query->where('type', $request->type);
        }

        // Filter by EAV Attributes (Professional Filter)
        // Format: ?attributes[attribute_id]=value1,value2
        $inputAttributes = $request->input('attributes');
        if (!empty($inputAttributes) && is_array($inputAttributes)) {
            foreach ($inputAttributes as $attrId => $values) {
                if (empty($values))
                    continue;
                $valueArray = is_array($values) ? $values : explode(',', $values);

                $query->whereHas('attributeValues', function ($q) use ($attrId, $valueArray) {
                    $q->where('attribute_id', $attrId)
                        ->whereIn('value', $valueArray);
                });
            }
        }

        // Sorting mapping
        $sortBy = $request->input('sort_by', 'created_at');
        $sortOrder = $request->input('sort_order', 'desc');

        $sortMapping = [
            'stock' => 'stock_quantity',
            'category' => 'category_id'
        ];

        $validSortFields = [
            'id', 'sku', 'name', 'price', 'cost_price', 'stock_quantity', 
            'created_at', 'type', 'category_id', 'is_featured', 'is_new'
        ];

        $field = $sortMapping[$sortBy] ?? $sortBy;
        if (!in_array($field, $validSortFields)) {
            $field = 'created_at';
        }
        
        $order = (strtolower($sortOrder) === 'asc') ? 'asc' : 'desc';
        $query->orderBy($field, $order);

        $perPage = $request->get('per_page', 9);
        $products = $query->paginate($perPage);

        return response()->json($products);
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
            $type = $request->get('link_type', ($product->type === 'configurable' ? 'super_link' : $product->type));
            $links = [];
            foreach ($request->linked_product_ids as $idx => $id) {
                $links[$id] = ['link_type' => $type, 'position' => $idx];
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

        return response()->json($product->load(['category', 'images', 'linkedProducts', 'superAttributes', 'attributeValues.attribute']), 201);
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        $product = Product::with([
            'category',
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
            $type = $request->get('link_type', ($product->type === 'configurable' ? 'super_link' : $product->type));
            $links = [];
            foreach ($request->linked_product_ids as $idx => $id) {
                $links[$id] = ['link_type' => $type, 'position' => $idx];
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

        return response()->json($product->load(['category', 'images', 'linkedProducts', 'superAttributes', 'attributeValues.attribute']));
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
        $clone->sku = $original->sku ? $original->sku . '-COPY-' . time() : null;
        $clone->save();

        // Copy images
        foreach ($original->images as $img) {
            ProductImage::create([
                'product_id' => $clone->id,
                'image_url' => $img->image_url,
                'is_primary' => $img->is_primary,
                'position' => $img->position
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

        return response()->json($clone->load(['category', 'images', 'attributeValues.attribute']));
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy($id)
    {
        $product = Product::findOrFail($id);
        $product->delete();

        return response()->json(['message' => 'Product deleted successfully']);
    }
}
