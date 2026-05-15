<?php

namespace App\Services;

use App\Models\Account;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductImage;
use App\Models\SiteDomain;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Throwable;

class MetaFeedService
{
    public const COLUMNS = [
        'id',
        'title',
        'description',
        'availability',
        'condition',
        'price',
        'link',
        'image_link',
        'brand',
        'product_type',
        'custom_label_0',
        'custom_label_1',
        'custom_label_2',
        'custom_label_3',
        'custom_label_4',
    ];

    private const BRAND = 'Gốm Đại Thành';
    private const DEFAULT_WEBSITE_URL = 'https://gomdaithanh.com';

    private ?array $categoryMap = null;

    public function writeCsv($stream): void
    {
        fputcsv($stream, self::COLUMNS);

        foreach ($this->entries() as $entry) {
            fputcsv($stream, array_map(fn (string $column) => $entry[$column] ?? '', self::COLUMNS));
        }
    }

    public function writeXml(): void
    {
        echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
        echo '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">' . "\n";
        echo "  <channel>\n";
        echo '    <title>' . $this->xml($this->brand() . ' Meta Feed') . "</title>\n";
        echo '    <link>' . $this->xml($this->websiteBaseUrl()) . "</link>\n";
        echo '    <description>' . $this->xml('Product catalog feed for Meta') . "</description>\n";

        foreach ($this->entries() as $entry) {
            echo "    <item>\n";
            foreach (self::COLUMNS as $column) {
                echo '      <g:' . $column . '>' . $this->xml((string) ($entry[$column] ?? '')) . '</g:' . $column . ">\n";
            }
            echo "    </item>\n";
        }

        echo "  </channel>\n";
        echo "</rss>\n";
    }

    public function entries(): \Generator
    {
        foreach ($this->catalogSnapshot()['entries'] as $entry) {
            yield $entry;
        }
    }

    public function catalogSnapshot(): array
    {
        $entries = [];
        $skippedEntries = [];
        $totalCount = 0;

        foreach ($this->productQuery()->lazy(200) as $product) {
            $totalCount++;
            $entry = $this->entryForProduct($product);
            $skipReasons = $this->skipReasonsForProduct($product, $entry);

            if (!empty($skipReasons)) {
                $skippedEntries[] = $this->skippedEntryPayload($product, $entry, $skipReasons);
                continue;
            }

            $entries[] = $entry;
        }

        return [
            'total_count' => $totalCount,
            'entries' => $entries,
            'skipped_entries' => $skippedEntries,
        ];
    }

    private function productQuery(): Builder
    {
        $query = Product::withoutGlobalScope('account_id')
            ->select([
                'id',
                'account_id',
                'site_domain_id',
                'category_id',
                'sku',
                'name',
                'slug',
                'description',
                'meta_description',
                'additional_info',
                'specifications',
                'price',
                'special_price',
                'special_price_from',
                'special_price_to',
                'stock_quantity',
                'status',
                'sort_order',
            ])
            ->whereDoesntHave('parentConfigurable')
            ->with([
                'images' => fn ($imageQuery) => $imageQuery
                    ->select(['id', 'product_id', 'media_asset_id', 'image_url', 'is_primary', 'sort_order'])
                    ->orderByDesc('is_primary')
                    ->orderBy('sort_order')
                    ->orderBy('id'),
                'images.mediaAsset',
                'category:id,name,parent_id,order,status',
                'categories:id,name,parent_id,order,status',
            ])
            ->orderBy('sort_order')
            ->orderByDesc('id');

        $this->scopeToWebsiteDomain($query);

        return $query;
    }

