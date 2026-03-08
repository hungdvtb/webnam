<?php

use App\Models\Product;
use App\Models\ProductImage;
use App\Models\Category;
use Illuminate\Support\Str;

require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

echo "Starting combo creation as Products...\n";

// Clear old grouped products
Product::where('type', 'group')->delete();

$productBinh = Product::where('name', 'like', '%Bình hoa%')->first();
$productTraTrang = Product::where('name', 'like', '%Bộ Trà Men Trắng%')->first();
$productTraDo = Product::where('name', 'like', '%Bộ Ấm Chén Bát Tràng Dáng QH Men Đỏ%')->first();

$accountId = $productBinh ? $productBinh->account_id : 1;
$categoryId = Category::where('name', 'Khác')->value('id') ?? Category::first()->id;

if ($productBinh && $productTraTrang) {
    echo "Creating Combo 1...\n";
    $discountedPrice = ($productBinh->price + $productTraTrang->price) * 0.9;
    
    $group1 = Product::create([
        'account_id' => $accountId,
        'category_id' => $categoryId,
        'type' => 'group',
        'name' => 'Combo Trà Đạo Hỷ Sự',
        'slug' => Str::slug('Combo Trà Đạo Hỷ Sự'),
        'description' => 'Sự kết hợp hoàn hảo giữa vẻ đẹp thanh cao của hoa sen và bộ ấm trà men trắng kẻ chỉ vàng cao cấp. Thích hợp làm quà tặng đẳng cấp.',
        'price' => $discountedPrice,
        'status' => true,
        'is_featured' => true,
        'stock_quantity' => parent_stock($productBinh, $productTraTrang),
        'sku' => 'COMBO-TRA-01',
    ]);
    
    // Add image (using binh hoa image)
    if ($img = $productBinh->images()->first()) {
        ProductImage::create([
            'product_id' => $group1->id,
            'image_url' => $img->image_url,
            'is_primary' => true,
        ]);
    }
    
    // Link via product_links (up-sell, cross-sell, group etc.)
    $group1->linkedProducts()->attach($productBinh->id, ['link_type' => 'group', 'position' => 1]);
    $group1->linkedProducts()->attach($productTraTrang->id, ['link_type' => 'group', 'position' => 2]);
    echo "Done combo 1.\n";
}

if ($productBinh && $productTraDo) {
    echo "Creating Combo 2...\n";
    $discountedPrice = ($productBinh->price + $productTraDo->price) * 0.85; // 15% off
    
    $group2 = Product::create([
        'account_id' => $accountId,
        'category_id' => $categoryId,
        'type' => 'group',
        'name' => 'Bộ Quà Tặng Tân Gia Đại Cát',
        'slug' => Str::slug('Bộ Quà Tặng Tân Gia Đại Cát'),
        'description' => 'Combo bao gồm ấm trà men đỏ quyền lực và bình hoa men ngọc. Món quà tân gia rước tài lộc, mang đến vượng khí cho gia chủ.',
        'price' => $discountedPrice,
        'status' => true,
        'is_featured' => true,
        'stock_quantity' => parent_stock($productBinh, $productTraDo),
        'sku' => 'COMBO-TAN-GIA-01',
    ]);
    
    if ($img = $productTraDo->images()->first()) {
        ProductImage::create([
            'product_id' => $group2->id,
            'image_url' => $img->image_url,
            'is_primary' => true,
        ]);
    }
    
    $group2->linkedProducts()->attach($productBinh->id, ['link_type' => 'group', 'position' => 1]);
    $group2->linkedProducts()->attach($productTraDo->id, ['link_type' => 'group', 'position' => 2]);
    echo "Done combo 2.\n";
}

echo "Combo creation complete!\n";

function parent_stock($p1, $p2) {
    // Stock is the minimum of its children
    return min($p1->stock_quantity ?? 0, $p2->stock_quantity ?? 0);
}
