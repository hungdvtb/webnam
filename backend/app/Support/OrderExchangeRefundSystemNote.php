<?php

namespace App\Support;

class OrderExchangeRefundSystemNote
{
    private const NOTE_PATTERN = '/^Nhận hàng trả thì trả lại khách\s+(?P<amount>[0-9\.\,]+)\s*(?P<suffix>k|đ)?$/u';

    public static function sync(?string $notes, ?float $refundAmount): ?string
    {
        $manualNotes = self::stripManagedNote($notes);
        $systemNote = self::build($refundAmount);
        $parts = [];

        if ($manualNotes !== null && $manualNotes !== '') {
            $parts[] = $manualNotes;
        }

        if ($systemNote !== null) {
            $parts[] = $systemNote;
        }

        return empty($parts) ? null : implode("\n", $parts);
    }

    public static function build(?float $refundAmount): ?string
    {
        $normalizedAmount = round(max(0, (float) ($refundAmount ?? 0)), 2);
        if ($normalizedAmount < 0.01) {
            return null;
        }

        return 'Nhận hàng trả thì trả lại khách ' . self::formatCompactVnd($normalizedAmount);
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

        return empty($keptLines) ? null : implode("\n", $keptLines);
    }

    private static function formatCompactVnd(float $amount): string
    {
        $rounded = (int) round($amount);

        if ($rounded >= 1000 && $rounded % 1000 === 0) {
            return number_format($rounded / 1000, 0, ',', '.') . 'k';
        }

        if ($rounded >= 1000) {
            return rtrim(rtrim(number_format($rounded / 1000, 1, ',', '.'), '0'), ',') . 'k';
        }

        return number_format($rounded, 0, ',', '.') . 'đ';
    }
}
