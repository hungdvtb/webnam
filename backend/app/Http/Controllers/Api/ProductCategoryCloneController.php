<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ProductCategoryCloneService;
use Illuminate\Http\Request;

class ProductCategoryCloneController extends Controller
{
    public function __construct(
        protected ProductCategoryCloneService $cloneService,
    ) {}

    public function preview(Request $request)
    {
        $validated = $request->validate([
            'source_category_id' => 'required|integer|exists:categories,id',
            'target_category_id' => 'nullable|integer|exists:categories,id',
            'target_category_name' => 'nullable|string|max:255',
        ]);

        return response()->json($this->cloneService->preview($validated));
    }

    public function apply(Request $request)
    {
        $validated = $request->validate([
            'source_category_id' => 'required|integer|exists:categories,id',
            'target_category_id' => 'nullable|integer|exists:categories,id',
            'target_category_name' => 'required_without:target_category_id|nullable|string|max:255',
            'rows' => 'required|array|min:1',
            'rows.*.source_product_id' => 'required|integer',
            'rows.*.name' => 'required|string|max:255',
            'rows.*.sku' => 'nullable|string|max:255',
            'rows.*.expected_cost' => 'nullable|numeric|min:0',
            'rows.*.price' => 'required|numeric|min:0',
        ]);

        return response()->json($this->cloneService->apply($validated), 201);
    }
}
