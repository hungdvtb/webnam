<?php

namespace App\Support;

use App\Models\Product;
use Illuminate\Support\Str;

class OrderProductSnapshot
{
    public static function isPlaceholderName(mixed $value, int $productId = 0): bool
    {
        $normalized = trim((string) $value);

        if ($normalized === '') {
            return true;
        }

        $compact = preg_replace('/[^a-z0-9]+/', '', Str::lower(Str::ascii($normalized))) ?: '';
        $normalizedProductId = max(0, $productId);

        return in_array($compact, ['sanpham', 'sanphambundle'], true)
            || ($normalizedProductId > 0 && $compact === 'sanpham' . $normalizedProductId);
    }

    public static function submittedNameOrCatalog(mixed $submittedName, Product $product): string
    {
        $name = trim((string) $submittedName);

        return !self::isPlaceholderName($name, (int) $product->id)
            ? $name
            : (string) $product->name;
    }

    public static function submittedSkuOrCatalog(mixed $submittedSku, Product $product): ?string
    {
        $sku = trim((string) $submittedSku);

        return $sku !== '' && Str::upper($sku) !== 'N/A'
            ? $sku
            : $product->sku;
    }
}
