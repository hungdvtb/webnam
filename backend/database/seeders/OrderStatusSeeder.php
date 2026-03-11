<?php

namespace Database\Seeders;

use App\Models\OrderStatus;
use App\Models\Account;
use Illuminate\Database\Seeder;

class OrderStatusSeeder extends Seeder
{
    public function run(): void
    {
        $account = Account::first();
        if (!$account) return;

        $statuses = [
            [
                'code' => 'new',
                'name' => 'Đơn mới',
                'color' => '#22c55e', // green
                'sort_order' => 1,
                'is_default' => true,
                'is_system' => true,
            ],
            [
                'code' => 'processing',
                'name' => 'Cần xử lý',
                'color' => '#f59e0b', // amber
                'sort_order' => 2,
                'is_default' => false,
                'is_system' => true,
            ],
            [
                'code' => 'shipping',
                'name' => 'Đang giao hàng',
                'color' => '#8b5cf6', // purple
                'sort_order' => 3,
                'is_default' => false,
                'is_system' => true,
            ],
            [
                'code' => 'completed',
                'name' => 'Giao hàng thành công',
                'color' => '#10b981', // emerald
                'sort_order' => 4,
                'is_default' => false,
                'is_system' => true,
            ],
            [
                'code' => 'pending_return',
                'name' => 'Chờ hoàn',
                'color' => '#ef4444', // red
                'sort_order' => 5,
                'is_default' => false,
                'is_system' => true,
            ],
            [
                'code' => 'returned',
                'name' => 'Đã hoàn',
                'color' => '#b91c1c', // dark red
                'sort_order' => 6,
                'is_default' => false,
                'is_system' => true,
            ],
            [
                'code' => 'cancelled',
                'name' => 'Đã hủy',
                'color' => '#6b7280', // gray
                'sort_order' => 7,
                'is_default' => false,
                'is_system' => true,
            ],
            [
                'code' => 'confirmed',
                'name' => 'Đã xác nhận',
                'color' => '#3b82f6', // blue
                'sort_order' => 8,
                'is_default' => false,
                'is_system' => true,
            ],
        ];

        $codes = array_column($statuses, 'code');
        
        // Delete statuses that are not in the new default list for this account
        OrderStatus::where('account_id', $account->id)
            ->whereNotIn('code', $codes)
            ->delete();

        foreach ($statuses as $status) {
            OrderStatus::updateOrCreate(
                ['account_id' => $account->id, 'code' => $status['code']],
                $status
            );
        }
    }
}
