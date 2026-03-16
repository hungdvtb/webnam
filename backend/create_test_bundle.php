<?php
use App\Models\Product;
use Illuminate\Support\Facades\DB;

require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

DB::beginTransaction();
try {
    // Delete existing test product if exists
    Product::where('sku', 'test100')->delete();

    $bundle = Product::create([
        'type' => 'bundle',
        'name' => 'Bộ Đồ Thờ Cao Cấp Demo (Test 100)',
        'sku' => 'test100',
        'price' => 5000000,
        'status' => 1,
        'description' => 'Sản phẩm bundle demo để test tính năng quản lý biến thể trong cấu hình bộ.',
        'slug' => 'bo-do-tho-cao-cap-demo-test-100'
    ]);

    $items = [
        // Ban thờ 1m27
        [
            'id' => 646, // Lọ hoa
            'quantity' => 1,
            'is_required' => 1,
            'link_type' => 'bundle',
            'position' => 0,
            'option_title' => 'Ban thờ 1m27',
            'is_default' => 1,
            'variant_id' => null
        ],
        [
            'id' => 647, // Bát hương
            'quantity' => 1,
            'is_required' => 1,
            'link_type' => 'bundle',
            'position' => 1,
            'option_title' => 'Ban thờ 1m27',
            'is_default' => 1,
            'variant_id' => null
        ],
        [
            'id' => 649, // Bát hương Cao cấp (Configurable)
            'quantity' => 1,
            'is_required' => 1,
            'link_type' => 'bundle',
            'position' => 2,
            'option_title' => 'Ban thờ 1m27',
            'is_default' => 1,
            'variant_id' => 650 // Specific variant
        ],
        // Ban thờ 1m75
        [
            'id' => 646,
            'quantity' => 2,
            'is_required' => 1,
            'link_type' => 'bundle',
            'position' => 3,
            'option_title' => 'Ban thờ 1m75',
            'is_default' => 0,
            'variant_id' => null
        ],
        [
            'id' => 649,
            'quantity' => 1,
            'is_required' => 1,
            'link_type' => 'bundle',
            'position' => 4,
            'option_title' => 'Ban thờ 1m75',
            'is_default' => 0,
            'variant_id' => 651 // Different variant
        ]
    ];

    foreach ($items as $item) {
        $id = $item['id'];
        unset($item['id']);
        $bundle->bundleItems()->attach($id, $item);
    }

    DB::commit();
    echo "Successfully created bundle product test100\n";
} catch (\Exception $e) {
    DB::rollBack();
    echo "Error: " . $e->getMessage() . "\n";
}
