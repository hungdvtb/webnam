<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use Illuminate\Http\Request;

class CategoryController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index()
    {
        $categories = Category::withCount('products')->whereNull('parent_id')->with('children')->get();
        return response()->json($categories);
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        $category = Category::with(['children', 'products'])->findOrFail($id);
        return response()->json($category);
    }
}