    private function entryForProduct(Product $product): array
    {
        $title = $this->cleanText((string) $product->name, 150);
        $description = $this->descriptionForProduct($product);
        $categoryMeta = $this->categoryMetaForProduct($product);
        $categoryName = (string) ($categoryMeta['direct_name'] ?? '');
        $parentCategoryName = (string) ($categoryMeta['parent_name'] ?? '');
        $categoryPath = (string) ($categoryMeta['path'] ?? $categoryName);
        $sortOrder = (int) ($categoryMeta['sort_order'] ?? 0);
        $primaryImage = $this->primaryImage($product);
        $imageLink = $this->imageUrl($primaryImage);

        return [
            '_product_id' => (int) $product->id,
            '_admin_edit_url' => $this->adminProductUrl($product),
            '_status' => (bool) $product->status,
            'id' => $this->feedId($product),
            'title' => $title,
            'description' => $description !== '' ? $description : $title,
            'availability' => 'in stock',
            'condition' => 'new',
            'price' => $this->formatPrice((float) ($product->current_price ?: $product->price ?: 0)),
            'link' => $this->productUrl($product),
            'image_link' => $imageLink,
            'brand' => $this->brand(),
            'product_type' => $categoryPath,
            'custom_label_0' => $categoryName,
            'custom_label_1' => $parentCategoryName,
            'custom_label_2' => $categoryPath,
            'custom_label_3' => $sortOrder > 0 ? (string) $sortOrder : '',
            'custom_label_4' => $sortOrder > 0 ? 'meta_sort_order:' . $sortOrder : '',
            '_meta_sort_order' => $sortOrder,
            '_meta_category_id' => (int) ($categoryMeta['direct_id'] ?? 0),
            '_meta_parent_category_id' => (int) ($categoryMeta['parent_id'] ?? 0),
            '_meta_product_sets' => (array) ($categoryMeta['product_sets'] ?? []),
            '_used_fallback_image' => false,
        ];
    }

    private function skipReasonsForProduct(Product $product, array $entry): array
    {
        $reasons = [];

        if (!(bool) $product->status) {
            $reasons[] = 'trạng thái kinh doanh OFF';
        }

        if (trim((string) ($entry['id'] ?? '')) === '') {
            $reasons[] = 'thiếu SKU/id';
        }

        if (trim((string) ($entry['title'] ?? '')) === '') {
            $reasons[] = 'thiếu tên sản phẩm';
        }

        if ((float) ($product->current_price ?: $product->price ?: 0) <= 0) {
            $reasons[] = 'thiếu giá bán hợp lệ > 0';
        }

        $link = trim((string) ($entry['link'] ?? ''));
        if ($link === '') {
            $reasons[] = 'thiếu link sản phẩm';
        } elseif (!filter_var($link, FILTER_VALIDATE_URL)) {
            $reasons[] = 'link sản phẩm không hợp lệ';
        }

        $imageLink = trim((string) ($entry['image_link'] ?? ''));
        if ($imageLink === '') {
            $reasons[] = 'thiếu ảnh';
        } elseif (!filter_var($imageLink, FILTER_VALIDATE_URL)) {
            $reasons[] = 'ảnh không hợp lệ';
        }

        $productType = trim((string) ($entry['product_type'] ?? ''));
        $customLabel = trim((string) ($entry['custom_label_0'] ?? ''));
        if ($productType === '' || $customLabel === '') {
            $reasons[] = 'thiếu danh mục product_type/custom_label_0';
        }

        return array_values(array_unique($reasons));
    }

    private function skippedEntryPayload(Product $product, array $entry, array $reasons): array
    {
        return [
            'id' => (string) ($entry['id'] ?? ''),
            'product_id' => (int) $product->id,
            'title' => (string) ($entry['title'] ?? $product->name ?? ''),
            'product_type' => (string) ($entry['product_type'] ?? ''),
            'admin_edit_url' => (string) ($entry['_admin_edit_url'] ?? $this->adminProductUrl($product)),
            'errors' => array_values($reasons),
        ];
    }

    private function brand(): string
    {
        return trim((string) config('meta_catalog.brand')) ?: self::BRAND;
    }

    private function categoryMetaForProduct(Product $product): array
    {
        $category = $this->primaryCategoryForProduct($product);

        if (!$category instanceof Category) {
            return [
                'direct_id' => 0,
                'direct_name' => '',
                'parent_id' => 0,
                'parent_name' => '',
                'path' => '',
                'sort_order' => 0,
                'product_sets' => [],
            ];
        }

        $pathCategories = $this->categoryPath($category);
        $directName = $this->cleanText((string) $category->name, 750);
        $rootCategory = $pathCategories[0] ?? $category;
        $parentName = $this->cleanText((string) ($rootCategory->name ?? $category->name), 750);
        $path = collect($pathCategories)
            ->map(fn (Category $pathCategory) => $this->cleanText((string) $pathCategory->name, 250))
            ->filter()
            ->implode(' > ');
        $sortOrder = $this->categorySortOrderForProduct($product, (int) $category->id);
        $hasParent = (int) ($category->parent_id ?? 0) > 0;
        $productSets = [];

        foreach ($pathCategories as $index => $pathCategory) {
            $name = $this->cleanText((string) $pathCategory->name, 250);
            if ($name === '') {
                continue;
            }

            $isDirect = (int) $pathCategory->id === (int) $category->id;
            $productSets[] = [
                'id' => (int) $pathCategory->id,
                'name' => $name,
                'type' => $isDirect && $hasParent ? 'child' : 'parent',
                'path' => collect(array_slice($pathCategories, 0, $index + 1))
                    ->map(fn (Category $pathCategory) => $this->cleanText((string) $pathCategory->name, 250))
                    ->filter()
                    ->implode(' > '),
                'filter_field' => $isDirect && $hasParent ? 'custom_label_0' : 'custom_label_1',
                'filter_value' => $name,
                'sort_order' => $sortOrder,
            ];
        }

        return [
            'direct_id' => (int) $category->id,
            'direct_name' => $directName,
            'parent_id' => (int) ($rootCategory->id ?? $category->id),
            'parent_name' => $parentName,
            'path' => $path !== '' ? $path : $directName,
            'sort_order' => $sortOrder,
            'product_sets' => $productSets,
        ];
    }

