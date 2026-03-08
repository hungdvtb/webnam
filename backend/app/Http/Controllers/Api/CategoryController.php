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
        ]);

        $category = Category::create([
            'name' => $request->name,
            'slug' => Str::slug($request->name),
            'parent_id' => $request->parent_id,
            'description' => $request->description,
            'status' => $request->status ?? 1,
            'order' => Category::where('parent_id', $request->parent_id)->max('order') + 1,
        ]);

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
        $category = Category::findOrFail($id);

        $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'parent_id' => 'nullable|exists:categories,id',
        ]);

        if ($request->has('name')) {
            $category->name = $request->name;
            $category->slug = Str::slug($request->name);
        }
        
        $category->parent_id = $request->input('parent_id', $category->parent_id);
        $category->description = $request->input('description', $category->description);
        $category->status = $request->input('status', $category->status);
        $category->save();

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
                'parent_id' => current(array_filter([$item['parent_id']], function($v) { return $v !== ''; })) ?: null,
                'order' => $item['order'] ?? 0,
            ]);
        }

        return response()->json(['message' => 'Tree reordered successfully']);
    }
}
