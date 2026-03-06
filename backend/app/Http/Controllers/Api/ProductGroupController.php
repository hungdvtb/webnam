<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ProductGroup;
use Illuminate\Http\Request;

class ProductGroupController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index()
    {
        $groups = ProductGroup::with('products')->where('status', true)->get();
        return response()->json($groups);
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        $group = ProductGroup::with('products')->findOrFail($id);
        return response()->json($group);
    }
}
