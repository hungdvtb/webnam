<?php

namespace App\Support;

use App\Models\Order;
use App\Models\OrderStatus;
use Illuminate\Support\Facades\Schema;

class OrderStatusCatalog
{
    public const NEW_CODE = 'new';
    public const PROCESSING_CODE = 'processing';
    public const SHIPPING_CODE = 'shipping';
    public const COMPLETED_CODE = 'completed';
    public const PENDING_RETURN_CODE = 'pending_return';

    public const PRINTED_CODE = 'printed';
    public const PRINTED_NAME = 'Đã in';
    public const PRINTED_COLOR = '#0f766e';

    public const DISPATCHED_CODE = 'dispatched';
    public const DISPATCHED_NAME = 'Đã tạo đơn';
    public const DISPATCHED_COLOR = '#eab308';

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

    public static function defaultSystemStatuses(): array
    {
        return [
            [
                'code' => self::NEW_CODE,
                'name' => 'Đơn mới',
                'color' => '#16a34a',
                'sort_order' => 1,
                'is_default' => true,
            ],
            [
                'code' => self::PROCESSING_CODE,
                'name' => 'Cần xử lý',
                'color' => '#f59e0b',
                'sort_order' => 2,
                'is_default' => false,
            ],
            [
                'code' => self::SHIPPING_CODE,
                'name' => 'Đang giao hàng',
                'color' => '#8b5cf6',
                'sort_order' => 3,
                'is_default' => false,
            ],
            [
                'code' => self::COMPLETED_CODE,
                'name' => 'Giao hàng thành công',
                'color' => '#10b981',
                'sort_order' => 4,
                'is_default' => false,
            ],
            [
                'code' => self::PENDING_RETURN_CODE,
                'name' => 'Chờ hoàn',
                'color' => '#ef4444',
                'sort_order' => 5,
                'is_default' => false,
            ],
            [
                'code' => self::RETURNED_CODE,
                'name' => self::RETURNED_NAME,
                'color' => self::RETURNED_COLOR,
                'sort_order' => 6,
                'is_default' => false,
            ],
            [
                'code' => 'cancelled',
                'name' => 'Đã hủy',
                'color' => '#6b7280',
                'sort_order' => 7,
                'is_default' => false,
            ],
            [
                'code' => 'confirmed',
                'name' => 'Đã xác nhận',
                'color' => '#3b82f6',
                'sort_order' => 8,
                'is_default' => false,
            ],
            [
                'code' => self::PRINTED_CODE,
                'name' => self::PRINTED_NAME,
                'color' => self::PRINTED_COLOR,
                'sort_order' => 9,
                'is_default' => false,
            ],
            [
                'code' => self::DISPATCHED_CODE,
                'name' => self::DISPATCHED_NAME,
                'color' => self::DISPATCHED_COLOR,
                'sort_order' => 10,
                'is_default' => false,
            ],
            [
                'code' => self::EXCHANGE_COMPLETED_CODE,
                'name' => self::EXCHANGE_COMPLETED_NAME,
                'color' => self::EXCHANGE_COMPLETED_COLOR,
                'sort_order' => 11,
                'is_default' => false,
            ],
            [
                'code' => self::PARTIAL_DELIVERY_CODE,
                'name' => self::PARTIAL_DELIVERY_NAME,
                'color' => self::PARTIAL_DELIVERY_COLOR,
                'sort_order' => 12,
                'is_default' => false,
            ],
        ];
    }

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

    public static function ensureDefaultSystemStatuses(int $accountId, bool $normalizeSortOrder = false): void
    {
        if (!Schema::hasTable('order_statuses')) {
            return;
        }

        $statuses = self::defaultSystemStatuses();
        $codes = array_column($statuses, 'code');
        $existingDefaultStatusCount = OrderStatus::query()
            ->where('account_id', $accountId)
            ->whereIn('code', $codes)
            ->count();
        $shouldNormalizeSortOrder = $normalizeSortOrder || $existingDefaultStatusCount < count($statuses);
        $hasDefaultStatus = OrderStatus::query()
            ->where('account_id', $accountId)
            ->where('is_default', true)
            ->exists();

        foreach ($statuses as $status) {
            self::ensureSystemStatus(
                $accountId,
                $status['code'],
                $status['name'],
                $status['color'],
                (int) $status['sort_order'],
                !$hasDefaultStatus && (bool) $status['is_default'],
                $shouldNormalizeSortOrder
            );
        }

        self::ensureDefaultStatusFlag($accountId);
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
        string $color,
        ?int $sortOrder = null,
        bool $isDefault = false,
        bool $updateSortOrder = false
    ): OrderStatus {
        if (!Schema::hasTable('order_statuses')) {
            return new OrderStatus([
                'account_id' => $accountId,
                'code' => $code,
                'name' => $name,
                'color' => $color,
                'is_default' => $isDefault,
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

            if ($updateSortOrder && $sortOrder !== null && (int) $status->sort_order !== $sortOrder) {
                $status->sort_order = $sortOrder;
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
            'sort_order' => $sortOrder ?? ($maxSortOrder + 1),
            'is_default' => $isDefault,
            'is_system' => true,
            'is_active' => true,
        ]);
    }

    private static function ensureDefaultStatusFlag(int $accountId): void
    {
        $hasDefault = OrderStatus::query()
            ->where('account_id', $accountId)
            ->where('is_default', true)
            ->exists();

        if ($hasDefault) {
            return;
        }

        OrderStatus::query()
            ->where('account_id', $accountId)
            ->where('code', self::NEW_CODE)
            ->update(['is_default' => true]);
    }
}
