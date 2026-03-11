<?php

namespace App\Services\Shipping;

/**
 * ShipmentTransitionGuard
 *
 * Enforces valid shipment status transitions.
 * Prevents backward status rollback unless explicitly overridden.
 */
class ShipmentTransitionGuard
{
    /**
     * Status progression order (higher = later in lifecycle)
     */
    const STATUS_ORDER = [
        'created'            => 0,
        'waiting_pickup'     => 1,
        'picked_up'          => 2,
        'shipped'            => 3,
        'in_transit'         => 4,
        'out_for_delivery'   => 5,
        'delivered'          => 6,       // terminal success
        'delivery_failed'    => 5,       // same level as out_for_delivery (can retry)
        'returning'          => 7,
        'returned'           => 8,       // terminal return
        'canceled'           => 9,       // terminal cancel
    ];

    /**
     * Terminal statuses: once reached, no change allowed without override
     */
    const TERMINAL_STATUSES = ['delivered', 'returned', 'canceled'];

    /**
     * Allowed transitions from terminal statuses (admin override only)
     */
    const TERMINAL_OVERRIDES = [
        'delivered'  => ['returning', 'returned'],     // post-delivery returns
        'returned'   => [],                              // truly final
        'canceled'   => ['created', 'waiting_pickup'],  // re-activate
    ];

    /**
     * Check if a transition is valid
     *
     * @return array ['allowed' => bool, 'reason' => string|null, 'requires_override' => bool]
     */
    public function canTransition(string $fromStatus, string $toStatus, bool $isAdminOverride = false): array
    {
        // Same status = no-op, allow
        if ($fromStatus === $toStatus) {
            return ['allowed' => true, 'reason' => null, 'requires_override' => false];
        }

        // delivery_failed -> out_for_delivery retry is always allowed
        if ($fromStatus === 'delivery_failed' && in_array($toStatus, ['out_for_delivery', 'returning', 'returned', 'canceled'])) {
            return ['allowed' => true, 'reason' => null, 'requires_override' => false];
        }

        // From terminal status
        if (in_array($fromStatus, self::TERMINAL_STATUSES)) {
            $allowedOverrides = self::TERMINAL_OVERRIDES[$fromStatus] ?? [];

            if (in_array($toStatus, $allowedOverrides)) {
                if ($isAdminOverride) {
                    return ['allowed' => true, 'reason' => 'Admin override từ trạng thái kết thúc', 'requires_override' => true];
                }
                return ['allowed' => false, 'reason' => "Trạng thái '{$fromStatus}' là trạng thái kết thúc. Cần quyền admin để thay đổi.", 'requires_override' => true];
            }

            return ['allowed' => false, 'reason' => "Không thể chuyển từ '{$fromStatus}' sang '{$toStatus}'. Trạng thái đã kết thúc.", 'requires_override' => false];
        }

        // Check backward movement
        $fromOrder = self::STATUS_ORDER[$fromStatus] ?? 0;
        $toOrder = self::STATUS_ORDER[$toStatus] ?? 0;

        if ($toOrder < $fromOrder) {
            if ($isAdminOverride) {
                return ['allowed' => true, 'reason' => 'Admin override rollback trạng thái', 'requires_override' => true];
            }
            return ['allowed' => false, 'reason' => "Không thể tụt trạng thái từ '{$fromStatus}' về '{$toStatus}'.", 'requires_override' => true];
        }

        return ['allowed' => true, 'reason' => null, 'requires_override' => false];
    }

    /**
     * Check if a status is terminal
     */
    public function isTerminal(string $status): bool
    {
        return in_array($status, self::TERMINAL_STATUSES);
    }
}
