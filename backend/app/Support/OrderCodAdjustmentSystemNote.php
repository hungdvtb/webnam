<?php

namespace App\Support;

class OrderCodAdjustmentSystemNote
{
    private const LEGACY_NOTE_PATTERN = '/^Ghi chú hệ thống:\s*phần điều chỉnh(?P<suffix>(?:\s+tăng)?(?:\s+thêm)?)\s+(?P<amount>[0-9\.\,]+)\s*đ\s+cho phù hợp với COD$/u';
    private const RETURN_NOTE_PATTERN = '/^Ghi chú hệ thống:\s*khách trả về\s+(?P<summary>.+?),\s*phần điều chỉnh\s*(?P<sign>[+-])\s*(?P<amount>[0-9\.\,]+)\s*đ$/u';

    public static function sync(
        ?string $notes,
        ?float $adjustmentAmount,
        array|bool $returnedItemsOrIsAdditional = [],
        bool $isAdditional = false
    ): ?string {
        $returnedItems = is_array($returnedItemsOrIsAdditional) ? $returnedItemsOrIsAdditional : [];
        if (is_bool($returnedItemsOrIsAdditional)) {
            $isAdditional = $returnedItemsOrIsAdditional;
        }

        $manualNotes = self::stripManagedNote($notes);
        $systemNote = self::build($adjustmentAmount, $returnedItems, $isAdditional);

        $parts = [];

        if ($manualNotes !== null && $manualNotes !== '') {
            $parts[] = $manualNotes;
        }

        if ($systemNote !== null) {
            $parts[] = $systemNote;
        }

        if (empty($parts)) {
            return null;
        }

        return implode("\n", $parts);
    }

    public static function build(
        ?float $adjustmentAmount,
        array|bool $returnedItemsOrIsAdditional = [],
        bool $isAdditional = false
    ): ?string {
        $returnedItems = is_array($returnedItemsOrIsAdditional) ? $returnedItemsOrIsAdditional : [];
        if (is_bool($returnedItemsOrIsAdditional)) {
            $isAdditional = $returnedItemsOrIsAdditional;
        }

        $normalizedAmount = round((float) ($adjustmentAmount ?? 0), 2);
        if (abs($normalizedAmount) < 0.01) {
            return null;
        }

        $returnedSummary = self::buildReturnedItemsSummary($returnedItems);
        if ($returnedSummary !== '') {
            $formattedAmount = number_format(abs($normalizedAmount), 0, ',', '.') . 'đ';
            $sign = $normalizedAmount >= 0 ? '+' : '-';

            return "Ghi chú hệ thống: khách trả về {$returnedSummary}, phần điều chỉnh {$sign}{$formattedAmount}";
        }

        $formattedAmount = number_format(abs($normalizedAmount), 0, ',', '.') . 'đ';
        $isIncrease = $normalizedAmount < 0;
        $action = $isIncrease
            ? ($isAdditional ? 'điều chỉnh tăng thêm' : 'điều chỉnh tăng')
            : ($isAdditional ? 'điều chỉnh thêm' : 'điều chỉnh');

        return "Ghi chú hệ thống: phần {$action} {$formattedAmount} cho phù hợp với COD";
    }

    public static function extractAdjustmentAmount(?string $notes): float
    {
        $meta = self::extractManagedNoteMeta($notes);

        return (float) ($meta['amount'] ?? 0.0);
    }

    public static function hasAdditionalWording(?string $notes): bool
    {
        $meta = self::extractManagedNoteMeta($notes);

        return (bool) ($meta['is_additional'] ?? false);
    }

