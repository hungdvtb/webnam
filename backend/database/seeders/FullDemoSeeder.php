<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\Product;
use App\Models\Category;
use App\Models\ProductImage;
use App\Models\ProductAttributeValue;
use App\Models\OrderAttributeValue;
use App\Models\Attribute;
use App\Models\AttributeOption;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderStatus;
use App\Models\Customer;
use App\Models\Account;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;
use Faker\Factory as Faker;

class FullDemoSeeder extends Seeder
{
    public function run()
    {
        $faker = Faker::create('vi_VN');
        $account = Account::first();
        if (!$account) {
            $account = Account::create(['name' => 'Gốm Sứ Việt', 'domain' => 'localhost', 'subdomain' => 'admin']);
        }
        $accountId = $account->id;
        app(\App\Services\BlogSystemPostService::class)->ensureForAccount((int) $accountId);

        // 1. Ensure Fundamental Categories exist
        $categoriesNames = [
            'Bình Gốm Chu Đậu', 'Lọ Hoa Men Lam', 'Bát Hương Đắp Nổi', 
            'Bộ Ấm Trà Tử Sa', 'Tượng Gốm Phong Thủy', 'Đĩa Trang Trí Vẽ Tay', 
            'Bộ Chén Bát Gia Đình', 'Quà Tặng Gốm Sứ Cao Cấp', 'Đồ thờ cúng Bát Tràng'
        ];
        
        $categories = [];
        foreach ($categoriesNames as $name) {
            $categories[] = Category::updateOrCreate(
                ['name' => $name, 'account_id' => $accountId],
                ['slug' => Str::slug($name) . '-' . $accountId, 'description' => "Danh mục $name cao cấp từ làng gốm Bát Tràng."]
            );
        }

        // 2. Clear previous demo data
        echo "Cleaning old demo data...\n";
        Product::where('sku', 'LIKE', 'DEMO-%')->forceDelete();
        Order::where('order_number', 'LIKE', 'ORD-%')->forceDelete();
        Customer::where('group', 'VIP-TEST')->forceDelete();

        // 3. Fetch Attributes for seeding
        $productAttributes = Attribute::where('entity_type', 'product')
            ->where('account_id', $accountId)
            ->get()->keyBy('code');
            
        $orderAttributes = Attribute::where('entity_type', 'order')
            ->where('account_id', $accountId)
            ->get()->keyBy('code');

        // 4. Create 100 Products
        echo "Generating 100 Products...\n";
        $potteryTypes = [
            'Bình hút tài lộc', 'Lọ hoa dáng tỳ bà', 'Bát hương men rạn', 'Bộ ấm trà mây tre',
            'Tượng Di Lặc', 'Đĩa cảnh bát tiên', 'Bộ bát đĩa hoa sen', 'Bình tỳ bà vẽ vàng',
            'Khay trà gốm', 'Lư hương đồng', 'Tượng Tam Đa', 'Bình gốm sơn mài', 'Chén trà men ngọc'
        ];

        $artists = ['Nghệ nhân Nhân dân Trần Độ', 'Nghệ nhân Ưu tú Hà Sơn', 'Nghệ nhân Phạm Anh Đạo', 'Nghệ nhân Nguyễn Lợi', 'Vương Mạnh Tuấn'];
        $mens = ['Men rạn', 'Men lam', 'Men ngọc', 'Men nâu', 'Men hoàng thạch', 'Men khử', 'Men đá'];
        $certifications = ['ISO 9001', 'OCOP 4 sao', 'OCOP 5 sao', 'Hàng VN CLC', 'Chứng nhận Bát Tràng'];

        $demoProducts = [];
        for ($i = 1; $i <= 100; $i++) {
            $type = $faker->randomElement($potteryTypes);
            $name = "$type #" . str_pad($i, 3, '0', STR_PAD_LEFT) . " - " . $faker->words(2, true);
            $sku = "DEMO-GOM-" . str_pad($i, 4, '0', STR_PAD_LEFT);
            $price = $faker->randomElement([500000, 1200000, 2500000, 4800000, 8500000, 15000000, 25000000]);
            $costPrice = $price * 0.45;
            $cat = $faker->randomElement($categories);

            $product = Product::create([
                'account_id' => $accountId,
                'category_id' => $cat->id,
                'type' => 'simple',
                'name' => $name,
                'slug' => Str::slug($name) . '-' . uniqid(),
                'sku' => $sku,
                'description' => "<h3>Câu chuyện về $name</h3><p>" . $faker->paragraphs(3, true) . "</p>",
                'price' => $price,
                'cost_price' => $costPrice,
                'stock_quantity' => $faker->numberBetween(0, 50),
                'status' => true,
                'is_featured' => $faker->boolean(15),
                'is_new' => $faker->boolean(25),
                'weight' => $faker->randomFloat(2, 0.5, 25.0),
                'meta_title' => $name . " | Gốm Sứ Bát Tràng Cao Cấp",
                'meta_description' => Str::limit($faker->paragraph, 155),
                'meta_keywords' => "gốm sứ, bát tràng, $type, phong thủy, quà tặng cao cấp",
            ]);

            // Gallery Images
            $imgCount = $faker->numberBetween(1, 4);
            for ($j = 0; $j < $imgCount; $j++) {
                ProductImage::create([
                    'product_id' => $product->id,
                    'image_url' => "https://picsum.photos/seed/" . Str::slug($name) . "-$j/800/1000",
                    'is_primary' => $j === 0,
                    'sort_order' => $j,
                    'file_name' => "gom_$i" . "_$j.jpg",
                    'file_size' => $faker->numberBetween(150, 450) * 1024,
                ]);
            }

            // Fill Custom Attributes for Product
            $attrsToFill = [
                'nghe_nhan' => $faker->randomElement($artists),
                'cau_chuyen' => "Sản phẩm độc bản được nghệ nhân kỳ công thực hiện trong 30 ngày.",
                'ngay_ra_lo' => $faker->date(),
                'loai_men' => $faker->randomElement($mens),
                'chung_chi' => json_encode($faker->randomElements($certifications, 2)),
                'phi_mau_dich' => $faker->boolean(10) ? 'Có' : 'Không',
                'phi_bao_hiem' => $price * 0.02,
                'anh_chung_nhan' => "https://picsum.photos/seed/cert-" . $product->id . "/400/600"
            ];

            foreach ($attrsToFill as $code => $val) {
                if ($productAttributes->has($code)) {
                    ProductAttributeValue::create([
                        'product_id' => $product->id, 
                        'attribute_id' => $productAttributes[$code]->id, 
                        'value' => $val
                    ]);
                }
            }

            $demoProducts[] = $product;
        }

        // 5. Create 100 Orders
        echo "Generating 100 Orders...\n";
        $orderStatuses = OrderStatus::where('account_id', $accountId)->pluck('code')->toArray();
        if (empty($orderStatuses)) {
            $orderStatuses = ['new', 'processing', 'shipping', 'completed', 'cancelled'];
        }

        $shippingUnits = ['Giao hàng Tiết Kiệm', 'Viettel Post', 'VNPost', 'J&T Express', 'GrabExpress'];
        $orderSources = ['Facebook Shop', 'Zalo Page', 'Tiktok Shop', 'Website', 'Cửa hàng'];
        $cities = ['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ', 'Quảng Ninh', 'Bắc Ninh'];
        $districts = ['Quận 1', 'Quận 3', 'Quận 5', 'Quận 7', 'Quận Hoàn Kiếm', 'Quận Ba Đình', 'Quận Cầu Giấy', 'Quận Ninh Kiều'];

        // Customers
        $customers = [];
        for ($c = 0; $c < 50; $c++) {
            $phone = '09' . $faker->numerify('########');
            $customers[] = Customer::create([
                'account_id' => $accountId,
                'name' => $faker->name,
                'phone' => $phone,
                'email' => $faker->unique()->safeEmail,
                'address' => $faker->streetAddress . ", " . $faker->randomElement($districts) . ", " . $faker->randomElement($cities),
                'group' => 'VIP-TEST',
            ]);
        }

        for ($i = 1; $i <= 100; $i++) {
            $customer = $faker->randomElement($customers);
            $status = $faker->randomElement($orderStatuses);
            $orderDate = $faker->dateTimeBetween('-45 days', 'now');
            
            $shippingFee = $faker->randomElement([0, 35000, 55000, 150000]);
            $discount = $faker->randomElement([0, 0, 50000, 100000, 200000]);

            $orderNumber = "ORD-" . $orderDate->format('ymd') . "-" . str_pad($i, 4, '0', STR_PAD_LEFT);

            $order = Order::create([
                'account_id' => $accountId,
                'order_number' => $orderNumber,
                'customer_id' => $customer->id,
                'customer_name' => $customer->name,
                'customer_phone' => $customer->phone,
                'customer_email' => $customer->email,
                'shipping_address' => $customer->address,
                'status' => $status,
                'source' => $faker->randomElement($orderSources),
                'type' => 'retail',
                'shipment_status' => $faker->randomElement(['ready', 'shipped', 'delivered', 'returned']),
                'shipping_fee' => $shippingFee,
                'discount' => $discount,
                'notes' => $faker->boolean(60) ? $faker->randomElement(['Hàng dễ vỡ, xin nhẹ tay', 'Giao sau 17h', 'Khách hẹn lấy tại kho', 'Hàng quà tặng, bọc kỹ']) : null,
                'total_price' => 0, 
                'cost_total' => 0,
                'created_at' => $orderDate,
                'updated_at' => $orderDate,
            ]);

            // Add Items (1-5 products)
            $itemCount = $faker->randomElement([1, 1, 1, 2, 2, 3, 4, 6]);
            $total = 0;
            $costTotal = 0;
            
            $chosenProducts = $faker->randomElements($demoProducts, $itemCount);
            foreach ($chosenProducts as $p) {
                $qty = $faker->numberBetween(1, 4);
                OrderItem::create([
                    'account_id' => $accountId,
                    'order_id' => $order->id,
                    'product_id' => $p->id,
                    'product_name_snapshot' => $p->name,
                    'product_sku_snapshot' => $p->sku,
                    'quantity' => $qty,
                    'price' => $p->price,
                    'cost_price' => $p->cost_price,
                ]);
                $total += ($p->price * $qty);
                $costTotal += ($p->cost_price * $qty);
            }

            $order->total_price = max(0, $total + $shippingFee - $discount);
            $order->cost_total = $costTotal;
            $order->save();

            // Fill Order Attributes
            $orderAttrs = [
                'shipping_provider' => $faker->randomElement($shippingUnits),
                'order_source' => $order->source,
                'internal_note' => $faker->boolean(30) ? "Đơn hàng từ khách quen, tặng kèm túi giấy." : null,
                'payment_status_attr' => $faker->randomElement(['Đã thanh toán đủ', 'Chờ xác nhận', 'COD']),
                'order_priority' => $faker->randomElement(['Thường', 'Gấp (Phải đi trong ngày)', 'Ưu tiên VIP'])
            ];

            foreach ($orderAttrs as $code => $val) {
                if ($val && $orderAttributes->has($code)) {
                    OrderAttributeValue::create([
                        'order_id' => $order->id,
                        'attribute_id' => $orderAttributes[$code]->id,
                        'value' => $val
                    ]);
                }
            }
        }
        echo "Done! Seeded 100 products and 100 orders successfully.\n";
    }
}
