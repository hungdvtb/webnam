<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\Attribute;
use App\Models\Category;
use App\Models\SiteDomain;
use App\Services\MediaService;
use App\Support\SimpleXlsx;
use Illuminate\Http\UploadedFile;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Throwable;

class CategoryController extends Controller
{
    public function __construct(
        protected MediaService $mediaService
    ) {
    }

    private function categoryImportSelectableFieldIds(): array
    {
        return [
            'name',
            'description',
            'tree',
            'banner',
            'logo',
        ];
    }

    private function resolveCategoryImportOptions(Request $request): array
    {
        $mode = trim((string) $request->input('mode', 'replace_all')) === 'update_selected_fields'
            ? 'update_selected_fields'
            : 'replace_all';

        $allowedFields = array_fill_keys($this->categoryImportSelectableFieldIds(), true);
        $selectedFields = [];

        foreach ((array) $request->input('update_fields', []) as $rawField) {
            $field = trim((string) $rawField);

            if ($field !== '' && isset($allowedFields[$field])) {
                $selectedFields[$field] = true;
            }
        }

        return [
            'mode' => $mode,
            'is_selective_update' => $mode === 'update_selected_fields',
            'selected_fields' => $selectedFields,
        ];
    }

    private function shouldApplyCategoryImportField(array $importOptions, string $field, bool $isExisting): bool
    {
        return !$isExisting
            || !$importOptions['is_selective_update']
            || !empty($importOptions['selected_fields'][$field]);
    }

