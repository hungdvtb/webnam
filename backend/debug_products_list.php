<?php
require 'vendor/autoload.php';
$app = require_once 'bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\Product;

$skus = [
    'DEMO-CONFIG-DD6HRF-20',
    'DEMO-CONFIG-DD6HRF-20-V1',
    'DEMO-CONFIG-DD6HRF-20-V2',
    'DEMO-CONFIG-DD6HRF-20-V3',
    'DEMO-CONFIG-DD6HRF-20-V4',
    'DEMO-CONFIG-C27I5B-18',
    'DEMO-CONFIG-4HQRHK-11'
];

foreach ($skus as $sku) {
    $p = Product::where('sku', $sku)->first();
    if (!$p) {
        echo "Product not found: $sku\n";
        continue;
    }
    $parentLinks = $p->parentProducts()->get();
    echo "ID: {$p->id}, SKU: {$p->sku}, Type: {$p->type}, Parent Count: " . $parentLinks->count() . "\n";
    foreach ($parentLinks as $parent) {
        echo "  - Parent ID: {$parent->id}, SKU: {$parent->sku}, Link Type: {$parent->pivot->link_type}\n";
    }
    
    $childLinks = $p->linkedProducts()->get();
    echo "  - Child Count: " . $childLinks->count() . "\n";
    foreach ($childLinks as $child) {
        echo "    - Child ID: {$child->id}, SKU: {$child->sku}, Link Type: {$child->pivot->link_type}\n";
    }
}
