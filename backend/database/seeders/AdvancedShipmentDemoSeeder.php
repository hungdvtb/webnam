<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\Product;
use App\Models\Category;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Customer;
use App\Models\Account;
use App\Models\Shipment;
use App\Models\Carrier;
use App\Models\Warehouse;
use App\Models\ShipmentStatusLog;
use App\Models\ShipmentNote;
use App\Models\ShipmentTrackingHistory;
use App\Models\ShipmentReconciliation;
use App\Models\User;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;
use Faker\Factory as Faker;

class AdvancedShipmentDemoSeeder extends Seeder
{
    public function run()
    {
        $faker = Faker::create('vi_VN');
        $account = Account::first() ?? Account::create(['name' => 'Gốm Sứ Việt', 'domain' => 'localhost', 'subdomain' => 'admin', 'site_code' => 'GSV']);
        $accountId = $account->id;

        $user = User::first();
        $warehouse = Warehouse::first() ?? Warehouse::create(['name' => 'Kho Bát Tràng', 'code' => 'KBT', 'account_id' => $accountId, 'address' => 'Gia Lâm, Hà nội']);
        
        $carriers = Carrier::all();
        if ($carriers->isEmpty()) {
            $defaultCarriers = [
                ['code' => 'GHN', 'name' => 'Giao Hàng Nhanh'],
                ['code' => 'GHTK', 'name' => 'Giao Hàng Tiết Kiệm'],
                ['code' => 'VTP', 'name' => 'Viettel Post'],
                ['code' => 'JT', 'name' => 'J&T Express'],
            ];
            foreach ($defaultCarriers as $c) {
                Carrier::create(['code' => $c['code'], 'name' => $c['name'], 'account_id' => $accountId, 'is_active' => true]);
            }
            $carriers = Carrier::all();
        }

        // 1. Ensure we have 20 products
        if (Product::count() < 20) {
            $cat = Category::first() ?? Category::create(['name' => 'Gốm Thượng Hạng', 'slug' => 'gom-thanh-hang', 'account_id' => $accountId]);
            for ($i = 0; $i < 20; $i++) {
                Product::create([
                    'account_id' => $accountId,
                    'category_id' => $cat->id,
                    'name' => "Sản phẩm Demo " . ($i + 1),
                    'sku' => "DEMO-GOM-" . Str::random(5),
                    'price' => rand(200, 2000) * 1000,
                    'cost_price' => rand(100, 1000) * 1000,
                    'stock_quantity' => 100,
                    'type' => 'simple',
                    'slug' => 'demo-product-' . $i . '-' . uniqid()
                ]);
            }
        }
        $products = Product::all();

        // 2. Ensure we have 50 customers
        if (Customer::count() < 50) {
            for ($i = 0; $i < 50; $i++) {
                Customer::create([
                    'account_id' => $accountId,
                    'name' => $faker->name,
                    'phone' => '09' . $faker->numerify('########'),
                    'email' => $faker->unique()->safeEmail,
                    'address' => $faker->streetAddress,
                ]);
            }
        }
        $customers = Customer::all();

        // 3. Generate 100 Orders and Shipments
        echo "Generating 100 Shipments...\n";
        
        $shipmentStatuses = [
            'created', 'waiting_pickup', 'picked_up', 'shipped', 
            'in_transit', 'out_for_delivery', 'delivered', 
            'delivery_failed', 'returning', 'returned', 'canceled'
        ];

        $reconcileStatuses = ['pending', 'reconciled', 'mismatch'];

        for ($i = 1; $i <= 100; $i++) {
            $customer = $customers->random();
            $orderDate = $faker->dateTimeBetween('-30 days', 'now');
            
            // Create Order
            $order = Order::create([
                'account_id' => $accountId,
                'order_number' => "ORD-" . $orderDate->format('ymd') . "-" . str_pad($i, 4, '0', STR_PAD_LEFT) . "-" . strtoupper(Str::random(4)),
                'customer_id' => $customer->id,
                'customer_name' => $customer->name,
                'customer_phone' => $customer->phone,
                'customer_email' => $customer->email,
                'shipping_address' => $customer->address,
                'status' => 'shipping',
                'total_price' => 0,
                'created_at' => $orderDate,
            ]);

            $item = $products->random();
            $qty = rand(1, 3);
            OrderItem::create([
                'account_id' => $accountId,
                'order_id' => $order->id,
                'product_id' => $item->id,
                'quantity' => $qty,
                'price' => $item->price,
                'product_name_snapshot' => $item->name,
                'product_sku_snapshot' => $item->sku,
            ]);
            $order->update(['total_price' => $item->price * $qty]);

            // Create Shipment
            $status = $faker->randomElement($shipmentStatuses);
            $carrier = $carriers->random();
            $codAmount = $order->total_price;
            $shipFee = rand(30, 150) * 1000;
            
            $deliveredAt = ($status === 'delivered') ? $faker->dateTimeBetween($orderDate, 'now') : null;
            $reconStatus = 'pending';
            $reconAmount = 0;
            $diffAmount = 0;

            if ($status === 'delivered' && $faker->boolean(70)) {
                $reconStatus = $faker->randomElement(['reconciled', 'mismatch']);
                if ($reconStatus === 'reconciled') {
                    $reconAmount = $codAmount - $shipFee;
                    $diffAmount = 0;
                } else {
                    $reconAmount = ($codAmount - $shipFee) - ($faker->randomElement([20000, 50000, 100000]));
                    $diffAmount = ($codAmount - $shipFee) - $reconAmount;
                }
            }

            $shipment = Shipment::create([
                'account_id' => $accountId,
                'order_id' => $order->id,
                'warehouse_id' => $warehouse->id,
                'shipment_number' => "VĐ-" . $orderDate->format('ymd') . "-" . str_pad($i, 4, '0', STR_PAD_LEFT),
                'tracking_number' => $carrier->code . $faker->numerify('##########'),
                'carrier_code' => $carrier->code,
                'carrier_name' => $carrier->name,
                'order_code' => $order->order_number,
                'channel' => $faker->randomElement(['manual', 'api', 'import']),
                'customer_id' => $customer->id,
                'customer_name' => $customer->name,
                'customer_phone' => $customer->phone,
                'customer_address' => $customer->address,
                'customer_province' => 'Hà Nội',
                'shipment_status' => $status,
                'status' => $status,
                'cod_amount' => $codAmount,
                'shipping_cost' => $shipFee,
                'service_fee' => $codAmount * 0.01,
                'reconciled_amount' => $reconAmount,
                'actual_received_amount' => $codAmount - $shipFee,
                'reconciliation_diff_amount' => $diffAmount,
                'reconciliation_status' => $reconStatus,
                'cod_status' => ($reconStatus !== 'pending') ? 'collected' : 'pending',
                'attempt_delivery_count' => ($status === 'delivered') ? 1 : rand(0, 3),
                'risk_flag' => ($codAmount > 5000000 || $diffAmount != 0) ? 'high' : 'normal',
                'priority_level' => $faker->randomElement(['normal', 'high', 'urgent']),
                'created_by' => $user?->id,
                'created_at' => $orderDate,
                'delivered_at' => $deliveredAt,
                'shipped_at' => (in_array($status, ['shipped', 'in_transit', 'delivered'])) ? $orderDate : null,
            ]);

            // Logs
            ShipmentStatusLog::create([
                'shipment_id' => $shipment->id,
                'from_status' => 'created',
                'to_status' => $status,
                'changed_by' => $user?->id,
                'change_source' => 'system'
            ]);

            // Notes
            if ($faker->boolean(40)) {
                ShipmentNote::create([
                    'shipment_id' => $shipment->id,
                    'content' => $faker->sentence(),
                    'created_by' => $user?->id,
                    'note_type' => $faker->randomElement(['info', 'warning'])
                ]);
            }

            // Tracking history
            if (in_array($status, ['in_transit', 'out_for_delivery', 'delivered'])) {
                ShipmentTrackingHistory::create([
                    'shipment_id' => $shipment->id,
                    'status' => 'in_transit',
                    'description' => 'Hàng đã rời kho trung chuyển',
                    'location' => 'Hà Nội',
                    'event_time' => $orderDate
                ]);
            }

            // Reconciliation record
            if ($reconStatus !== 'pending') {
                ShipmentReconciliation::create([
                    'shipment_id' => $shipment->id,
                    'reconciled_at' => now(),
                    'cod_amount' => $codAmount,
                    'shipping_fee' => $shipFee,
                    'system_expected_amount' => $codAmount - $shipFee,
                    'actual_received_amount' => $reconAmount,
                    'diff_amount' => $diffAmount,
                    'status' => $reconStatus,
                    'note' => $reconStatus === 'mismatch' ? 'Chênh lệch phí vận chuyển hãng' : 'Khớp dữ liệu'
                ]);
            }
        }

        echo "Success: Created 100 Shipments with detailed audit logs and reconciliation data.\n";
    }
}
