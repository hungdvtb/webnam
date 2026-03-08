<?php

namespace App\Http\Controllers;

use App\Models\Attribute;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class AttributeController extends Controller
{
    public function index()
    {
        $attributes = Attribute::with('options')->get();
        return response()->json($attributes);
    }

    public function store(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'code' => 'sometimes|string|max:255|unique:attributes,code',
            'frontend_type' => 'required|string',
            'swatch_type' => 'nullable|string|in:color,image',
            'options' => 'nullable|array',
            'is_filterable' => 'boolean',
            'is_required' => 'boolean',
            'is_variant' => 'boolean'
        ]);

        $code = $request->code ?: Str::slug($request->name);
        
        if (Attribute::where('code', $code)->exists()) {
            $code = $code . '-' . time();
        }

        $attribute = Attribute::create([
            'name' => $request->name,
            'code' => $code,
            'frontend_type' => $request->frontend_type,
            'swatch_type' => $request->swatch_type,
            'is_filterable' => $request->is_filterable ?? false,
            'is_required' => $request->is_required ?? false,
            'is_variant' => $request->is_variant ?? false,
        ]);

        if (in_array($request->frontend_type, ['select', 'multiselect']) && $request->has('options')) {
            foreach ($request->options as $index => $option) {
                if (is_array($option) && isset($option['value'])) {
                    $attribute->options()->create([
                        'value' => $option['value'],
                        'swatch_value' => $option['swatch_value'] ?? null,
                        'order' => $index
                    ]);
                } else if (is_string($option) && trim($option) !== '') {
                    $attribute->options()->create([
                        'value' => $option,
                        'order' => $index
                    ]);
                }
            }
        }

        return response()->json($attribute->load('options'), 201);
    }

    public function show(string $id)
    {
        $attribute = Attribute::with('options')->findOrFail($id);
        return response()->json($attribute);
    }

    public function update(Request $request, string $id)
    {
        $attribute = Attribute::findOrFail($id);

        $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'frontend_type' => 'sometimes|required|string',
            'swatch_type' => 'nullable|string|in:color,image',
            'options' => 'nullable|array',
            'is_filterable' => 'boolean',
            'is_required' => 'boolean',
            'is_variant' => 'boolean'
        ]);

        $attribute->update($request->only('name', 'frontend_type', 'swatch_type', 'is_filterable', 'is_required', 'is_variant'));

        if ($request->has('options')) {
            $attribute->options()->delete();
            if (in_array($attribute->frontend_type, ['select', 'multiselect'])) {
                foreach ($request->options as $index => $option) {
                    if (is_array($option) && isset($option['value'])) {
                        $attribute->options()->create([
                            'value' => $option['value'],
                            'swatch_value' => $option['swatch_value'] ?? null,
                            'order' => $index
                        ]);
                    } else if (is_string($option) && trim($option) !== '') {
                        $attribute->options()->create([
                            'value' => $option,
                            'order' => $index
                        ]);
                    }
                }
            }
        }

        return response()->json($attribute->load('options'));
    }

    public function destroy(string $id)
    {
        $attribute = Attribute::findOrFail($id);
        $attribute->delete();

        return response()->json(['message' => 'Attribute deleted']);
    }
}