    public function index()
    {
        $categories = Category::with(['bannerMediaAsset', 'logoMediaAsset'])
            ->withCount('products')
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
            'parent_id' => 'nullable|integer',
            'description' => 'nullable|string',
            'banner' => 'nullable|image|max:5120',
            'logo' => 'nullable|image|max:5120',
            'filterable_attribute_ids' => 'nullable|array',
        ]);

        $parentId = $this->resolveValidatedParentId($request->input('parent_id'));

        $normalizedCode = Category::normalizeCode($request->input('code'));

        try {
            $bannerAsset = $request->hasFile('banner')
                ? $this->mediaService->uploadImage($request->file('banner'), [
                    'collection' => 'category-banners',
                    'source' => 'category-form-upload',
                ])
                : null;
            $logoAsset = $request->hasFile('logo')
                ? $this->mediaService->uploadImage($request->file('logo'), [
                    'collection' => 'category-logos',
                    'source' => 'category-form-upload',
                ])
                : null;

            $category = Category::create([
                'name' => $request->name,
                'code' => $normalizedCode ? Category::buildUniqueCode($normalizedCode) : Category::buildUniqueCode($request->name),
                'slug' => Category::buildUniqueSlug($request->name),
                'parent_id' => $parentId,
                'description' => $request->description,
                'banner_path' => $bannerAsset ? $this->mediaService->buildAssetUrl($bannerAsset, 'large') : null,
                'banner_media_asset_id' => $bannerAsset?->id,
                'logo_path' => $logoAsset ? $this->mediaService->buildAssetUrl($logoAsset, 'large') : null,
                'logo_media_asset_id' => $logoAsset?->id,
                'status' => $request->status ?? 1,
                'order' => Category::where('parent_id', $parentId)->max('order') + 1,
                'display_layout' => 'layout_1',
                'filterable_attribute_ids' => $this->normalizeFilterableAttributeIds(
                    $request->input('filterable_attribute_ids')
                ),
            ]);
        } catch (Throwable $exception) {
            \Log::error('Error creating category: ' . $exception->getMessage());
            return response()->json(['error' => $exception->getMessage()], 500);
        }

        return response()->json($category->load(['bannerMediaAsset', 'logoMediaAsset']), 201);
    }

    public function show($id)
    {
        $category = Category::with(['children.bannerMediaAsset', 'children.logoMediaAsset', 'products', 'bannerMediaAsset', 'logoMediaAsset'])->findOrFail($id);

        return response()->json($category);
    }

    public function update(Request $request, $id)
    {
        \Log::info("Category update request for ID: {$id}", [
            'data' => $request->all(),
            'has_file' => $request->hasFile('banner'),
            'has_logo_file' => $request->hasFile('logo'),
        ]);

        $category = Category::findOrFail($id);
        $previousBannerAssetId = $category->banner_media_asset_id;
        $previousLogoAssetId = $category->logo_media_asset_id;

        $validator = \Validator::make($request->all(), [
            'name' => 'sometimes|required|string|max:255',
            'code' => 'nullable|string|max:120',
            'parent_id' => 'sometimes|nullable|integer',
            'banner' => 'nullable|image|max:5120',
            'logo' => 'nullable|image|max:5120',
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
            $this->replaceCategoryMediaAsset($category, 'banner', $request->file('banner'));
        } elseif ($request->input('remove_banner') === 'true') {
            $category->banner_path = null;
            $category->banner_media_asset_id = null;
        }

        if ($request->hasFile('logo')) {
            $this->replaceCategoryMediaAsset($category, 'logo', $request->file('logo'));
        } elseif ($request->input('remove_logo') === 'true') {
            $category->logo_path = null;
            $category->logo_media_asset_id = null;
        }

        if ($request->has('parent_id')) {
            $category->parent_id = $this->resolveValidatedParentId(
                $request->input('parent_id'),
                (int) $category->id
            );
        }
        $category->description = $request->input('description', $category->description);
        $category->status = $request->input('status', $category->status);
        $category->display_layout = 'layout_1';

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

        if ($request->input('remove_banner') === 'true' && $previousBannerAssetId) {
            $this->mediaService->deleteAsset($previousBannerAssetId);
        }

        if ($request->input('remove_logo') === 'true' && $previousLogoAssetId) {
            $this->mediaService->deleteAsset($previousLogoAssetId);
        }

        return response()->json($category->load(['bannerMediaAsset', 'logoMediaAsset']));
    }

    public function destroy($id)
    {
        $category = Category::findOrFail($id);
        $category->delete();

        return response()->json(['message' => 'Category deleted successfully']);
    }

    public function reorder(Request $request)
    {
        $request->validate([
            'items' => 'nullable|array',
            'items.*.id' => 'required|integer|min:1',
            'items.*.parent_id' => 'nullable|integer|min:1',
            'items.*.order' => 'nullable|integer|min:0',
        ]);

        $items = collect($request->input('items', []))
            ->map(fn (array $item) => [
                'id' => (int) $item['id'],
                'parent_id' => $this->normalizeParentIdInput($item['parent_id'] ?? null),
                'order' => isset($item['order']) ? (int) $item['order'] : 0,
            ])
            ->values();

        if ($items->isEmpty()) {
            return response()->json(['message' => 'Tree reordered successfully']);
        }

        $this->validateReorderPayload($items);

        foreach ($items as $item) {
            Category::where('id', $item['id'])->update([
                'parent_id' => $item['parent_id'],
                'order' => $item['order'] ?? 0,
            ]);
        }

        return response()->json(['message' => 'Tree reordered successfully']);
    }

    public function bulkDestroy(Request $request)
    {
        $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer|distinct',
        ]);

        $ids = collect($request->input('ids', []))
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            throw ValidationException::withMessages([
                'ids' => ['Vui long chon it nhat mot danh muc hop le de xoa.'],
            ]);
        }

        $existingIds = Category::query()
            ->whereIn('id', $ids)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values();

        if ($existingIds->count() !== $ids->count()) {
            throw ValidationException::withMessages([
                'ids' => ['Mot hoac nhieu danh muc khong ton tai hoac khong hop le.'],
            ]);
        }

        DB::transaction(function () use ($existingIds) {
            Category::query()
                ->whereIn('id', $existingIds)
                ->delete();
        });

        return response()->json([
            'message' => 'Da xoa cac danh muc da chon.',
            'deleted_count' => $existingIds->count(),
        ]);
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

    public function exportExcel(Request $request)
    {
        $request->validate([
            'ids' => 'nullable',
        ]);

        $allCategories = Category::query()
            ->orderBy('order')
            ->orderBy('id')
            ->get([
                'account_id',
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
                'banner_path',
                'logo_path',
            ]);

        $requestedIds = $this->normalizeCategoryExportIds($request->input('ids'));
        $categories = $this->filterCategoriesForExport($allCategories, $requestedIds);

        return $this->xlsxDownloadResponse(
            'danh-muc-san-pham-' . now()->format('Ymd-His') . '.xlsx',
            [[
                'name' => 'DanhMucSanPham',
                'rows' => array_merge(
                    [$this->categoryExportHeaders()],
                    $this->buildCategoryExportRows($categories)
                ),
            ]]
        );
    }

    public function importExcel(Request $request)
    {
        $request->validate([
            'file' => 'required|file|mimes:xlsx|max:10240',
            'mode' => 'nullable|string|in:replace_all,update_selected_fields',
            'update_fields' => 'nullable|array',
            'update_fields.*' => 'nullable|string|max:60',
        ]);

        $importOptions = $this->resolveCategoryImportOptions($request);
        if ($importOptions['is_selective_update'] && empty($importOptions['selected_fields'])) {
            return response()->json([
                'message' => 'Vui long chon it nhat 1 truong can cap nhat truoc khi import.',
                'errors' => [[
                    'row' => 1,
                    'column' => 'Truong cap nhat',
                    'message' => 'Chua co truong nao duoc chon de cap nhat.',
                ]],
            ], 422);
        }

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

        [$records, $errors] = $this->validateCategoryImportRows($rows, $importOptions);

        if (!empty($errors)) {
            return response()->json([
                'message' => 'Phat hien loi trong file import. Khong co du lieu nao duoc cap nhat.',
                'errors' => $errors,
            ], 422);
        }

        try {
            $summary = DB::transaction(fn () => $this->applyCategoryImport($records, $importOptions));
        } catch (Throwable $exception) {
            return response()->json([
                'message' => 'Import danh muc that bai. ' . $exception->getMessage(),
                'errors' => [[
                    'row' => 0,
                    'column' => 'Du lieu',
                    'message' => $exception->getMessage(),
                ]],
            ], 422);
        }

        return response()->json([
            'message' => sprintf(
                'Import thanh cong: %d them moi, %d cap nhat, %d anh dong bo.',
                $summary['created'],
                $summary['updated'],
                $summary['images_imported'] ?? 0
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

        $existingProductIds = $this->sortableCategoryProductsQuery($category)
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

    protected function sortableCategoryProductsQuery(Category $category)
    {
        return $category->products()
            ->whereDoesntHave('parentConfigurable');
    }

    protected function buildCategoryProductPayload(Category $category): array
    {
        $products = $this->sortableCategoryProductsQuery($category)
            ->with([
                'images:id,product_id,image_url,is_primary,sort_order',
                'category:id,name',
            ])
            ->withCount('parentConfigurable')
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
                    'is_variant_child' => ((int) ($product->parent_configurable_count ?? 0)) > 0,
                ];
            })
            ->values();

        return [
            'category' => [
                'id' => (int) $category->id,
                'name' => $category->name,
                'slug' => $category->slug,
                'parent_id' => $category->parent_id ? (int) $category->parent_id : null,
                'display_layout' => 'layout_1',
                'status' => (int) $category->status,
                'products_count' => (int) $products->count(),
            ],
            'products' => $products,
        ];
    }

    private function categoryImportHeaders(): array
    {
        return [
            'Ma danh muc',
            'Ten danh muc',
            'Mo ta',
            'Danh muc cha',
            'Thu tu trong cay',
            'Link anh banner',
            'Link anh nho',
        ];
    }

    private function categoryExportHeaders(): array
    {
        return $this->categoryImportHeaders();
    }

    private function categoryTemplateRows(): array
    {
        return [
            [
                '#vd-do-tho-bat-trang',
                '#Ten danh muc',
                '#Mo ta danh muc',
                '#CODE:ma-cha hoac ID:12 hoac NAME:Ten danh muc cha',
                '#0',
                '#https://cdn.example.com/category/banner.jpg',
                '#https://cdn.example.com/category/logo.jpg',
            ],
            [
                '#chi-dan',
                '#Ten danh muc bat buoc khi tao moi hoac khi cap nhat truong ten',
                '#De trong = xoa mo ta khi import day du. Nhap NULL/deletE/CLEAR de xoa trong update mode',
                '#De trong = dua ve cap goc khi import day du hoac khi chon cap nhat cay',
                '#Thu tu trong nhom anh em. Neu bo trong, he thong giu thu tu cu hoac noi tiep',
                '#Chi nhan URL http/https. Import se luu lai ve kho anh online cua he thong',
                '#De trong = bo qua khi update 1 phan. Nhap NULL/deletE/CLEAR de xoa anh',
            ],
        ];
    }

    private function buildCategoryExportRows(Collection $categories): array
    {
        $categoriesById = $categories->keyBy(fn ($category) => (int) $category->id);

        return array_map(function (Category $category) use ($categoriesById) {
            /** @var Category|null $parent */
            $parent = $category->parent_id ? $categoriesById->get((int) $category->parent_id) : null;

            return [
                $category->resolvedCode(),
                $category->name,
                $category->description ?? '',
                $parent ? ('CODE:' . $parent->resolvedCode()) : '',
                (int) ($category->order ?? 0),
                $this->resolveCategoryAssetPublicUrl($category->banner_path),
                $this->resolveCategoryAssetPublicUrl($category->logo_path),
            ];
        }, $this->orderedCategoriesForExport($categories));
    }

    private function normalizeCategoryExportIds($value): array
    {
        $items = $value;

        if (is_string($items)) {
            $items = preg_split('/[\s,;|]+/', $items) ?: [];
        }

        return collect((array) $items)
            ->map(fn ($item) => is_numeric($item) ? (int) $item : null)
            ->filter(fn ($item) => $item !== null && $item > 0)
            ->unique()
            ->values()
            ->all();
    }

    private function filterCategoriesForExport(Collection $categories, array $requestedIds): Collection
    {
        if (empty($requestedIds)) {
            return $categories;
        }

        $categoriesById = $categories->keyBy(fn (Category $category) => (int) $category->id);
        $childrenByParent = $categories->groupBy(fn (Category $category) => $category->parent_id ? (int) $category->parent_id : 0);
        $includedIds = [];

        $includeAncestors = function (int $categoryId) use (&$includeAncestors, &$includedIds, $categoriesById): void {
            $category = $categoriesById->get($categoryId);
            if (!$category) {
                return;
            }

            $includedIds[$categoryId] = true;

            if ($category->parent_id) {
                $includeAncestors((int) $category->parent_id);
            }
        };

        $includeDescendants = function (int $parentId) use (&$includeDescendants, &$includedIds, $childrenByParent): void {
            foreach ($childrenByParent->get($parentId, collect()) as $child) {
                $childId = (int) $child->id;

                if (isset($includedIds[$childId])) {
                    continue;
                }

                $includedIds[$childId] = true;
                $includeDescendants($childId);
            }
        };

        foreach ($requestedIds as $requestedId) {
            $includeAncestors((int) $requestedId);
            $includeDescendants((int) $requestedId);
        }

        return $categories
            ->filter(fn (Category $category) => isset($includedIds[(int) $category->id]))
            ->values();
    }

    private function parseCategoryNullableImportCell(string $value, bool $clearWhenBlank): array
    {
        $trimmed = trim($value);

        if ($trimmed === '') {
            return $clearWhenBlank
                ? ['provided' => true, 'clear' => true, 'value' => null]
                : ['provided' => false, 'clear' => false, 'value' => null];
        }

        if ($this->isCategoryImportNullishValue($trimmed)) {
            return ['provided' => true, 'clear' => true, 'value' => null];
        }

        return ['provided' => true, 'clear' => false, 'value' => $trimmed];
    }

    private function isCategoryImportNullishValue(string $value): bool
    {
        return in_array(
            $this->normalizeLookupValue($value),
            ['null', 'none', 'clear', 'delete', 'xoa', '__clear__'],
            true
        );
    }

    private function isValidImportedImageUrl(string $value): bool
    {
        return filter_var($value, FILTER_VALIDATE_URL) !== false
            && preg_match('#^https?://#i', $value) === 1;
    }

    private function categoryAssetDisk(): string
    {
        $publicDriver = (string) config('filesystems.disks.public.driver', 'local');

        if ($publicDriver !== '' && $publicDriver !== 'local') {
            return 'public';
        }

        return filled(config('filesystems.disks.s3.bucket'))
            ? 's3'
            : 'public';
    }

    private function storeUploadedCategoryAsset(UploadedFile $file, string $directory): string
    {
        $disk = $this->categoryAssetDisk();
        $path = Storage::disk($disk)->putFile($directory, $file, ['visibility' => 'public']);

        if (!$path) {
            throw new \RuntimeException('Khong the luu anh danh muc len kho online.');
        }

        return $this->buildAbsoluteStorageUrl($disk, $path);
    }

    private function importCategoryAssetFromUrl(string $sourceUrl, ?string $currentValue, string $directory): array
    {
        $normalizedSourceUrl = trim($sourceUrl);
        $disk = $this->categoryAssetDisk();
        $currentManagedUrl = $this->resolveCategoryAssetPublicUrl($currentValue);

        if ($currentManagedUrl !== '' && $this->normalizeComparableUrl($currentManagedUrl) === $this->normalizeComparableUrl($normalizedSourceUrl)) {
            return [
                'url' => $currentManagedUrl,
                'stored' => false,
            ];
        }

        $existingManagedPath = $this->extractManagedCategoryAssetPath($normalizedSourceUrl, $disk);
        if ($existingManagedPath !== null) {
            return [
                'url' => $this->buildAbsoluteStorageUrl($disk, $existingManagedPath),
                'stored' => false,
            ];
        }

        $response = Http::timeout(30)
            ->withHeaders(['Accept' => 'image/*,*/*;q=0.8'])
            ->get($normalizedSourceUrl);

        if (!$response->successful()) {
            throw new \RuntimeException('Khong the tai anh tu link online: ' . $normalizedSourceUrl);
        }

        $contentType = trim((string) $response->header('Content-Type', ''));
        if ($contentType !== '' && !str_starts_with(Str::lower($contentType), 'image/')) {
            throw new \RuntimeException('Link anh khong tra ve du lieu hinh anh hop le: ' . $normalizedSourceUrl);
        }

        $extension = $this->guessCategoryAssetExtension($normalizedSourceUrl, $contentType);
        $path = trim($directory, '/') . '/' . Str::uuid()->toString() . '.' . $extension;
        $stored = Storage::disk($disk)->put($path, $response->body(), [
            'visibility' => 'public',
            'ContentType' => $contentType !== '' ? $contentType : null,
        ]);

        if (!$stored) {
            throw new \RuntimeException('Khong the luu anh da import vao kho online.');
        }

        return [
            'url' => $this->buildAbsoluteStorageUrl($disk, $path),
            'stored' => true,
        ];
    }

    private function guessCategoryAssetExtension(string $url, string $contentType): string
    {
        $extensionFromContentType = match (Str::lower(trim($contentType))) {
            'image/jpeg', 'image/jpg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
            'image/avif' => 'avif',
            'image/svg+xml' => 'svg',
            default => null,
        };

        if ($extensionFromContentType !== null) {
            return $extensionFromContentType;
        }

        $path = parse_url($url, PHP_URL_PATH) ?: $url;
        $extension = Str::lower((string) pathinfo((string) $path, PATHINFO_EXTENSION));

        return in_array($extension, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg'], true)
            ? ($extension === 'jpeg' ? 'jpg' : $extension)
            : 'jpg';
    }

    private function resolveCategoryAssetPublicUrl(?string $value): string
    {
        $rawValue = trim((string) $value);

        if ($rawValue === '') {
            return '';
        }

        if (preg_match('#^https?://#i', $rawValue) === 1) {
            return $rawValue;
        }

        $path = preg_replace('#^/?storage/#i', '', $rawValue) ?? $rawValue;

        return $this->buildAbsoluteStorageUrl($this->categoryAssetDisk(), ltrim($path, '/'));
    }

    private function buildAbsoluteStorageUrl(string $disk, string $path): string
    {
        $url = Storage::disk($disk)->url($path);

        if (preg_match('#^https?://#i', $url) === 1) {
            return $url;
        }

        if (str_starts_with($url, '//')) {
            return 'https:' . $url;
        }

        $baseUrl = rtrim((string) (request()?->getSchemeAndHttpHost() ?: config('app.url', '')), '/');

        return $baseUrl !== '' && str_starts_with($url, '/')
            ? $baseUrl . $url
            : $url;
    }

    private function extractManagedCategoryAssetPath(?string $value, string $disk): ?string
    {
        $rawValue = trim((string) $value);

        if ($rawValue === '') {
            return null;
        }

        if (preg_match('#^https?://#i', $rawValue) !== 1) {
            return ltrim((string) preg_replace('#^/?storage/#i', '', $rawValue), '/');
        }

        $diskBaseUrls = array_filter([
            rtrim($this->buildAbsoluteStorageUrl($disk, ''), '/'),
            rtrim((string) config('filesystems.disks.public.url', ''), '/'),
        ]);

        foreach ($diskBaseUrls as $baseUrl) {
            if ($baseUrl !== '' && str_starts_with($rawValue, $baseUrl . '/')) {
                return ltrim(substr($rawValue, strlen($baseUrl)), '/');
            }
        }

        $path = parse_url($rawValue, PHP_URL_PATH);
        if (is_string($path) && preg_match('#/storage/(.+)$#i', $path, $matches) === 1) {
            return ltrim($matches[1], '/');
        }

        return null;
    }

    private function normalizeComparableUrl(string $value): string
    {
        return Str::lower(rtrim(trim($value), '/'));
    }

    private function buildCategoryDomainLookup(Collection $categories): array
    {
        $accountIds = $categories
            ->pluck('account_id')
            ->filter()
            ->map(fn ($accountId) => (int) $accountId)
            ->unique()
            ->values();

        if ($accountIds->isEmpty()) {
            return [];
        }

        $domainsByAccount = SiteDomain::query()
            ->whereIn('account_id', $accountIds)
            ->orderByDesc('is_default')
            ->orderByDesc('is_active')
            ->orderBy('id')
            ->get(['account_id', 'domain', 'is_active', 'is_default'])
            ->groupBy(fn ($domain) => (int) $domain->account_id);

        $accountsById = Account::query()
            ->whereIn('id', $accountIds)
            ->get(['id', 'domain'])
            ->keyBy(fn ($account) => (int) $account->id);

        $resolved = [];

        foreach ($accountIds as $accountId) {
            $accountDomainRows = $domainsByAccount->get((int) $accountId, collect());
            $siteDomain = $accountDomainRows->first(
                fn ($domain) => (bool) $domain->is_active && (bool) $domain->is_default
            ) ?? $accountDomainRows->first(
                fn ($domain) => (bool) $domain->is_active
            ) ?? $accountDomainRows->first(
                fn ($domain) => (bool) $domain->is_default
            ) ?? $accountDomainRows->first();

            $baseUrl = $this->normalizeCategoryBaseUrl(
                $siteDomain?->domain ?? $accountsById->get((int) $accountId)?->domain
            );

            if ($baseUrl !== null) {
                $resolved[(int) $accountId] = $baseUrl;
            }
        }

        return $resolved;
    }

    private function buildCategoryPublicUrl(Category $category, array $domainsByAccountId): string
    {
        $slug = trim((string) ($category->slug ?? ''));
        if ($slug === '') {
            return '';
        }

        $path = '/category/' . rawurlencode($slug);
        $baseUrl = $domainsByAccountId[(int) ($category->account_id ?? 0)] ?? null;

        return $baseUrl ? rtrim($baseUrl, '/') . $path : $path;
    }

    private function normalizeCategoryBaseUrl(?string $value): ?string
    {
        $domain = trim((string) $value);
        if ($domain === '') {
            return null;
        }

        if (!preg_match('/^https?:\/\//i', $domain)) {
            $domain = 'https://' . ltrim($domain, '/');
        }

        $parts = parse_url($domain);
        if (!$parts || empty($parts['host'])) {
            return null;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? 'https'));
        $host = strtolower((string) $parts['host']);
        $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
        $path = trim((string) ($parts['path'] ?? ''), '/');

        return $scheme . '://' . $host . $port . ($path !== '' ? '/' . $path : '');
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

    private function validateCategoryImportRows(array $rows, array $importOptions): array
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

        if (!isset($headerMap['code']) && !isset($headerMap['name']) && !isset($headerMap['id'])) {
            $errors[] = [
                'row' => 1,
                'column' => 'Ma danh muc',
                'message' => 'File import can co it nhat mot cot dinh danh (Ma danh muc hoac ID) hoac cot Ten danh muc.',
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
            'banner_path',
            'logo_path',
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
            $nameIsRequired = !$existingCategory
                || !$importOptions['is_selective_update']
                || !empty($importOptions['selected_fields']['name']);

            if ($nameIsRequired && $name === '') {
                $rowErrors[] = $this->importError($rowNumber, 'Ten danh muc', 'Ten danh muc khong duoc de trong.');
            }

            $resolvedCode = $normalizedCode
                ?? ($existingCategory ? $existingCategory->resolvedCode() : ($name !== '' ? Category::buildUniqueCode($name) : null));

            if ($resolvedCode !== null) {
                $duplicateCandidates[] = [
                    'row_number' => $rowNumber,
                    'code' => $resolvedCode,
                    'existing_id' => $existingCategory ? (int) $existingCategory->id : null,
                ];
            }

            if ($resolvedCode === null) {
                $rowErrors[] = $this->importError($rowNumber, 'Ma danh muc', 'Khong the xac dinh ma danh muc cho dong nay.');
            }

            [$sortOrder, $sortOrderError] = $this->parseImportedSortOrder(
                $this->importCellValue($row, $headerMap, 'tree_order')
            );
            if ($sortOrderError !== null) {
                $rowErrors[] = $this->importError($rowNumber, 'Thu tu trong cay', $sortOrderError);
            }

            $treeModeActive = !$existingCategory
                || !$importOptions['is_selective_update']
                || !empty($importOptions['selected_fields']['tree']);
            $descriptionClearWhenBlank = !$existingCategory || !$importOptions['is_selective_update'];
            $imageClearWhenBlank = !$existingCategory || !$importOptions['is_selective_update'];

            $parentPayload = isset($headerMap['parent'])
                ? $this->parseCategoryNullableImportCell(
                    $this->importCellValue($row, $headerMap, 'parent'),
                    $treeModeActive
                )
                : ['provided' => false, 'clear' => false, 'value' => null];
            $descriptionPayload = isset($headerMap['description'])
                ? $this->parseCategoryNullableImportCell(
                    $this->importCellValue($row, $headerMap, 'description'),
                    $descriptionClearWhenBlank
                )
                : ['provided' => false, 'clear' => false, 'value' => null];
            $bannerPayload = isset($headerMap['banner_url'])
                ? $this->parseCategoryNullableImportCell(
                    $this->importCellValue($row, $headerMap, 'banner_url'),
                    $imageClearWhenBlank
                )
                : ['provided' => false, 'clear' => false, 'value' => null];
            $logoPayload = isset($headerMap['logo_url'])
                ? $this->parseCategoryNullableImportCell(
                    $this->importCellValue($row, $headerMap, 'logo_url'),
                    $imageClearWhenBlank
                )
                : ['provided' => false, 'clear' => false, 'value' => null];

            if (!empty($bannerPayload['provided']) && empty($bannerPayload['clear']) && !$this->isValidImportedImageUrl((string) $bannerPayload['value'])) {
                $rowErrors[] = $this->importError($rowNumber, 'Link anh banner', 'Link anh banner phai la URL http/https hop le.');
            }

            if (!empty($logoPayload['provided']) && empty($logoPayload['clear']) && !$this->isValidImportedImageUrl((string) $logoPayload['value'])) {
                $rowErrors[] = $this->importError($rowNumber, 'Link anh nho', 'Link anh nho phai la URL http/https hop le.');
            }

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
                'parent_ref' => !empty($parentPayload['clear']) ? '' : trim((string) ($parentPayload['value'] ?? '')),
                'parent_payload' => $parentPayload,
                'order' => $sortOrder,
                'description_payload' => $descriptionPayload,
                'banner_payload' => $bannerPayload,
                'logo_payload' => $logoPayload,
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

    private function applyCategoryImport(array $records, array $importOptions): array
    {
        $persistedByKey = [];
        $created = 0;
        $updated = 0;
        $imagesImported = 0;

        foreach ($records as $record) {
            $category = $record['existing_id']
                ? Category::query()->findOrFail($record['existing_id'])
                : new Category();

            $isExisting = $category->exists;

            if (!$isExisting) {
                $category->code = Category::buildUniqueCode($record['code'] ?: $record['name']);
                $category->status = 1;
                $category->display_layout = 'layout_1';
                $category->filterable_attribute_ids = [];
                $category->parent_id = null;
                $category->order = 0;
            } elseif (!filled($category->code) && !empty($record['code'])) {
                $category->code = Category::buildUniqueCode($record['code'], (int) $category->id);
            }

            if ($this->shouldApplyCategoryImportField($importOptions, 'name', $isExisting)) {
                $category->name = $record['name'];
                $category->slug = Category::buildUniqueSlug($record['name'], $record['existing_id']);
            } elseif (!$isExisting) {
                $category->name = $record['name'];
                $category->slug = Category::buildUniqueSlug($record['name']);
            }

            if (!empty($record['description_payload']['provided']) && $this->shouldApplyCategoryImportField($importOptions, 'description', $isExisting)) {
                $category->description = !empty($record['description_payload']['clear'])
                    ? null
                    : trim((string) ($record['description_payload']['value'] ?? ''));
            }

            if (!empty($record['banner_payload']['provided']) && $this->shouldApplyCategoryImportField($importOptions, 'banner', $isExisting)) {
                if (!empty($record['banner_payload']['clear'])) {
                    if ($category->banner_media_asset_id) {
                        $this->mediaService->deleteAsset($category->banner_media_asset_id);
                    }
                    $category->banner_path = null;
                    $category->banner_media_asset_id = null;
                } else {
                    $previousAssetId = $category->banner_media_asset_id;
                    $bannerAsset = $this->mediaService->importFromReference((string) $record['banner_payload']['value'], [
                        'collection' => 'category-banners',
                        'source' => 'category-import',
                    ]);

                    if ($bannerAsset) {
                        $category->banner_media_asset_id = $bannerAsset->id;
                        $category->banner_path = $this->mediaService->buildAssetUrl($bannerAsset, 'large');
                        $imagesImported++;

                        if ($previousAssetId && $previousAssetId !== $bannerAsset->id) {
                            $this->mediaService->deleteAsset($previousAssetId);
                        }
                    }
                }
            }

            if (!empty($record['logo_payload']['provided']) && $this->shouldApplyCategoryImportField($importOptions, 'logo', $isExisting)) {
                if (!empty($record['logo_payload']['clear'])) {
                    if ($category->logo_media_asset_id) {
                        $this->mediaService->deleteAsset($category->logo_media_asset_id);
                    }
                    $category->logo_path = null;
                    $category->logo_media_asset_id = null;
                } else {
                    $previousAssetId = $category->logo_media_asset_id;
                    $logoAsset = $this->mediaService->importFromReference((string) $record['logo_payload']['value'], [
                        'collection' => 'category-logos',
                        'source' => 'category-import',
                    ]);

                    if ($logoAsset) {
                        $category->logo_media_asset_id = $logoAsset->id;
                        $category->logo_path = $this->mediaService->buildAssetUrl($logoAsset, 'large');
                        $imagesImported++;

                        if ($previousAssetId && $previousAssetId !== $logoAsset->id) {
                            $this->mediaService->deleteAsset($previousAssetId);
                        }
                    }
                }
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
            $shouldApplyTree = $this->shouldApplyCategoryImportField($importOptions, 'tree', $record['existing_id'] !== null);

            if (!$shouldApplyTree) {
                continue;
            }

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
            'images_imported' => $imagesImported,
        ];
    }

    private function resolveCategoryImportHeaderMap(array $headers): array
    {
        $aliases = [
            'code' => ['ma_danh_muc', 'ma', 'code', 'category_code'],
            'id' => ['id', 'category_id'],
            'name' => ['ten_danh_muc', 'name', 'category_name'],
            'parent' => ['danh_muc_cha', 'parent', 'parent_ref', 'parent_category'],
            'tree_order' => ['thu_tu_trong_cay', 'thu_tu_hien_thi', 'tree_order', 'sort_order', 'order'],
            'description' => ['mo_ta', 'description', 'ghi_chu', 'note'],
            'banner_url' => ['link_anh_banner', 'anh_banner', 'banner', 'banner_url', 'banner_link'],
            'logo_url' => ['link_anh_nho', 'anh_nho', 'logo', 'logo_url', 'logo_link', 'small_image'],
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
            return ['layout_1', null];
        }

        $normalized = $this->normalizeLookupValue($value);

        return match ($normalized) {
            'layout_1', 'layout1', '1', 'giao_dien_1', 'giao_dien_mot',
            'layout_2', 'layout2', '2', 'giao_dien_2', 'giao_dien_hai' => ['layout_1', null],
            default => [null, 'Giao dien chi hop le voi layout_1.'],
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

    private function replaceCategoryMediaAsset(Category $category, string $type, UploadedFile $file): void
    {
        $collection = $type === 'logo' ? 'category-logos' : 'category-banners';
        $foreignKey = $type === 'logo' ? 'logo_media_asset_id' : 'banner_media_asset_id';
        $urlField = $type === 'logo' ? 'logo_path' : 'banner_path';
        $previousAssetId = (int) ($category->{$foreignKey} ?? 0);

        $asset = $this->mediaService->uploadImage($file, [
            'collection' => $collection,
            'source' => 'category-form-upload',
        ]);

        $category->{$foreignKey} = $asset->id;
        $category->{$urlField} = $this->mediaService->buildAssetUrl($asset, 'large');

        if ($previousAssetId > 0 && $previousAssetId !== $asset->id) {
            $this->mediaService->deleteAsset($previousAssetId);
        }
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

    private function normalizeParentIdInput($value): ?int
    {
        if ($value === null || $value === '' || $value === 0 || $value === '0') {
            return null;
        }

        if (!is_numeric($value) || (int) $value <= 0) {
            throw ValidationException::withMessages([
                'parent_id' => ['Danh muc cha khong hop le.'],
            ]);
        }

        return (int) $value;
    }

    private function resolveValidatedParentId($value, ?int $categoryId = null): ?int
    {
        $parentId = $this->normalizeParentIdInput($value);

        if ($parentId === null) {
            return null;
        }

        if (!Category::query()->whereKey($parentId)->exists()) {
            throw ValidationException::withMessages([
                'parent_id' => ['Danh muc cha khong ton tai.'],
            ]);
        }

        if ($categoryId !== null) {
            $parentMap = $this->buildCategoryParentMap();
            $parentMap[$categoryId] = $parentId;
            $this->assertCategoryParentMapHasNoCycles($parentMap, 'parent_id');
        }

        return $parentId;
    }

    private function validateReorderPayload(Collection $items): void
    {
        $requestedIds = $items->pluck('id')->map(fn ($id) => (int) $id)->values();

        if ($requestedIds->duplicates()->isNotEmpty()) {
            throw ValidationException::withMessages([
                'items' => ['Danh sach danh muc sap xep dang bi trung ID.'],
            ]);
        }

        $parentMap = $this->buildCategoryParentMap();

        foreach ($requestedIds as $categoryId) {
            if (!array_key_exists($categoryId, $parentMap)) {
                throw ValidationException::withMessages([
                    'items' => ['Co danh muc khong ton tai trong yeu cau sap xep.'],
                ]);
            }
        }

        foreach ($items as $item) {
            $parentId = $item['parent_id'];

            if ($parentId !== null && !array_key_exists($parentId, $parentMap)) {
                throw ValidationException::withMessages([
                    'items' => ['Danh muc cha khong ton tai trong pham vi hien tai.'],
                ]);
            }

            $parentMap[$item['id']] = $parentId;
        }

        $this->assertCategoryParentMapHasNoCycles($parentMap, 'items');
    }

    private function buildCategoryParentMap(): array
    {
        return Category::query()
            ->get(['id', 'parent_id'])
            ->mapWithKeys(fn ($category) => [
                (int) $category->id => $category->parent_id ? (int) $category->parent_id : null,
            ])
            ->all();
    }

    private function assertCategoryParentMapHasNoCycles(array $parentMap, string $attribute): void
    {
        foreach ($parentMap as $categoryId => $parentId) {
            $visited = [(int) $categoryId => true];
            $cursor = $parentId === null ? null : (int) $parentId;

            while ($cursor !== null) {
                if (isset($visited[$cursor])) {
                    throw ValidationException::withMessages([
                        $attribute => ['Khong the tao vong lap danh muc cha.'],
                    ]);
                }

                if (!array_key_exists($cursor, $parentMap)) {
                    break;
                }

                $visited[$cursor] = true;
                $nextParentId = $parentMap[$cursor];
                $cursor = $nextParentId === null ? null : (int) $nextParentId;
            }
        }
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
