<?php
require 'vendor/autoload.php';
$app = require_once 'bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\Product;

$sku = 'DEMO-CONFIG-DD6HRF-20';
$parent = Product::where('sku', $sku)->first();

if (!$parent) {
    echo "Parent not found: $sku\n";
    exit;
}

echo "Parent: {$parent->id} - {$parent->sku} - Type: {$parent->type}\n";

echo "Children (linkedProducts):\n";
foreach ($parent->linkedProducts as $child) {
    echo "- ID: {$child->id}, SKU: {$child->sku}, Type: {$child->type}, Link Type: " . $child->pivot->link_type . "\n";
}

echo "\nAll products in DB (top 20):\n";
foreach (Product::limit(20)->get() as $p) {
    $parentCount = $p->parentProducts()->count();
    echo "ID: {$p->id}, SKU: {$p->sku}, Type: {$p->type}, Parent Count: $parentCount\n";
}
