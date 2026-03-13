<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$kernel->handle(Illuminate\Http\Request::capture());

$results = [
    'products' => Illuminate\Support\Facades\DB::select("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'products'"),
    'product_attribute_values' => Illuminate\Support\Facades\DB::select("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'product_attribute_values'"),
    'product_images' => Illuminate\Support\Facades\DB::select("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'product_images'")
];

file_put_contents('db_inspection_products.json', json_encode($results, JSON_PRETTY_PRINT));
echo "Done\n";