    private function primaryCategoryForProduct(Product $product): ?Category
    {
        $categories = $product->relationLoaded('categories') ? $product->categories : $product->categories()->get();
        $category = $categories->first();

        if ($category instanceof Category) {
            return $category;
        }

        $category = $product->relationLoaded('category') ? $product->category : $product->category()->first();

        return $category instanceof Category ? $category : null;
    }

    /**
     * @return array<int, Category>
     */
    private function categoryPath(Category $category): array
    {
        $map = $this->categoryMap();
        $path = [];
        $current = $category;
        $guard = 0;

        while ($current instanceof Category && $guard < 20) {
            array_unshift($path, $current);
            $parentId = (int) ($current->parent_id ?? 0);
            if ($parentId <= 0 || !isset($map[$parentId])) {
                break;
            }

            $current = $map[$parentId];
            $guard++;
        }

        return $path;
    }

    private function categorySortOrderForProduct(Product $product, int $categoryId): int
    {
        $categories = $product->relationLoaded('categories') ? $product->categories : $product->categories()->get();
        $category = $categories->firstWhere('id', $categoryId);
        $pivotSortOrder = $category?->pivot?->sort_order;

        if ($pivotSortOrder !== null && is_numeric($pivotSortOrder)) {
            return max(1, (int) $pivotSortOrder + 1);
        }

        $productSortOrder = $product->sort_order;
        if ($productSortOrder !== null && is_numeric($productSortOrder)) {
            return max(1, (int) $productSortOrder + 1);
        }

        return 0;
    }

    /**
     * @return array<int, Category>
     */
    private function categoryMap(): array
    {
        if ($this->categoryMap !== null) {
            return $this->categoryMap;
        }

        $columns = ['id', 'account_id', 'name', 'parent_id', 'order', 'status'];
        if (Schema::hasColumn('categories', 'site_domain_id')) {
            $columns[] = 'site_domain_id';
        }

        $query = Category::withoutGlobalScope('account_id')
            ->select($columns);

        $this->scopeCategoriesToWebsiteDomain($query);

        return $this->categoryMap = $query
            ->get()
            ->keyBy(fn (Category $category) => (int) $category->id)
            ->all();
    }

    private function scopeToWebsiteDomain(Builder $query): void
    {
        $domain = $this->websiteDomain();
        if ($domain === '') {
            return;
        }

        $siteDomain = SiteDomain::query()
            ->where('domain', $domain)
            ->where('is_active', true)
            ->first();

        if ($siteDomain) {
            $query
                ->where('products.account_id', (int) $siteDomain->account_id)
                ->where(function (Builder $domainQuery) use ($siteDomain) {
                    $domainQuery
                        ->whereNull('products.site_domain_id')
                        ->orWhere('products.site_domain_id', (int) $siteDomain->id);
                });

            return;
        }

        $account = Account::query()
            ->where('domain', $domain)
            ->orWhere('subdomain', $domain)
            ->first();

        if ($account) {
            $query->where('products.account_id', (int) $account->id);
        }
    }

    private function scopeCategoriesToWebsiteDomain(Builder $query): void
    {
        $domain = $this->websiteDomain();
        if ($domain === '') {
            return;
        }

        $siteDomain = SiteDomain::query()
            ->where('domain', $domain)
            ->where('is_active', true)
            ->first();

        if ($siteDomain) {
            $query->where('categories.account_id', (int) $siteDomain->account_id);

            if (Schema::hasColumn('categories', 'site_domain_id')) {
                $query->where(function (Builder $domainQuery) use ($siteDomain) {
                    $domainQuery
                        ->whereNull('categories.site_domain_id')
                        ->orWhere('categories.site_domain_id', (int) $siteDomain->id);
                });
            }

            return;
        }

        $account = Account::query()
            ->where('domain', $domain)
            ->orWhere('subdomain', $domain)
            ->first();

        if ($account) {
            $query->where('categories.account_id', (int) $account->id);
        }
    }

