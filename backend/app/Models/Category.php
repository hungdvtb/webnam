<?php

namespace App\Models;

use App\Services\CategoryDemoLogoService;
use App\Services\MediaService;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class Category extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'name',
        'code',
        'slug',
        'parent_id',
        'description',
        'banner_path',
        'banner_media_asset_id',
        'logo_path',
        'logo_media_asset_id',
        'status',
        'order',
        'account_id',
        'display_layout',
        'filterable_attribute_ids',
    ];

    protected $casts = [
        'banner_media_asset_id' => 'integer',
        'logo_media_asset_id' => 'integer',
        'filterable_attribute_ids' => 'array',
        'status' => 'integer',
        'order' => 'integer'
    ];

    protected $appends = [
        'banner_image',
        'logo_image',
    ];

    protected static function booted(): void
    {
        static::deleted(function (Category $category): void {
            $mediaService = app(MediaService::class);

            if ($category->banner_media_asset_id) {
                $mediaService->deleteAsset($category->banner_media_asset_id);
            }

            if ($category->logo_media_asset_id) {
                $mediaService->deleteAsset($category->logo_media_asset_id);
            }
        });
    }
    
    public function parent()
    {
        return $this->belongsTo(Category::class, 'parent_id');
    }

    public function children()
    {
        return $this->hasMany(Category::class, 'parent_id')
            ->orderBy('order')
            ->orderBy('id');
    }

    public function products()
    {
        return $this->belongsToMany(Product::class)
            ->wherePivot('item_type', 'product')
            ->withPivot(['sort_order', 'item_type', 'bundle_option_key'])
            ->withTimestamps()
            ->orderBy('category_product.sort_order')
            ->orderBy('category_product.id');
    }

    public function bannerMediaAsset()
    {
        return $this->belongsTo(MediaAsset::class, 'banner_media_asset_id');
    }

    public function logoMediaAsset()
    {
        return $this->belongsTo(MediaAsset::class, 'logo_media_asset_id');
    }

    public function getBannerPathAttribute($value): ?string
    {
        if ($this->relationLoaded('bannerMediaAsset') && $this->bannerMediaAsset) {
            return app(MediaService::class)->buildAssetUrl($this->bannerMediaAsset, 'large');
        }

        return app(MediaService::class)->normalizeLegacyUrl($value);
    }

    public function getLogoPathAttribute($value): ?string
    {
        if ($this->relationLoaded('logoMediaAsset') && $this->logoMediaAsset) {
            return app(MediaService::class)->buildAssetUrl($this->logoMediaAsset, 'large');
        }

        $resolvedLogoUrl = app(MediaService::class)->normalizeLegacyUrl($value);

        if ($resolvedLogoUrl !== '') {
            return $resolvedLogoUrl;
        }

        return app(MediaService::class)->normalizeLegacyUrl(
            app(CategoryDemoLogoService::class)->demoLogoPathFor($this)
        );
    }

    public function getBannerImageAttribute(): ?array
    {
        return app(MediaService::class)->buildAssetPayload($this->bannerMediaAsset, $this->getRawOriginal('banner_path'));
    }

    public function getLogoImageAttribute(): ?array
    {
        $legacyLogoPath = $this->getRawOriginal('logo_path');

        if (!filled($legacyLogoPath)) {
            $legacyLogoPath = app(CategoryDemoLogoService::class)->demoLogoPathFor($this);
        }

        return app(MediaService::class)->buildAssetPayload($this->logoMediaAsset, $legacyLogoPath);
    }

    public static function normalizeCode(?string $value): ?string
    {
        $normalized = Str::slug((string) $value);

        return $normalized !== '' ? $normalized : null;
    }

    public static function buildUniqueCode(string $source, ?int $exceptId = null): string
    {
        $baseCode = static::normalizeCode($source) ?? 'danh-muc';
        $code = $baseCode;
        $suffix = 2;

        while (static::codeExists($code, $exceptId)) {
            $code = $baseCode . '-' . $suffix;
            $suffix++;
        }

        return $code;
    }

    public static function buildUniqueSlug(string $source, ?int $exceptId = null): string
    {
        $baseSlug = Str::slug($source) ?: 'danh-muc';
        $slug = $baseSlug;
        $suffix = 2;

        while (static::withoutGlobalScopes()->where('slug', $slug)->when($exceptId, fn ($query) => $query->where('id', '!=', $exceptId))->exists()) {
            $slug = $baseSlug . '-' . $suffix;
            $suffix++;
        }

        return $slug;
    }

    public function resolvedCode(): string
    {
        return static::normalizeCode($this->code)
            ?? static::normalizeCode($this->slug)
            ?? ('category-' . $this->id);
    }

    public static function buildProductSyncPayload(Product $product, array $categoryIds): array
    {
        $normalizedCategoryIds = collect($categoryIds)
            ->map(fn ($categoryId) => is_numeric($categoryId) ? (int) $categoryId : null)
            ->filter()
            ->unique()
            ->values();

        if ($normalizedCategoryIds->isEmpty()) {
            return [];
        }

        $currentSortOrders = DB::table('category_product')
            ->where('product_id', $product->id)
            ->where('item_type', 'product')
            ->whereIn('category_id', $normalizedCategoryIds)
            ->pluck('sort_order', 'category_id')
            ->mapWithKeys(fn ($sortOrder, $categoryId) => [(int) $categoryId => $sortOrder === null ? null : (int) $sortOrder]);

        $nextSortOrders = DB::table('category_product')
            ->selectRaw('category_id, MAX(sort_order) as max_sort_order')
            ->whereIn('category_id', $normalizedCategoryIds)
            ->groupBy('category_id')
            ->get()
            ->mapWithKeys(fn ($row) => [(int) $row->category_id => $row->max_sort_order === null ? -1 : (int) $row->max_sort_order]);

        $payload = [];

        foreach ($normalizedCategoryIds as $categoryId) {
            $existingSortOrder = $currentSortOrders->get($categoryId);

            if ($existingSortOrder !== null) {
                $sortOrder = $existingSortOrder;
            } else {
                $sortOrder = ((int) ($nextSortOrders->get($categoryId) ?? -1)) + 1;
                $nextSortOrders->put($categoryId, $sortOrder);
            }

            $payload[$categoryId] = [
                'sort_order' => $sortOrder,
                'item_type' => 'product',
                'bundle_option_key' => '',
                'bundle_option_post_id' => null,
                'bundle_option_title' => null,
            ];
        }

        return $payload;
    }

    public static function ensureProductAssignments(int $categoryId): void
    {
        $rows = DB::table('category_product')
            ->where('category_id', $categoryId)
            ->orderByRaw('CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'sort_order']);

        $nextSortOrder = 0;

        foreach ($rows as $row) {
            if ((int) ($row->sort_order ?? -1) !== $nextSortOrder) {
                DB::table('category_product')
                    ->where('id', $row->id)
                    ->update([
                        'sort_order' => $nextSortOrder,
                        'updated_at' => now(),
                    ]);
            }

            $nextSortOrder++;
        }

        $missingProductIds = Product::query()
            ->select('products.id')
            ->leftJoin('category_product', function ($join) use ($categoryId) {
                $join->on('products.id', '=', 'category_product.product_id')
                    ->where('category_product.category_id', '=', $categoryId)
                    ->where('category_product.item_type', '=', 'product');
            })
            ->where('products.category_id', $categoryId)
            ->whereNull('category_product.id')
            ->orderBy('products.created_at')
            ->orderBy('products.id')
            ->pluck('products.id');

        if ($missingProductIds->isEmpty()) {
            return;
        }

        $timestamp = now();
        $insertRows = [];

        foreach ($missingProductIds as $productId) {
            $insertRows[] = [
                'product_id' => (int) $productId,
                'category_id' => $categoryId,
                'item_type' => 'product',
                'bundle_option_key' => '',
                'bundle_option_post_id' => null,
                'bundle_option_title' => null,
                'sort_order' => $nextSortOrder++,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ];
        }

        DB::table('category_product')->insert($insertRows);
    }

    private static function codeExists(string $code, ?int $exceptId = null): bool
    {
        return static::query()
            ->where('code', $code)
            ->when($exceptId, fn ($query) => $query->where('id', '!=', $exceptId))
            ->exists();
    }
}
