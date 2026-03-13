<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$kernel->handle(Illuminate\Http\Request::capture());

$results = [
    'orders' => Illuminate\Support\Facades\DB::select("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'orders'"),
    'order_items' => Illuminate\Support\Facades\DB::select("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'order_items'"),
    'order_attribute_values' => Illuminate\Support\Facades\DB::select("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'order_attribute_values'")
];

file_put_contents('db_inspection.json', json_encode($results, JSON_PRETTY_PRINT));
echo "Done\n";