    private function feedId(Product $product): string
    {
        $sku = trim((string) $product->sku);

        return $sku !== '' ? $sku : 'product-' . (int) $product->id;
    }

    private function descriptionForProduct(Product $product): string
    {
        foreach ([$product->description, $product->meta_description, $product->additional_info, $product->specifications] as $value) {
            $text = $this->cleanText($this->decodeStructuredText($value), 5000);
            if ($text !== '') {
                return $text;
            }
        }

        return '';
    }

    private function decodeStructuredText(mixed $value): string
    {
        if ($value === null) {
            return '';
        }

        if (is_array($value)) {
            return collect($value)
                ->map(fn ($item) => $this->decodeStructuredText($item))
                ->filter()
                ->implode(' ');
        }

        $text = trim((string) $value);
        if ($text === '') {
            return '';
        }

        try {
            $decoded = json_decode($text, true, 512, JSON_THROW_ON_ERROR);
            if (is_array($decoded)) {
                return $this->decodeStructuredText($decoded);
            }
        } catch (Throwable) {
            // Plain text or HTML; keep processing below.
        }

        return $text;
    }

    private function cleanText(string $value, int $limit): string
    {
        $text = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = Str::squish($text);

        return Str::limit($text, $limit, '');
    }

    private function formatPrice(float $price): string
    {
        return number_format(max($price, 0), 0, '', '') . ' VND';
    }

    private function productUrl(Product $product): string
    {
        $identifier = trim((string) ($product->slug ?: $product->id));

        return $this->normalizeUrl($this->websiteBaseUrl(), '/product/' . rawurlencode($identifier));
    }

    private function adminProductUrl(Product $product): string
    {
        return '/admin/products/edit/' . (int) $product->id;
    }

    private function primaryImage(Product $product): ?ProductImage
    {
        $images = $product->relationLoaded('images') ? $product->images : $product->images()->get();

        $image = $images->firstWhere('is_primary', true)
            ?: $images->sortBy('sort_order')->first();

        return $image ?: $this->relatedProductImage($product);
    }

    private function relatedProductImage(Product $product): ?ProductImage
    {
        foreach (['variations', 'bundleItems', 'groupedItems'] as $relation) {
            $items = $product->relationLoaded($relation)
                ? $product->getRelation($relation)
                : $product->{$relation}()->with('images')->get();

            foreach ($items as $item) {
                $images = $item->relationLoaded('images') ? $item->images : $item->images()->get();
                $image = $images->firstWhere('is_primary', true)
                    ?: $images->sortBy('sort_order')->first();

                if ($image instanceof ProductImage) {
                    return $image;
                }
            }
        }

        return null;
    }

    private function imageUrl(?ProductImage $image): string
    {
        $url = trim((string) ($image?->large_url ?: $image?->image_url ?: ''));

        if ($url !== '') {
            return $this->normalizeUrl($this->mediaBaseUrl(), $url);
        }

        return '';
    }

    private function websiteBaseUrl(): string
    {
        $baseUrl = trim((string) config('app.frontend_url')) ?: self::DEFAULT_WEBSITE_URL;

        if (!Str::startsWith($baseUrl, ['http://', 'https://'])) {
            $baseUrl = 'https://' . $baseUrl;
        }

        return rtrim($baseUrl, '/');
    }

    private function websiteDomain(): string
    {
        return $this->normalizeDomain((string) parse_url($this->websiteBaseUrl(), PHP_URL_HOST));
    }

    private function mediaBaseUrl(): string
    {
        return trim((string) config('media.public_base_url'))
            ?: trim((string) config('app.url'))
            ?: $this->websiteBaseUrl();
    }

    private function normalizeUrl(string $baseUrl, string $pathOrUrl): string
    {
        $value = trim($pathOrUrl);
        if ($value === '') {
            return '';
        }

        if (Str::startsWith($value, ['http://', 'https://'])) {
            return $value;
        }

        if (Str::startsWith($value, '//')) {
            return 'https:' . $value;
        }

        return rtrim($baseUrl, '/') . '/' . ltrim($value, '/');
    }

    private function normalizeDomain(string $domain): string
    {
        $domain = trim(Str::lower($domain));
        $domain = preg_replace('#^https?://#', '', $domain) ?? $domain;

        return trim($domain, "/ \t\n\r\0\x0B");
    }

    private function xml(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_COMPAT, 'UTF-8');
    }
}
