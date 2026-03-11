<?php

namespace Database\Seeders;

use App\Models\Account;
use App\Models\Attribute;
use App\Models\Category;
use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderAttributeValue;
use App\Models\Product;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class DemoContentSeeder extends Seeder
{
    public function run(): void
    {
        // 1. Ensure Account exists
        $account = Account::first();
        if (!$account) {
            $account = Account::create([
                'name' => 'Gốm Sứ Đại Thành',
                'subdomain' => 'gom-su-dai-thanh',
                'domain' => 'gomsu.example.local',
                'site_code' => 'GSDT'
            ]);
        }
        $accountId = $account->id;

        // 2. Run basic seeders
        $this->call([
            AttributeSeeder::class,
            DemoOrderAttributeSeeder::class,
        ]);

        // 3. Create Categories
        $categoriesData = [
            ['name' => 'Lọ Hoa Cao Cấp', 'slug' => 'lo-hoa-cao-cap'],
            ['name' => 'Bộ Ấm Trà Đạo', 'slug' => 'bo-am-tra-dao'],
            ['name' => 'Tranh Gốm Mỹ Thuật', 'slug' => 'tranh-gom-my-thuat'],
            ['name' => 'Tượng Phong Thủy', 'slug' => 'tuong-phong-thuy'],
            ['name' => 'Bát Đĩa Men Rạn', 'slug' => 'bat-dia-men-ran'],
        ];

        $categories = [];
        foreach ($categoriesData as $c) {
            $categories[] = Category::firstOrCreate(['slug' => $c['slug']], [
                'name' => $c['name'],
                'account_id' => $accountId
            ]);
        }

        // 4. Create Products
        Product::query()->delete();
        $products = [];
        for ($i = 1; $i <= 20; $i++) {
            $cat = $categories[array_rand($categories)];
            $price = rand(500, 5000) * 1000;
            $products[] = Product::create([
                'account_id' => $accountId,
                'category_id' => $cat->id,
                'name' => "Sản phẩm Gốm Sứ Thượng Hạng #$i",
                'slug' => "san-pham-gom-su-thuong-hang-$i-" . Str::random(4),
                'sku' => "GOM-" . strtoupper(Str::random(6)),
                'price' => $price,
                'cost_price' => $price * 0.6,
                'stock_quantity' => rand(5, 50),
                'description' => "Mô tả chi tiết cho sản phẩm gốm sứ thượng hạng số $i. Chế tác thủ công từ đất sét trắng tinh khiết.",
                'is_featured' => (rand(1, 10) > 8),
                'type' => 'simple'
            ]);
        }

        // 5. Create Customers
        $customers = [];
        $names = ['Nguyễn Văn An', 'Trần Thị Bình', 'Lê Công Vinh', 'Phạm Minh Chính', 'Hoàng Xuân Vinh', 'Đặng Lệ Thu', 'Vũ Hồng Nhung', 'Bùi Xuân Huấn', 'Ngô Kiến Huy', 'Phan Mạnh Quỳnh'];
        foreach ($names as $idx => $name) {
            $customers[] = Customer::create([
                'account_id' => $accountId,
                'name' => $name,
                'email' => 'customer' . ($idx+1) . '@example.com',
                'phone' => '09' . rand(10000000, 99999999),
                'address' => rand(1, 500) . " Đường Lê Lợi, Quận " . rand(1, 12) . ", TP. Hồ Chí Minh",
                'total_spent' => 0,
                'total_orders' => 0
            ]);
        }

        // 6. Create 30 Orders
        $statuses = ['new', 'processing', 'shipping', 'completed', 'pending_return', 'returned'];
        $orderAttributes = Attribute::where('entity_type', 'order')->with('options')->get();

        for ($i = 1; $i <= 30; $i++) {
            $customer = $customers[array_rand($customers)];
            $status = $statuses[array_rand($statuses)];
            $orderDate = now()->subDays(rand(0, 60))->subHours(rand(0, 23));

            $order = Order::create([
                'account_id' => $accountId,
                'customer_id' => $customer->id,
                'order_number' => 'ORD-' . date('Ymd') . '-' . strtoupper(Str::random(6)),
                'customer_name' => $customer->name,
                'customer_email' => $customer->email,
                'customer_phone' => $customer->phone,
                'shipping_address' => $customer->address,
                'status' => $status,
                'total_price' => 0, // Will update after items
                'created_at' => $orderDate,
                'updated_at' => $orderDate,
                'notes' => rand(1, 5) > 3 ? "Lưu ý: Giao hàng giờ hành chính." : null
            ]);

            $totalPrice = 0;
            $itemsCount = rand(1, 4);
            $selectedProducts = (array) array_rand($products, $itemsCount);
            
            foreach ((array)$selectedProducts as $pIdx) {
                $p = $products[$pIdx];
                $qty = rand(1, 3);
                OrderItem::create([
                    'order_id' => $order->id,
                    'product_id' => $p->id,
                    'quantity' => $qty,
                    'price' => $p->price,
                    'account_id' => $accountId
                ]);
                $totalPrice += $p->price * $qty;
            }

            $order->update(['total_price' => $totalPrice]);
            $customer->increment('total_spent', $totalPrice);
            $customer->increment('total_orders');

            // Add some Order Attribute Values
            foreach ($orderAttributes as $attr) {
                if (rand(1, 10) > 3) { // 70% chance to have value
                    $val = '';
                    if ($attr->frontend_type == 'select' || $attr->frontend_type == 'multiselect') {
                        $opt = $attr->options->random();
                        $val = $opt->value;
                    } elseif ($attr->frontend_type == 'textarea' || $attr->frontend_type == 'text') {
                        $val = "Dữ liệu demo cho " . $attr->name;
                    }

                    if ($val) {
                        OrderAttributeValue::create([
                            'order_id' => $order->id,
                            'attribute_id' => $attr->id,
                            'value' => $val
                        ]);
                    }
                }
            }
        }
    }
}
