<?php

namespace App\Support;

use App\Models\OrderStatus;

class OrderStatusCatalog
{
    public const PRINTED_CODE = 'printed';
    public const PRINTED_NAME = 'Đã in';
    public const PRINTED_COLOR = '#0f766e';
    public const RETURNED_CODE = 'returned';
    public const RETURNED_NAME = 'Đã hoàn';
    public const RETURNED_COLOR = '#b91c1c';

    public const PRINT_STATUS_LOCK_CODES = [
        'shipping',
        'completed',
        'pending_return',
        'returned',
        'cancelled',
    ];

    public static function ensurePrintedStatus(int $accountId): OrderStatus
    {
        return self::ensureSystemStatus(
            $accountId,
            self::PRINTED_CODE,
            self::PRINTED_NAME,
            self::PRINTED_COLOR
        );
    }

    public static function ensureReturnedStatus(int $accountId): OrderStatus
    {
        return self::ensureSystemStatus(
            $accountId,
            self::RETURNED_CODE,
            self::RETURNED_NAME,
            self::RETURNED_COLOR
        );
    }

    public static function shouldKeepStatusWhenPrinting(?string $status): bool
    {
        return in_array((string) $status, self::PRINT_STATUS_LOCK_CODES, true);
    }

    private static function ensureSystemStatus(
        int $accountId,
        string $code,
        string $name,
        string $color
    ): OrderStatus {
        $status = OrderStatus::query()
            ->where('account_id', $accountId)
            ->where('code', $code)
            ->first();

        if ($status) {
            $dirty = false;

            if (!$status->is_system) {
                $status->is_system = true;
                $dirty = true;
            }

            if (!$status->is_active) {
                $status->is_active = true;
                $dirty = true;
            }

            if ($dirty) {
                $status->save();
            }

            return $status;
        }

        $maxSortOrder = (int) (OrderStatus::query()
            ->where('account_id', $accountId)
            ->max('sort_order') ?? 0);

        return OrderStatus::create([
            'account_id' => $accountId,
            'code' => $code,
            'name' => $name,
            'color' => $color,
            'sort_order' => $maxSortOrder + 1,
            'is_default' => false,
            'is_system' => true,
            'is_active' => true,
        ]);
    }
}
