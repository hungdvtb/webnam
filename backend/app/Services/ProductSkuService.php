<?php

namespace App\Services;

use App\Models\Product;
use App\Models\ProductAttributeValue;
use App\Models\ProductImage;
use App\Models\SupplierProductPrice;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ProductSkuService
{
    public function normalize(?string $sku): ?string
    {
        if ($sku === null) {
            return null;
        }

        $normalized = trim(preg_replace('/\s+/', '-', $sku) ?? '');

        return $normalized !== '' ? $normalized : null;
    }

    public function generateBaseSku(?string $seed, string $fallback = 'PRODUCT'): string
    {
        $normalized = Str::of((string) $seed)
            ->ascii()
            ->upper()
            ->replaceMatches('/[^A-Z0-9]+/', '-')
            ->trim('-')
            ->toString();

        if ($normalized === '') {
            $normalized = $fallback;
        }

        return $this->truncateSku($normalized);
    }

    public function ensureUniqueSku(?string $requestedSku, ?string $fallbackSeed = null, ?int $ignoreProductId = null, array $reserved = []): string
    {
        $base = $this->normalize($requestedSku) ?? $this->generateBaseSku($fallbackSeed);

        return $this->generateUniqueSku($base, $ignoreProductId, $reserved);
    }

    public function generateCopySku(?string $originalSku, ?string $fallbackSeed = null, ?int $ignoreProductId = null, array $reserved = []): string
    {
        $base = $this->generateBaseSku($originalSku ?: $fallbackSeed);

        return $this->generateUniqueSku($this->suffixSku($base, '-COPY'), $ignoreProductId, $reserved);
    }

    public function generateVariantSku(string $parentSku, ?int $ignoreProductId = null, array $reserved = []): string
    {
        $base = $this->generateBaseSku($parentSku, 'VARIANT');

        for ($index = 1; $index <= 9999; $index++) {
            $candidate = $this->suffixSku($base, '-V' . $index);

            if (!$this->isReservedOrTaken($candidate, $ignoreProductId, $reserved)) {
                return $candidate;
            }
        }

        return $this->generateUniqueSku($this->suffixSku($base, '-V'), $ignoreProductId, $reserved);
    }

    public function generateUniqueSku(string $baseSku, ?int $ignoreProductId = null, array $reserved = []): string
    {
        $baseSku = $this->truncateSku($this->normalize($baseSku) ?? $this->generateBaseSku($baseSku));

        if (!$this->isReservedOrTaken($baseSku, $ignoreProductId, $reserved)) {
            return $baseSku;
        }

        for ($suffix = 1; $suffix <= 9999; $suffix++) {
            $candidate = $this->suffixSku($baseSku, '-' . $suffix);

            if (!$this->isReservedOrTaken($candidate, $ignoreProductId, $reserved)) {
                return $candidate;
            }
        }

        return $this->suffixSku($baseSku, '-' . strtoupper(Str::random(6)));
    }

    public function skuExists(string $sku, ?int $ignoreProductId = null): bool
    {
        $query = DB::table('products')
            ->where('sku', $sku);

        if ($ignoreProductId !== null) {
            $query->where('id', '<>', $ignoreProductId);
        }

        return $query->exists();
    }

    public function generateUniqueSlug(?string $seed, ?int $ignoreProductId = null): string
    {
        $base = Str::slug((string) $seed);
        $base = $base !== '' ? $base : 'san-pham';
        $candidate = $base;
        $suffix = 1;

        while (DB::table('products')
            ->when($ignoreProductId !== null, fn ($query) => $query->where('id', '<>', $ignoreProductId))
            ->where('slug', $candidate)
            ->exists()) {
            $candidate = $base . '-' . $suffix++;
        }

        return $candidate;
    }

    public function cloneVariantForParent(Product $sourceVariant, Product $parent, array $linkData = [], bool $attachToParent = true): Product
    {
        $newVariant = $sourceVariant->replicate();
        $newVariant->sku = $this->generateVariantSku((string) $parent->sku);
        $newVariant->slug = $this->generateUniqueSlug($sourceVariant->slug ?: $sourceVariant->name ?: $newVariant->sku);
        $newVariant->deleted_at = null;
        $newVariant->save();

        $this->copyProductDecorators($sourceVariant, $newVariant);
        $this->copySuppliers($sourceVariant, $newVariant);
        $this->copySupplierPrices($sourceVariant, $newVariant);

        if ($attachToParent) {
            $parent->linkedProducts()->attach($newVariant->id, array_merge([
                'link_type' => 'super_link',
                'position' => $linkData['position'] ?? 0,
            ], $linkData));
        }

        return $newVariant;
    }

    public function copyProductDecorators(Product $source, Product $target): void
    {
        foreach ($source->images as $image) {
            ProductImage::create([
                'product_id' => $target->id,
                'image_url' => $image->image_url,
                'is_primary' => $image->is_primary,
                'sort_order' => $image->sort_order,
                'file_name' => $image->file_name,
                'file_size' => $image->file_size,
            ]);
        }

        foreach ($source->attributeValues as $attributeValue) {
            ProductAttributeValue::create([
                'product_id' => $target->id,
                'attribute_id' => $attributeValue->attribute_id,
                'value' => $attributeValue->value,
            ]);
        }
    }

    public function repairLegacyIntegrity(): array
    {
        return DB::transaction(function () {
            return [
                'shared_variants' => $this->repairSharedVariants(),
                'duplicate_skus' => $this->repairDuplicateSkus(),
                'blank_variant_skus' => $this->repairBlankVariantSkus(),
            ];
        });
    }

    public function repairSharedVariants(): array
    {
        $sharedVariantIds = DB::table('product_links')
            ->where('link_type', 'super_link')
            ->select('linked_product_id')
            ->groupBy('linked_product_id')
            ->havingRaw('COUNT(DISTINCT product_id) > 1')
            ->pluck('linked_product_id');

        if ($sharedVariantIds->isEmpty()) {
            return [];
        }

        $changes = [];

        foreach ($sharedVariantIds as $variantId) {
            $links = DB::table('product_links')
                ->where('link_type', 'super_link')
                ->where('linked_product_id', $variantId)
                ->orderBy('product_id')
                ->orderBy('id')
                ->get();

            if ($links->count() <= 1) {
                continue;
            }

            $sourceVariant = Product::withoutGlobalScopes()
                ->withTrashed()
                ->with(['images', 'attributeValues', 'suppliers:id', 'supplierPrices'])
                ->find($variantId);

            if (!$sourceVariant) {
                continue;
            }

            $ownerLink = $links->shift();

            foreach ($links as $link) {
                $parent = Product::withoutGlobalScopes()->withTrashed()->find($link->product_id);

                if (!$parent) {
                    continue;
                }

                $clonedVariant = $this->cloneVariantForParent($sourceVariant, $parent, [
                    'position' => $link->position ?? 0,
                ], false);

                DB::table('product_links')
                    ->where('id', $link->id)
                    ->update([
                        'linked_product_id' => $clonedVariant->id,
                        'updated_at' => now(),
                    ]);

                $changes[] = [
                    'original_variant_id' => (int) $variantId,
                    'parent_id' => (int) $parent->id,
                    'kept_parent_id' => (int) $ownerLink->product_id,
                    'new_variant_id' => (int) $clonedVariant->id,
                    'new_variant_sku' => $clonedVariant->sku,
                ];
            }
        }

        return $changes;
    }

    public function repairDuplicateSkus(): array
    {
        $duplicateSkuGroups = DB::table('products')
            ->select('sku', DB::raw('COUNT(*) as duplicate_count'))
            ->whereNotNull('sku')
            ->where('sku', '<>', '')
            ->groupBy('sku')
            ->havingRaw('COUNT(*) > 1')
            ->pluck('sku');

        if ($duplicateSkuGroups->isEmpty()) {
            return [];
        }

        $changes = [];

        foreach ($duplicateSkuGroups as $sku) {
            $products = Product::withoutGlobalScopes()
                ->withTrashed()
                ->where('sku', $sku)
                ->orderBy('id')
                ->get();

            $keeper = $products->shift();

            foreach ($products as $product) {
                $newSku = $this->generateReplacementSkuForProduct($product, $sku);
                $product->forceFill(['sku' => $newSku])->save();

                $changes[] = [
                    'product_id' => (int) $product->id,
                    'old_sku' => $sku,
                    'new_sku' => $newSku,
                    'kept_product_id' => (int) $keeper->id,
                ];
            }
        }

        return $changes;
    }

    public function repairBlankVariantSkus(): array
    {
        $variantRows = DB::table('product_links')
            ->join('products as variants', 'variants.id', '=', 'product_links.linked_product_id')
            ->join('products as parents', 'parents.id', '=', 'product_links.product_id')
            ->where('product_links.link_type', 'super_link')
            ->where(function ($query) {
                $query
                    ->whereNull('variants.sku')
                    ->orWhere('variants.sku', '');
            })
            ->select([
                'variants.id as variant_id',
                'parents.sku as parent_sku',
            ])
            ->get();

        $changes = [];

        foreach ($variantRows as $variantRow) {
            $variant = Product::withoutGlobalScopes()->withTrashed()->find($variantRow->variant_id);

            if (!$variant) {
                continue;
            }

            $newSku = $this->generateVariantSku((string) $variantRow->parent_sku, $variant->id);
            $variant->forceFill(['sku' => $newSku])->save();

            $changes[] = [
                'variant_id' => (int) $variant->id,
                'new_sku' => $newSku,
            ];
        }

        return $changes;
    }

    protected function copySuppliers(Product $source, Product $target): void
    {
        $supplierIds = $source->suppliers->pluck('id')->map(fn ($id) => (int) $id)->filter()->unique()->values();

        if ($supplierIds->isEmpty()) {
            return;
        }

        $syncData = [];

        foreach ($supplierIds as $supplierId) {
            $syncData[$supplierId] = ['account_id' => $target->account_id];
        }

        $target->suppliers()->sync($syncData);
        $target->forceFill([
            'supplier_id' => $supplierIds->first(),
        ])->save();
    }

    protected function copySupplierPrices(Product $source, Product $target): void
    {
        foreach ($source->supplierPrices as $supplierPrice) {
            SupplierProductPrice::create([
                'account_id' => $supplierPrice->account_id ?: $target->account_id,
                'supplier_id' => $supplierPrice->supplier_id,
                'product_id' => $target->id,
                'supplier_product_code' => $supplierPrice->supplier_product_code,
                'unit_cost' => $supplierPrice->unit_cost,
                'notes' => $supplierPrice->notes,
                'updated_by' => $supplierPrice->updated_by,
            ]);
        }
    }

    protected function generateReplacementSkuForProduct(Product $product, string $currentSku): string
    {
        $parentSku = DB::table('product_links')
            ->join('products', 'products.id', '=', 'product_links.product_id')
            ->where('product_links.link_type', 'super_link')
            ->where('product_links.linked_product_id', $product->id)
            ->value('products.sku');

        if ($parentSku) {
            return $this->generateVariantSku((string) $parentSku, $product->id);
        }

        return $this->generateUniqueSku($currentSku, $product->id);
    }

    protected function isReservedOrTaken(string $sku, ?int $ignoreProductId = null, array $reserved = []): bool
    {
        return in_array($sku, $reserved, true) || $this->skuExists($sku, $ignoreProductId);
    }

    protected function truncateSku(string $sku): string
    {
        return Str::limit($sku, 120, '');
    }

    protected function suffixSku(string $base, string $suffix): string
    {
        $maxBaseLength = max(1, 120 - strlen($suffix));
        $trimmedBase = Str::limit($base, $maxBaseLength, '');
        $trimmedBase = rtrim($trimmedBase, '-');

        return $trimmedBase . $suffix;
    }
}
