<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attribute;
use App\Models\Category;
use App\Support\SimpleXlsx;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

class CategoryController extends Controller
{
    public function index()
    {
        $categories = Category::withCount('products')
            ->orderBy('order')
            ->orderBy('id')
            ->get();

        return response()->json($categories);
    }

    public function store(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'code' => 'nullable|string|max:120',
            'parent_id' => 'nullable|exists:categories,id',
            'description' => 'nullable|string',
            'banner' => 'nullable|image|max:5120',
            'filterable_attribute_ids' => 'nullable|array',
        ]);

        $bannerPath = null;
        if ($request->hasFile('banner')) {
            $bannerPath = $request->file('banner')->store('category_banners', 'public');
        }

        $normalizedCode = Category::normalizeCode($request->input('code'));

        try {
            $category = Category::create([
                'name' => $request->name,
                'code' => $normalizedCode ? Category::buildUniqueCode($normalizedCode) : Category::buildUniqueCode($request->name),
                'slug' => Category::buildUniqueSlug($request->name),
                'parent_id' => $request->filled('parent_id') ? $request->parent_id : null,
                'description' => $request->description,
                'banner_path' => $bannerPath,
                'status' => $request->status ?? 1,
                'order' => Category::where('parent_id', $request->parent_id)->max('order') + 1,
                'display_layout' => $request->display_layout ?? 'layout_1',
                'filterable_attribute_ids' => $this->normalizeFilterableAttributeIds(
                    $request->input('filterable_attribute_ids')
                ),
            ]);
        } catch (Throwable $exception) {
            \Log::error('Error creating category: ' . $exception->getMessage());
            return response()->json(['error' => $exception->getMessage()], 500);
        }

        return response()->json($category, 201);
    }

    public function show($id)
    {
        $category = Category::with(['children', 'products'])->findOrFail($id);

        return response()->json($category);
    }

    public function update(Request $request, $id)
    {
        \Log::info("Category update request for ID: {$id}", [
            'data' => $request->all(),
            'has_file' => $request->hasFile('banner'),
        ]);

        $category = Category::findOrFail($id);

        $validator = \Validator::make($request->all(), [
            'name' => 'sometimes|required|string|max:255',
            'code' => 'nullable|string|max:120',
            'parent_id' => 'sometimes|nullable|exists:categories,id',
            'banner' => 'nullable|image|max:5120',
            'filterable_attribute_ids' => 'nullable|array',
        ]);

        if ($validator->fails()) {
            \Log::error('Category validation failed: ' . json_encode($validator->errors()->toArray()));
            return response()->json(['errors' => $validator->errors()], 422);
        }

        if ($request->has('name')) {
            $category->name = $request->name;
            $category->slug = Category::buildUniqueSlug($request->name, (int) $category->id);
        }

        if ($request->filled('code')) {
            $category->code = Category::buildUniqueCode($request->input('code'), (int) $category->id);
        }

        if ($request->hasFile('banner')) {
            $category->banner_path = $request->file('banner')->store('category_banners', 'public');
        } elseif ($request->input('remove_banner') === 'true') {
            $category->banner_path = null;
        }

        $category->parent_id = $request->filled('parent_id') ? $request->parent_id : null;
        $category->description = $request->input('description', $category->description);
        $category->status = $request->input('status', $category->status);
        $category->display_layout = $request->input('display_layout', $category->display_layout);

        if ($request->has('filterable_attribute_ids')) {
            $category->filterable_attribute_ids = $this->normalizeFilterableAttributeIds(
                $request->input('filterable_attribute_ids')
            );
        } elseif ($request->has('clear_attributes') && $request->input('clear_attributes') == 'true') {
            $category->filterable_attribute_ids = [];
        }

        try {
            $category->save();
        } catch (Throwable $exception) {
            \Log::error('Error saving category: ' . $exception->getMessage());
            return response()->json(['error' => $exception->getMessage()], 500);
        }

        return response()->json($category);
    }

    public function destroy($id)
    {
        $category = Category::findOrFail($id);
        $category->delete();

        return response()->json(['message' => 'Category deleted successfully']);
    }

    public function reorder(Request $request)
    {
        $items = $request->input('items', []);

        foreach ($items as $item) {
            Category::where('id', $item['id'])->update([
                'parent_id' => $item['parent_id'] ?: null,
                'order' => $item['order'] ?? 0,
            ]);
        }

        return response()->json(['message' => 'Tree reordered successfully']);
    }

    public function bulkUpdateLayout(Request $request)
    {
        $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'exists:categories,id',
            'display_layout' => 'required|string|in:layout_1,layout_2',
        ]);

        Category::whereIn('id', $request->ids)->update([
            'display_layout' => $request->display_layout,
        ]);

        return response()->json(['message' => 'Bulk update successful']);
    }

    public function downloadImportTemplate()
    {
        return $this->xlsxDownloadResponse(
            'mau-import-danh-muc-san-pham.xlsx',
            [[
                'name' => 'DanhMucSanPham',
                'rows' => array_merge([$this->categoryImportHeaders()], $this->categoryTemplateRows()),
            ]]
        );
    }

    public function exportExcel()
    {
        $categories = Category::query()
            ->orderBy('order')
            ->orderBy('id')
            ->get([
                'id',
                'name',
                'code',
                'slug',
                'parent_id',
                'description',
                'status',
                'order',
                'display_layout',
                'filterable_attribute_ids',
            ]);

        $attributes = Attribute::query()
            ->where('entity_type', 'product')
            ->get(['id', 'name', 'code']);

        return $this->xlsxDownloadResponse(
            'danh-muc-san-pham-' . now()->format('Ymd-His') . '.xlsx',
            [[
                'name' => 'DanhMucSanPham',
                'rows' => array_merge(
                    [$this->categoryImportHeaders()],
                    $this->buildCategoryExportRows($categories, $attributes)
                ),
            ]]
        );
    }

    public function importExcel(Request $request)
    {
        $request->validate([
            'file' => 'required|file|mimes:xlsx|max:10240',
        ]);

        try {
            $rows = SimpleXlsx::readRows($request->file('file')->getRealPath());
        } catch (Throwable $exception) {
            return response()->json([
                'message' => 'Khong the doc file Excel. Vui long dung file .xlsx hop le.',
                'errors' => [[
                    'row' => 1,
                    'column' => 'File',
                    'message' => $exception->getMessage(),
                ]],
            ], 422);
        }

        [$records, $errors] = $this->validateCategoryImportRows($rows);

        if (!empty($errors)) {
            return response()->json([
                'message' => 'Phat hien loi trong file import. Khong co du lieu nao duoc cap nhat.',
                'errors' => $errors,
            ], 422);
        }

        $summary = DB::transaction(fn () => $this->applyCategoryImport($records));

        return response()->json([
            'message' => sprintf(
                'Import thanh cong: %d them moi, %d cap nhat.',
                $summary['created'],
                $summary['updated']
            ),
            'summary' => $summary,
        ]);
    }

    public function products($id)
    {
        $category = Category::findOrFail($id);
        Category::ensureProductAssignments((int) $category->id);

        return response()->json($this->buildCategoryProductPayload($category));
    }

    public function reorderProducts(Request $request, $id)
    {
        $request->validate([
            'product_ids' => 'required|array',
            'product_ids.*' => 'integer|distinct',
        ]);

        $category = Category::findOrFail($id);
        Category::ensureProductAssignments((int) $category->id);

        $productIds = collect($request->input('product_ids', []))
            ->map(fn ($productId) => is_numeric($productId) ? (int) $productId : null)
            ->filter()
            ->values();

        $existingProductIds = $category->products()
            ->pluck('products.id')
            ->map(fn ($productId) => (int) $productId)
            ->values();

        if (
            $productIds->count() !== $existingProductIds->count()
            || $productIds->diff($existingProductIds)->isNotEmpty()
            || $existingProductIds->diff($productIds)->isNotEmpty()
        ) {
            return response()->json([
                'message' => 'Danh sach san pham khong hop le cho danh muc nay.',
            ], 422);
        }

        DB::transaction(function () use ($category, $productIds) {
            $timestamp = now();

            foreach ($productIds as $index => $productId) {
                DB::table('category_product')
                    ->where('category_id', $category->id)
                    ->where('product_id', $productId)
                    ->update([
                        'sort_order' => $index,
                        'updated_at' => $timestamp,
                    ]);
            }
        });

        Category::ensureProductAssignments((int) $category->id);

        return response()->json([
            'message' => 'Da cap nhat thu tu san pham trong danh muc.',
            ...$this->buildCategoryProductPayload($category->fresh()),
        ]);
    }

    protected function buildCategoryProductPayload(Category $category): array
    {
        $category->loadCount('products');

        $products = $category->products()
            ->with([
                'images:id,product_id,image_url,is_primary,sort_order',
                'category:id,name',
            ])
            ->get([
                'products.id',
                'products.name',
                'products.slug',
                'products.sku',
                'products.status',
                'products.category_id',
            ])
            ->map(function ($product) use ($category) {
                return [
                    'id' => (int) $product->id,
                    'name' => $product->name,
                    'slug' => $product->slug,
                    'sku' => $product->sku,
                    'status' => (bool) $product->status,
                    'category_id' => $product->category_id ? (int) $product->category_id : null,
                    'category_name' => $product->category?->name,
                    'main_image' => $product->main_image,
                    'sort_order' => (int) ($product->pivot->sort_order ?? 0),
                    'is_primary_category' => (int) $product->category_id === (int) $category->id,
                ];
            })
            ->values();

        return [
            'category' => [
                'id' => (int) $category->id,
                'name' => $category->name,
                'slug' => $category->slug,
                'parent_id' => $category->parent_id ? (int) $category->parent_id : null,
                'display_layout' => $category->display_layout,
                'status' => (int) $category->status,
                'products_count' => (int) ($category->products_count ?? $products->count()),
            ],
            'products' => $products,
        ];
    }

    private function categoryImportHeaders(): array
    {
        return [
            'Ma danh muc',
            'ID',
            'Ten danh muc',
            'Danh muc cha',
            'Thu tu hien thi',
            'Giao dien',
            'Bo loc thuoc tinh',
            'Trang thai hien thi',
            'Ghi chu',
        ];
    }

    private function categoryTemplateRows(): array
    {
        return [
            [
                '#vd-do-tho-bat-trang',
                '#de-trong-khi-them-moi',
                '#Ten danh muc',
                '#CODE:ma-cha hoac ID:12 hoac NAME:Ten danh muc cha',
                '#0',
                '#layout_1 hoac layout_2',
                '#duong-kinh, loai-men',
                '#1 hoac 0',
                '#Dong bat dau bang # se duoc bo qua khi import',
            ],
            [
                '#chi-dan',
                '',
                '#Can giu duy nhat cot Ma danh muc neu muon cap nhat bang ma',
                '#De trong cot Danh muc cha neu muon dua ve cap goc',
                '#Neu de trong cot Thu tu, he thong se giu hoac noi tiep thu tu hien tai',
                '#layout_1',
                '#Nhan theo ma thuoc tinh hoac ten thuoc tinh',
                '#1',
                '#File mau nay co the tai ve, dien du lieu roi import lai',
            ],
        ];
    }

    private function buildCategoryExportRows(Collection $categories, Collection $attributes): array
    {
        $attributesById = $attributes->keyBy(fn ($attribute) => (int) $attribute->id);
        $categoriesById = $categories->keyBy(fn ($category) => (int) $category->id);

        return array_map(function (Category $category) use ($attributesById, $categoriesById) {
            /** @var Category|null $parent */
            $parent = $category->parent_id ? $categoriesById->get((int) $category->parent_id) : null;

            return [
                $category->resolvedCode(),
                (int) $category->id,
                $category->name,
                $parent ? ('CODE:' . $parent->resolvedCode()) : '',
                (int) ($category->order ?? 0),
                $category->display_layout ?: 'layout_1',
                $this->formatCategoryAttributeTokens((array) ($category->filterable_attribute_ids ?? []), $attributesById),
                (int) ($category->status ?? 1),
                $category->description ?? '',
            ];
        }, $this->orderedCategoriesForExport($categories));
    }

    private function orderedCategoriesForExport(Collection $categories): array
    {
        $sorted = $categories
            ->sortBy(fn ($category) => sprintf(
                '%010d-%010d',
                (int) ($category->order ?? 0),
                (int) $category->id
            ))
            ->values();

        $childrenByParent = [];
        foreach ($sorted as $category) {
            $childrenByParent[$this->parentGroupKey($category->parent_id)][] = $category;
        }

        $ordered = [];
        $visited = [];

        $visit = function (string $parentKey) use (&$visit, &$ordered, &$visited, $childrenByParent): void {
            foreach ($childrenByParent[$parentKey] ?? [] as $category) {
                if (isset($visited[$category->id])) {
                    continue;
                }

                $visited[$category->id] = true;
                $ordered[] = $category;
                $visit($this->parentGroupKey((int) $category->id));
            }
        };

        $visit($this->parentGroupKey(null));

        foreach ($sorted as $category) {
            if (!isset($visited[$category->id])) {
                $ordered[] = $category;
            }
        }

        return $ordered;
    }

    private function validateCategoryImportRows(array $rows): array
    {
        if (empty($rows)) {
            return [[], [[
                'row' => 1,
                'column' => 'File',
                'message' => 'File Excel khong co du lieu.',
            ]]];
        }

        $headerMap = $this->resolveCategoryImportHeaderMap($rows[0] ?? []);
        $errors = [];

        if (!isset($headerMap['name'])) {
            $errors[] = [
                'row' => 1,
                'column' => 'Ten danh muc',
                'message' => 'Khong tim thay cot Ten danh muc trong file import.',
            ];

            return [[], $errors];
        }

        $categories = Category::query()->orderBy('id')->get([
            'id',
            'name',
            'code',
            'slug',
            'parent_id',
            'description',
            'status',
            'order',
            'display_layout',
            'filterable_attribute_ids',
        ]);

        $existingById = [];
        $existingByCode = [];
        foreach ($categories as $category) {
            $existingById[(int) $category->id] = $category;
            $existingByCode[$category->resolvedCode()] = $category;
        }

        $attributes = Attribute::query()
            ->where('entity_type', 'product')
            ->get(['id', 'name', 'code']);

        $attributeMaps = $this->buildAttributeLookupMaps($attributes);
        $records = [];
        $duplicateCandidates = [];

        for ($index = 1; $index < count($rows); $index++) {
            $row = $rows[$index] ?? [];
            $rowNumber = $index + 1;

            if ($this->shouldSkipCategoryImportRow($row)) {
                continue;
            }

            $rowErrors = [];
            $id = $this->parseImportedCategoryId(
                $this->importCellValue($row, $headerMap, 'id'),
                $rowNumber,
                $rowErrors
            );

            $codeInput = $this->importCellValue($row, $headerMap, 'code');
            $normalizedCode = $codeInput !== '' ? Category::normalizeCode($codeInput) : null;
            if ($codeInput !== '' && $normalizedCode === null) {
                $rowErrors[] = $this->importError($rowNumber, 'Ma danh muc', 'Ma danh muc khong hop le.');
            }

            $existingByIdMatch = $id !== null ? ($existingById[$id] ?? null) : null;
            if ($id !== null && !$existingByIdMatch) {
                $rowErrors[] = $this->importError($rowNumber, 'ID', 'Khong tim thay danh muc theo ID da nhap.');
            }

            $existingByCodeMatch = $normalizedCode !== null ? ($existingByCode[$normalizedCode] ?? null) : null;
            if (
                $existingByIdMatch
                && $existingByCodeMatch
                && (int) $existingByIdMatch->id !== (int) $existingByCodeMatch->id
            ) {
                $rowErrors[] = $this->importError(
                    $rowNumber,
                    'Ma danh muc',
                    'Ma danh muc dang tro toi mot danh muc khac voi ID da nhap.'
                );
            }

            $existingCategory = $existingByIdMatch ?? $existingByCodeMatch;

            $name = trim($this->importCellValue($row, $headerMap, 'name'));
            if ($name === '') {
                $rowErrors[] = $this->importError($rowNumber, 'Ten danh muc', 'Ten danh muc khong duoc de trong.');
            }

            $resolvedCode = $normalizedCode
                ?? ($existingCategory ? $existingCategory->resolvedCode() : Category::buildUniqueCode($name ?: 'danh-muc'));

            if ($resolvedCode !== null) {
                $duplicateCandidates[] = [
                    'row_number' => $rowNumber,
                    'code' => $resolvedCode,
                    'existing_id' => $existingCategory ? (int) $existingCategory->id : null,
                ];
            }

            [$layout, $layoutError] = $this->parseImportedLayout(
                $this->importCellValue($row, $headerMap, 'layout'),
                $existingCategory?->display_layout
            );
            if ($layoutError !== null) {
                $rowErrors[] = $this->importError($rowNumber, 'Giao dien', $layoutError);
            }

            [$status, $statusError] = $this->parseImportedStatus(
                $this->importCellValue($row, $headerMap, 'status'),
                $existingCategory ? (int) $existingCategory->status : null
            );
            if ($statusError !== null) {
                $rowErrors[] = $this->importError($rowNumber, 'Trang thai hien thi', $statusError);
            }

            [$sortOrder, $sortOrderError] = $this->parseImportedSortOrder(
                $this->importCellValue($row, $headerMap, 'sort_order')
            );
            if ($sortOrderError !== null) {
                $rowErrors[] = $this->importError($rowNumber, 'Thu tu hien thi', $sortOrderError);
            }

            [$filterIds, $filterErrors] = $this->parseImportedAttributeTokens(
                $this->importCellValue($row, $headerMap, 'filters'),
                $attributeMaps,
                $rowNumber
            );
            $rowErrors = array_merge($rowErrors, $filterErrors);

            if (!empty($rowErrors)) {
                $errors = array_merge($errors, $rowErrors);
                continue;
            }

            $records[] = [
                'row_number' => $rowNumber,
                'record_key' => $existingCategory ? ('existing:' . $existingCategory->id) : ('new:' . $resolvedCode),
                'existing_id' => $existingCategory ? (int) $existingCategory->id : null,
                'existing_parent_id' => $existingCategory && $existingCategory->parent_id ? (int) $existingCategory->parent_id : null,
                'existing_order' => $existingCategory ? (int) ($existingCategory->order ?? 0) : null,
                'code' => $resolvedCode,
                'name' => $name,
                'parent_ref' => trim($this->importCellValue($row, $headerMap, 'parent')),
                'order' => $sortOrder,
                'layout' => $layout,
                'status' => $status,
                'description' => trim($this->importCellValue($row, $headerMap, 'description')),
                'filterable_attribute_ids' => $filterIds,
            ];
        }

        if (!empty($errors)) {
            $errors = array_merge($errors, $this->validateDuplicateCategoryImportRecords($duplicateCandidates));
            return [[], $errors];
        }

        $errors = array_merge($errors, $this->validateDuplicateCategoryImportRecords($records));
        if (!empty($errors)) {
            return [[], $errors];
        }

        $recordsByKey = [];
        $recordsByCode = [];
        $recordsByName = [];
        $recordByExistingId = [];

        foreach ($records as $index => $record) {
            $recordsByKey[$record['record_key']] = &$records[$index];
            $recordsByCode[$record['code']] = &$records[$index];
            $recordsByName[$this->normalizeLookupValue($record['name'])][] = &$records[$index];

            if ($record['existing_id'] !== null) {
                $recordByExistingId[$record['existing_id']] = &$records[$index];
            }
        }

        $existingByName = [];
        foreach ($categories as $category) {
            if (isset($recordByExistingId[(int) $category->id])) {
                continue;
            }

            $existingByName[$this->normalizeLookupValue($category->name)][] = $category;
        }

        foreach ($records as $index => $record) {
            [$resolvedParent, $parentErrors] = $this->resolveImportedParentReference(
                $record,
                $recordsByCode,
                $recordsByName,
                $existingById,
                $existingByCode,
                $existingByName
            );

            if (!empty($parentErrors)) {
                $errors = array_merge($errors, $parentErrors);
                continue;
            }

            $records[$index]['resolved_parent'] = $resolvedParent;
        }

        if (!empty($errors)) {
            return [[], $errors];
        }

        foreach ($records as $record) {
            if ($this->detectCategoryCycle($record['record_key'], $recordsByKey, $recordByExistingId, $existingById)) {
                $errors[] = $this->importError(
                    $record['row_number'],
                    'Danh muc cha',
                    'Quan he cha con tao thanh vong lap. Vui long kiem tra lai cot Danh muc cha.'
                );
            }
        }

        return [empty($errors) ? $records : [], $errors];
    }

    private function applyCategoryImport(array $records): array
    {
        $persistedByKey = [];
        $created = 0;
        $updated = 0;

        foreach ($records as $record) {
            $category = $record['existing_id']
                ? Category::query()->findOrFail($record['existing_id'])
                : new Category();

            $isExisting = $category->exists;

            $category->name = $record['name'];
            $category->code = $record['code'];
            $category->slug = Category::buildUniqueSlug($record['name'], $record['existing_id']);
            $category->description = $record['description'] !== '' ? $record['description'] : null;
            $category->status = $record['status'];
            $category->display_layout = $record['layout'];
            $category->filterable_attribute_ids = $record['filterable_attribute_ids'];

            if (!$isExisting) {
                $category->parent_id = null;
                $category->order = 0;
            }

            $category->save();
            $persistedByKey[$record['record_key']] = $category;

            if ($isExisting) {
                $updated++;
            } else {
                $created++;
            }
        }

        $nextOrderByParent = $this->buildNextOrderLookup();

        foreach ($records as $record) {
            $category = $persistedByKey[$record['record_key']];
            $parentId = $this->resolveImportedParentId($record['resolved_parent'] ?? null, $persistedByKey);
            $orderKey = $this->parentGroupKey($parentId);
            $desiredOrder = $record['order'];

            if ($desiredOrder === null) {
                if (
                    $record['existing_id'] !== null
                    && $record['existing_parent_id'] === $parentId
                    && $record['existing_order'] !== null
                ) {
                    $desiredOrder = (int) $record['existing_order'];
                } else {
                    $desiredOrder = $nextOrderByParent[$orderKey] ?? 0;
                }
            }

            $nextOrderByParent[$orderKey] = max($nextOrderByParent[$orderKey] ?? 0, $desiredOrder + 1);

            $category->parent_id = $parentId;
            $category->order = $desiredOrder;
            $category->save();
        }

        $this->resequenceCategoryOrders();

        return [
            'created' => $created,
            'updated' => $updated,
            'processed' => $created + $updated,
        ];
    }

    private function resolveCategoryImportHeaderMap(array $headers): array
    {
        $aliases = [
            'code' => ['ma_danh_muc', 'ma', 'code', 'category_code'],
            'id' => ['id', 'category_id'],
            'name' => ['ten_danh_muc', 'name', 'category_name'],
            'parent' => ['danh_muc_cha', 'parent', 'parent_ref', 'parent_category'],
            'sort_order' => ['thu_tu_hien_thi', 'sort_order', 'order'],
            'layout' => ['giao_dien', 'display_layout', 'layout'],
            'filters' => ['bo_loc_thuoc_tinh', 'filterable_attributes', 'attributes', 'filters'],
            'status' => ['trang_thai_hien_thi', 'status', 'hien_thi'],
            'description' => ['ghi_chu', 'mo_ta', 'description', 'note'],
        ];

        $resolved = [];

        foreach ($headers as $index => $header) {
            $normalizedHeader = $this->normalizeImportHeader((string) $header);

            foreach ($aliases as $field => $fieldAliases) {
                if (in_array($normalizedHeader, $fieldAliases, true) && !isset($resolved[$field])) {
                    $resolved[$field] = $index;
                }
            }
        }

        return $resolved;
    }

    private function validateDuplicateCategoryImportRecords(array $records): array
    {
        $errors = [];
        $rowsByCode = [];
        $rowsByExistingId = [];

        foreach ($records as $record) {
            if (isset($rowsByCode[$record['code']])) {
                $errors[] = $this->importError(
                    $record['row_number'],
                    'Ma danh muc',
                    'Trung ma danh muc voi dong ' . $rowsByCode[$record['code']] . '.'
                );
            } else {
                $rowsByCode[$record['code']] = $record['row_number'];
            }

            if ($record['existing_id'] !== null) {
                if (isset($rowsByExistingId[$record['existing_id']])) {
                    $errors[] = $this->importError(
                        $record['row_number'],
                        'ID',
                        'Danh muc nay da xuat hien o dong ' . $rowsByExistingId[$record['existing_id']] . '.'
                    );
                } else {
                    $rowsByExistingId[$record['existing_id']] = $record['row_number'];
                }
            }
        }

        return $errors;
    }

    private function resolveImportedParentReference(
        array $record,
        array $recordsByCode,
        array $recordsByName,
        array $existingById,
        array $existingByCode,
        array $existingByName
    ): array {
        $reference = trim((string) ($record['parent_ref'] ?? ''));
        if ($reference === '') {
            return [null, []];
        }

        [$mode, $needle] = $this->splitReferenceToken($reference);
        $currentKey = $record['record_key'];

        if ($mode === 'code' || $mode === null) {
            $code = Category::normalizeCode($needle);
            if ($code !== null) {
                if (isset($recordsByCode[$code])) {
                    $candidate = $recordsByCode[$code];
                    if ($candidate['record_key'] === $currentKey) {
                        return [null, [$this->importError($record['row_number'], 'Danh muc cha', 'Danh muc khong the tu lam cha cua chinh no.')]];
                    }

                    return [[
                        'type' => 'record',
                        'key' => $candidate['record_key'],
                    ], []];
                }

                if (isset($existingByCode[$code])) {
                    if ($record['existing_id'] !== null && (int) $existingByCode[$code]->id === (int) $record['existing_id']) {
                        return [null, [$this->importError($record['row_number'], 'Danh muc cha', 'Danh muc khong the tu lam cha cua chinh no.')]];
                    }

                    return [[
                        'type' => 'existing',
                        'id' => (int) $existingByCode[$code]->id,
                    ], []];
                }
            }

            if ($mode === 'code') {
                return [null, [$this->importError(
                    $record['row_number'],
                    'Danh muc cha',
                    'Khong tim thay danh muc cha theo ma da khai bao.'
                )]];
            }
        }

        if ($mode === 'id' || ($mode === null && ctype_digit($needle))) {
            $parentId = (int) $needle;
            if (isset($existingById[$parentId])) {
                if ($record['existing_id'] !== null && $parentId === (int) $record['existing_id']) {
                    return [null, [$this->importError($record['row_number'], 'Danh muc cha', 'Danh muc khong the tu lam cha cua chinh no.')]];
                }

                return [[
                    'type' => 'existing',
                    'id' => $parentId,
                ], []];
            }

            if ($mode === 'id') {
                return [null, [$this->importError(
                    $record['row_number'],
                    'Danh muc cha',
                    'Khong tim thay danh muc cha theo ID da khai bao.'
                )]];
            }
        }

        $nameKey = $this->normalizeLookupValue($needle);
        $candidates = [];

        foreach ($recordsByName[$nameKey] ?? [] as $candidate) {
            $candidates[$candidate['record_key']] = [
                'type' => 'record',
                'key' => $candidate['record_key'],
            ];
        }

        foreach ($existingByName[$nameKey] ?? [] as $candidate) {
            $candidates['existing:' . $candidate->id] = [
                'type' => 'existing',
                'id' => (int) $candidate->id,
            ];
        }

        if (count($candidates) === 1) {
            $resolved = array_values($candidates)[0];
            if (
                ($resolved['type'] === 'record' && $resolved['key'] === $currentKey)
                || ($resolved['type'] === 'existing' && $record['existing_id'] !== null && $resolved['id'] === (int) $record['existing_id'])
            ) {
                return [null, [$this->importError($record['row_number'], 'Danh muc cha', 'Danh muc khong the tu lam cha cua chinh no.')]];
            }

            return [$resolved, []];
        }

        if (count($candidates) > 1) {
            return [null, [$this->importError(
                $record['row_number'],
                'Danh muc cha',
                'Ten danh muc cha dang bi trung. Vui long dung CODE:... hoac ID:... de xac dinh ro.'
            )]];
        }

        return [null, [$this->importError(
            $record['row_number'],
            'Danh muc cha',
            'Khong tim thay danh muc cha. Hay dung CODE:ma, ID:so hoac NAME:ten chinh xac.'
        )]];
    }

    private function detectCategoryCycle(
        string $startKey,
        array $recordsByKey,
        array $recordByExistingId,
        array $existingById
    ): bool {
        $visited = [];
        $currentKey = $startKey;

        while ($currentKey !== null) {
            if (isset($visited[$currentKey])) {
                return true;
            }

            $visited[$currentKey] = true;
            $currentKey = $this->nextParentRecordKey($currentKey, $recordsByKey, $recordByExistingId, $existingById);
        }

        return false;
    }

    private function nextParentRecordKey(
        string $recordKey,
        array $recordsByKey,
        array $recordByExistingId,
        array $existingById
    ): ?string {
        $record = $recordsByKey[$recordKey] ?? null;
        if ($record !== null) {
            $resolvedParent = $record['resolved_parent'] ?? null;

            if ($resolvedParent === null) {
                return null;
            }

            if ($resolvedParent['type'] === 'record') {
                return $resolvedParent['key'];
            }

            $parentId = (int) $resolvedParent['id'];
            if (isset($recordByExistingId[$parentId])) {
                return $recordByExistingId[$parentId]['record_key'];
            }

            return isset($existingById[$parentId]) ? ('existing:' . $parentId) : null;
        }

        if (!str_starts_with($recordKey, 'existing:')) {
            return null;
        }

        $existingId = (int) Str::after($recordKey, 'existing:');
        if (isset($recordByExistingId[$existingId])) {
            return $recordByExistingId[$existingId]['record_key'];
        }

        $category = $existingById[$existingId] ?? null;
        if (!$category || !$category->parent_id) {
            return null;
        }

        $parentId = (int) $category->parent_id;
        if (isset($recordByExistingId[$parentId])) {
            return $recordByExistingId[$parentId]['record_key'];
        }

        return isset($existingById[$parentId]) ? ('existing:' . $parentId) : null;
    }

    private function buildAttributeLookupMaps(Collection $attributes): array
    {
        $byId = [];
        $byCode = [];
        $byName = [];

        foreach ($attributes as $attribute) {
            $byId[(int) $attribute->id] = $attribute;

            if ($attribute->code) {
                $byCode[Category::normalizeCode($attribute->code) ?? (string) $attribute->code] = $attribute;
            }

            $byName[$this->normalizeLookupValue($attribute->name)][] = $attribute;
        }

        return [
            'by_id' => $byId,
            'by_code' => $byCode,
            'by_name' => $byName,
        ];
    }

    private function parseImportedAttributeTokens(string $rawValue, array $attributeMaps, int $rowNumber): array
    {
        $value = trim($rawValue);
        if ($value === '') {
            return [[], []];
        }

        $tokens = preg_split('/[\r\n,;|]+/', $value) ?: [];
        $attributeIds = [];
        $errors = [];

        foreach ($tokens as $token) {
            $token = trim((string) $token);
            if ($token === '') {
                continue;
            }

            [$mode, $needle] = $this->splitReferenceToken($token);

            if ($mode === 'code' || $mode === null) {
                $code = Category::normalizeCode($needle);
                if ($code !== null && isset($attributeMaps['by_code'][$code])) {
                    $attributeIds[] = (int) $attributeMaps['by_code'][$code]->id;
                    continue;
                }

                if ($mode === 'code') {
                    $errors[] = $this->importError(
                        $rowNumber,
                        'Bo loc thuoc tinh',
                        'Khong tim thay thuoc tinh theo ma "' . $token . '".'
                    );
                    continue;
                }
            }

            if ($mode === 'id' || ($mode === null && ctype_digit($needle))) {
                $attributeId = (int) $needle;
                if (isset($attributeMaps['by_id'][$attributeId])) {
                    $attributeIds[] = $attributeId;
                    continue;
                }

                if ($mode === 'id') {
                    $errors[] = $this->importError(
                        $rowNumber,
                        'Bo loc thuoc tinh',
                        'Khong tim thay thuoc tinh theo ID "' . $token . '".'
                    );
                    continue;
                }
            }

            $nameKey = $this->normalizeLookupValue($needle);
            $nameCandidates = $attributeMaps['by_name'][$nameKey] ?? [];

            if (count($nameCandidates) === 1) {
                $attributeIds[] = (int) $nameCandidates[0]->id;
                continue;
            }

            if (count($nameCandidates) > 1) {
                $errors[] = $this->importError(
                    $rowNumber,
                    'Bo loc thuoc tinh',
                    'Ten thuoc tinh "' . $token . '" dang bi trung. Hay dung ma thuoc tinh.'
                );
                continue;
            }

            $errors[] = $this->importError(
                $rowNumber,
                'Bo loc thuoc tinh',
                'Khong tim thay thuoc tinh "' . $token . '".'
            );
        }

        return [array_values(array_unique($attributeIds)), $errors];
    }

    private function parseImportedCategoryId(string $value, int $rowNumber, array &$errors): ?int
    {
        $value = trim($value);
        if ($value === '') {
            return null;
        }

        if (!ctype_digit($value)) {
            $errors[] = $this->importError($rowNumber, 'ID', 'ID phai la so nguyen duong.');
            return null;
        }

        return (int) $value;
    }

    private function parseImportedLayout(string $value, ?string $fallback = null): array
    {
        $value = trim($value);
        if ($value === '') {
            return [$fallback ?: 'layout_1', null];
        }

        $normalized = $this->normalizeLookupValue($value);

        return match ($normalized) {
            'layout_1', 'layout1', '1', 'giao_dien_1', 'giao_dien_mot' => ['layout_1', null],
            'layout_2', 'layout2', '2', 'giao_dien_2', 'giao_dien_hai' => ['layout_2', null],
            default => [null, 'Giao dien chi hop le voi layout_1 hoac layout_2.'],
        };
    }

    private function parseImportedStatus(string $value, ?int $fallback = null): array
    {
        $value = trim($value);
        if ($value === '') {
            return [$fallback ?? 1, null];
        }

        $normalized = $this->normalizeLookupValue($value);

        return match ($normalized) {
            '1', 'true', 'yes', 'hien_thi', 'dang_hien_thi', 'active' => [1, null],
            '0', 'false', 'no', 'an', 'dang_an', 'inactive', 'hidden' => [0, null],
            default => [null, 'Trang thai hien thi chi hop le voi 1 hoac 0.'],
        };
    }

    private function parseImportedSortOrder(string $value): array
    {
        $value = trim($value);
        if ($value === '') {
            return [null, null];
        }

        if (!preg_match('/^-?\d+$/', $value)) {
            return [null, 'Thu tu hien thi phai la so nguyen.'];
        }

        $sortOrder = (int) $value;
        if ($sortOrder < 0) {
            return [null, 'Thu tu hien thi khong duoc nho hon 0.'];
        }

        return [$sortOrder, null];
    }

    private function buildNextOrderLookup(): array
    {
        $lookup = [];

        Category::query()
            ->get(['parent_id', 'order'])
            ->groupBy(fn ($category) => $this->parentGroupKey($category->parent_id))
            ->each(function (Collection $siblings, string $key) use (&$lookup) {
                $lookup[$key] = ((int) $siblings->max('order')) + 1;
            });

        return $lookup;
    }

    private function resequenceCategoryOrders(): void
    {
        $groups = Category::query()
            ->orderBy('order')
            ->orderBy('id')
            ->get(['id', 'parent_id', 'order'])
            ->groupBy(fn ($category) => $this->parentGroupKey($category->parent_id));

        foreach ($groups as $siblings) {
            foreach ($siblings->values() as $index => $category) {
                if ((int) ($category->order ?? -1) !== $index) {
                    Category::query()
                        ->where('id', $category->id)
                        ->update(['order' => $index]);
                }
            }
        }
    }

    private function resolveImportedParentId(?array $resolvedParent, array $persistedByKey): ?int
    {
        if ($resolvedParent === null) {
            return null;
        }

        if ($resolvedParent['type'] === 'record') {
            return isset($persistedByKey[$resolvedParent['key']])
                ? (int) $persistedByKey[$resolvedParent['key']]->id
                : null;
        }

        return (int) $resolvedParent['id'];
    }

    private function formatCategoryAttributeTokens(array $attributeIds, Collection $attributesById): string
    {
        return collect($attributeIds)
            ->map(function ($attributeId) use ($attributesById) {
                $attribute = $attributesById->get((int) $attributeId);
                if ($attribute) {
                    return trim((string) ($attribute->code ?: $attribute->name));
                }

                return 'ID:' . (int) $attributeId;
            })
            ->filter()
            ->implode(', ');
    }

    private function normalizeFilterableAttributeIds($value): ?array
    {
        if ($value === null) {
            return null;
        }

        $ids = $value;
        if (is_string($ids)) {
            $decoded = json_decode($ids, true);
            $ids = is_array($decoded) ? $decoded : explode(',', $ids);
        }

        return array_values(array_unique(array_map('intval', array_filter((array) $ids, fn ($id) => $id !== '' && $id !== null))));
    }

    private function shouldSkipCategoryImportRow(array $row): bool
    {
        $values = array_map(fn ($value) => trim((string) $value), $row);
        $nonEmptyValues = array_values(array_filter($values, fn ($value) => $value !== ''));

        if (empty($nonEmptyValues)) {
            return true;
        }

        return str_starts_with($nonEmptyValues[0], '#');
    }

    private function importCellValue(array $row, array $headerMap, string $field): string
    {
        $index = $headerMap[$field] ?? null;

        return $index === null ? '' : trim((string) ($row[$index] ?? ''));
    }

    private function splitReferenceToken(string $value): array
    {
        $value = trim($value);

        if (preg_match('/^(code|id|name)\s*:\s*(.+)$/i', $value, $matches) === 1) {
            return [Str::lower($matches[1]), trim($matches[2])];
        }

        return [null, $value];
    }

    private function normalizeImportHeader(string $value): string
    {
        return trim((string) Str::of(Str::ascii($value))
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', '_'), '_');
    }

    private function normalizeLookupValue(string $value): string
    {
        return trim((string) Str::of(Str::ascii($value))
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', '_'), '_');
    }

    private function parentGroupKey($parentId): string
    {
        return $parentId ? ('parent:' . (int) $parentId) : 'root';
    }

    private function importError(int $row, string $column, string $message): array
    {
        return [
            'row' => $row,
            'column' => $column,
            'message' => $message,
        ];
    }

    private function xlsxDownloadResponse(string $filename, array $sheets)
    {
        $binary = SimpleXlsx::buildWorkbook($sheets);

        return response($binary, 200, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'Cache-Control' => 'no-store, no-cache, must-revalidate',
        ]);
    }
}
