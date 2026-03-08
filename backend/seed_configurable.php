<?php

use App\Models\Product;
use App\Models\ProductImage;
use App\Models\Category;
use App\Models\Attribute;
use App\Models\AttributeOption;
use App\Models\ProductAttributeValue;
use Illuminate\Support\Str;

require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

echo "Creating Configurable Product: Bình Hút Lộc...\n";

// 1. Ensure Attribute "Kích thước" exists
$attr = Attribute::updateOrCreate(
    ['code' => 'kich_thuoc'],
    [
        'name' => 'Kích thước',
        'type' => 'static', // standard Laravel column? no, we use EAV system in this project for attributes
        'frontend_type' => 'select',
        'is_filterable' => true,
        'is_required' => true,
    ]
);

// 2. Add Options
$options = ['25cm', '35cm', '45cm'];
foreach ($options as $val) {
    AttributeOption::updateOrCreate(
        ['attribute_id' => $attr->id, 'value' => $val],
        ['label' => $val, 'position' => 0]
    );
}

$cat = Category::where('name', 'Gốm Tâm Linh')->first() ?? Category::first();
$accountId = 1;

// 3. Create Parent (Configurable)
$parent = Product::create([
    'account_id' => $accountId,
    'category_id' => $cat->id,
    'type' => 'configurable',
    'name' => 'Bình Hút Lộc Vinh Hoa Phú Quý',
    'slug' => Str::slug('Bình Hút Lộc Vinh Hoa Phú Quý'),
    'description' => 'Bình hút lộc với các kích thước khác nhau phù hợp cho mọi không gian ban thờ hoặc phòng khách. Họa tiết vẽ vàng tinh xảo.',
    'price' => 2500000, // Base price displayed on list
    'status' => true,
    'sku' => 'BHL-VH-PARENT',
]);

// Link super attribute (size) to parent
$parent->superAttributes()->sync([$attr->id => ['position' => 0]]);

// 4. Create Children
$prices = [
    '25cm' => 2500000,
    '35cm' => 4500000,
    '45cm' => 8500000,
];

foreach ($prices as $size => $price) {
    $child = Product::create([
        'account_id' => $accountId,
        'category_id' => $cat->id,
        'type' => 'simple', // Children are simple products (visibility can be hidden but for now simple)
        'name' => "Bình Hút Lộc Vinh Hoa ($size)",
        'slug' => Str::slug("Bình Hút Lộc Vinh Hoa ($size)"),
        'price' => $price,
        'status' => true,
        'sku' => "BHL-VH-" . strtoupper($size),
        'stock_quantity' => rand(5, 15),
    ]);

    // Set size attribute for child
    ProductAttributeValue::create([
        'product_id' => $child->id,
        'attribute_id' => $attr->id,
        'value' => $size
    ]);

    // Add main image for child (reusing from parent or generic)
    ProductImage::create([
        'product_id' => $child->id,
        'image_url' => 'https://gomsuhoanggia.vn/wp-content/uploads/2021/04/binh-hut-loc-vinh-hoa-phu-quy-men-ngoc-ve-vang-h35cm-800x800.jpg',
        'is_primary' => true
    ]);

    // Link child to parent
    $parent->linkedProducts()->attach($child->id, ['link_type' => 'super_link', 'position' => 0]);
}

// Add image for parent
ProductImage::create([
    'product_id' => $parent->id,
    'image_url' => 'https://gomsuhoanggia.vn/wp-content/uploads/2021/04/binh-hut-loc-vinh-hoa-phu-quy-men-ngoc-ve-vang-h35cm-800x800.jpg',
    'is_primary' => true
]);

echo "Configurable Product created successfully!\n";