    private static function extractManagedNoteMeta(?string $notes): ?array
    {
        $normalizedNotes = str_replace(["\r\n", "\r"], "\n", trim((string) ($notes ?? '')));
        if ($normalizedNotes === '') {
            return null;
        }

        foreach (explode("\n", $normalizedNotes) as $line) {
            $trimmedLine = trim($line);
            if ($trimmedLine === '') {
                continue;
            }

            if (preg_match(self::RETURN_NOTE_PATTERN, $trimmedLine, $matches) === 1) {
                $rawAmount = str_replace(',', '.', str_replace('.', '', (string) ($matches['amount'] ?? '0')));
                $amount = round((float) $rawAmount, 2);

                if (($matches['sign'] ?? '+') === '-') {
                    $amount *= -1;
                }

                return [
                    'amount' => $amount,
                    'is_additional' => false,
                ];
            }

            if (preg_match(self::LEGACY_NOTE_PATTERN, $trimmedLine, $matches) !== 1) {
                continue;
            }

            $suffix = trim((string) ($matches['suffix'] ?? ''));
            $rawAmount = str_replace(',', '.', str_replace('.', '', (string) ($matches['amount'] ?? '0')));
            $amount = (float) $rawAmount;

            if (str_contains($suffix, 'tăng')) {
                $amount *= -1;
            }

            return [
                'amount' => round($amount, 2),
                'is_additional' => str_contains($suffix, 'thêm'),
            ];
        }

        return null;
    }

    private static function stripManagedNote(?string $notes): ?string
    {
        $normalizedNotes = str_replace(["\r\n", "\r"], "\n", trim((string) ($notes ?? '')));
        if ($normalizedNotes === '') {
            return null;
        }

        $lines = explode("\n", $normalizedNotes);
        $keptLines = [];
        $previousBlank = false;

        foreach ($lines as $line) {
            $trimmedLine = trim($line);

            if ($trimmedLine !== '' && self::isManagedNoteLine($trimmedLine)) {
                continue;
            }

            if ($trimmedLine === '') {
                if ($previousBlank || empty($keptLines)) {
                    continue;
                }

                $keptLines[] = '';
                $previousBlank = true;
                continue;
            }

            $keptLines[] = rtrim($line);
            $previousBlank = false;
        }

        while (!empty($keptLines) && end($keptLines) === '') {
            array_pop($keptLines);
        }

        if (empty($keptLines)) {
            return null;
        }

        return implode("\n", $keptLines);
    }

    private static function isManagedNoteLine(string $line): bool
    {
        return preg_match(self::LEGACY_NOTE_PATTERN, $line) === 1
            || preg_match(self::RETURN_NOTE_PATTERN, $line) === 1;
    }

    private static function buildReturnedItemsSummary(array $returnedItems): string
    {
        $normalizedItems = collect($returnedItems)
            ->map(function ($item) {
                $quantity = InventoryQuantity::normalize($item['quantity'] ?? $item->quantity ?? 0);
                $name = trim((string) (
                    $item['product_name_snapshot']
                    ?? $item['snapshot_name']
                    ?? $item['name']
                    ?? $item->product_name_snapshot
                    ?? $item->snapshot_name
                    ?? $item->name
                    ?? ''
                ));

                if ($quantity <= 0 || $name === '') {
                    return null;
                }

                return [
                    'key' => mb_strtolower($name, 'UTF-8'),
                    'name' => $name,
                    'quantity' => $quantity,
                ];
            })
            ->filter()
            ->groupBy('key')
            ->map(function ($rows) {
                $first = $rows->first();

                return [
                    'name' => $first['name'],
                    'quantity' => InventoryQuantity::normalize($rows->sum('quantity')),
                ];
            })
            ->values();

        if ($normalizedItems->isEmpty()) {
            return '';
        }

        $parts = $normalizedItems
            ->take(2)
            ->map(fn (array $item) => $item['quantity'] . ' ' . $item['name'])
            ->all();

        $remainingCount = $normalizedItems->count() - count($parts);
        if ($remainingCount > 0) {
            $parts[] = '+' . $remainingCount . ' sản phẩm khác';
        }

        return implode('; ', $parts);
    }
}
