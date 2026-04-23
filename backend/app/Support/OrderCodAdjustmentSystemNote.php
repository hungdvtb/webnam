<?php

namespace App\Support;

class OrderCodAdjustmentSystemNote
{
    private const NOTE_PATTERN = '/^Ghi chú hệ thống:\s*phần điều chỉnh(?P<suffix>(?:\s+tăng)?(?:\s+thêm)?)\s+(?P<amount>[0-9\.\,]+)\s*đ\s+cho phù hợp với COD$/u';

    public static function sync(?string $notes, ?float $adjustmentAmount, bool $isAdditional = false): ?string
    {
        $manualNotes = self::stripManagedNote($notes);
        $systemNote = self::build($adjustmentAmount, $isAdditional);

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

    public static function build(?float $adjustmentAmount, bool $isAdditional = false): ?string
    {
        $normalizedAmount = round((float) ($adjustmentAmount ?? 0), 2);

        if (abs($normalizedAmount) < 0.01) {
            return null;
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

            if (preg_match(self::NOTE_PATTERN, $trimmedLine, $matches) !== 1) {
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

            if ($trimmedLine !== '' && preg_match(self::NOTE_PATTERN, $trimmedLine) === 1) {
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
}
