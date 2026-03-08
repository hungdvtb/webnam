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
        if ($request->has('category_id')) {
            $query->where('category_id', $request->category_id);
        }

        // Search by name
        if ($request->has('search')) {
            $query->where('name', 'like', '%' . $request->search . '%');
        }

        // Filter by price range
        if ($request->has('min_price')) {
            $query->where('price', '>=', $request->min_price);
        }
        if ($request->has('max_price')) {
            $query->where('price', '<=', $request->max_price);
        }

        // Filter by stock range
        if ($request->has('min_stock')) {
            $query->where('stock_quantity', '>=', $request->min_stock);
        }
        if ($request->has('max_stock')) {
            $query->where('stock_quantity', '<=', $request->max_stock);
        }

        // Filter by date range (created_at)
        if ($request->has('start_date')) {
            $query->whereDate('created_at', '>=', $request->start_date);
        }
        if ($request->has('end_date')) {
            $query->whereDate('created_at', '<=', $request->end_date);
        }

        // Filter by featured
        if ($request->has('is_featured')) {
            $query->where('is_featured', $request->boolean('is_featured'));
        }

        // Filter by is_new
        if ($request->has('is_new')) {
            $query->where('is_new', $request->boolean('is_new'));
        }

        // Filter by type
        if ($request->has('type')) {
            $query->where('type', $request->type);
        }

        // Filter by EAV Attributes (Professional Filter)
        // Format: ?attributes[attribute_id]=value1,value2
        if ($request->has('attributes')) {
            foreach ($request->attributes as $attrId => $values) {
                if (empty($values)) continue;
                $valueArray = is_array($values) ? $values : explode(',', $values);
                
                $query->whereHas('attributeValues', function($q) use ($attrId, $valueArray) {
                    $q->where('attribute_id', $attrId)
                      ->whereIn('value', $valueArray);
                });
            }
        }

        // Sorting
        $sortField = $request->get('sort_by', 'created_at');
        if ($sortField === 'price') {
            // Respect special price if needed, but for now simple price
            $query->orderBy('price', $request->get('sort_order', 'asc'));
        } else {
            $query->orderBy($sortField, $request->get('sort_order', 'desc'));
        }

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
            'special_price' => 'nullable|numeric|min:0',
            'special_price_from' => 'nullable|date',
            'special_price_to' => 'nullable|date',
            'description' => 'nullable|string',
            'is_featured' => 'boolean',
            'is_new' => 'boolean',
            'stock_quantity' => 'integer|min:0',
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
            $path = $request->file('main_image')->store('products', 's3');
            ProductImage::create([
                'product_id' => $product->id,
                'image_url' => Storage::disk('s3')->url($path),
                'is_primary' => true
            ]);
        }

        if ($request->hasFile('images')) {
            foreach ($request->file('images') as $image) {
                $path = $image->store('products', 's3');
                ProductImage::create([
                    'product_id' => $product->id,
                    'image_url' => Storage::disk('s3')->url($path),
                    'is_primary' => false
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
            'special_price' => 'nullable|numeric|min:0',
            'special_price_from' => 'nullable|date',
            'special_price_to' => 'nullable|date',
            'description' => 'nullable|string',
            'is_featured' => 'boolean',
            'is_new' => 'boolean',
            'stock_quantity' => 'integer|min:0',
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

        $product->update($validated);

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
     * Remove the specified resource from storage.
     */
    public function destroy($id)
    {
        $product = Product::findOrFail($id);
        $product->delete();

        return response()->json(['message' => 'Product deleted successfully']);
    }
}
