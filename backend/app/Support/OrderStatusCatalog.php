<?php

namespace App\Support;

use App\Models\Order;
use App\Models\OrderStatus;
use Illuminate\Support\Facades\Schema;

class OrderStatusCatalog
{
    public const PRINTED_CODE = 'printed';
    public const PRINTED_NAME = 'Đã in';
    public const PRINTED_COLOR = '#0f766e';

    public const RETURNED_CODE = 'returned';
    public const RETURNED_NAME = 'Đã hoàn';
    public const RETURNED_COLOR = '#b91c1c';

    public const EXCHANGE_COMPLETED_CODE = 'exchange_completed';
    public const EXCHANGE_COMPLETED_NAME = 'Đổi hàng thành công';
    public const EXCHANGE_COMPLETED_COLOR = '#15803d';

    public const PARTIAL_DELIVERY_CODE = Order::TYPE_PARTIAL_DELIVERY;
    public const PARTIAL_DELIVERY_NAME = 'Giao hàng 1 phần';
    public const PARTIAL_DELIVERY_COLOR = '#0369a1';

    public const PRINT_STATUS_LOCK_CODES = [
        'shipping',
        'completed',
        'pending_return',
        'returned',
        self::EXCHANGE_COMPLETED_CODE,
        self::PARTIAL_DELIVERY_CODE,
        'cancelled',
    ];

    public const AUTO_RETURN_WORKFLOW_CODES = [
        self::RETURNED_CODE,
        self::EXCHANGE_COMPLETED_CODE,
        self::PARTIAL_DELIVERY_CODE,
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

    public static function ensureExchangeCompletedStatus(int $accountId): OrderStatus
    {
        return self::ensureSystemStatus(
            $accountId,
            self::EXCHANGE_COMPLETED_CODE,
            self::EXCHANGE_COMPLETED_NAME,
            self::EXCHANGE_COMPLETED_COLOR
        );
    }

    public static function ensurePartialDeliveryStatus(int $accountId): OrderStatus
    {
        return self::ensureSystemStatus(
            $accountId,
            self::PARTIAL_DELIVERY_CODE,
            self::PARTIAL_DELIVERY_NAME,
            self::PARTIAL_DELIVERY_COLOR
        );
    }

    public static function ensureDefaultSystemStatuses(int $accountId): void
    {
        self::ensurePrintedStatus($accountId);
        self::ensureExchangeCompletedStatus($accountId);
        self::ensurePartialDeliveryStatus($accountId);
    }

    public static function shouldKeepStatusWhenPrinting(?string $status): bool
    {
        return in_array((string) $status, self::PRINT_STATUS_LOCK_CODES, true);
    }

    public static function isAutoReturnWorkflowStatus(?string $status): bool
    {
        return in_array((string) $status, self::AUTO_RETURN_WORKFLOW_CODES, true);
    }

    public static function resolvedStatusForCompletedReturn(Order $order): string
    {
        return match ($order->getNormalizedOrderType()) {
            Order::TYPE_EXCHANGE_RETURN => self::EXCHANGE_COMPLETED_CODE,
            Order::TYPE_PARTIAL_DELIVERY => self::PARTIAL_DELIVERY_CODE,
            default => self::RETURNED_CODE,
        };
    }

    public static function ensureStatusForCompletedReturn(Order $order): void
    {
        $accountId = (int) ($order->account_id ?? 0);
        if ($accountId <= 0) {
            return;
        }

        match (self::resolvedStatusForCompletedReturn($order)) {
            self::EXCHANGE_COMPLETED_CODE => self::ensureExchangeCompletedStatus($accountId),
            self::PARTIAL_DELIVERY_CODE => self::ensurePartialDeliveryStatus($accountId),
            default => self::ensureReturnedStatus($accountId),
        };
    }

    private static function ensureSystemStatus(
        int $accountId,
        string $code,
        string $name,
        string $color
    ): OrderStatus {
        if (!Schema::hasTable('order_statuses')) {
            return new OrderStatus([
                'account_id' => $accountId,
                'code' => $code,
                'name' => $name,
                'color' => $color,
                'is_default' => false,
                'is_system' => true,
                'is_active' => true,
            ]);
        }

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
