<?php

namespace App\Support;

final class ImportCostRounding
{
    private const STEP = 1000;

    private function __construct()
    {
    }

    public static function roundUnitCost(mixed $value): float
    {
        $numericValue = (float) ($value ?? 0);

        return round($numericValue / self::STEP, 0, PHP_ROUND_HALF_UP) * self::STEP;
    }

    public static function lineTotal(mixed $unitCost, int|float $quantity): float
    {
        return round(self::roundUnitCost($unitCost) * (float) $quantity, 2);
    }
}
