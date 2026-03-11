<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DemoOrderAttributeSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        // First, clear existing demo order attributes to avoid duplicates
        \App\Models\Attribute::where('entity_type', 'order')->delete();

        // Get the first available account to associate these attributes
        $account = \App\Models\Account::first();
        if (!$account) {
            echo "No account found, cannot seed order attributes.\n";
            return;
        }

        $demos = [
            [
                'name' => 'Đơn vị vận chuyển',
                'code' => 'shipping_provider',
                'frontend_type' => 'select',
                'options' => ['Giao hàng Tiết Kiệm', 'Giao hàng Nhanh (GHN)', 'Viettel Post', 'J&T Express', 'GrabExpress (Hỏa tốc)']
            ],
            [
                'name' => 'Kênh bán hàng',
                'code' => 'order_source',
                'frontend_type' => 'select',
                'options' => ['Trực tiếp tại showroom', 'Website bán hàng', 'Facebook Messenger', 'Zalo OA', 'Sàn Shopee', 'Sàn Lazada', 'Sàn TikTok Shop']
            ],
            [
                'name' => 'Ghi chú nội bộ',
                'code' => 'internal_note',
                'frontend_type' => 'textarea',
                'options' => []
            ],
            [
                'name' => 'Trạng thái thanh toán',
                'code' => 'payment_status_attr',
                'frontend_type' => 'select',
                'options' => ['Chờ xác nhận', 'Đã đặt cọc 50%', 'Đã thanh toán đủ', 'Thanh toán khi nhận hàng (COD)', 'Đã hoàn tiền']
            ],
            [
                'name' => 'Độ ưu tiên xử lý',
                'code' => 'order_priority',
                'frontend_type' => 'select',
                'options' => ['Thường', 'Gấp (Phải đi trong ngày)', 'Ưu tiên VIP']
            ]
        ];

        foreach ($demos as $demo) {
            $attr = \App\Models\Attribute::create([
                'name' => $demo['name'],
                'code' => $demo['code'],
                'entity_type' => 'order',
                'frontend_type' => $demo['frontend_type'],
                'is_filterable' => false,
                'is_required' => false,
                'is_variant' => false,
                'account_id' => $account->id
            ]);

            foreach ($demo['options'] as $index => $opt) {
                $attr->options()->create([
                    'value' => $opt,
                    'order' => $index
                ]);
            }
        }
    }
}
