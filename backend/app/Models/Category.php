<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class Category extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = ['name', 'code', 'slug', 'parent_id', 'description', 'banner_path', 'status', 'order', 'account_id', 'display_layout', 'filterable_attribute_ids'];

    protected $casts = [
        'filterable_attribute_ids' => 'array',
        'status' => 'integer',
        'order' => 'integer'
    ];
    
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
            ->withPivot('sort_order')
            ->withTimestamps()
            ->orderBy('category_product.sort_order')
            ->orderBy('category_product.id');
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

            $payload[$categoryId] = ['sort_order' => $sortOrder];
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
                    ->where('category_product.category_id', '=', $categoryId);
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
