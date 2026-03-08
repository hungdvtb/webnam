<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\Product;
use App\Models\Category;
use App\Models\ProductImage;
use Illuminate\Support\Str;

echo "Starting product recreation...\n";

// Clear existing
ProductImage::truncate();
Product::query()->delete();

$accountId = 1;

// Ensure Categories
$catVase = Category::firstOrCreate(['slug' => 'binh-hoa'], [
    'name' => 'Bình Hoa',
    'account_id' => $accountId,
    'status' => 1
]);

$catTeaSet = Category::firstOrCreate(['slug' => 'am-chen'], [
    'name' => 'Ấm Chén',
    'account_id' => $accountId,
    'status' => 1
]);

$products = [
  [
    "name" => "Bình hoa 25 cm – Sen Vàng (men ngọc)",
    "price" => 2138400,
    "image_url" => "https://gomsuhoanggia.vn/wp-content/uploads/2021/05/Bình-hoa-25-cm-Sen-Vàng-men-ngọc-scaled-1.jpg",
    "category_id" => $catVase->id,
    "sku" => "BH-SV-25",
    "desc" => "Bình hoa cao cấp Bát Tràng họa tiết Sen Vàng vẽ tay tinh xảo trên nền men ngọc quý phái. Sản phẩm phù hợp bày biện phòng khách, bàn thờ hoặc làm quà tặng tân gia đẳng cấp."
  ],
  [
    "name" => "Bộ Trà Men Trắng Vẽ Sen Kẻ Chỉ Vàng",
    "price" => 1250000,
    "image_url" => "https://gomsuhoanggia.vn/wp-content/uploads/2020/08/BỘ-TRÀ-SEN-VẼ-VÀNG-GIÁ-1.250.000VND.jpg",
    "category_id" => $catTeaSet->id,
    "sku" => "AC-SEN-VANG",
    "desc" => "Bộ ấm chén Bát Tràng men trắng cao cấp, vẽ sen vàng kim thủ công. Sự kết hợp hoàn hảo giữa nét truyền thống và vẻ sang trọng hiện đại."
  ],
  [
    "name" => "Bộ Âm Chén Bát Tràng Cao Cấp Men Màu Xanh VCV",
    "price" => 950000,
    "image_url" => "https://gomsuhoanggia.vn/wp-content/uploads/2025/02/Bo-am-chen-men-mau-xanh-da-vcv.jpg",
    "category_id" => $catTeaSet->id,
    "sku" => "AC-XANH-VCV",
    "desc" => "Bộ ấm chén với sắc xanh cổ điển, nước men bóng mịn đặc trưng của làng nghề Bát Tràng. Phù hợp cho những buổi trà đạo thư giãn."
  ],
  [
    "name" => "Bộ Ấm Chén Bát Tràng Dáng QH Men Đỏ Vẽ Vàng Cao Cấp",
    "price" => 950000,
    "image_url" => "https://gomsuhoanggia.vn/wp-content/uploads/2025/02/Bo-Am-Chen-Men-Mau-Do-Ve-Vang-.jpg",
    "category_id" => $catTeaSet->id,
    "sku" => "AC-DO-VANG",
    "desc" => "Dáng ấm QH quý phái, sắc đỏ đại cát kết hợp cùng họa tiết vẽ vàng kim mang lại sự may mắn và thịnh vượng cho gia chủ."
  ],
  [
    "name" => "Bộ Ấm Chén Phú Quý Cao Cấp Men Xanh Ngọc Vẽ Vàng",
    "price" => 950000,
    "image_url" => "https://gomsuhoanggia.vn/wp-content/uploads/2025/02/Bo-am-chen-phu-quy-men-da-ve-vang.jpg",
    "category_id" => $catTeaSet->id,
    "sku" => "AC-PQ-XN",
    "desc" => "Bộ ấm chén Phú Quý men xanh ngọc bích cực kỳ sang trọng, từng đường nét vẽ vàng tinh khôi. Sản phẩm bán chạy nhất năm 2024."
  ],
  [
    "name" => "Bộ Ấm Trà Cao Cấp Bát Tràng Men Xanh Ngọc",
    "price" => 950000,
    "image_url" => "https://gomsuhoanggia.vn/wp-content/uploads/2025/02/7.jpg",
    "category_id" => $catTeaSet->id,
    "sku" => "AC-XN-7",
    "desc" => "Bộ ấm trà truyền thống Bát Tràng với chất men xanh ngọc mướt mát, bền đẹp theo thời gian."
  ]
];

foreach ($products as $pData) {
    echo "Creating product: " . $pData['name'] . "\n";
    $product = Product::create([
        'account_id' => $accountId,
        'category_id' => $pData['category_id'],
        'name' => $pData['name'],
        'slug' => Str::slug($pData['name']),
        'description' => $pData['desc'],
        'price' => $pData['price'],
        'sku' => $pData['sku'],
        'status' => true,
        'is_featured' => true,
        'type' => 'simple',
        'stock_quantity' => 20
    ]);

    ProductImage::create([
        'product_id' => $product->id,
        'image_url' => $pData['image_url'],
        'is_primary' => true,
        'account_id' => $accountId
    ]);
}

echo "All products recreated successfully!\n";
