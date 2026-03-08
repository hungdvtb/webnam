<?php

use App\Models\Product;
use App\Models\ProductGroup;
use Illuminate\Support\Str;

require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

echo "Starting combo creation...\n";

// Clear old groups
ProductGroup::truncate();
\DB::table('product_group_items')->truncate();

$productBinh = Product::where('name', 'like', '%Bình hoa%')->first();
$productTraTrang = Product::where('name', 'like', '%Bộ Trà Men Trắng%')->first();
$productTraDo = Product::where('name', 'like', '%Bộ Ấm Chén Bát Tràng Dáng QH Men Đỏ%')->first();

if ($productBinh && $productTraTrang) {
    echo "Creating Combo 1...\n";
    $group1 = ProductGroup::create([
        'name' => 'Combo Trà Đạo Hỷ Sự',
        'slug' => Str::slug('Combo Trà Đạo Hỷ Sự'),
        'description' => 'Sự kết hợp hoàn hảo giữa vẻ đẹp thanh cao của hoa sen và bộ ấm trà men trắng kẻ chỉ vàng cao cấp. Thích hợp làm quà tặng đẳng cấp.',
        'price' => null,
        'price_type' => 'sum', // Customer pays total of products
        'status' => true,
    ]);
    
    $group1->products()->attach($productBinh->id, ['quantity' => 1, 'is_required' => true]);
    $group1->products()->attach($productTraTrang->id, ['quantity' => 1, 'is_required' => true]);
    echo "Done combo 1.\n";
}

if ($productBinh && $productTraDo) {
    echo "Creating Combo 2...\n";
    $discountedPrice = ($productBinh->price + $productTraDo->price) * 0.9; // 10% off
    
    $group2 = ProductGroup::create([
        'name' => 'Bộ Quà Tặng Tân Gia Đại Cát',
        'slug' => Str::slug('Bộ Quà Tặng Tân Gia Đại Cát'),
        'description' => 'Combo bao gồm ấm trà men đỏ quyền lực và bình hoa men ngọc. Món quà tân gia rước tài lộc, mang đến vượng khí cho gia chủ.',
        'price' => $discountedPrice,
        'price_type' => 'fixed', // Special discount price
        'status' => true,
    ]);
    
    $group2->products()->attach($productBinh->id, ['quantity' => 1, 'is_required' => true]);
    $group2->products()->attach($productTraDo->id, ['quantity' => 1, 'is_required' => true]);
    echo "Done combo 2.\n";
}

echo "Combo creation complete!\n";
