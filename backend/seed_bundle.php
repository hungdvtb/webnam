<?php

use App\Models\Product;
use App\Models\ProductImage;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';

$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

DB::beginTransaction();

try {
    // 1. Find some existing simple products to bundle
    $items = Product::where('type', 'simple')->limit(5)->get();

    if ($items->count() < 3) {
        echo "Not enough simple products found to create a bundle. Please run other seeders first.\n";
        exit;
    }

    // 2. Create the Bundle Product
    $bundleSku = 'BUNDLE-THO-01';
    
    // Delete existing if any
    $existing = Product::withTrashed()->where('sku', $bundleSku)->first();
    if ($existing) {
        $existing->forceDelete();
    }

    $bundle = Product::create([
        'type' => 'bundle',
        'name' => 'Bộ Đồ Thờ Men Rạn Cổ Dát Vàng - Tam Thế Phật',
        'sku' => $bundleSku,
        'slug' => 'bo-do-tho-men-ran-co-dat-vang-tam-the-phat',
        'price' => 0, // Will be calculated if price_type is sum
        'price_type' => 'sum',
        'description' => 'Bộ đồ thờ cao cấp được chế tác thủ công từ làng nghề Bát Tràng, men rạn cổ dát vàng 24k sang trọng và đẳng cấp.',
        'specifications' => json_encode([
            ['label' => 'Chất liệu', 'value' => 'Gốm sứ men rạn'],
            ['label' => 'Họa tiết', 'value' => 'Đắp nổi, dát vàng 24k'],
            ['label' => 'Xuất xứ', 'value' => 'Bát Tràng, Việt Nam']
        ]),
        'status' => true,
        'account_id' => 1,
        'category_id' => $items[0]->category_id
    ]);

    echo "Created bundle: " . $bundle->name . "\n";

    // 3. Attach Items as Bundle Components
    foreach ($items as $idx => $item) {
        $qty = ($idx === 0) ? 1 : ($idx + 1);
        $bundle->bundleItems()->attach($item->id, [
            'link_type' => 'bundle',
            'quantity' => $qty,
            'is_required' => ($idx < 2), // First two are required
            'position' => $idx
        ]);
        echo "  - Added component: " . $item->name . " (Qty: $qty)\n";
    }

    // 4. Add Images to Bundle (Copy from components or use placeholder)
    $primaryImg = $items[0]->images()->where('is_primary', true)->first();
    if ($primaryImg) {
        ProductImage::create([
            'product_id' => $bundle->id,
            'image_url' => $primaryImg->image_url,
            'is_primary' => true,
            'sort_order' => 0
        ]);
    }

    DB::commit();
    echo "Successfully created bundle and linked components.\n";

} catch (\Exception $e) {
    DB::rollBack();
    echo "Error: " . $e->getMessage() . "\n";
}
