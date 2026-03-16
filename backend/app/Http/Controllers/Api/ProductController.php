<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductImage;
use App\Models\BulkUpdateLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

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
            'type', 'category_id', 'is_featured', 'is_new', 'created_at', 'status', 'specifications', 'video_url'
        ])
            ->with([
            'categories:id,name',
            'category:id,name',
            'images:id,product_id,image_url,is_primary',
            'attributeValues:id,product_id,attribute_id,value',
            'attributeValues.attribute:id,name,code,is_filterable,is_filterable_backend',
            'variations:id,sku,name,price,cost_price,stock_quantity,type',
            'variations.images:id,product_id,image_url,is_primary',
            'groupedItems:id,sku,name,price,cost_price,stock_quantity,type',
            'groupedItems.images:id,product_id,image_url,is_primary'
        ]);

        // Handle Trash View
        if ($request->boolean('is_trash')) {
            $query->onlyTrashed();
        }

        // Filter by category
        if ($request->filled('category_id')) {
            if ($request->category_id === 'uncategorized') {
                $query->whereNull('category_id')->doesntHave('categories');
            }
            else {
                $query->where(function ($q) use ($request) {
                    $q->where('category_id', $request->category_id)
                        ->orWhereHas('categories', function ($sub) use ($request) {
                        $sub->where('categories.id', $request->category_id);
                    }
                    );
                });
            }
        }

        if ($request->filled('category_ids')) {
            $catIds = is_array($request->category_ids) ? $request->category_ids : explode(',', $request->category_ids);
            $query->where(function ($q) use ($catIds) {
                $q->whereIn('category_id', $catIds)
                    ->orWhereHas('categories', function ($sub) use ($catIds) {
                    $sub->whereIn('categories.id', $catIds);
                }
                );
            });
        }

        // Search by name & SKU & more (Advanced Fuzzy & Token Matching)
        if ($request->filled('search')) {
            $search = trim($request->search);
            // Split into tokens
            $tokens = preg_split('/\s+/', $search, -1, PREG_SPLIT_NO_EMPTY);

            if (!empty($tokens)) {
                $query->where(function (Builder $q) use ($tokens) {
                    foreach ($tokens as $token) {
                        $q->where(function (Builder $sub) use ($token) {
                                    $escapedToken = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $token) . '%';
                                    $fuzzyToken = '%' . implode('%', preg_split('//u', str_replace(['%', '_'], '', $token), -1, PREG_SPLIT_NO_EMPTY)) . '%';

                                    // Name match
                                    $sub->whereRaw('immutable_unaccent(name) ILIKE immutable_unaccent(?)', [$escapedToken])
                                        // SKU match (substring or compacted substring)
                                        ->orWhereRaw('immutable_unaccent(sku) ILIKE immutable_unaccent(?)', [$escapedToken])
                                        ->orWhereRaw("immutable_unaccent(REGEXP_REPLACE(sku, '[^a-zA-Z0-9]', '', 'g')) ILIKE immutable_unaccent(?)", [$escapedToken])
                                        // SKU fuzzy/subsequence match
                                        ->orWhereRaw("immutable_unaccent(REGEXP_REPLACE(sku, '[^a-zA-Z0-9]', '', 'g')) ILIKE immutable_unaccent(?)", [$fuzzyToken])

                                        // Nếu là sản phẩm cha, hãy kiểm tra xem có biến thể nào khớp không
                                        ->orWhereHas('variations', function (Builder $sq) use ($escapedToken) {
                                $sq->whereRaw('immutable_unaccent(name) ILIKE immutable_unaccent(?)', [$escapedToken])
                                    ->orWhereRaw('immutable_unaccent(sku) ILIKE immutable_unaccent(?)', [$escapedToken]);
                            }
                            );

                        }
                        );
                    }
                });
            }
        }

        // Numberic Filters
        if ($request->filled('min_price'))
            $query->where('price', '>=', $request->min_price);
        if ($request->filled('max_price'))
            $query->where('price', '<=', $request->max_price);
        if ($request->filled('min_stock'))
            $query->where('stock_quantity', '>=', $request->min_stock);
        if ($request->filled('max_stock'))
            $query->where('stock_quantity', '<=', $request->max_stock);

        // Filter by date range
        if ($request->filled('start_date'))
            $query->whereDate('created_at', '>=', $request->start_date);
        if ($request->filled('end_date'))
            $query->whereDate('created_at', '<=', $request->end_date);

        // Flags
        if ($request->filled('is_featured'))
            $query->where('is_featured', $request->boolean('is_featured'));
        if ($request->filled('is_new'))
            $query->where('is_new', $request->boolean('is_new'));
        // Type Filtering (Improved for Multiple Types & Variants logic)
        if ($request->filled('type')) {
            $types = is_array($request->type) ? $request->type : explode(',', $request->type);
            $query->where(function ($q) use ($types) {
                foreach ($types as $type) {
                    $q->orWhere(function ($sub) use ($type) {
                        if ($type === 'configurable') {
                            // Trả về sản phẩm cha thực sự có biến thể
                            $sub->where('type', 'configurable')
                                ->whereHas('variations');
                        } elseif ($type === 'simple') {
                            // Trả về sản phẩm đơn độc lập (không phải là biến thể của sản phẩm khác)
                            $sub->where('type', 'simple')
                                ->whereDoesntHave('parentConfigurable');
                        } else {
                            $sub->where('type', $type);
                        }
                    });
                }
            });
        }

        // Filter by EAV Attributes
        $inputAttributes = $request->input('attributes');
        if (!empty($inputAttributes) && is_array($inputAttributes)) {
            foreach ($inputAttributes as $attrId => $values) {
                if (empty($values))
                    continue;
                $valueArray = is_array($values) ? $values : explode(',', $values);

                $query->whereHas('attributeValues', function ($q) use ($attrId, $valueArray) {
                    $q->where('attribute_id', $attrId)
                        ->where(function ($sub) use ($valueArray) {
                        foreach ($valueArray as $val) {
                            $sub->orWhere('value', $val)
                                ->orWhere('value', 'LIKE', '%"' . $val . '"%');
                        }
                    }
                    );
                });
            }
        }
        // Mặc định luôn ẩn sản phẩm con (biến thể) ở danh sách chính
        // Sản phẩm con chỉ hiển thị khi bấm mở rộng sản phẩm cha ở frontend
        if (!$request->filled('type')) {
            $query->whereDoesntHave('parentConfigurable');
        }

        // Sorting
        $sortBy = $request->input('sort_by', 'created_at');
        $sortOrder = $request->input('sort_order', 'desc');

        if ($sortBy === 'random') {
            $query->inRandomOrder();
        } else {
            $sortMapping = ['stock' => 'stock_quantity', 'category' => 'category_id'];
            $validSortFields = ['id', 'sku', 'name', 'price', 'cost_price', 'stock_quantity', 'created_at', 'type', 'category_id'];

            $field = $sortMapping[$sortBy] ?? $sortBy;
            if (!in_array($field, $validSortFields))
                $field = 'created_at';

            $order = (strtolower($sortOrder) === 'asc') ? 'asc' : 'desc';

            // Ưu tiên đưa sản phẩm có biến thể lên đầu nếu cùng tiêu chí sắp xếp (giúp dễ quản lý)
            $query->orderByRaw("CASE WHEN type = 'configurable' THEN 0 ELSE 1 END")
                ->orderBy($field, $order);
        }

        $perPage = (int)$request->get('per_page', 20);
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
            'category_id' => 'nullable|exists:categories,id',
            'category_ids' => 'nullable|array',
            'category_ids.*' => 'exists:categories,id',
            'price' => 'required|numeric|min:0',
            'price_type' => 'nullable|string|in:fixed,sum',
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
            'status' => 'nullable|boolean',
            'video_url' => 'nullable|string',
            'slug' => 'nullable|string|max:255|unique:products,slug',
            // linkages
            'linked_product_ids' => 'nullable|array',
            'linked_product_ids.*' => 'exists:products,id',
            'link_type' => 'nullable|string',
            'grouped_items' => 'nullable|array', // For product groups
            'grouped_items.*.id' => 'required|exists:products,id',
            'grouped_items.*.quantity' => 'required|integer|min:1',
            'grouped_items.*.is_required' => 'required|boolean',
            'grouped_items.*.variant_id' => 'nullable|exists:products,id',
            'grouped_items.*.option_title' => 'nullable|string',
            'grouped_items.*.is_default' => 'nullable|boolean',
            'super_attribute_ids' => 'nullable|array',
            'super_attribute_ids.*' => 'exists:attributes,id',
            // EAV custom values
            'custom_attributes' => 'nullable|array',
            // images
            'main_image' => 'nullable|image',
            'images' => 'nullable|array',
            'images.*' => 'image',
        ], [
            'type.required' => 'Vui lòng chọn loại sản phẩm.',
            'name.required' => 'Vui lòng nhập tên tác phẩm nghệ thuật.',
            'price.required' => 'Vui lòng nhập giá bán.',
            'stock_quantity.integer' => 'Số lượng tồn kho phải là số nguyên.',
            'slug.unique' => 'Đường dẫn (slug) này đã tồn tại, vui lòng chọn tên khác.',
        ]);

        if (empty($validated['slug'])) {
            $validated['slug'] = Str::slug($validated['name']);
            // Ensure unique slug if auto-generated
            $baseSlug = $validated['slug'];
            $counter = 1;
            while (Product::where('slug', $validated['slug'])->exists()) {
                $validated['slug'] = $baseSlug . '-' . $counter++;
            }
        } else {
            // Force lowercase and slug format if manually entered
            $validated['slug'] = Str::slug($validated['slug']);
        }

        $product = Product::create(array_merge($validated, ['account_id' => $request->header('X-Account-Id')]));

        if ($request->has('category_ids')) {
            $product->categories()->sync($request->category_ids);
        }
        elseif ($request->has('category_id') && !empty($request->category_id)) {
            // Default to primary category if no multi-select provided
            $product->categories()->sync([$request->category_id]);
        }

        if ($request->hasFile('main_image')) {
            $disk = 's3';
            $imageFile = $request->file('main_image');
            $path = Storage::disk($disk)->put('products', $imageFile, 'public');
            
            // Construct Clean S3 URL
            $baseUrl = rtrim(config('filesystems.disks.s3.url'), '/');
            $url = $baseUrl . '/' . ltrim($path, '/');

            ProductImage::create([
                'product_id' => $product->id,
                'image_url' => $url,
                'file_name' => $imageFile->getClientOriginalName(),
                'file_size' => $imageFile->getSize(),
                'is_primary' => true
            ]);
        }

        if ($request->hasFile('images')) {
            $disk = 's3';
            foreach ($request->file('images') as $idx => $image) {
                $path = Storage::disk($disk)->put('products', $image, 'public');
                
                // Construct Clean S3 URL
                $baseUrl = rtrim(config('filesystems.disks.s3.url'), '/');
                $url = $baseUrl . '/' . ltrim($path, '/');

                // If no main_image provided, set first in array as primary
                $isPrimary = (!$request->hasFile('main_image')) && ($idx === 0);
                ProductImage::create([
                    'product_id' => $product->id,
                    'image_url' => $url,
                    'file_name' => $image->getClientOriginalName(),
                    'file_size' => $image->getSize(),
                    'is_primary' => $isPrimary,
                    'sort_order' => $idx
                ]);
            }
        }

        if ($request->has('custom_attributes')) {
            $validAttrIds = \App\Models\Attribute::whereIn('id', array_keys($request->custom_attributes))->pluck('id')->toArray();
            foreach ($request->custom_attributes as $attrId => $val) {
                if (!in_array($attrId, $validAttrIds)) continue;
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

        if ($request->has('grouped_items') && in_array($product->type, ['grouped', 'bundle'])) {
            $linkType = $product->type === 'bundle' ? 'bundle' : 'grouped';
            
            // We use detach + attach in a loop to support multiple variants of the same product
            if ($product->type === 'bundle') {
                $product->bundleItems()->detach();
            } else {
                $product->groupedItems()->detach();
            }

            foreach ($request->grouped_items as $idx => $item) {
                $pivotData = [
                    'quantity' => $item['quantity'],
                    'is_required' => $item['is_required'],
                    'link_type' => $linkType,
                    'position' => $idx,
                    'option_title' => $item['option_title'] ?? null,
                    'is_default' => $item['is_default'] ?? false,
                    'variant_id' => $item['variant_id'] ?? null,
                ];

                if ($product->type === 'bundle') {
                    $product->bundleItems()->attach($item['id'], $pivotData);
                } else {
                    $product->groupedItems()->attach($item['id'], $pivotData);
                }
            }
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
            foreach ($request->variants as $idx => $vData) {
                $vProduct = Product::create([
                    'account_id' => $product->account_id,
                    'type' => 'simple',
                    'name' => $vData['name'] ?? ($product->name . ' - ' . ($vData['sku'] ?? 'Variant')),
                    'sku' => $vData['sku'],
                    'price' => $vData['price'],
                    'cost_price' => $vData['cost_price'] ?? null,
                    'weight' => $vData['weight'] ?? null,
                    'stock_quantity' => $vData['stock_quantity'] ?? 0,
                    'category_id' => $product->category_id,
                    'status' => $product->status ?? true,
                ]);

                // Handle variant image
                if ($request->hasFile("variants.{$idx}.image")) {
                    $imageFile = $request->file("variants.{$idx}.image");
                    $path = $imageFile->store('products', 'public');
                    \App\Models\ProductImage::create([
                        'product_id' => $vProduct->id,
                        'image_url' => \Illuminate\Support\Facades\Storage::disk('public')->url($path),
                        'is_primary' => true,
                        'file_name' => $imageFile->getClientOriginalName(),
                        'file_size' => $imageFile->getSize(),
                    ]);
                }

                $product->linkedProducts()->attach($vProduct->id, [
                    'link_type' => 'super_link',
                ]);

                // Save variant attribute values
                if (isset($vData['attributes'])) {
                    $vValidAttrIds = \App\Models\Attribute::whereIn('id', array_keys($vData['attributes']))->pluck('id')->toArray();
                    foreach ($vData['attributes'] as $attrId => $val) {
                        if (!in_array($attrId, $vValidAttrIds)) continue;
                        \App\Models\ProductAttributeValue::create([
                            'product_id' => $vProduct->id,
                            'attribute_id' => $attrId,
                            'value' => $val
                        ]);
                    }
                }
            }
        }

        return response()->json($product->load(['category', 'categories', 'images', 'linkedProducts.images', 'linkedProducts.attributeValues', 'superAttributes', 'attributeValues.attribute']), 201);
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        $product = Product::with([
            'category:id,name',
            'categories:id,name',
            'images:id,product_id,image_url,is_primary,file_name,file_size',
            'superAttributes:id,name,code,frontend_type',
            'superAttributes.options:id,attribute_id,value,swatch_value,order',
            'attributeValues:id,product_id,attribute_id,value',
            'attributeValues.attribute:id,name,code,frontend_type',
            'linkedProducts' => function ($q) {
            $q->select(['products.id', 'sku', 'name', 'price', 'cost_price', 'stock_quantity', 'type', 'weight'])
                ->withPivot(['link_type', 'position', 'quantity', 'is_required'])
                ->with([
                    'images:id,product_id,image_url,is_primary',
                    'attributeValues:id,product_id,attribute_id,value',
                    'attributeValues.attribute:id,name,code'
                ]);
        },
            'groupedItems' => function ($q) {
                $q->select(['products.id', 'sku', 'name', 'price', 'cost_price', 'stock_quantity', 'type', 'weight'])
                    ->withPivot(['link_type', 'position', 'quantity', 'is_required'])
                    ->with([
                        'images:id,product_id,image_url,is_primary',
                        'attributeValues:id,product_id,attribute_id,value'
                    ]);
            },
            'bundleItems' => function ($q) {
                $q->select(['products.id', 'sku', 'name', 'price', 'cost_price', 'stock_quantity', 'type', 'weight'])
                    ->withPivot(['link_type', 'position', 'quantity', 'is_required', 'option_title', 'is_default', 'variant_id'])
                    ->with([
                        'images:id,product_id,image_url,is_primary',
                        'attributeValues:id,product_id,attribute_id,value'
                    ]);
            },
            'approvedReviews.user:id,name'
        ])->findOrFail($id);

        if ($product->type === 'configurable') {
            // Get variations manually to find all used attribute values from IN-STOCK variations
            $variations = $product->linkedProducts()
                ->wherePivot('link_type', 'super_link')
                ->where('stock_quantity', '>', 0) // Only count in-stock variations for initial attribute listing
                ->with('attributeValues')
                ->get();
            
            $usedValuesByAttr = [];
            foreach ($variations as $v) {
                foreach ($v->attributeValues as $av) {
                    $usedValuesByAttr[$av->attribute_id][] = $av->value;
                }
            }

            // Filter the eager-loaded superAttributes to only include those that have valid in-stock options
            $filteredSuperAttributes = $product->superAttributes->filter(function($attribute) use ($usedValuesByAttr) {
                $relevantValues = array_unique($usedValuesByAttr[$attribute->id] ?? []);
                if (empty($relevantValues)) return false;

                $filteredOptions = $attribute->options->filter(function($opt) use ($relevantValues) {
                    return in_array($opt->value, $relevantValues);
                })->values();

                $attribute->setRelation('options', $filteredOptions);
                return $filteredOptions->count() > 0;
            })->values();

            $product->setRelation('superAttributes', $filteredSuperAttributes);

            // Also expose ALL variations (including out of stock ones if needed, 
            // but for filtering we might want to know about them, or just keep what's returned by linkedProducts)
            // Re-fetch all variations to ensure we have the full list for frontend logic if it needs to show "out of stock" instead of hiding
            // But user said "không có hàng... phải ẩn hẳn", so let's stick to in-stock variations for selection logic.
            $product->setRelation('variations', $variations);
        }

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
            'category_id' => 'nullable|exists:categories,id',
            'category_ids' => 'nullable|array',
            'category_ids.*' => 'exists:categories,id',
            'price' => 'sometimes|required|numeric|min:0',
            'price_type' => 'nullable|string|in:fixed,sum',
            'cost_price' => 'nullable|numeric|min:0',
            'special_price' => 'nullable|numeric|min:0',
            'special_price_from' => 'nullable|date',
            'special_price_to' => 'nullable|date',
            'description' => 'nullable|string',
            'is_featured' => 'boolean',
            'is_new' => 'boolean',
            'stock_quantity' => 'nullable|integer|min:0',
            'weight' => 'nullable|string',
            'sku' => 'nullable|string|unique:products,sku,' . $id,
            'status' => 'nullable|boolean',
            'meta_title' => 'nullable|string',
            'meta_description' => 'nullable|string',
            'meta_keywords' => 'nullable|string',
            'specifications' => 'nullable|string',
            'video_url' => 'nullable|string',
            'slug' => 'nullable|string|max:255|unique:products,slug,' . $id,
            'linked_product_ids' => 'nullable|array',
            'linked_product_ids.*' => 'exists:products,id',
            'link_type' => 'nullable|string',
            'grouped_items' => 'nullable|array',
            'grouped_items.*.id' => 'required|exists:products,id',
            'grouped_items.*.quantity' => 'required|integer|min:1',
            'grouped_items.*.is_required' => 'required|boolean',
            'grouped_items.*.variant_id' => 'nullable|exists:products,id',
            'grouped_items.*.option_title' => 'nullable|string',
            'grouped_items.*.is_default' => 'nullable|boolean',
            'super_attribute_ids' => 'nullable|array',
            'super_attribute_ids.*' => 'exists:attributes,id',
            // EAV custom values
            'custom_attributes' => 'nullable|array',
        ], [
            'name.required' => 'Tên sản phẩm không được để trống.',
            'price.required' => 'Giá bán không được để trống.',
            'sku.unique' => 'Mã SKU này đã được sử dụng.',
            'slug.unique' => 'Đường dẫn (slug) này đã tồn tại, vui lòng chọn tên khác.',
            'slug.regex' => 'Đường dẫn chỉ được chứa chữ cái thường, số và dấu gạch ngang (VD: san-pham-1).',
        ]);

        // Capture which fields changed before saving
        $nameChanged = $product->isDirty('name');
        $skuChanged = $product->isDirty('sku');

        if (isset($validated['slug'])) {
            if (empty($validated['slug'])) {
                $validated['slug'] = Str::slug($product->name);
            } else {
                $validated['slug'] = Str::slug($validated['slug']);
            }
        }

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
        }
        elseif ($request->has('category_id') && !empty($request->category_id)) {
            // If only primary category changed, sync it as well
            $product->categories()->syncWithoutDetaching([$request->category_id]);
        }
        elseif ($request->has('category_id') && empty($request->category_id)) {
            // If primary category was explicitly cleared
            $product->categories()->detach();
            $product->update(['category_id' => null]);
        }
        // Sync EAV custom attributes
        if ($request->has('custom_attributes')) {
            $validAttrIds = \App\Models\Attribute::whereIn('id', array_keys($request->custom_attributes))->pluck('id')->toArray();
            foreach ($request->custom_attributes as $attrId => $val) {
                if (!in_array($attrId, $validAttrIds)) continue;
                // $val could be string, or array (for multiselect)
                $rawValue = is_array($val) ? json_encode($val) : $val;

                \App\Models\ProductAttributeValue::updateOrCreate(
                    ['product_id' => $product->id, 'attribute_id' => $attrId],
                    ['value' => $rawValue]
                );
            }
        }

        if ($request->has('linked_product_ids')) {
            $links = [];
            foreach ($request->linked_product_ids as $idx => $id) {
                $links[$id] = ['link_type' => 'related', 'position' => $idx];
            }

            $product->relatedProducts()->sync($links);
        }

        if ($request->has('grouped_items') && in_array($product->type, ['grouped', 'bundle'])) {
            $linkType = $product->type === 'bundle' ? 'bundle' : 'grouped';
            
            if ($product->type === 'bundle') {
                $product->bundleItems()->detach();
            } else {
                $product->groupedItems()->detach();
            }

            foreach ($request->grouped_items as $idx => $item) {
                $pivotData = [
                    'quantity' => $item['quantity'],
                    'is_required' => $item['is_required'],
                    'link_type' => $linkType,
                    'position' => $idx,
                    'option_title' => $item['option_title'] ?? null,
                    'is_default' => $item['is_default'] ?? false,
                    'variant_id' => $item['variant_id'] ?? null,
                ];

                if ($product->type === 'bundle') {
                    $product->bundleItems()->attach($item['id'], $pivotData);
                } else {
                    $product->groupedItems()->attach($item['id'], $pivotData);
                }
            }
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
            $incomingVariants = $request->variants;
            $incomingVariantIds = [];

            // 1. Identify which variants to keep vs delete
            foreach ($incomingVariants as $vData) {
                if (isset($vData['id'])) {
                    $incomingVariantIds[] = $vData['id'];
                }
            }

            // 2. Remove variants that are no longer in the list (Clean up orphans) FIRST
            // This prevents duplicate SKU errors if a variant is recreated with the same SKU
            $existingVariantIds = $product->linkedProducts()
                ->wherePivot('link_type', 'super_link')
                ->pluck('products.id')
                ->toArray();
            
            $toDelete = array_diff($existingVariantIds, $incomingVariantIds);
            if (!empty($toDelete)) {
                $product->linkedProducts()->detach($toDelete);
                Product::whereIn('id', $toDelete)->delete();
            }

            // 3. Process remaining variants (Update or Create)
            foreach ($incomingVariants as $idx => $vData) {
                if (isset($vData['id'])) {
                    $variant = Product::findOrFail($vData['id']);
                    $variant->update([
                        'name' => $vData['name'] ?? $variant->name,
                        'sku' => $vData['sku'],
                        'price' => $vData['price'],
                        'cost_price' => $vData['cost_price'] ?? null,
                        'weight' => $vData['weight'] ?? null,
                        'stock_quantity' => $vData['stock_quantity'] ?? 0,
                    ]);

                    // Handle variant image update/removal
                    if ($request->hasFile("variants.{$idx}.image")) {
                        $disk = 's3';
                        $variant->images()->delete();
                        $imageFile = $request->file("variants.{$idx}.image");
                        $path = Storage::disk($disk)->put('products', $imageFile, 'public');

                        // Construct Clean S3 URL
                        $baseUrl = rtrim(config('filesystems.disks.s3.url'), '/');
                        $url = $baseUrl . '/' . ltrim($path, '/');

                        \App\Models\ProductImage::create([
                            'product_id' => $variant->id,
                            'image_url' => $url,
                            'is_primary' => true,
                            'file_name' => $imageFile->getClientOriginalName(),
                            'file_size' => $imageFile->getSize(),
                        ]);
                    }
                    elseif (isset($vData['remove_image']) && $vData['remove_image'] == 'true') {
                        $variant->images()->delete();
                    }

                    // Save/Update variant attribute values
                    if (isset($vData['attributes'])) {
                        $vValidAttrIds = \App\Models\Attribute::whereIn('id', array_keys($vData['attributes']))->pluck('id')->toArray();
                        foreach ($vData['attributes'] as $attrId => $val) {
                            if (!in_array($attrId, $vValidAttrIds)) continue;
                            \App\Models\ProductAttributeValue::updateOrCreate(
                                ['product_id' => $variant->id, 'attribute_id' => $attrId],
                                ['value' => $val]
                            );
                        }
                    }
                }
                else {
                    // It's a "new" variant from frontend's perspective.
                    // But maybe it's actually an existing simple product by SKU?
                    // (Optional: can try to find by SKU if you want to be extra safe,
                    // but usually create is fine as long as toDelete happened)
                    $variant = Product::create([
                        'account_id' => $product->account_id,
                        'type' => 'simple',
                        'name' => $vData['name'] ?? ($product->name . ' - ' . ($vData['sku'] ?? 'Variant')),
                        'sku' => $vData['sku'],
                        'price' => $vData['price'],
                        'cost_price' => $vData['cost_price'] ?? null,
                        'weight' => $vData['weight'] ?? null,
                        'stock_quantity' => $vData['stock_quantity'] ?? 0,
                        'category_id' => $product->category_id,
                        'status' => $product->status ?? true,
                    ]);

                    if ($request->hasFile("variants.{$idx}.image")) {
                        $disk = 's3';
                        $imageFile = $request->file("variants.{$idx}.image");
                        $path = Storage::disk($disk)->put('products', $imageFile, 'public');

                        // Construct Clean S3 URL
                        $baseUrl = rtrim(config('filesystems.disks.s3.url'), '/');
                        $url = $baseUrl . '/' . ltrim($path, '/');

                        \App\Models\ProductImage::create([
                            'product_id' => $variant->id,
                            'image_url' => $url,
                            'is_primary' => true,
                            'file_name' => $imageFile->getClientOriginalName(),
                            'file_size' => $imageFile->getSize(),
                        ]);
                    }

                    $product->linkedProducts()->attach($variant->id, ['link_type' => 'super_link']);

                    if (isset($vData['attributes'])) {
                        $vValidAttrIds = \App\Models\Attribute::whereIn('id', array_keys($vData['attributes']))->pluck('id')->toArray();
                        foreach ($vData['attributes'] as $attrId => $val) {
                            if (!in_array($attrId, $vValidAttrIds)) continue;
                            \App\Models\ProductAttributeValue::create([
                                'product_id' => $variant->id,
                                'attribute_id' => $attrId,
                                'value' => $val
                            ]);
                        }
                    }
                }
            }
        }

        return response()->json($product->load(['category', 'categories', 'images', 'linkedProducts.images', 'linkedProducts.attributeValues', 'superAttributes', 'attributeValues.attribute']));
    }

    /**
     * Duplicate the specified resource.
     */
    public function duplicate($id)
    {
        $original = Product::with(['attributeValues', 'images', 'superAttributes', 'linkedProducts.images', 'linkedProducts.attributeValues'])->where('id', $id)->firstOrFail();

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

        // Copy linked products (for grouped/bundle/configurable)
        if (in_array($original->type, ['grouped', 'bundle', 'configurable'])) {
            foreach ($original->linkedProducts as $lp) {
                if ($lp->pivot->link_type === 'super_link') {
                    // For variations, we MUST clone the child product itself
                    $newVariant = $lp->replicate();
                    // Generate a new SKU for the variant based on the new parent SKU or original suffix
                    $vSuffix = \Illuminate\Support\Str::afterLast($lp->sku, '-');
                    if (is_numeric($vSuffix)) {
                        $newVariant->sku = $clone->sku . '-' . $vSuffix;
                    }
                    else {
                        $newVariant->sku = $clone->sku . '-' . \Illuminate\Support\Str::random(4);
                    }

                    $newVariant->name = $lp->name; // Keep name or update? Keep is usually better for variants
                    $newVariant->slug = \Illuminate\Support\Str::slug($newVariant->name) . '-' . strtolower(\Illuminate\Support\Str::random(6));
                    $newVariant->save();

                    // Copy variant images
                    foreach ($lp->images as $img) {
                        \App\Models\ProductImage::create([
                            'product_id' => $newVariant->id,
                            'image_url' => $img->image_url,
                            'is_primary' => $img->is_primary,
                            'sort_order' => $img->sort_order
                        ]);
                    }

                    // Copy variant EAV attributes
                    foreach ($lp->attributeValues as $av) {
                        \App\Models\ProductAttributeValue::create([
                            'product_id' => $newVariant->id,
                            'attribute_id' => $av->attribute_id,
                            'value' => $av->value
                        ]);
                    }

                    $clone->linkedProducts()->attach($newVariant->id, [
                        'link_type' => 'super_link',
                        'position' => $lp->pivot->position
                    ]);
                }
                else {
                    // For regular links (related, cross-sell, grouped), just attach the same ID with pivot data
                    $clone->linkedProducts()->attach($lp->id, [
                        'link_type' => $lp->pivot->link_type,
                        'position' => $lp->pivot->position,
                        'quantity' => $lp->pivot->quantity ?? 1,
                        'is_required' => $lp->pivot->is_required ?? true,
                    ]);
                }
            }
        }

        // Copy categories
        $clone->categories()->sync($original->categories->pluck('id')->toArray());

        return response()->json([
            'message' => 'Sản phẩm đã được nhân bản thành công',
            'data' => $clone->load(['category', 'categories', 'images', 'attributeValues.attribute', 'linkedProducts.images', 'linkedProducts.attributeValues', 'superAttributes'])
        ]);
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
                    $pData['basic'][$field] = $product->{ $field};
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
            if (!$product)
                continue;

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
                    if ($val === null || $val === '')
                        continue;
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
            if (!$product)
                continue;

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
                    }
                    else {
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
