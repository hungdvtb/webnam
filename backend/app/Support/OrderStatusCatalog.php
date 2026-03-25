<?php

namespace App\Support;

use App\Models\OrderStatus;

class OrderStatusCatalog
{
    public const PRINTED_CODE = 'printed';
    public const PRINTED_NAME = 'Đã in';
    public const PRINTED_COLOR = '#0f766e';

    public const PRINT_STATUS_LOCK_CODES = [
        'shipping',
        'completed',
        'pending_return',
        'returned',
        'cancelled',
    ];

    public static function ensurePrintedStatus(int $accountId): OrderStatus
    {
        $status = OrderStatus::query()
            ->where('account_id', $accountId)
            ->where('code', self::PRINTED_CODE)
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
            'code' => self::PRINTED_CODE,
            'name' => self::PRINTED_NAME,
            'color' => self::PRINTED_COLOR,
            'sort_order' => $maxSortOrder + 1,
            'is_default' => false,
            'is_system' => true,
            'is_active' => true,
        ]);
    }

    public static function shouldKeepStatusWhenPrinting(?string $status): bool
    {
        return in_array((string) $status, self::PRINT_STATUS_LOCK_CODES, true);
    }
}
