<?php
require 'vendor/autoload.php';
$app = require_once 'bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

$tables = ['orders', 'order_items', 'customers', 'products', 'order_attribute_values'];
$results = [];

foreach ($tables as $table) {
    if (Schema::hasTable($table)) {
        $indexes = DB::select("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = ?", [$table]);
        $results[$table] = [
            'count' => DB::table($table)->count(),
            'indexes' => $indexes
        ];
    }
}

file_put_contents('db_inspection.json', json_encode($results, JSON_PRETTY_PRINT));
