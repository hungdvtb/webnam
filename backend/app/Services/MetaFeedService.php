<?php

namespace App\Services;

use App\Models\Account;
use App\Models\Product;
use App\Models\ProductImage;
use App\Models\SiteDomain;
use Illuminate\Database\Eloquent\Builder;
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
    ];

    private const BRAND = 'Gốm Đại Thành';
    private const DEFAULT_WEBSITE_URL = 'https://gomdaithanh.com';

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
        echo '    <title>' . $this->xml(self::BRAND . ' Meta Feed') . "</title>\n";
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
            ])
            ->where('status', true)
            ->whereDoesntHave('parentConfigurable')
            ->with([
                'images' => fn ($imageQuery) => $imageQuery
                    ->select(['id', 'product_id', 'media_asset_id', 'image_url', 'is_primary', 'sort_order'])
                    ->orderByDesc('is_primary')
                    ->orderBy('sort_order')
                    ->orderBy('id'),
                'images.mediaAsset',
                'category:id,name',
                'categories:id,name',
            ])
            ->orderBy('sort_order')
            ->orderByDesc('id');

        $this->scopeToWebsiteDomain($query);

        foreach ($query->lazy(200) as $product) {
            yield $this->entryForProduct($product);
        }
    }

    private function entryForProduct(Product $product): array
    {
        $title = $this->cleanText((string) $product->name, 150);
        $description = $this->descriptionForProduct($product);
        $categoryName = $this->categoryNameForProduct($product);

        return [
            'id' => $this->feedId($product),
            'title' => $title,
            'description' => $description !== '' ? $description : $title,
            'availability' => ((float) ($product->stock_quantity ?? 0)) > 0 ? 'in stock' : 'out of stock',
            'condition' => 'new',
            'price' => $this->formatPrice((float) ($product->current_price ?: $product->price ?: 0)),
            'link' => $this->productUrl($product),
            'image_link' => $this->imageUrl($this->primaryImage($product)),
            'brand' => self::BRAND,
            'product_type' => $categoryName,
            'custom_label_0' => $categoryName,
        ];
    }

    private function categoryNameForProduct(Product $product): string
    {
        $category = $product->relationLoaded('category') ? $product->category : $product->category()->first();
        $categoryName = $this->cleanText((string) ($category?->name ?? ''), 750);

        if ($categoryName !== '') {
            return $categoryName;
        }

        $categories = $product->relationLoaded('categories') ? $product->categories : $product->categories()->get();

        return $this->cleanText((string) ($categories->first()?->name ?? ''), 750);
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

    private function primaryImage(Product $product): ?ProductImage
    {
        $images = $product->relationLoaded('images') ? $product->images : $product->images()->get();

        return $images->firstWhere('is_primary', true)
            ?: $images->sortBy('sort_order')->first();
    }

    private function imageUrl(?ProductImage $image): string
    {
        $url = trim((string) ($image?->large_url ?: $image?->image_url ?: ''));

        return $url !== '' ? $this->normalizeUrl($this->mediaBaseUrl(), $url) : '';
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
