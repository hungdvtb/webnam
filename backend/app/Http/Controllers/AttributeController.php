<?php

namespace App\Http\Controllers;

use App\Models\Attribute;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class AttributeController extends Controller
{
    public function index(Request $request)
    {
        $query = Attribute::with('options');
        if ($request->has('entity_type')) {
            $query->byEntityType($request->entity_type);
        }
        
        if ($request->boolean('active_only')) {
            $query->where('status', true);
        }

        $attributes = $query
            ->ordered()
            ->get();
        return response()->json($attributes);
    }

    public function store(Request $request)
    {
        $accountId = session()->get('active_account_id') ?? request()->header('X-Account-Id');

        $request->validate([
            'name' => 'required|string|max:255',
            'entity_type' => 'nullable|string|in:product,order',
            'code' => [
                'sometimes', 
                'string', 
                'max:255', 
                \Illuminate\Validation\Rule::unique('attributes', 'code')->where('account_id', $accountId)
            ],
            'frontend_type' => 'required|string',
            'swatch_type' => 'nullable|string|in:none,color,image',
            'options' => 'nullable|array',
            'is_filterable' => 'boolean',
            'is_filterable_frontend' => 'boolean',
            'is_filterable_backend' => 'boolean',
            'is_required' => 'boolean',
            'is_variant' => 'boolean',
            'status' => 'boolean'
        ]);

        $code = $request->code ?: Str::slug($request->name);
        
        if (Attribute::where('code', $code)->exists()) {
            $code = $code . '-' . time();
        }

        $entityType = $request->entity_type ?? 'product';

        $payload = [
            'name' => $request->name,
            'entity_type' => $entityType,
            'code' => $code,
            'frontend_type' => $request->frontend_type,
            'swatch_type' => $request->swatch_type === 'none' ? null : $request->swatch_type,
            'is_filterable' => $request->is_filterable ?? false,
            'is_filterable_frontend' => $request->is_filterable_frontend ?? false,
            'is_filterable_backend' => $request->is_filterable_backend ?? false,
            'is_required' => $request->is_required ?? false,
            'is_variant' => $request->is_variant ?? false,
            'status' => $request->status ?? true,
        ];

        if (Attribute::hasSortOrderColumn()) {
            $payload['sort_order'] = Attribute::nextSortOrderFor($entityType, $accountId);
        }

        $attribute = Attribute::create($payload);

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
            'entity_type' => 'sometimes|required|string|in:product,order',
            'frontend_type' => 'sometimes|required|string',
            'swatch_type' => 'nullable|string|in:none,color,image',
            'options' => 'nullable|array',
            'is_filterable' => 'boolean',
            'is_filterable_frontend' => 'boolean',
            'is_filterable_backend' => 'boolean',
            'is_required' => 'boolean',
            'is_variant' => 'boolean',
            'status' => 'boolean'
        ]);

        $data = $request->only('name', 'entity_type', 'frontend_type', 'swatch_type', 'is_filterable', 'is_filterable_frontend', 'is_filterable_backend', 'is_required', 'is_variant', 'status');
        if (isset($data['swatch_type']) && $data['swatch_type'] === 'none') {
            $data['swatch_type'] = null;
        }
        $attribute->update($data);

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

    public function reorder(Request $request)
    {
        $validated = $request->validate([
            'entity_type' => 'required|string|in:product,order',
            'attribute_ids' => 'required|array|min:1',
            'attribute_ids.*' => 'required|integer|distinct|exists:attributes,id',
        ]);

        $orderedIds = collect($validated['attribute_ids'])
            ->map(fn ($id) => (int) $id)
            ->values();

        $existingIds = Attribute::query()
            ->byEntityType($validated['entity_type'])
            ->ordered()
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values();

        if (
            $orderedIds->count() !== $existingIds->count()
            || $orderedIds->diff($existingIds)->isNotEmpty()
            || $existingIds->diff($orderedIds)->isNotEmpty()
        ) {
            throw ValidationException::withMessages([
                'attribute_ids' => 'Danh sach thuoc tinh sap xep khong hop le. Vui long tai lai va thu lai.',
            ]);
        }

        if (!Attribute::hasSortOrderColumn()) {
            return response()->json([
                'message' => 'Da bo qua sap xep thuoc tinh vi cot sort_order chua ton tai trong CSDL.',
            ]);
        }

        DB::transaction(function () use ($orderedIds) {
            foreach ($orderedIds as $index => $attributeId) {
                Attribute::query()
                    ->whereKey($attributeId)
                    ->update(['sort_order' => $index + 1]);
            }
        });

        return response()->json([
            'message' => 'Da cap nhat thu tu thuoc tinh thanh cong.',
        ]);
    }
}
