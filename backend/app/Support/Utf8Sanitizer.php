<?php

namespace App\Support;

class Utf8Sanitizer
{
    public static function normalize(mixed $value): mixed
    {
        if (is_array($value)) {
            $normalized = [];

            foreach ($value as $key => $item) {
                $normalized[$key] = self::normalize($item);
            }

            return $normalized;
        }

        if (is_string($value)) {
            return self::normalizeString($value);
        }

        return $value;
    }

    public static function normalizeString(string $value): string
    {
        if ($value === '') {
            return '';
        }

        $base = self::decodeUnicodeEscapes(self::ensureUtf8($value));
        $candidates = array_filter([
            $base,
            self::decodeUnicodeEscapes(self::reinterpretAsUtf8($base, 'Windows-1252')),
            self::decodeUnicodeEscapes(self::reinterpretAsUtf8($base, 'ISO-8859-1')),
            self::decodeUnicodeEscapes(self::reinterpretAsUtf8(self::reinterpretAsUtf8($base, 'Windows-1252'), 'Windows-1252')),
            self::decodeUnicodeEscapes(self::reinterpretAsUtf8(self::reinterpretAsUtf8($base, 'ISO-8859-1'), 'Windows-1252')),
        ], static fn ($candidate) => is_string($candidate) && $candidate !== '');

        $best = $base;
        $bestScore = self::score($base);

        foreach ($candidates as $candidate) {
            $candidateScore = self::score($candidate);

            if ($candidateScore < $bestScore) {
                $best = $candidate;
                $bestScore = $candidateScore;
            }
        }

        return $best;
    }

    private static function ensureUtf8(string $value): string
    {
        if (self::isValidUtf8($value)) {
            return $value;
        }

        foreach (['Windows-1252', 'ISO-8859-1', 'UTF-8'] as $sourceEncoding) {
            $converted = self::convert($value, $sourceEncoding);

            if ($converted !== '' && self::isValidUtf8($converted)) {
                return $converted;
            }
        }

        return $value;
    }

    private static function convert(string $value, string $sourceEncoding): string
    {
        $converted = @mb_convert_encoding($value, 'UTF-8', $sourceEncoding);

        return is_string($converted) ? $converted : $value;
    }

    private static function reinterpretAsUtf8(string $value, string $targetEncoding): string
    {
        $bytes = @mb_convert_encoding($value, $targetEncoding, 'UTF-8');

        if (!is_string($bytes) || $bytes === '') {
            return $value;
        }

        return self::isValidUtf8($bytes) ? $bytes : $value;
    }

    private static function decodeUnicodeEscapes(string $value): string
    {
        if (!preg_match('/\\\\u[0-9a-fA-F]{4}/', $value)) {
            return $value;
        }

        return preg_replace_callback(
            '/\\\\u([0-9a-fA-F]{4})/',
            static fn (array $matches) => mb_convert_encoding(pack('H*', $matches[1]), 'UTF-8', 'UTF-16BE'),
            $value
        ) ?? $value;
    }

    private static function isValidUtf8(string $value): bool
    {
        return preg_match('//u', $value) === 1;
    }

    private static function score(string $value): int
    {
        $score = 0;

        if (!self::isValidUtf8($value)) {
            $score += 1000;
        }

        preg_match_all('/(?:Ã.|Â.|Ä.|áº.|á».|Æ.|Ð.|Ñ.|â€™|â€œ|â€|â€¢|�)/u', $value, $matches);
        $score += count($matches[0]) * 12;

        if (preg_match('/\\\\u[0-9a-fA-F]{4}/', $value) === 1) {
            $score += 8;
        }

        return $score;
    }
}
