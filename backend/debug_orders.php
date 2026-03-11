<?php
require 'vendor/autoload.php';
$app = require_once 'bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\Order;
use App\Models\Account;

echo "Total Orders: " . Order::withoutGlobalScopes()->count() . "\n";
echo "Active User: " . (auth()->check() ? auth()->user()->name : "Not logged in") . "\n";

$accounts = Account::all();
foreach ($accounts as $acc) {
    echo "Account ID {$acc->id} ({$acc->name}): " . Order::withoutGlobalScopes()->where('account_id', $acc->id)->count() . " orders\n";
}

$orders = Order::withoutGlobalScopes()->limit(5)->get();
foreach ($orders as $o) {
    echo "Order #{$o->order_number} - Status: {$o->status} - Account: {$o->account_id}\n";
}
