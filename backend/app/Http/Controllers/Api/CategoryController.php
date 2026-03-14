<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CategoryController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index()
    {
        $categories = Category::withCount('products')->orderBy('order')->get();
        return response()->json($categories);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'parent_id' => 'nullable|exists:categories,id',
            'description' => 'nullable|string',
            'banner' => 'nullable|image|max:5120', // Max 5MB
            'filterable_attribute_ids' => 'nullable|array',
        ]);

        $bannerPath = null;
        if ($request->hasFile('banner')) {
            $bannerPath = $request->file('banner')->store('category_banners', 'public');
        }

        try {
            $category = Category::create([
                'name' => $request->name,
                'slug' => Str::slug($request->name),
                'parent_id' => $request->filled('parent_id') ? $request->parent_id : null,
                'description' => $request->description,
                'banner_path' => $bannerPath,
                'status' => $request->status ?? 1,
                'order' => Category::where('parent_id', $request->parent_id)->max('order') + 1,
                'display_layout' => $request->display_layout ?? 'layout_1',
                'filterable_attribute_ids' => $request->filterable_attribute_ids,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("Error creating category: " . $e->getMessage());
            return response()->json(['error' => $e->getMessage()], 500);
        }

        return response()->json($category, 201);
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        $category = Category::with(['children', 'products'])->findOrFail($id);
        return response()->json($category);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, $id)
    {
        \Illuminate\Support\Facades\Log::info("Category update request for ID: $id", ['data' => $request->all(), 'has_file' => $request->hasFile('banner')]);
        $category = Category::findOrFail($id);

        $validator = \Illuminate\Support\Facades\Validator::make($request->all(), [
            'name' => 'sometimes|required|string|max:255',
            'parent_id' => 'sometimes|nullable|exists:categories,id',
            'banner' => 'nullable|image|max:5120',
            'filterable_attribute_ids' => 'nullable|array',
        ]);

        if ($validator->fails()) {
            \Illuminate\Support\Facades\Log::error("Category validation failed: " . json_encode($validator->errors()->toArray()));
            return response()->json(['errors' => $validator->errors()], 422);
        }

        if ($request->has('name')) {
            $category->name = $request->name;
            $category->slug = Str::slug($request->name);
        }
        
        if ($request->hasFile('banner')) {
            // Optional: Delete old banner if exists
            // if ($category->banner_path) { \Illuminate\Support\Facades\Storage::disk('public')->delete($category->banner_path); }
            $category->banner_path = $request->file('banner')->store('category_banners', 'public');
        } elseif ($request->input('remove_banner') === 'true') {
            $category->banner_path = null;
        }

        $category->parent_id = $request->filled('parent_id') ? $request->parent_id : null;
        $category->description = $request->input('description', $category->description);
        $category->status = $request->input('status', $category->status);
        $category->display_layout = $request->input('display_layout', $category->display_layout);
        
        if ($request->has('filterable_attribute_ids')) {
            $category->filterable_attribute_ids = $request->filterable_attribute_ids;
        } elseif ($request->has('clear_attributes') && $request->clear_attributes == 'true') {
            $category->filterable_attribute_ids = [];
        }
        
        try {
            $category->save();
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("Error saving category: " . $e->getMessage());
            return response()->json(['error' => $e->getMessage()], 500);
        }

        return response()->json($category);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy($id)
    {
        $category = Category::findOrFail($id);
        $category->delete();

        return response()->json(['message' => 'Category deleted successfully']);
    }

    /**
     * Reorder tree (Drag and drop support).
     */
    public function reorder(Request $request)
    {
        $items = $request->input('items', []);
        
        // items is an array of objects e.g., [['id' => 1, 'parent_id' => null, 'order' => 1], ...]
        foreach ($items as $item) {
            Category::where('id', $item['id'])->update([
                'parent_id' => $item['parent_id'] ?: null,
                'order' => $item['order'] ?? 0,
            ]);
        }

        return response()->json(['message' => 'Tree reordered successfully']);
    }
}
