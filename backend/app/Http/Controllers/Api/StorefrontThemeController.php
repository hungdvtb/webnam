<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\StorefrontTheme;
use App\Services\AccountDataScopeService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class StorefrontThemeController extends Controller
{
    public function __construct(
        protected AccountDataScopeService $accountDataScopeService
    ) {
    }

    public function index(Request $request)
    {
        $accountId = $this->accountDataScopeService->catalogAccountIdForRequest($request);

        $themes = StorefrontTheme::query()
            ->with('clonedFrom:id,name,code')
            ->where(function ($query) use ($accountId) {
                $query->whereNull('account_id');

                if ($accountId) {
                    $query->orWhere('account_id', $accountId);
                }
            })
            ->when($request->filled('status'), function ($query) use ($request) {
                $query->where('status', filter_var($request->input('status'), FILTER_VALIDATE_BOOLEAN));
            })
            ->when($request->filled('product_type'), function ($query) use ($request) {
                $query->where('product_type', $this->normalizeProductType($request->input('product_type')));
            })
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        return response()->json($themes);
    }

    public function store(Request $request)
    {
        $accountId = $this->accountDataScopeService->catalogAccountIdForRequest($request);

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'code' => ['nullable', 'string', 'max:120', Rule::unique('storefront_themes', 'code')],
            'folder' => ['nullable', 'string', 'max:160'],
            'preview_image' => ['nullable', 'string', 'max:1000'],
            'description' => ['nullable', 'string', 'max:4000'],
            'product_type' => ['nullable', 'string', Rule::in(['simple', 'configurable', 'bundle'])],
            'status' => ['nullable', 'boolean'],
            'is_default' => ['nullable', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ]);

        $code = $this->normalizeUniqueCode($validated['code'] ?? $validated['name']);
        $theme = StorefrontTheme::create([
            'account_id' => $accountId,
            'name' => $validated['name'],
            'code' => $code,
            'folder' => $this->normalizeFolder($validated['folder'] ?? $code),
            'preview_image' => $validated['preview_image'] ?? null,
            'description' => $validated['description'] ?? null,
            'product_type' => $this->normalizeProductType($validated['product_type'] ?? null),
            'status' => $validated['status'] ?? true,
            'is_default' => $validated['is_default'] ?? false,
            'sort_order' => $validated['sort_order'] ?? $this->nextSortOrder($accountId),
        ]);

        if ($theme->is_default) {
            $this->clearOtherDefaults($theme);
        }

        return response()->json($theme->fresh('clonedFrom:id,name,code'), 201);
    }

    public function update(Request $request, int $id)
    {
        $theme = StorefrontTheme::query()->findOrFail($id);

        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'code' => ['sometimes', 'required', 'string', 'max:120', Rule::unique('storefront_themes', 'code')->ignore($theme->id)],
            'folder' => ['sometimes', 'required', 'string', 'max:160'],
            'preview_image' => ['nullable', 'string', 'max:1000'],
            'description' => ['nullable', 'string', 'max:4000'],
            'product_type' => ['nullable', 'string', Rule::in(['simple', 'configurable', 'bundle'])],
            'status' => ['nullable', 'boolean'],
            'is_default' => ['nullable', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ]);

        if (array_key_exists('code', $validated)) {
            $validated['code'] = $this->normalizeUniqueCode($validated['code'], $theme->id);
        }

        if (array_key_exists('folder', $validated)) {
            $validated['folder'] = $this->normalizeFolder($validated['folder']);
        }

        if (array_key_exists('product_type', $validated)) {
            $validated['product_type'] = $this->normalizeProductType($validated['product_type']);
        }

        $theme->update($validated);

        if ($theme->is_default) {
            $this->clearOtherDefaults($theme);
        }

        return response()->json($theme->fresh('clonedFrom:id,name,code'));
    }

    public function duplicate(Request $request, int $id)
    {
        $source = StorefrontTheme::query()->findOrFail($id);
        $accountId = $this->accountDataScopeService->catalogAccountIdForRequest($request);

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'code' => ['nullable', 'string', 'max:120', Rule::unique('storefront_themes', 'code')],
            'preview_image' => ['nullable', 'string', 'max:1000'],
            'description' => ['nullable', 'string', 'max:4000'],
            'product_type' => ['nullable', 'string', Rule::in(['simple', 'configurable', 'bundle'])],
            'copy_source_files' => ['nullable', 'boolean'],
        ]);

        $code = $this->normalizeUniqueCode($validated['code'] ?? $validated['name']);
        $theme = StorefrontTheme::create([
            'account_id' => $accountId,
            'name' => $validated['name'],
            'code' => $code,
            'folder' => $code,
            'preview_image' => $validated['preview_image'] ?? $source->preview_image,
            'description' => $validated['description'] ?? ('Nhân bản từ ' . $source->name),
            'product_type' => $this->normalizeProductType($validated['product_type'] ?? $source->product_type ?? null),
            'cloned_from_id' => $source->id,
            'status' => true,
            'is_default' => false,
            'sort_order' => $this->nextSortOrder($accountId),
        ]);

        $fileCopy = $this->copyThemeSourceFolder($source->folder ?: $source->code, $theme);

        return response()->json([
            'theme' => $theme->fresh('clonedFrom:id,name,code'),
            'source_copy' => $fileCopy,
        ], 201);
    }

    public function destroy(int $id)
    {
        $theme = StorefrontTheme::query()->findOrFail($id);

        if ($theme->is_default) {
            return response()->json(['message' => 'Khong the xoa giao dien mac dinh.'], 422);
        }

        $theme->delete();

        return response()->json(['message' => 'Theme deleted successfully']);
    }

    private function normalizeUniqueCode(string $value, ?int $exceptId = null): string
    {
        $baseCode = Str::slug($value) ?: 'storefront-theme';
        $code = $baseCode;
        $suffix = 2;

        while (
            StorefrontTheme::query()
                ->where('code', $code)
                ->when($exceptId, fn ($query) => $query->where('id', '!=', $exceptId))
                ->exists()
        ) {
            $code = $baseCode . '-' . $suffix;
            $suffix++;
        }

        return $code;
    }

    private function normalizeFolder(string $value): string
    {
        return Str::slug($value) ?: 'storefront-theme';
    }

    private function normalizeProductType(mixed $value): string
    {
        $type = Str::lower(Str::squish((string) $value));

        return in_array($type, ['simple', 'configurable', 'bundle'], true)
            ? $type
            : 'simple';
    }

    private function nextSortOrder(?int $accountId): int
    {
        return (int) StorefrontTheme::query()
            ->where(function ($query) use ($accountId) {
                $query->whereNull('account_id');

                if ($accountId) {
                    $query->orWhere('account_id', $accountId);
                }
            })
            ->max('sort_order') + 1;
    }

    private function clearOtherDefaults(StorefrontTheme $theme): void
    {
        StorefrontTheme::query()
            ->whereKeyNot($theme->id)
            ->where('is_default', true)
            ->update(['is_default' => false]);
    }

    private function copyThemeSourceFolder(string $sourceFolder, StorefrontTheme $targetTheme): array
    {
        $sourcePath = base_path('../webgom/src/themes/storefront/' . $this->normalizeFolder($sourceFolder));
        $targetPath = base_path('../webgom/src/themes/storefront/' . $this->normalizeFolder($targetTheme->folder));

        if (!File::isDirectory($sourcePath)) {
            return [
                'copied' => false,
                'reason' => 'source_missing',
                'source_path' => $sourcePath,
                'target_path' => $targetPath,
            ];
        }

        if (File::exists($targetPath)) {
            return [
                'copied' => false,
                'reason' => 'target_exists',
                'source_path' => $sourcePath,
                'target_path' => $targetPath,
            ];
        }

        if (!Schema::hasTable('storefront_themes')) {
            return [
                'copied' => false,
                'reason' => 'themes_table_missing',
                'source_path' => $sourcePath,
                'target_path' => $targetPath,
            ];
        }

        try {
            File::copyDirectory($sourcePath, $targetPath);
            File::put(
                $targetPath . DIRECTORY_SEPARATOR . 'theme.json',
                json_encode([
                    'name' => $targetTheme->name,
                    'code' => $targetTheme->code,
                    'folder' => $targetTheme->folder,
                    'cloned_from' => $targetTheme->clonedFrom?->code,
                    'purpose' => $targetTheme->description,
                    'product_type' => $targetTheme->product_type ?: 'simple',
                    'entry' => 'ProductDetailPageTheme.js',
                    'product_detail_entries' => [
                        'simple' => 'SimpleProductDetailPageTheme.js',
                        'configurable' => 'ConfigurableProductDetailPageTheme.js',
                        'bundle' => 'BundleProductDetailPageTheme.js',
                    ],
                ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL
            );
        } catch (\Throwable $exception) {
            return [
                'copied' => false,
                'reason' => 'copy_failed',
                'message' => $exception->getMessage(),
                'source_path' => $sourcePath,
                'target_path' => $targetPath,
            ];
        }

        return [
            'copied' => true,
            'source_path' => $sourcePath,
            'target_path' => $targetPath,
        ];
    }
}
