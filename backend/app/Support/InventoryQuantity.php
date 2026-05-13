<?php

namespace App\Support;

final class InventoryQuantity
{
    public const SCALE = 3;

    private function __construct()
    {
    }

    public static function normalize(mixed $value, float $fallback = 0.0): float
    {
        if (is_string($value)) {
            $value = str_replace(',', '.', trim($value));
        }

        if (!is_numeric($value)) {
            return round($fallback, self::SCALE);
        }

        return round((float) $value, self::SCALE);
    }

    public static function positive(mixed $value): bool
    {
        return self::normalize($value) > 0;
    }

    public static function zero(float $value): bool
    {
        return abs($value) < 0.0005;
    }
}
